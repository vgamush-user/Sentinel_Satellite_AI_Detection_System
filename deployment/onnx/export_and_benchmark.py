"""
export_and_benchmark.py
------------------------
Week 5 (Hardening) stretch goal — "ONNX Runtime + dynamic quantization"
(tech stack table: ML Lead + Software/Integration Lead), tying back to the
original deck's onboard/SWaP-constrained claim: is the detection model
small and fast enough to plausibly run onboard a resource-constrained
CubeSat, not just on a ground-segment server?

This script does five things, in order, and prints/saves real measured
numbers for every one of them -- nothing here is asserted without being
run against the actual `baseline_xgb.json` model and the actual
`noised_dataset.csv` domain-shift test set (the project's own established
"real" evaluation set, per the 6-week plan and week4_integration.md):

  1. Export `src/ml/baseline_xgb.json` to ONNX (fp32) and verify it
     produces byte-for-byte identical class predictions to the native
     XGBoost model on the full noised set -- not just "looks about right."
  2. Attempt ONNX Runtime dynamic quantization on that export, and if it
     fails, report exactly why instead of silently skipping it. (Spoiler,
     confirmed against ONNX Runtime's own quantization operator registry:
     it fails, and the reason is architectural, not a bug in this script
     -- see ONNX_QUANTIZATION_REPORT.md.)
  3. Benchmark inference latency: native XGBoost vs. ONNX Runtime (fp32),
     both single-row (matches how the live agent pipeline actually calls
     the classifier -- one telemetry window at a time) and full-batch.
  4. Compare on-disk model size: the native XGBoost JSON vs. the ONNX
     export.
  5. Because tensor quantization doesn't apply to a tree ensemble, run
     the compression lever that actually does: fewer boosting rounds.
     Slice the booster at several round counts and measure the real
     accuracy/macro-F1 trade-off against the domain-shift test set, plus
     the resulting ONNX file size at each size -- this is the honest
     answer to "can this be made smaller for SWaP-constrained deployment"
     for a tree-ensemble model specifically.

Run:
    pip install -r deployment/onnx/requirements.txt
    python deployment/onnx/export_and_benchmark.py

Writes:
    deployment/onnx/model_fp32.onnx
    deployment/onnx/benchmark_results.json
"""
from __future__ import annotations

import json
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, f1_score

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ONNX_DIR = Path(__file__).resolve().parent
ML_DIR = PROJECT_ROOT / "src" / "ml"

MODEL_PATH = ML_DIR / "baseline_xgb.json"
FEATURE_ORDER_PATH = ML_DIR / "baseline_feature_order.json"
NOISED_CSV = PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv"
CLASS_NAMES = ["Normal", "Storage Exhaustion", "Command Flooding", "Data Injection", "Defence Impairment"]

FP32_ONNX_PATH = ONNX_DIR / "model_fp32.onnx"
INT8_ONNX_PATH = ONNX_DIR / "model_int8.onnx"
RESULTS_PATH = ONNX_DIR / "benchmark_results.json"

SINGLE_ROW_REPEATS = 500  # timed single-row predictions per engine
WARMUP_ROWS = 20


def load_model_and_data():
    model = xgb.XGBClassifier()
    model.load_model(str(MODEL_PATH))
    feature_order = json.loads(FEATURE_ORDER_PATH.read_text())

    noised = pd.read_csv(NOISED_CSV)
    X = noised[feature_order].values.astype(np.float32)
    y = noised["Label"].values.astype(int)
    return model, feature_order, X, y


def export_to_onnx(model: xgb.XGBClassifier, feature_order: list[str]) -> None:
    """onnxmltools' XGBoost converter can't map named feature columns back
    to tree-node feature indices (it expects the internal 'f%d' pattern
    XGBoost uses when trained without column names) -- it raises
    `RuntimeError: Unable to interpret 'MemoryShmemMB', feature names
    should follow pattern 'f%d'.` on this exact model, confirmed while
    building this script. Clearing the booster's feature_names before
    conversion works around it; predict() never needed the names anyway
    (only DataFrame-input validation does), so this has zero effect on
    the model's actual behavior -- confirmed below by the 100% prediction
    agreement check."""
    from onnxmltools.convert import convert_xgboost
    from onnxmltools.convert.common.data_types import FloatTensorType

    booster = model.get_booster()
    booster.feature_names = None

    initial_type = [("float_input", FloatTensorType([None, len(feature_order)]))]
    onnx_model = convert_xgboost(model, initial_types=initial_type)
    FP32_ONNX_PATH.write_bytes(onnx_model.SerializeToString())


def verify_onnx_matches_native(model: xgb.XGBClassifier, X: np.ndarray, y: np.ndarray) -> dict:
    import onnxruntime as ort

    xgb_pred = model.predict(X)

    sess = ort.InferenceSession(str(FP32_ONNX_PATH), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    onnx_label, _onnx_proba = sess.run(None, {input_name: X})

    agreement = float((onnx_label == xgb_pred).mean())
    return {
        "onnx_vs_native_label_agreement": agreement,
        "native_accuracy_vs_true_label": float(accuracy_score(y, xgb_pred)),
        "native_macro_f1_vs_true_label": float(f1_score(y, xgb_pred, average="macro")),
        "onnx_accuracy_vs_true_label": float(accuracy_score(y, onnx_label)),
        "onnx_macro_f1_vs_true_label": float(f1_score(y, onnx_label, average="macro")),
    }


def attempt_dynamic_quantization() -> dict:
    """Attempts ONNX Runtime dynamic weight quantization on the fp32
    export. Expected (and confirmed, see ONNX_QUANTIZATION_REPORT.md) to
    fail: the converted model is a single ai.onnx.ml `TreeEnsembleClassifier`
    node with zero initializer tensors -- every split threshold and leaf
    value is a node *attribute*, not a weight tensor. ONNX Runtime's
    quantization tooling (both the dynamic `IntegerOpsRegistry` and the
    static `QLinearOpsRegistry`, per its own registry.py) only targets
    tensor-weighted ops like Conv/MatMul/Gemm/LSTM/Attention. There is
    nothing in a tree-ensemble ONNX graph for it to quantize, which is why
    it fails at the very first step (it can't even find a standard 'ai.onnx'
    domain opset import to target, since the whole graph is 'ai.onnx.ml')."""
    from onnxruntime.quantization import QuantType, quantize_dynamic

    try:
        quantize_dynamic(
            model_input=str(FP32_ONNX_PATH),
            model_output=str(INT8_ONNX_PATH),
            weight_type=QuantType.QUInt8,
        )
        return {"attempted": True, "succeeded": True, "int8_model_path": str(INT8_ONNX_PATH)}
    except Exception as e:
        return {
            "attempted": True,
            "succeeded": False,
            "error_type": type(e).__name__,
            "error_message": str(e),
            "explanation": (
                "Architectural, not a bug in this script or an environment gap: XGBoost's ONNX "
                "export is one TreeEnsembleClassifier op (ai.onnx.ml domain) with all thresholds/"
                "leaf values stored as node attributes -- zero initializer tensors exist to "
                "quantize. Confirmed against ONNX Runtime's own quantization/registry.py: neither "
                "IntegerOpsRegistry (dynamic) nor QLinearOpsRegistry (static) lists TreeEnsemble* "
                "or any ai.onnx.ml op. See ONNX_QUANTIZATION_REPORT.md for the full writeup and "
                "what compression lever actually works for a tree ensemble instead."
            ),
        }


def benchmark_latency(model: xgb.XGBClassifier, X: np.ndarray) -> dict:
    import onnxruntime as ort

    results: dict = {}
    single_row = X[:1]

    # --- native XGBoost ---
    for _ in range(WARMUP_ROWS):
        model.predict_proba(single_row)
    t0 = time.perf_counter()
    for _ in range(SINGLE_ROW_REPEATS):
        model.predict_proba(single_row)
    xgb_single_ms = (time.perf_counter() - t0) / SINGLE_ROW_REPEATS * 1000

    t0 = time.perf_counter()
    model.predict_proba(X)
    xgb_batch_sec = time.perf_counter() - t0

    results["xgboost_native"] = {
        "single_row_ms_mean": xgb_single_ms,
        "batch_total_sec": xgb_batch_sec,
        "batch_rows_per_sec": len(X) / xgb_batch_sec,
    }

    # --- ONNX Runtime, at two graph-optimization levels ---
    for level_name, level in [
        ("disabled", ort.GraphOptimizationLevel.ORT_DISABLE_ALL),
        ("all", ort.GraphOptimizationLevel.ORT_ENABLE_ALL),
    ]:
        so = ort.SessionOptions()
        so.graph_optimization_level = level
        sess = ort.InferenceSession(str(FP32_ONNX_PATH), sess_options=so, providers=["CPUExecutionProvider"])
        input_name = sess.get_inputs()[0].name

        for _ in range(WARMUP_ROWS):
            sess.run(None, {input_name: single_row})
        t0 = time.perf_counter()
        for _ in range(SINGLE_ROW_REPEATS):
            sess.run(None, {input_name: single_row})
        onnx_single_ms = (time.perf_counter() - t0) / SINGLE_ROW_REPEATS * 1000

        t0 = time.perf_counter()
        sess.run(None, {input_name: X})
        onnx_batch_sec = time.perf_counter() - t0

        results[f"onnxruntime_fp32_opt_{level_name}"] = {
            "single_row_ms_mean": onnx_single_ms,
            "batch_total_sec": onnx_batch_sec,
            "batch_rows_per_sec": len(X) / onnx_batch_sec,
        }

    return results


def compare_model_size() -> dict:
    native_bytes = MODEL_PATH.stat().st_size
    onnx_bytes = FP32_ONNX_PATH.stat().st_size
    return {
        "native_xgboost_json_bytes": native_bytes,
        "onnx_fp32_bytes": onnx_bytes,
        "onnx_vs_native_ratio": onnx_bytes / native_bytes,
    }


def round_count_tradeoff(model: xgb.XGBClassifier, feature_order: list[str], X: np.ndarray, y: np.ndarray) -> list[dict]:
    """The compression lever that DOES work for a tree ensemble: fewer
    boosting rounds. `booster[:k]` slices by round (handles the 5-tree-
    per-round multiclass grouping correctly), so this is a real, valid
    XGBoost model at every k, not an approximation."""
    full_booster = model.get_booster()
    full_rounds = full_booster.num_boosted_rounds()
    dmat = xgb.DMatrix(X, feature_names=feature_order)

    rows = []
    for k in [10, 20, 30, 35, 40, 50, 75, 100, full_rounds]:
        if k > full_rounds:
            continue
        sliced = full_booster[:k] if k < full_rounds else full_booster
        proba = sliced.predict(dmat)
        pred = proba.argmax(axis=1)

        # Export this slice to ONNX too, to get a real file-size number at
        # this round count (not an estimate) -- reuses the same
        # feature-names workaround as the full export.
        sliced.feature_names = None
        from onnxmltools.convert import convert_xgboost
        from onnxmltools.convert.common.data_types import FloatTensorType

        sliced_clf = xgb.XGBClassifier()
        sliced_clf._Booster = sliced
        sliced_clf.n_classes_ = len(CLASS_NAMES)
        onnx_sliced = convert_xgboost(sliced_clf, initial_types=[("float_input", FloatTensorType([None, len(feature_order)]))])
        sliced_onnx_bytes = len(onnx_sliced.SerializeToString())

        rows.append(
            {
                "rounds": k,
                "rounds_pct_of_full": round(100 * k / full_rounds, 1),
                "accuracy": float(accuracy_score(y, pred)),
                "macro_f1": float(f1_score(y, pred, average="macro")),
                "onnx_bytes": sliced_onnx_bytes,
                "onnx_bytes_pct_of_full": None,  # filled in below once full size is known
            }
        )

    full_size = next(r["onnx_bytes"] for r in rows if r["rounds"] == full_rounds)
    for r in rows:
        r["onnx_bytes_pct_of_full"] = round(100 * r["onnx_bytes"] / full_size, 1)
    return rows


def main() -> None:
    print("=" * 70)
    print("SentinelSat — ONNX export + quantization benchmark (Week 5 stretch goal)")
    print("=" * 70)

    print("\n[1/5] Loading baseline_xgb.json + noised_dataset.csv (domain-shift test set)...")
    model, feature_order, X, y = load_model_and_data()
    print(f"      {len(feature_order)} features, {len(X):,} test rows.")

    print("\n[2/5] Exporting to ONNX (fp32) and verifying against native XGBoost...")
    export_to_onnx(model, feature_order)
    agreement = verify_onnx_matches_native(model, X, y)
    print(f"      Label agreement (ONNX vs native XGBoost): {agreement['onnx_vs_native_label_agreement']:.4%}")
    print(f"      Native accuracy / macro F1: {agreement['native_accuracy_vs_true_label']:.4f} / {agreement['native_macro_f1_vs_true_label']:.4f}")
    print(f"      ONNX   accuracy / macro F1: {agreement['onnx_accuracy_vs_true_label']:.4f} / {agreement['onnx_macro_f1_vs_true_label']:.4f}")
    if agreement["onnx_vs_native_label_agreement"] < 1.0:
        print("      WARNING: ONNX export does not perfectly match the native model's predictions.")

    print("\n[3/5] Attempting ONNX Runtime dynamic quantization...")
    quant_result = attempt_dynamic_quantization()
    if quant_result["succeeded"]:
        print("      Quantization succeeded (unexpected for a tree ensemble -- verify results carefully).")
    else:
        print(f"      Failed as expected: {quant_result['error_type']}: {quant_result['error_message']}")
        print("      See ONNX_QUANTIZATION_REPORT.md for why this is architectural, not a bug.")

    print("\n[4/5] Benchmarking inference latency (native XGBoost vs. ONNX Runtime)...")
    latency = benchmark_latency(model, X)
    for engine, stats in latency.items():
        print(f"      {engine:32s} single-row: {stats['single_row_ms_mean']:.4f} ms   batch: {stats['batch_rows_per_sec']:,.0f} rows/sec")

    print("\n      Comparing on-disk model size...")
    size_cmp = compare_model_size()
    print(f"      native XGBoost JSON: {size_cmp['native_xgboost_json_bytes']:,} bytes")
    print(f"      ONNX fp32:           {size_cmp['onnx_fp32_bytes']:,} bytes ({size_cmp['onnx_vs_native_ratio']:.2%} of native)")

    print("\n[5/5] Round-count trade-off (the compression lever that actually applies to a tree ensemble)...")
    tradeoff = round_count_tradeoff(model, feature_order, X, y)
    for r in tradeoff:
        print(
            f"      rounds={r['rounds']:>3}/{tradeoff[-1]['rounds']} ({r['rounds_pct_of_full']:>5.1f}%)   "
            f"acc={r['accuracy']:.4f}  macroF1={r['macro_f1']:.4f}   "
            f"onnx_size={r['onnx_bytes']:,}B ({r['onnx_bytes_pct_of_full']}% of full)"
        )

    results = {
        "onnx_export_verification": agreement,
        "quantization_attempt": quant_result,
        "latency_benchmark": latency,
        "model_size_comparison": size_cmp,
        "round_count_tradeoff": tradeoff,
    }
    RESULTS_PATH.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {RESULTS_PATH.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)

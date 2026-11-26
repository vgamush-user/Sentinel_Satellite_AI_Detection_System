# ONNX Export + Quantization Benchmark — Week 5 Stretch Goal

**Owner:** ML Lead + Software/Integration Lead (per the tech stack table: *"Model
compression (stretch): ONNX Runtime + dynamic quantization"*).
**Goal (from the 6-week plan):** tie back to the original deck's onboard /
SWaP-constrained claim — is the detection model plausibly small and fast
enough to run onboard a resource-constrained CubeSat, not just on a ground
server?

**Reproduce:** `python deployment/onnx/export_and_benchmark.py` (writes
`model_fp32.onnx` and `benchmark_results.json` — every number below comes
from that file, run against `src/ml/baseline_xgb.json` and the project's
established domain-shift test set, `data/noised/noised_dataset.csv`).

## Headline finding: quantization doesn't apply here, and that's a real result, not a gap

The plan's stretch goal names "ONNX Runtime + dynamic quantization" as one
item, but for a tree-ensemble model like this project's XGBoost classifier
they're two separable steps with two different outcomes:

- **ONNX export: works, and is valuable on its own.**
- **ONNX Runtime dynamic quantization: does not apply to tree ensembles**,
  confirmed by actually running it and by checking ONNX Runtime's own
  source, not assumed.

### Why quantization fails (verified, not guessed)

Running `onnxruntime.quantization.quantize_dynamic()` on the exported model
fails immediately:
```
ValueError: Failed to find proper ai.onnx domain
```
Inspecting the exported graph explains why — it is a **single node**:
```
opset imports: domain='ai.onnx.ml' version=1
nodes: op_type=TreeEnsembleClassifier domain='ai.onnx.ml'
initializers: []  <-- zero weight tensors
```
Every split threshold and leaf value in all 150 boosting rounds is packed
into that one op's **attributes** (`nodes_values`, `class_weights`, etc.),
not stored as separate float32 tensors the way a neural network's
`Gemm`/`MatMul`/`Conv` weights are. ONNX Runtime's quantization tooling
only targets ops with actual weight tensors to requantize — checked
directly against `onnxruntime/python/tools/quantization/registry.py`:
`IntegerOpsRegistry` (dynamic quantization) covers `Conv`, `MatMul`,
`Attention`, `LSTM` (+ `Gather`/`Transpose`/`EmbedLayerNormalization`
passthroughs); `QLinearOpsRegistry` (static) covers a longer list of the
same kind of standard tensor-op. **Neither lists `TreeEnsembleClassifier`
or any `ai.onnx.ml` op.** There is nothing in this graph for ONNX Runtime's
quantizer to act on — the "Failed to find proper ai.onnx domain" error is
it failing at the first step (finding a standard-domain opset to target)
because the graph never imports one.

This is a known, general limitation, not something specific to this
project's model or an XGBoost version issue — see
[microsoft/onnxruntime#15563](https://github.com/microsoft/onnxruntime/issues/15563)
for another user hitting the same "Failed to find proper ai.onnx domain"
error on an unrelated ai.onnx.ml-domain model, and the
[quantization docs](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
for the supported-op registry ONNX Runtime itself points to. **Conclusion:
ONNX Runtime tensor quantization is the wrong tool for compressing a tree
ensemble.** It's the right tool for the deep-learning half of this
project's stretch scope (an LSTM, if one were exported to ONNX) — just not
for XGBoost. Section 3 below covers what actually works instead.

## 1. ONNX export — real gains, verified correct

| | Native XGBoost JSON | ONNX (fp32) |
|---|---|---|
| File size | 362,584 bytes | 50,777 bytes (**14.0%** of native — an 86% reduction) |
| Label agreement with native model (22,465 noised-set rows) | — | **100.0000%** |
| Accuracy vs. true label | 0.6891 | 0.6891 |
| Macro F1 vs. true label | 0.6967 | 0.6967 |

The 86% size reduction is just from switching container formats (XGBoost's
verbose JSON tree dump vs. ONNX's compact binary protobuf) — it costs
nothing in accuracy (verified: identical predictions on every one of the
22,465 domain-shift test rows, not a sample) and needs no quantization to
get. That alone is a meaningful SWaP-relevant result on its own.

## 2. Inference latency — native XGBoost vs. ONNX Runtime

Measured on this project's CPU-only dev/CI environment (not real CubeSat
onboard hardware — noted honestly, not as real flight timing), 500 timed
single-row calls (with 20 warm-up calls first) plus one full-batch pass
over all 22,465 rows:

| Engine | Single-row latency (mean) | Batch throughput |
|---|---|---|
| XGBoost native | 0.459 ms/row | 429,679 rows/sec |
| ONNX Runtime, graph opt disabled | **0.027 ms/row** | 127,210 rows/sec |
| ONNX Runtime, graph opt enabled (all) | 0.028 ms/row | 145,183 rows/sec |

Two honest, opposite-direction findings, not one clean "ONNX wins":

- **Single-row inference (the shape that actually matters here): ONNX
  Runtime is ~17x faster than native XGBoost** (0.027 ms vs. 0.459 ms).
  This is the realistic onboard/live-agent access pattern — the Monitor
  Agent's `classify_telemetry` tool (`src/tools/classifier_tool.py`)
  classifies one telemetry window at a time, not a batch, so this is the
  number that actually matters for a SWaP-constrained onboard deployment
  or for keeping the live dashboard's per-click latency low.
- **Full-batch throughput: native XGBoost wins**, by a comfortable margin
  (429K vs. ~127-145K rows/sec). XGBoost's native `predict_proba` is a
  vectorized batched C++ path; ONNX Runtime's per-call overhead amortizes
  worse here in this configuration. Not relevant to how this project's
  agent pipeline actually calls the classifier, but worth recording
  honestly rather than only reporting the number that favors ONNX.
- Graph-optimization level made a negligible difference either way for
  this model (0.027 vs. 0.028 ms/row) — expected, since a single opaque
  `TreeEnsembleClassifier` op gives ONNX Runtime's graph optimizer almost
  nothing to fuse or fold.

## 3. What actually compresses a tree ensemble: fewer boosting rounds

Since tensor quantization doesn't apply, the real lever for a tree
ensemble's size/latency vs. accuracy trade-off is boosting-round count.
`baseline_xgb.json` has 150 rounds (`n_estimators=150` in
`src/ml/train_baseline.py`). Slicing the booster (`booster[:k]`, which
XGBoost handles correctly for this 5-class `multi:softprob` model — no
retraining involved, this is the *same* fitted model, just truncated) and
re-evaluating against the domain-shift test set at each `k`:

| Rounds kept | % of full model | Accuracy | Macro F1 | ONNX size | % of full ONNX size |
|---|---|---|---|---|---|
| 10 | 6.7% | 0.4838 | 0.4856 | 10,346 B | 20.4% |
| 20 | 13.3% | 0.4703 | 0.4752 | 19,922 B | 39.2% |
| 30 | 20.0% | 0.6470 | 0.6500 | 26,772 B | 52.7% |
| 35 | 23.3% | 0.6494 | 0.6529 | 29,492 B | 58.1% |
| **40** | **26.7%** | **0.6891** | **0.6967** | **30,977 B** | **61.0%** |
| 50 | 33.3% | 0.6891 | 0.6967 | 32,777 B | 64.6% |
| 75 | 50.0% | 0.6891 | 0.6967 | 37,277 B | 73.4% |
| 100 | 66.7% | 0.6891 | 0.6967 | 41,777 B | 82.3% |
| 150 (full) | 100.0% | 0.6891 | 0.6967 | 50,777 B | 100.0% |

**The model converges to its full-size domain-shift accuracy (0.6891 /
0.6967 — the project's own headline number, reproduced exactly) at 40 of
150 rounds.** Rounds 41-150 (73% of the model) contribute measurably
*nothing* to accuracy on this test set. Practical read: a 40-round build
would be ~39% smaller again on top of the ONNX format's own 86% reduction
— combined, a ~39KB ONNX model instead of a 363KB native JSON one, with
zero measured accuracy loss on the same domain-shift evaluation this
project already treats as its real number.

**Not currently adopted as the shipped model** — this is a benchmark
result, not a retraining decision. Cutting the classifier to 40 rounds
would change `src/ml/baseline_xgb.json`, which every other role's
component (`classifier_tool.py`'s `FEATURE_ORDER`/`CLASS_NAMES` contract,
`monitor_tool.py`'s baseline stats, the integration test's cached
expectations in `demo_cache.json`) is calibrated against. That's a
cross-team call for the ML Lead to make deliberately (and re-verify with
`tests/test_integration_all_scenarios.py --live` afterward), not something
to swap in silently from a deployment-folder script — flagging it here as
a validated option, per Week 5's "document every failure/finding honestly"
principle, rather than shipping it unilaterally.

## Summary

| Question | Answer |
|---|---|
| Does ONNX export shrink the model? | Yes — 86% smaller, zero accuracy loss, verified on all 22,465 test rows. |
| Does ONNX Runtime quantization work on this model? | No — architecturally inapplicable to tree ensembles; confirmed against ONNX Runtime's own op registry, not just a local error. |
| Is ONNX faster? | For single-row inference (the pattern this project actually uses): yes, ~17x. For batch: no, native XGBoost wins. |
| Is there a real compression lever for this model? | Yes — round-count reduction. 40/150 rounds reproduces the full model's accuracy exactly, ~39% smaller than the full ONNX export. Not yet adopted as the shipped model; flagged for the ML Lead to decide on.

Sources: [microsoft/onnxruntime#15563](https://github.com/microsoft/onnxruntime/issues/15563), [ONNX Runtime quantization docs](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html), [ONNX Runtime quantization registry.py](https://github.com/microsoft/onnxruntime/blob/main/onnxruntime/python/tools/quantization/registry.py).

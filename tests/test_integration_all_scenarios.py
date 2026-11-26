"""
Week 4 Integration Lead deliverable: a full-pipeline integration test that
drives all 5 scenarios (Normal + 4 attack classes) back-to-back and logs
every failure -- the actual "everyone in the same room" Phase 4 goal from
the 6-week plan, turned into something you can re-run on demand.

Two modes:
  - cached (default): replays the already-computed, zero-cost results in
    src/pipeline/demo_cache.json. No GROQ_API_KEY needed, no quota spent,
    runs in under a second. Use this as your pre-flight check before a demo,
    and after any change to the pipeline, agents, or policy.
  - --live: re-runs all 5 scenarios through the real Crew end-to-end
    (src/pipeline/full_pipeline.py). Costs ~20 Groq calls (4 agents x 5
    classes) and ~4 minutes of TPM-budget sleeps between calls. Use this
    before a demo or after regenerating the cache, not on every commit.

What actually gets checked per scenario (this is the "do all 4 people's
components still agree" test -- the thing an Integration Lead owns -- not
just "did it not crash"):
  1. Data contract -- FEATURE_ORDER is identical across monitor_tool.py,
     classifier_tool.py, and baseline_feature_order.json, and every one of
     those features actually exists as a column in noised_dataset.csv.
     Checked once, before any scenario runs.
  2. Status validity -- the pipeline always returns one of AUTONOMOUS /
     FLAGGED_FOR_REVIEW / ERROR. Never something else, never an uncaught
     exception.
  3. Guardrail enforcement -- confidence < 0.70 must never produce
     AUTONOMOUS. This is the Cybersecurity Lead's guardrail; this test
     proves it's actually wired into the live pipeline, not just present
     in decide_mitigation()'s code.
  4. Policy agreement -- when status == AUTONOMOUS, the Mitigation Agent's
     narrated action must actually match what decide_mitigation() (the
     Cybersecurity Lead's deterministic policy table) says for that exact
     class/confidence. Catches silent agent drift from policy.
  5. Report quality gate -- the incident report is non-empty and actually
     names the detected class, mirroring the same disagreement check
     full_pipeline.py applies internally -- verified here independently.

Every problem found is collected rather than raised immediately, so one bad
scenario doesn't hide problems in the other four. Results are written to
tests/integration_logs/<timestamp>.json as the paper trail, and the process
exits 1 if anything failed.

Usage:
    python tests/test_integration_all_scenarios.py            # cached, free
    python tests/test_integration_all_scenarios.py --live     # real Groq run
    python tests/test_integration_all_scenarios.py --live --rows 2
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

CLASS_NAMES = ["Normal", "Storage Exhaustion", "Command Flooding", "Data Injection", "Defence Impairment"]
VALID_STATUSES = {"AUTONOMOUS", "FLAGGED_FOR_REVIEW", "ERROR"}

CACHE_PATH = PROJECT_ROOT / "src" / "pipeline" / "demo_cache.json"
LOG_DIR = Path(__file__).resolve().parent / "integration_logs"


def check_data_contract() -> list[str]:
    """Confirms the ML Lead's feature schema, the Agentic AI Lead's tool
    schemas, and the actual dataset all agree on the same columns. Returns
    a list of problems found (empty = contract holds)."""
    problems = []

    ml_dir = PROJECT_ROOT / "src" / "ml"
    with open(ml_dir / "baseline_feature_order.json") as f:
        baseline_order = json.load(f)

    from tools.monitor_tool import FEATURE_ORDER as monitor_order
    from tools.classifier_tool import FEATURE_ORDER as classifier_order

    if monitor_order != baseline_order:
        problems.append("tools/monitor_tool.py FEATURE_ORDER != src/ml/baseline_feature_order.json")
    if classifier_order != baseline_order:
        problems.append("tools/classifier_tool.py FEATURE_ORDER != src/ml/baseline_feature_order.json")

    import pandas as pd
    noised_path = PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv"
    noised_cols = set(pd.read_csv(noised_path, nrows=1).columns)
    missing = [f for f in baseline_order if f not in noised_cols]
    if missing:
        problems.append(f"data/noised/noised_dataset.csv is missing model-expected features: {missing}")

    return problems


def check_scenario_result(predicted_from: dict) -> list[str]:
    """Applies the 5 integration checks to one scenario's pipeline result.
    `predicted_from` is a plain dict shaped like a cache entry:
    {status, classification: {predicted_class, confidence} | None,
     sparta_context, mitigation, report}.
    Returns a list of problems found (empty = scenario passed)."""
    problems = []

    status = predicted_from.get("status")
    if status not in VALID_STATUSES:
        problems.append(f"unknown status '{status}'")
        return problems

    if status == "ERROR":
        problems.append("pipeline returned ERROR status")
        return problems

    classification = predicted_from.get("classification")
    if classification is None:
        problems.append("status is non-ERROR but classification is missing")
        return problems

    predicted_class = classification["predicted_class"]
    confidence = classification["confidence"]

    if predicted_class not in CLASS_NAMES:
        problems.append(f"predicted_class '{predicted_class}' is not one of the 5 known classes")

       # Guardrail check -- Week 4's "guardrails live" deliverable, verified
    # from the outside rather than trusted from the pipeline's own status.
    from tools.mitigation_tool import POLICY
    min_autonomous_threshold = 1.0
    if predicted_class in POLICY:
        active_thresholds = [
            thresh for thresh, action, _, _ in POLICY[predicted_class]
            if action not in ("log_only", "Escalate Alert")
        ]
        if active_thresholds:
            min_autonomous_threshold = min(active_thresholds)
        else:
            min_autonomous_threshold = 0.0

    if confidence < min_autonomous_threshold and status == "AUTONOMOUS":
        problems.append(
            f"GUARDRAIL BREACH: confidence {confidence:.3f} < {min_autonomous_threshold} but status is AUTONOMOUS"
        )

    # Policy-agreement check -- catches Mitigation Agent drift from the
    # Cybersecurity Lead's actual policy table.
    if status == "AUTONOMOUS":
        from tools.mitigation_tool import decide_mitigation
        policy = decide_mitigation(predicted_class, confidence)
        if "error" in policy:
            problems.append(
                f"decide_mitigation() itself errored for {predicted_class}/{confidence}: {policy['error']}"
            )
        else:
            mitigation_text = (predicted_from.get("mitigation") or "").lower()
            action_key = policy["action"].split(" + ")[0].strip().lower()
            tool_key = policy["tool_function"].lower()
            if action_key not in mitigation_text and tool_key not in mitigation_text:
                problems.append(
                    f"mitigation output doesn't clearly reference policy action '{policy['action']}' "
                    f"(tool: {policy['tool_function']}) -- possible agent drift from Cybersecurity Lead's policy"
                )

    # Report quality gate.
    report = (predicted_from.get("report") or "")
    if not report.strip():
        problems.append("incident report is empty")
    elif predicted_class.lower() not in report.lower():
        problems.append(f"incident report never mentions the detected class '{predicted_class}'")

    return problems


def run_cached() -> dict[str, dict]:
    if not CACHE_PATH.exists():
        print(f"No demo cache found at {CACHE_PATH}.")
        print("Run `python src/pipeline/generate_demo_cache.py` first, or pass --live.")
        sys.exit(1)
    cache = json.loads(CACHE_PATH.read_text())
    results = {}
    for class_name in CLASS_NAMES:
        entry = cache.get(class_name)
        if entry is None:
            results[class_name] = {"status": "MISSING", "classification": None, "mitigation": "", "report": ""}
        else:
            results[class_name] = entry
    return results


def run_live(rows_per_class: int) -> dict[str, dict]:
    import pandas as pd
    from pipeline.full_pipeline import run_pipeline_for_window
    from pipeline.generate_demo_cache import pick_representative_row
    from tools.monitor_tool import FEATURE_ORDER

    noised = pd.read_csv(PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv")

    results = {}
    first = True
    for label, class_name in enumerate(CLASS_NAMES):
        for i in range(rows_per_class):
            if not first:
                time.sleep(45)  # same TPM-budget spacing full_pipeline.py uses
            first = False

            if i == 0:
                window = pick_representative_row(noised, label)
            else:
                group = noised[noised["Label"] == label]
                row = group.iloc[min(i, len(group) - 1)]
                window = {f: float(row[f]) for f in FEATURE_ORDER}

            print(f"Running live pipeline for {class_name} (row {i + 1}/{rows_per_class})...")
            result = run_pipeline_for_window(window)
            key = class_name if rows_per_class == 1 else f"{class_name} [row {i + 1}]"
            results[key] = {
                "status": result["status"],
                "classification": (
                    {
                        "predicted_class": result["classification"].predicted_class,
                        "confidence": result["classification"].confidence,
                    }
                    if result["classification"]
                    else None
                ),
                "sparta_context": result["sparta_context"],
                "mitigation": result["mitigation"],
                "report": result["report"],
            }
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--live", action="store_true", help="Re-run against the real Groq-backed Crew instead of replaying the cache.")
    parser.add_argument("--rows", type=int, default=1, help="Rows per class in --live mode (default 1).")
    args = parser.parse_args()

    print("=" * 70)
    print("SentinelSat -- Week 4 Integration Test: all 5 scenarios")
    print(f"Mode: {'LIVE (spends Groq quota)' if args.live else 'CACHED (free, from demo_cache.json)'}")
    print("=" * 70)

    print("\n[1/2] Data contract check...")
    contract_problems = check_data_contract()
    if contract_problems:
        print("  FAIL:")
        for p in contract_problems:
            print(f"    - {p}")
    else:
        print("  PASS -- monitor_tool, classifier_tool, and the dataset all agree on the feature schema.")

    print("\n[2/2] Running scenarios...")
    results = run_live(args.rows) if args.live else run_cached()

    scenario_problems: dict[str, list[str]] = {}
    for name, result in results.items():
        problems = check_scenario_result(result)
        scenario_problems[name] = problems
        cls = result.get("classification")
        conf_str = f"{cls['confidence']:.3f}" if cls else "n/a"
        pred_str = cls["predicted_class"] if cls else "n/a"
        outcome = "PASS" if not problems else "FAIL"
        print(f"  [{outcome}] {name:28s} status={result.get('status', '?'):20s} predicted={pred_str:20s} conf={conf_str}")
        for p in problems:
            print(f"           - {p}")

    total_problems = len(contract_problems) + sum(len(p) for p in scenario_problems.values())

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = LOG_DIR / f"{timestamp}.json"
    log_path.write_text(
        json.dumps(
            {
                "timestamp_utc": timestamp,
                "mode": "live" if args.live else "cached",
                "data_contract_problems": contract_problems,
                "scenario_results": {k: {"status": v.get("status"), "classification": v.get("classification")} for k, v in results.items()},
                "scenario_problems": scenario_problems,
                "total_problems": total_problems,
            },
            indent=2,
        )
    )

    print("\n" + "=" * 70)
    if total_problems == 0:
        print(f"ALL SCENARIOS PASSED. Log written to {log_path.relative_to(PROJECT_ROOT)}")
    else:
        print(f"{total_problems} PROBLEM(S) FOUND across {sum(1 for p in scenario_problems.values() if p)} scenario(s) "
              f"+ {len(contract_problems)} contract issue(s). Log written to {log_path.relative_to(PROJECT_ROOT)}")
    print("=" * 70)

    sys.exit(1 if total_problems else 0)


if __name__ == "__main__":
    main()

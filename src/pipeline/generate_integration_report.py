"""
Week 4 Integration Lead deliverable: renders the current demo_cache.json
into a clean, human-readable Markdown report -- the "one clean end-to-end
run" safety-net artifact called for in Phase 4 of the 6-week plan.

If a live demo breaks in front of someone later, this file is the proof
that the full 5-agent pipeline (Monitor -> Classifier -> SPARTA Analyst ->
Mitigation -> Incident Reporter) ran end-to-end and produced a sane result
for all 5 scenarios at least once.

Zero cost to regenerate -- reads only from the existing cache, never calls
Groq. If you want a genuinely *fresh* run baked into the safety net first:
    python src/pipeline/generate_demo_cache.py
then re-run this script.

Usage:
    python src/pipeline/generate_integration_report.py
Writes to:
    src/reports/integration_safety_net_run.md
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_PATH = PROJECT_ROOT / "src" / "pipeline" / "demo_cache.json"
OUT_PATH = PROJECT_ROOT / "src" / "reports" / "integration_safety_net_run.md"

CLASS_NAMES = ["Normal", "Storage Exhaustion", "Command Flooding", "Data Injection", "Defence Impairment"]


def main():
    if not CACHE_PATH.exists():
        print(f"No demo cache found at {CACHE_PATH}.")
        print("Run `python src/pipeline/generate_demo_cache.py` first, then re-run this script.")
        sys.exit(1)

    cache = json.loads(CACHE_PATH.read_text())

    lines = []
    lines.append("# Integration Safety-Net Run — All 5 Scenarios")
    lines.append("")
    lines.append(
        f"_Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} from "
        "`src/pipeline/demo_cache.json` (cached, zero Groq cost). This is the Week 4 "
        "Integration Lead safety-net artifact: proof the full 5-agent pipeline "
        "(Monitor → Classifier → SPARTA Analyst → Mitigation → Incident Reporter) ran "
        "end-to-end and produced a sane, guardrail-respecting result for every one of "
        "the 5 scenarios -- to point to if a later live demo breaks. Regenerate anytime "
        "with `python src/pipeline/generate_integration_report.py`; for a *fresh* "
        "underlying run first, run `python src/pipeline/generate_demo_cache.py`._"
    )
    lines.append("")

    n_autonomous = sum(1 for v in cache.values() if v.get("status") == "AUTONOMOUS")
    n_flagged = sum(1 for v in cache.values() if v.get("status") == "FLAGGED_FOR_REVIEW")
    n_error = sum(1 for v in cache.values() if v.get("status") == "ERROR")
    n_missing = len(CLASS_NAMES) - sum(1 for c in CLASS_NAMES if c in cache)

    lines.append("## Summary")
    lines.append("")
    lines.append("| Scenario | True Label | Predicted | Confidence | Status |")
    lines.append("|---|---|---|---|---|")
    for class_name in CLASS_NAMES:
        entry = cache.get(class_name)
        if entry is None:
            lines.append(f"| {class_name} | — | **MISSING FROM CACHE** | — | — |")
            continue
        cls = entry.get("classification")
        pred = cls["predicted_class"] if cls else "N/A"
        conf = f"{cls['confidence']:.3f}" if cls else "N/A"
        lines.append(f"| {class_name} | {entry.get('true_label', '—')} | {pred} | {conf} | **{entry.get('status')}** |")
    lines.append("")

    summary_bits = [f"**{n_autonomous}/5 AUTONOMOUS, {n_flagged}/5 FLAGGED_FOR_REVIEW, {n_error}/5 ERROR.**"]
    if n_missing:
        summary_bits.append(f"{n_missing} scenario(s) missing from the cache -- run `generate_demo_cache.py`.")
    if n_error == 0:
        summary_bits.append("No errors -- the pipeline never crashed or returned a status the dashboard can't handle.")
    else:
        summary_bits.append(f"{n_error} scenario(s) errored -- see detail below before treating this as a clean run.")
    if n_flagged:
        summary_bits.append(
            f"{n_flagged} scenario(s) correctly deferred to human review instead of acting autonomously "
            "on a low-confidence call -- that's the confidence guardrail working as designed, not a bug."
        )
    lines.append(" ".join(summary_bits))
    lines.append("")

    for class_name in CLASS_NAMES:
        entry = cache.get(class_name)
        if entry is None:
            continue
        lines.append(f"## {class_name}")
        lines.append("")
        lines.append(f"- **True label:** {entry.get('true_label', '—')} ({class_name})")
        cls = entry.get("classification")
        if cls:
            lines.append(f"- **Predicted:** {cls['predicted_class']} (confidence {cls['confidence']:.4f})")
        lines.append(f"- **Guardrail status:** {entry.get('status')}")
        lines.append("")
        lines.append("**SPARTA context:**")
        lines.append("")
        lines.append(f"> {entry.get('sparta_context', '')}")
        lines.append("")
        lines.append("**Mitigation:**")
        lines.append("")
        lines.append(f"> {entry.get('mitigation', '')}")
        lines.append("")
        lines.append("**Incident report:**")
        lines.append("")
        lines.append(f"> {entry.get('report', '')}")
        lines.append("")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()

import uuid
from datetime import datetime, timezone
from crewai.tools import BaseTool
from pydantic import BaseModel, Field
from tools.mitigation_tool import POLICY

# Severity mapping derived from the finalized mitigation policy table
# (docs/planning/cybersecurity_lead_complete_package.md sec 2) -- deterministic,
# not LLM-decided, same reasoning as the Mitigation Agent's policy lookup.
def compute_severity(class_name: str, action: str) -> str:
    if class_name == "Normal":
        return "NONE"
    if action == "enable_safe_mode":
        return "CRITICAL"
    if action in ("flush_command_queue + App Restart", "flush_command_queue + Rate Limit", "isolate_subsystem"):
        return "HIGH"
    if action == "Escalate Alert":
        return "HIGH"  # Defence Impairment is critical-severity even at low confidence
    if action in ("flush_command_queue", "isolate_subsystem + Ground Review"):
        return "MEDIUM"
    return "LOW"  # log_only


# Known real confusion modes from the ML Lead's domain-shift confusion matrix
# (SentinelSat_6_Week_Plan): Normal<->Data Injection (1,786 cases), Command
# Flooding<->Data Injection (1,254+451 cross-errors). Flag these explicitly
# rather than pretending every detection is equally trustworthy.
def assess_false_positive_risk(class_name: str, confidence: float) -> dict:
    if class_name == "Normal":
        return {"fp_risk_score": "N/A", "risk_note": "No action taken; false positives not applicable to Normal classification."}
    min_autonomous_threshold = 1.0
    if class_name in POLICY:
        active_thresholds = [
            thresh for thresh, action, _, _ in POLICY[class_name]
            if action not in ("log_only", "Escalate Alert")
        ]
        if active_thresholds:
            min_autonomous_threshold = min(active_thresholds)
        else:
            min_autonomous_threshold = 0.0
    if confidence < min_autonomous_threshold:
        return {"fp_risk_score": "HIGH", "risk_note": f"Below guardrail threshold ({min_autonomous_threshold}) -- flagged for review, not autonomously actioned."}
    if class_name in ("Command Flooding", "Data Injection") and confidence < 0.85:
        return {"fp_risk_score": "MEDIUM", "risk_note": ("Command Flooding and Data Injection show significant mutual "
                "confusion under domain shift (1,254+451 cross-errors in validation); confidence below 0.85 warrants caution.")}
    if class_name == "Data Injection":
        return {"fp_risk_score": "MEDIUM", "risk_note": ("Data Injection is the project's central false-positive risk -- "
                "1,786 genuinely-Normal windows were misclassified as Data Injection in validation.")}
    return {"fp_risk_score": "LOW", "risk_note": "Confidence comfortably exceeds guardrail threshold; class not in a known high-confusion pair."}


def assemble_incident_record(
    class_name: str,
    confidence: float,
    tactic_id: str,
    technique_id: str,
    action: str,
    tool_function: str,
    guardrail_note: str,
    autonomous: bool,
) -> dict:
    severity = compute_severity(class_name, action)
    fp_risk = assess_false_positive_risk(class_name, confidence)

    return {
        "incident_id": f"INC-{uuid.uuid4().hex[:12].upper()}",
        "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "satellite_id": "CuCD-SAT-1",
        "classification": {
            "class_name": class_name,
            "confidence": confidence,
            "severity": severity,
        },
        "shap_drivers": [
            {"note": "SHAP per-window driver export not yet available from the ML Lead's pipeline -- placeholder."}
        ],
        "sparta_context": {
            "tactic_id": tactic_id,
            "technique_id": technique_id,
        },
        "mitigation": {
            "recommended_action": action,
            "executed_tool_call": tool_function,
            "autonomous_execution": autonomous,
            "guardrail_note": guardrail_note,
        },
        "false_positive_risk": fp_risk,
        "human_review": {
            "status": "PENDING_REVIEW",
            "reviewer_id": None,
            "review_timestamp": None,
        },
    }


class IncidentRecordQuery(BaseModel):
    class_name: str = Field(..., description="The detected attack class name.")
    confidence: float = Field(..., description="The Classifier Agent's confidence score.")
    tactic_id: str = Field(..., description="SPARTA tactic ID from the SPARTA Analyst Agent.")
    technique_id: str = Field(..., description="SPARTA technique ID from the SPARTA Analyst Agent.")
    action: str = Field(..., description="The mitigation action from the Mitigation Agent's policy tool.")
    tool_function: str = Field(..., description="The mitigation tool function name that was invoked.")
    guardrail_note: str = Field(..., description="The guardrail note from the Mitigation Agent's policy tool.")
    autonomous: bool = Field(..., description="Whether the mitigation action executed autonomously.")


class AssembleIncidentRecordTool(BaseTool):
    name: str = "assemble_incident_record"
    description: str = (
        "Assembles the machine-readable incident record (severity, false-positive risk, "
        "structured JSON fields) from the Classifier, SPARTA Analyst, and Mitigation "
        "Agents' outputs. Call this first, then write the human-readable report from its result."
    )
    args_schema: type[BaseModel] = IncidentRecordQuery

    def _run(self, **kwargs) -> dict:
        return assemble_incident_record(**kwargs)

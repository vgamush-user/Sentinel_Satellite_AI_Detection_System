import json
from pathlib import Path
import xgboost as xgb
from crewai.tools import BaseTool
from pydantic import BaseModel, create_model

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ML_DIR = PROJECT_ROOT / "src" / "ml"


class ClassificationResult(BaseModel):
    predicted_class: str
    confidence: float

_model = xgb.XGBClassifier()
_model.load_model(str(ML_DIR / "baseline_xgb.json"))

with open(ML_DIR / "baseline_feature_order.json") as f:
    FEATURE_ORDER = json.load(f)

CLASS_NAMES = ["Normal", "Storage Exhaustion", "Command Flooding", "Data Injection", "Defence Impairment"]


def classify_telemetry(window: dict) -> dict:
    x = [[window[f] for f in FEATURE_ORDER]]
    label = int(_model.predict(x)[0])
    proba = _model.predict_proba(x)[0]
    return {"class": CLASS_NAMES[label], "confidence": round(float(proba[label]), 4)}


# Plain text on purpose: asking gpt-oss for JSON makes it emit a call to a
# nonexistent 'json' tool, which Groq rejects (tool_use_failed).
CLASSIFIER_EXPECTED_OUTPUT = (
    "One plain-text line, no JSON: the predicted class name exactly as the tool "
    "returned it, then the confidence score as a decimal, e.g. 'Command Flooding, confidence 0.9999'."
)


def parse_classification(raw: str) -> "ClassificationResult | None":
    """Parse the Classifier agent's plain-text answer into a ClassificationResult.

    Replaces CrewAI's output_pydantic: with Groq's gpt-oss models, output_pydantic
    makes the model emit a call to a nonexistent 'json' tool, which Groq rejects
    (tool_use_failed). Asking for a plain-text answer and parsing it here avoids
    that. Accepts a JSON object too. Returns None if no known class + confidence
    can be found.
    """
    import re

    if not raw:
        return None
    match = re.search(r"\{.*?\}", raw, re.S)
    if match:
        try:
            data = json.loads(match.group(0))
            cls = data.get("predicted_class") or data.get("class")
            if cls in CLASS_NAMES and "confidence" in data:
                return ClassificationResult(predicted_class=cls, confidence=float(data["confidence"]))
        except (ValueError, TypeError):
            pass
    # Fallback: free text. Longest names first so "Normal" can't shadow anything.
    lowered = raw.lower()
    cls = next((c for c in sorted(CLASS_NAMES, key=len, reverse=True) if c.lower() in lowered), None)
    num = re.search(r"\b(0(?:\.\d+)?|1(?:\.0+)?)\b", raw)
    if cls and num:
        return ClassificationResult(predicted_class=cls, confidence=float(num.group(1)))
    return None


TelemetryWindow = create_model(
    "TelemetryWindow",
    **{f: (float, ...) for f in FEATURE_ORDER},
)


class ClassifyTelemetryTool(BaseTool):
    name: str = "classify_telemetry"
    description: str = (
        "Classifies a satellite telemetry window into Normal or one of 4 "
        "SPARTA-mapped attack classes (Storage Exhaustion, Command Flooding, "
        "Data Injection, Defence Impairment), returning the class and a "
        "confidence score."
    )
    args_schema: type[BaseModel] = TelemetryWindow

    def _run(self, **window) -> dict:
        return classify_telemetry(window)

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, FiniteFloat
from functools import lru_cache
import os
from pathlib import Path
import joblib
import numpy as np

# Initialize FastAPI App
app = FastAPI(
    title="Sentinel Satellite AI Anomaly Detection API",
    version="5.0",
    description="Real-time telemetry anomaly classification & risk scoring engine"
)

@lru_cache(maxsize=1)
def load_artifacts():
    directory = Path(os.environ.get("PHASE4_MODEL_DIR", "."))
    scaler = directory / "telemetry_scaler.pkl"
    model = directory / "xgb_phase4_model.pkl"
    if not scaler.is_file() or not model.is_file():
        raise HTTPException(503, "The Phase 4 scaler and model files are unavailable.")
    return joblib.load(scaler), joblib.load(model)

class TelemetryPacket(BaseModel):
    MsgLength: FiniteFloat
    CmdCode: FiniteFloat
    TimeRadians: FiniteFloat
    ApId: FiniteFloat
    MsgId: FiniteFloat

@app.get("/")
def health_check():
    return {"status": "ONLINE", "system": "Sentinel Satellite AI Detection System"}

@app.post("/predict")
def predict_anomaly(packet: TelemetryPacket):
    scaler, model = load_artifacts()
    try:
        # Format input data
        data_raw = np.array([[
            packet.MsgLength, packet.CmdCode,
            packet.TimeRadians, packet.ApId, packet.MsgId
        ]])

        # Scale features using saved Phase 4 scaler
        data_scaled = scaler.transform(data_raw)

        # Predict class & confidence
        prediction = int(model.predict(data_scaled)[0])
        probabilities = model.predict_proba(data_scaled)[0]
        confidence = float(np.max(probabilities))

        is_anomaly = bool(prediction != 0)

        return {
            "prediction_class": prediction,
            "is_anomaly": is_anomaly,
            "confidence_score": round(confidence, 4),
            "status": "ALERT: Anomaly Detected!" if is_anomaly else "NORMAL: Systems Nominal"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

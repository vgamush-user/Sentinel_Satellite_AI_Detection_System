# -*- coding: utf-8 -*-
"""
agents/incident_reporter.py
===========================
Role B — Day 6 Deliverable (Incident Reporter Agent)

Generates human-readable, executive-ready cyber security incident reports
combining:
  - Detection results
  - SPARTA RAG threat context
  - SHAP evidence attribution
  - Autonomous mitigation logs
"""

import sys, os, io, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def generate_llm_incident_narrative(incident_data: dict, groq_api_key: str = None) -> str:
    """
    Generates a natural-language security report narrative using Groq LLM (if key set),
    or formatted Markdown executive summary (fallback).
    """
    if groq_api_key:
        try:
            from groq import Groq
            client = Groq(api_key=groq_api_key)
            prompt = (
                f"You are the Incident Reporter Agent for a CubeSat Autonomous IDS.\n"
                f"Generate a concise, professional, executive cybersecurity incident summary based on:\n"
                f"{json.dumps(incident_data, indent=2)}\n\n"
                f"Format with sections: Executive Summary, Threat Mapping (SPARTA), Evidence Analysis (SHAP), and Action Taken."
            )
            chat_completion = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.1-8b-instant",
            )
            return chat_completion.choices[0].message.content
        except Exception as e:
            pass

    # Template-based Markdown executive report (free / offline mode)
    inc_id = incident_data.get("incident_id", "INC-0000")
    attack = incident_data.get("attack_detected", "Unknown")
    severity = incident_data.get("severity", "MEDIUM")
    sparta = incident_data.get("sparta_tactic", "N/A")
    action = incident_data.get("action_taken", "log_only")
    shap_feat = incident_data.get("top_shap_feature", "N/A")
    conf = incident_data.get("confidence", "95.0%")

    narrative = f"""
# 🚨 CUBESAT SECURITY INCIDENT REPORT [{inc_id}]

### 📌 EXECUTIVE SUMMARY
- **Timestamp**: {incident_data.get('timestamp', 'N/A')}
- **Severity Level**: **{severity}**
- **Attack Classification**: **{attack}** (Confidence: {conf})
- **Autonomous Response Status**: `{action}`

---

### 🛡️ THREAT INTELLIGENCE MAPPING (SPARTA)
- **SPARTA Tactic**: {sparta}
- **Technique**: {incident_data.get('sparta_technique', 'N/A')}
- **Context**: {incident_data.get('summary', 'No summary available.')}

---

### 🔬 EVIDENCE & SHAP ATTRIBUTION
Primary telemetry anomaly driver: **`{shap_feat}`**.
The onboard model flagged this window based on statistical deviations matching known {attack} signatures in CCSDS telemetry.

---

### ⚡ AUTONOMOUS ACTION EXECUTED
Action `{action}` was evaluated against confidence guardrails and executed without human latency to ensure spacecraft survivability.
"""
    return narrative.strip()


if __name__ == "__main__":
    sample_data = {
        "incident_id": "INC-0042",
        "timestamp": "2026-07-22T15:22:00Z",
        "severity": "HIGH",
        "attack_detected": "Command Flooding",
        "sparta_tactic": "ST0009 — Impact",
        "sparta_technique": "SV-MA-1",
        "confidence": "96.4%",
        "top_shap_feature": "SlidingWindowMaxIntervalSec",
        "action_taken": "flush_command_queue",
        "summary": "Command Flooding attack detected — maps to SPARTA ST0009 (Impact)."
    }
    report = generate_llm_incident_narrative(sample_data)
    print(report)

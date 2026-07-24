# 🛰️ CubeSat Autonomous Intrusion Detection System (CuCD-ID)

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

An autonomous, on-board multi-agent decision system for CubeSat telemetry monitoring, SPARTA threat mapping, and automated mitigation. Built on top of the **CuCD-ID dataset** (*Data in Brief*, Feb 2026).

---

## 🎯 Key Features

1. **Telemetry Stream Simulator**: Replays real CCSDS satellite packets or injects calibrated attack scenarios.
2. **SPARTA RAG Knowledge Base**: Uses ChromaDB and sentence-transformers to map anomalies to DoD SPARTA tactics & techniques (`ST0001`–`ST0009`).
3. **Multi-Agent Pipeline**:
   - **Monitor Agent**: Watches live stream & handles escalation.
   - **Classifier Agent**: Predicts attack class (XGBoost / LSTM).
   - **SPARTA Analyst**: Queries RAG for threat intelligence context.
   - **Mitigation Agent**: Executes rule/LLM hybrid policies with confidence guardrails (e.g. against false-positive Data Injection).
   - **Incident Reporter**: Produces structured incident reports.

---

## 📁 Repository Structure

```text
cubesat-ids/
├── simulator/
│   ├── telemetry_simulator.py   # Live CCSDS telemetry replayer
│   ├── scenario_injector.py     # Scripted attack scenario engine
│   └── scenario_validator.py    # Paper spec & edge-case validator
├── sparta_kb/
│   ├── sparta_data.py           # SPARTA framework mappings
│   └── build_chroma.py          # Vector store builder (RAG)
├── agents/
│   ├── tools.py                 # CrewAI tool integration layer
│   └── pipeline.py              # End-to-end multi-agent pipeline
├── data/                        # Place CuCD-ID CSV files here
└── reports/                     # Output incident logs
```

---

## 🚀 Quickstart

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Build SPARTA Knowledge Base (RAG)
```bash
python sparta_kb/build_chroma.py
```

### 3. Run Scenario Injector Demo
```bash
python simulator/scenario_injector.py --demo
```

### 4. Execute Full Agent Pipeline
```bash
python agents/test_pipeline.py
```

---

## 📊 Dataset & Paper Reference
- **Dataset**: [CubeSat Cybersecurity Dataset for Intrusion Detection (CuCD-ID)](https://data.mendeley.com/datasets/7n2d42pm3n/3)
- **Publication**: *Data in Brief*, Vol. 65, 2026.

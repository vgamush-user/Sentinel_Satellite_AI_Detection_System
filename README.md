---
title: Sentinel Satellite
emoji: 🛰️
colorFrom: blue
colorTo: indigo
sdk: gradio
app_file: deployment/huggingface/space_app.py
pinned: false
---

## Project Structure
``` 
Sentinel_Satellite_AI_Detection_System/
├── README.md
├── LICENSE
├── .env.example
├── .gitignore
├── requirements.txt
│
├── docs/
│   ├── architecture.md                  # agent roster + data flow diagram
│   ├── planning/
│   │   ├── week1_foundations.md
│   │   ├── week2_baselines.md
│   │   ├── week3_core_build.md
│   │   ├── week4_integration.md
│   │   ├── week5_hardening.md
│   │   └── week6_polish_submit.md       # one file per phase deliverable + notes
│   ├── security/
│   │   ├── threat_model.md              # SPARTA mapping table
│   │   ├── mitigation_policy.md         # confidence-band → action table
│   │   ├── adversarial_test_log.md      # Phase 5 stress-test results
│   │   └── known_limitations.md         # honest failure-mode writeup
│   ├── resume_bullets.md
│   └── demo_video_script.md
│
├── data/
│   ├── raw/
│   │   └── consolidated_dataset_raw.csv
│   ├── noised/
│   │   └── noised_dataset.csv
│   └── README.md                        # schema notes, autocorrelation warning
│
├── notebooks/
│   ├── data_reconnaissance.ipynb
│   └── Satellite_Telemetry_AI_Pipeline.ipynb
│
├── src/
│   ├── ml/                              # ML Lead's domain
│   │   ├── train_baseline.py
│   │   ├── compute_baseline_stats.py
│   │   ├── baseline_xgb.json
│   │   ├── baseline_feature_order.json
│   │   ├── nominal_baseline_stats.json
│   │   └── models/                      # LSTM, Autoencoder go here (Week 3+)
│   │
│   ├── agents/                          # Agentic AI Lead's domain
│   │   ├── helloworldagent.py
│   │   ├── classifier_agent.py
│   │   ├── sparta_agent.py
│   │   ├── mitigation_agent.py
│   │   └── incident_reporter_agent.py   # add in Week 3
│   │
│   ├── tools/                           # CrewAI tools called by agents
│   │   ├── classifier_tool.py
│   │   ├── monitor_tool.py
│   │   ├── sparta_tool.py
│   │   └── mitigation_tool.py
│   │
│   ├── rag/
│   │   └── build_sparta_kb.py           # ChromaDB knowledge base builder
│   │
│   ├── simulator/                       # Software/Integration Lead's domain
│   │   ├── telemetry_simulator.py
│   │   ├── Telemetry_simulation_instructions.md
│   │   └── Telemetry_simulation_requirements.txt
│   │
│   ├── pipeline/
│   │   └── monitor_pipeline.py
│   │
│   ├── dashboard/
│   │   └── app.py
│   │
│   └── reports/
│       └── cybersecurity_lead_report.md
│
├── tests/
│   ├── test_monitor.py
│   └── test_mitigation_boundaries.py
│
├── .github/
│   └── workflows/
│       └── deploy-hf-space.yml          # CI: push to main -> verify -> deploy to the HF Space
│
└── deployment/
    ├── huggingface/                     # HF Spaces config, Week 5 (Software/Integration Lead)
    │   ├── space_app.py                 # Space entrypoint: builds the SPARTA KB on cold start, then launches src/dashboard/app.py's `demo`
    │   ├── requirements.txt             # trimmed Space-only deps (no streamlit/fastapi/uvicorn/shap)
    │   ├── README.md                    # Space card (YAML frontmatter) to merge into the pushed README.md
    │   ├── DEPLOY.md                    # step-by-step push guide, secrets, known free-tier constraints
    │   └── verify_space_ready.py        # pre-push integration check — run before every deploy
    └── onnx/                            # stretch-goal quantization, Week 5



```

## Currently Deployed HuggingFace Link


https://huggingface.co/spaces/Amuthavel2402/Sentinel_Satellite

## Setup & Running — Agent Pipeline (Agentic AI Lead components)

### 1. Install dependencies
```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
Use Python 3.11 or 3.12. Newer versions (e.g. 3.14) may not have prebuilt wheels yet for some dependencies (xgboost, numpy) and will try to compile from source.
```

### 2. Set your Groq API key
Get a free key at [console.groq.com](https://console.groq.com), then create a `.env` file in the project root (copy `.env.example`):
GROQ_API_KEY=your-key-here


### 3. Build the SPARTA knowledge base (one-time, or after editing its source docs)
```bash
python src/rag/build_sparta_kb.py
```

### 4. Run an individual agent (standalone smoke test)
```bash
python src/agents/classifier_agent.py
python src/agents/sparta_agent.py
python src/agents/mitigation_agent.py
python src/agents/incident_reporter_agent.py
```
Each prints its own test result and costs 1 Groq call.

### 5. Run the full 5-agent pipeline against the live simulator
```bash
python src/pipeline/full_pipeline.py
```
Streams rows from `data/noised/noised_dataset.csv`, gates them through the Monitor Agent (free), and runs the full Classifier → SPARTA Analyst → Mitigation → Incident Reporter chain (4 Groq calls) on whatever escalates. Capped at a small row count by default — each escalated row costs real API quota.

### 6. Run the dashboard
```bash
python src/dashboard/app.py
```
Open the printed local URL. Click **Start** to stream telemetry live, **🔍 Run Full Agent Analysis** to manually trigger the agent pipeline on the latest row (costs 4 Groq calls), or use the **Demo Mode** buttons for instant, zero-cost cached examples.

### 7. Regenerate the cached demo examples (only if you edit the agents/tools)
```bash
python src/pipeline/generate_demo_cache.py
```
Costs ~4 Groq calls per class not already cached. Groq's free tier caps at 12,000 tokens/minute *and* 100,000 tokens/day — expect to hit the daily cap if you regenerate everything in one session; the script skips already-cached classes so it's safe to re-run after the quota resets.

### 8. Run the fast tests (no Groq calls, no cost)
```bash
python tests/test_monitor.py
python tests/test_mitigation_boundaries.py
```

### 9. Deploy to Hugging Face Spaces (Week 5)
See `deployment/huggingface/DEPLOY.md` for the full walkthrough. Short version:
```bash
python deployment/huggingface/verify_space_ready.py   # pre-push integration check
# then follow DEPLOY.md steps 1-6 to create the Space, set the GROQ_API_KEY
# secret, and push -- or let .github/workflows/deploy-hf-space.yml do it on
# every push to main once HF_TOKEN / HF_SPACE_REPO are configured.
```

### 10. If Claude or any AI is used
```
Check Claude.MD and make sure that you don't co=author any of the commits
```

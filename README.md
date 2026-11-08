# Sentinel Satellite AI Detection System

Real-time intrusion detection for satellite telemetry. Telemetry streams
through **Apache Kafka**, an **XGBoost** model scores every row, attack bursts
are grouped into **incidents**, and a crew of **4 AI agents** (CrewAI on Groq)
maps each incident to SPARTA, picks the policy-mandated mitigation and writes
an incident report. A live website shows all of it as it happens.

**Quick start (real-time system):** start Docker Desktop, then
```bash
cd frontend
npm ci
npm run build
cd ..
python scripts/start_all.py --open
```
Website: http://127.0.0.1:8050 · Kafka UI: http://localhost:8081.
See [Real-time pipeline](#real-time-pipeline-kafka) below.

## Project Structure
``` 
Sentinel_Satellite_AI_Detection_System/
├── README.md
├── LICENSE
├── .env.example
├── .gitignore
├── requirements.txt
├── docker-compose.yml                   # Kafka (KRaft) + Kafka UI for the real-time pipeline
│
├── scripts/
│   └── start_all.py                     # one command: Kafka + every streaming service + website
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
│   │   └── app.py                       # Gradio dashboard (manual, click-to-analyse)
│   │
│   ├── streaming/                       # real-time Kafka pipeline
│   │   ├── config.py                    # topics, guards, settings (all overridable via env)
│   │   ├── topics.py                    # creates the 4 Kafka topics
│   │   ├── producer.py                  # replays a CSV into telemetry.raw
│   │   ├── inject.py                    # shared entry point (+ CLI) for new telemetry
│   │   ├── detector.py                  # XGBoost on every row -> telemetry.scored
│   │   ├── incident_manager.py          # groups attack rows into incidents
│   │   ├── agent_worker.py              # 4-agent crew per incident -> reports
│   │   ├── recorder.py                  # incidents + reports -> SQLite
│   │   └── storage.py                   # SQLite schema + queries
│   │
│   ├── web/                             # live website (FastAPI + WebSocket)
│   │   ├── server.py
│   │   └── static/                      # shared dashboard stylesheet
│   │
│   └── reports/
│       └── cybersecurity_lead_report.md
│
├── tests/
│   ├── test_monitor.py
│   └── test_mitigation_boundaries.py
│
└── deployment/
    └── onnx/                            # stretch-goal quantization, Week 5



```

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

## Real-time pipeline (Kafka)

```
 CSV replay / website / API / CLI
            │
            ▼
   telemetry.raw ──► Detector (XGBoost, every row) ──► telemetry.scored ──► website (live chart)
                                                              │
                                                              ▼
                                         Incident manager (false-alarm guards)
                                                              │
                                                              ▼
                     incidents ──► Agent worker (4 CrewAI agents on Groq, one per incident) ──► reports
                         │                                                                       │
                         └──────────────► Recorder ──► SQLite history ◄──────────────────────────┘
```

Each box is a separate process; they only talk through Kafka topics. Detection
is milliseconds per row and never waits for the LLM. Groq is called **once per
incident**, not per row, so its cost grows with the number of attacks, not the
volume of telemetry. If several incidents open at once they queue in Kafka.

### Run it
Requires Node.js 22, Docker Desktop (running), and `GROQ_API_KEY` in `.env` for live agents. The live dashboard uses React, TypeScript, and Vite. Build it from the repository root before starting the Python stack.

```bash
cd frontend
npm ci
npm run typecheck
npm test
npm run build
cd ..
```
```bash
pip install -r requirements.txt
python scripts/start_all.py --open                 # live agents on Groq
python scripts/start_all.py --agents cached        # offline demo: stored reports, no Groq calls
python scripts/start_all.py --speed 20 --mode all  # replay every row (attacks come as long blocks)
```

FastAPI serves the production dashboard at `http://127.0.0.1:8050` by default. Rebuild after frontend changes. For frontend development with hot reload, leave the Python stack running and start Vite in a second terminal.

```bash
cd frontend
npm run dev
```

Open the URL printed by Vite. It proxies `/api` and `/ws` to FastAPI and reads `WEB_PORT` from the environment or the repository's `.env`.

See the [dashboard migration checklist](docs/dashboard-migration.md) for view behavior and the browser API contract.
`Ctrl+C` stops the services; `docker compose down` stops Kafka. Logs: `data/live/logs/`.

### Sending new entries
Every entry point writes to `telemetry.raw`, exactly like the replay:
- **Website → Test a new entry:** load a real row (pick a class, clean or noisy), edit any of the 22 features, send once or as a burst, and follow it through detection → incident → AI report.
- **Website → Launch an attack:** one click sends a burst of real attack rows.
- **HTTP:** `POST /api/ingest` with `{"features": {...22 features...}, "count": 1}`.
- **CLI:** `cd src && python -m streaming.inject --cls "Command Flooding" --count 15`

### Incident rules (false-alarm guards)
A row counts as attack evidence only if XGBoost predicts a non-Normal class with
confidence ≥ 0.7. An incident opens when **5 of the last 20 rows** are evidence of
the same class ("K of the last N", because attack rows arrive interleaved with
normal traffic), and closes after 40 rows (or 30 s) without that class. The class
always comes from XGBoost; the agents explain and respond, they don't re-decide it.

Tuned on the datasets: 0 false incidents over 3 loops of the Normal replay;
clean attack bursts open exactly one correct incident 100% of the time. On the
noised dataset the model is ~69% accurate and many noisy attack rows stay below
the confidence guard, so noisy bursts are caught only 17–48% of the time. The
website lets you compare clean vs noisy attacks live. All thresholds can be
changed with environment variables (see `src/streaming/config.py`).

### 10. If Claude or any AI is used
```
Check Claude.MD and make sure that you don't co=author any of the commits
```

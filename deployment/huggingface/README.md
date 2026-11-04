---
title: SentinelSat — CubeSat Intrusion Detection
emoji: 🛰️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 6.31.0
app_file: deployment/huggingface/space_app.py
pinned: false
license: mit
---

# SentinelSat on Hugging Face Spaces

Copy the YAML block above (the frontmatter between the `---` lines) into the
**very first lines** of the root `README.md` of whatever repo you point the
Space at — Spaces reads that block to configure the SDK, the entry file, and
the Space card. See `../DEPLOY.md` in this same folder for the full
step-by-step push process, the required `GROQ_API_KEY` secret, and the
known free-tier constraints.

This file is deliberately just the Space card + a pointer, not a duplicate
of the project README — the real project documentation lives at the repo
root `README.md`.

## What this Space runs

`app_file` points at `deployment/huggingface/space_app.py`, a thin wrapper
(not a fork) around the real dashboard at `src/dashboard/app.py`. The
wrapper's only job is to build the SPARTA ChromaDB knowledge base on cold
start if it's missing — see the module docstring in `space_app.py` for why
that step doesn't happen automatically otherwise on a fresh Space.

## What a visitor can do without any setup

- Watch the telemetry-replay simulator stream `noised_dataset.csv` live.
- Click any of the 5 **Demo Mode** buttons for an instant, zero-cost,
  zero-API-key cached example of the full 5-agent pipeline's output
  (reads `src/pipeline/demo_cache.json`).

## What requires the `GROQ_API_KEY` secret

- **🔍 Run Full Agent Analysis on Latest Row** — runs the live 4-agent Groq
  chain (Classifier → SPARTA Analyst → Mitigation → Incident Reporter) on
  whatever row the simulator most recently streamed. Costs real Groq quota
  per click. Without the secret set, this button will fail when clicked —
  Demo Mode and the passive stream are unaffected.

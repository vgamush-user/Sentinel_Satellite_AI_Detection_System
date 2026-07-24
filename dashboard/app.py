# -*- coding: utf-8 -*-
"""
dashboard/app.py
================
Role D — Product/DevOps Lead | Interactive UI Dashboard

Web dashboard built with Gradio for real-time visualization of:
  - Telemetry Stream simulator
  - Live Multi-Agent Reasoning trace
  - SPARTA Threat Intel RAG lookups
  - Security Mitigation Alerts & Metrics

Launch:
  python dashboard/app.py
"""

import sys, os, io, json, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import gradio as gr
import pandas as pd
import numpy as np

from simulator.scenario_injector import InjectionEngine, ScenarioSequencer, LABEL_NAMES
from agents.tools import StreamState, tool_classify, tool_sparta_lookup
from agents.pipeline import (
    monitor_agent_step, classifier_agent_step, sparta_analyst_step,
    mitigation_agent_step, incident_reporter_step
)

# ──────────────────────────────────────────────────────────────────────────────
# CORE LOGIC FOR GRADIO DASHBOARD
# ──────────────────────────────────────────────────────────────────────────────

def run_scenario_simulation(scenario_id: int, max_windows: int, confidence_thresh: float):
    """
    Runs the selected scenario and returns formatted output for Gradio UI tabs.
    """
    builders = {
        0: lambda: ScenarioSequencer.normal_ops(max_windows * 53),
        1: ScenarioSequencer.storage_exhaustion_attack,
        2: ScenarioSequencer.command_flooding_attack,
        3: ScenarioSequencer.data_injection_attack,
        4: ScenarioSequencer.defence_impairment_attack,
        5: ScenarioSequencer.full_demo_sequence,
    }
    
    steps = builders[scenario_id]() if scenario_id in builders else builders[0]()
    engine = InjectionEngine(steps)
    
    state = StreamState.get()
    state.generator = engine.stream()
    state.is_running = True
    state.buffer.buffer.clear()
    
    incident_logs = []
    agent_trace = []
    
    windows_processed = 0
    while windows_processed < max_windows and state.is_running:
        stream_res = monitor_agent_step(state)
        if not stream_res or not stream_res.get("stream_status", {}).get("window_ready", False):
            continue
            
        classification = classifier_agent_step()
        if classification.get("status") != "OK":
            continue
            
        pred = classification["prediction"]
        label = pred["label"]
        
        sparta_context = sparta_analyst_step(label)
        mitigation = mitigation_agent_step(classification, sparta_context, confidence_thresh)
        
        incident = incident_reporter_step(
            window_num=windows_processed,
            classification=classification,
            sparta_context=sparta_context,
            mitigation=mitigation,
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        )
        
        incident_logs.append(incident)
        
        # Build agent reasoning step trace
        trace_entry = (
            f"=== WINDOW #{windows_processed:02d} | ATTACK: {pred['class_name'].upper()} ===\n"
            f"[Monitor Agent] Stream packet batch received.\n"
            f"[Classifier Agent] Prediction={pred['class_name']} (Confidence={pred['confidence']:.2f})\n"
            f"[SPARTA Analyst] Tactic={sparta_context['sparta_tactic']} ({sparta_context['sparta_tactic_name']})\n"
            f"[Mitigation Agent] Action={mitigation['action_taken']} (Guardrail Fired={mitigation['guardrail_fired']})\n"
            f"[Reason] {mitigation['reason']}\n\n"
        )
        agent_trace.append(trace_entry)
        windows_processed += 1
        
    df_incidents = pd.DataFrame(incident_logs)
    if not df_incidents.empty:
        display_df = df_incidents[["incident_id", "severity", "attack_detected", "sparta_tactic", "confidence", "action_taken", "guardrail_fired"]]
    else:
        display_df = pd.DataFrame(columns=["incident_id", "severity", "attack_detected", "sparta_tactic", "confidence", "action_taken", "guardrail_fired"])
        
    trace_text = "".join(agent_trace) if agent_trace else "No windows processed."
    
    # Summary metrics
    total_incidents = len(incident_logs)
    guardrails_fired = sum(1 for i in incident_logs if i.get("guardrail_fired"))
    unique_attacks = len(set(i.get("attack_detected") for i in incident_logs if i.get("attack_detected") != "Normal"))
    
    metrics_summary = (
        f"### 📊 Execution Summary\n"
        f"- **Windows Analyzed**: {windows_processed}\n"
        f"- **Incidents Logged**: {total_incidents}\n"
        f"- **Autonomous Actions Blocked by Guardrail**: {guardrails_fired}\n"
        f"- **Attack Types Detected**: {unique_attacks}\n"
    )
    
    return display_df, trace_text, metrics_summary


# ──────────────────────────────────────────────────────────────────────────────
# GRADIO INTERFACE BUILDER
# ──────────────────────────────────────────────────────────────────────────────

def create_dashboard():
    with gr.Blocks(title="CubeSat Autonomous Intrusion Detection System") as demo:
        gr.Markdown(
            "# 🛰️ CubeSat Autonomous Intrusion Detection System (CuCD-ID)\n"
            "### Multi-Agent Telemetry Security, SPARTA Threat Mapping & Autonomous Response"
        )
        
        with gr.Row():
            with gr.Column(scale=1):
                scenario_dropdown = gr.Dropdown(
                    choices=[
                        ("0: Normal Operations", 0),
                        ("1: Storage Exhaustion Attack", 1),
                        ("2: Command Flooding Attack", 2),
                        ("3: Data Injection Attack", 3),
                        ("4: Defence Impairment Attack", 4),
                        ("5: Full Multi-Attack Scenario", 5),
                    ],
                    value=2,
                    label="Select Telemetry Scenario"
                )
                max_windows_slider = gr.Slider(minimum=2, maximum=20, value=6, step=1, label="Windows to Analyze")
                confidence_slider = gr.Slider(minimum=0.5, maximum=0.95, value=0.70, step=0.05, label="Guardrail Confidence Threshold")
                btn_run = gr.Button("🚀 Run Autonomous Agent Pipeline", variant="primary")
                
                gr.Markdown(metrics_md := gr.Markdown("### 📊 Execution Summary\n*Run a scenario to see metrics.*"))

            with gr.Column(scale=2):
                with gr.Tabs():
                    with gr.TabItem("📋 Incident Log"):
                        incidents_table = gr.Dataframe(headers=["incident_id", "severity", "attack_detected", "sparta_tactic", "confidence", "action_taken", "guardrail_fired"], interactive=False)
                    
                    with gr.TabItem("🧠 Multi-Agent Reasoning Trace"):
                        trace_output = gr.Textbox(lines=18, label="Agent Execution Logs", interactive=False)

        btn_run.click(
            fn=run_scenario_simulation,
            inputs=[scenario_dropdown, max_windows_slider, confidence_slider],
            outputs=[incidents_table, trace_output, metrics_md]
        )

    return demo


if __name__ == "__main__":
    app = create_dashboard()
    print("Launching CubeSat IDS Gradio Dashboard...")
    app.launch(server_name="127.0.0.1", server_port=7860, share=False)

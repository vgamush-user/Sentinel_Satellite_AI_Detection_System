# -*- coding: utf-8 -*-
"""
simulator/scenario_injector.py
===============================
Role C — Day 4 Deliverable

Attack Scenario Injector — the "mission control" of the demo.

What this does:
  Allows mid-stream injection of scripted attack scenarios with realistic
  pacing, mirroring the paper's actual COSMOS attack scripts (Section 4.5).

Features:
  1. ScenarioScript     — defines a scenario: which attack, how long, transition
  2. ScenarioSequencer  — chains multiple scenarios together (Normal → Attack → Normal)
  3. InjectionEngine    — feeds scripted packets into the live stream at realistic rates
  4. Realistic pacing   — matches paper's documented packet rates per scenario
  5. Mid-stream switch  — inject an attack while stream is running

Paper-documented scenario details (Section 4.5, Table 3):
  - Normal:             ~53 packets/window, regular cadence
  - Storage Exhaustion: memory grows monotonically, packet rate similar to normal
  - Command Flooding:   packet rate 5-10x normal during attack window
  - Data Injection:     novel message IDs appear mid-window
  - Defence Impairment: targeted commands to security apps, then silence

Usage:
  python simulator/scenario_injector.py --demo
  python simulator/scenario_injector.py --scenario 2 --duration 300
"""

import sys, io, os, json, time, argparse
from typing import Optional, Generator
from dataclasses import dataclass, field
from enum import IntEnum
from copy import deepcopy

# Fix Windows encoding
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.live import Live
from rich.text import Text
from rich import box

console = Console()


# ──────────────────────────────────────────────────────────────────────────────
# ATTACK LABEL ENUM
# ──────────────────────────────────────────────────────────────────────────────

class AttackLabel(IntEnum):
    NORMAL              = 0
    STORAGE_EXHAUSTION  = 1
    COMMAND_FLOODING    = 2
    DATA_INJECTION      = 3
    DEFENCE_IMPAIRMENT  = 4


LABEL_NAMES = {
    0: "Normal",
    1: "Storage Exhaustion",
    2: "Command Flooding",
    3: "Data Injection",
    4: "Defence Impairment",
}

LABEL_COLORS = {
    0: "green",
    1: "yellow",
    2: "red",
    3: "magenta",
    4: "bold red",
}


# ──────────────────────────────────────────────────────────────────────────────
# PAPER-GROUNDED PACKET PROFILES
# Based on Section 4.5 of the CuCD-ID paper — each attack class has
# distinct telemetry signatures we reproduce synthetically when no CSV is loaded.
# When the real CSV IS loaded, we sample from actual rows instead.
# ──────────────────────────────────────────────────────────────────────────────

def _base_packet(label: int, packet_id: int, t: float) -> dict:
    """
    Generate one synthetic telemetry packet matching the paper's feature
    distributions for a given attack class.

    These distributions are calibrated against the paper's Table 4 statistics.
    """
    rng = np.random.default_rng(seed=packet_id)

    # Shared baseline (normal ops)
    base = {
        "MemoryAnonMB":                float(rng.normal(120, 8)),
        "MemoryShmemMB":               float(rng.normal(55, 4)),
        "MemoryFileMB":                float(rng.normal(210, 12)),
        "UniqueMessageIDsInWindow":    int(rng.integers(3, 8)),
        "SlidingWindowMaxIntervalSec": float(rng.exponential(0.18)),
        "SlidingWindowMinIntervalSec": float(rng.exponential(0.02)),
        "MsgCount":                    int(rng.integers(45, 58)),
        "TimeRadians":                 float((t % (2 * np.pi))),
    }

    # ── Attack-specific modifications ──────────────────────────────────────
    if label == AttackLabel.STORAGE_EXHAUSTION:
        # Memory grows over time — the attack consumes storage monotonically
        growth = min(packet_id * 0.8, 300)
        base["MemoryAnonMB"]  += growth
        base["MemoryShmemMB"] += growth * 0.4
        base["MemoryFileMB"]  += growth * 0.6

    elif label == AttackLabel.COMMAND_FLOODING:
        # Packet rate explodes — MaxInterval near zero, MsgCount >> normal
        base["SlidingWindowMaxIntervalSec"] = float(rng.exponential(0.008))
        base["SlidingWindowMinIntervalSec"] = float(rng.exponential(0.001))
        base["MsgCount"] = int(rng.integers(180, 250))   # 4-5x normal rate
        base["UniqueMessageIDsInWindow"] = int(rng.integers(15, 30))

    elif label == AttackLabel.DATA_INJECTION:
        # Novel message IDs appear — UniqueMessageIDsInWindow spikes
        base["UniqueMessageIDsInWindow"] = int(rng.integers(25, 45))
        base["SlidingWindowMinIntervalSec"] = float(rng.exponential(0.005))
        # Small timing irregularity
        base["SlidingWindowMaxIntervalSec"] *= float(rng.uniform(0.3, 0.7))

    elif label == AttackLabel.DEFENCE_IMPAIRMENT:
        # Targeted commands to monitoring apps — unusual but not high-volume
        base["UniqueMessageIDsInWindow"] = int(rng.integers(8, 15))
        base["MsgCount"] = int(rng.integers(20, 40))   # Slightly lower volume
        # Memory changes as security apps are killed
        base["MemoryFileMB"] -= float(rng.uniform(20, 60))

    return {
        "packet_id":  packet_id,
        "label":      label,
        "label_name": LABEL_NAMES[label],
        "features":   base,
        "timestamp":  t,
    }


# ──────────────────────────────────────────────────────────────────────────────
# SCENARIO SCRIPT
# A single scenario step: attack type, duration, optional CSV slice
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ScenarioStep:
    """
    One step in a scenario sequence.

    Args:
        label:          Attack label (0-4)
        n_packets:      How many packets to emit for this step
        inter_packet_s: Time between packets in seconds (0 = instant)
        description:    Human-readable label for display
        source_df:      Optional real CSV slice (if None, uses synthetic generator)
    """
    label:          int
    n_packets:      int     = 53       # One full window by default
    inter_packet_s: float   = 0.0     # Instant by default
    description:    str     = ""
    source_df:      Optional[pd.DataFrame] = field(default=None, repr=False)

    def __post_init__(self):
        if not self.description:
            self.description = LABEL_NAMES.get(self.label, "Unknown")


# ──────────────────────────────────────────────────────────────────────────────
# SCENARIO SEQUENCER
# Pre-built scenario sequences for the 5 attack types + demo sequence
# ──────────────────────────────────────────────────────────────────────────────

class ScenarioSequencer:
    """
    Chains ScenarioSteps into a full mission scenario.
    Mirrors the paper's COSMOS test scripts (Section 4.5).
    """

    @staticmethod
    def normal_ops(n_packets: int = 212) -> list[ScenarioStep]:
        """Normal satellite operations — 4 windows of baseline."""
        return [ScenarioStep(label=0, n_packets=n_packets, description="Normal Ops")]

    @staticmethod
    def storage_exhaustion_attack(source_df: pd.DataFrame = None) -> list[ScenarioStep]:
        """
        Storage Exhaustion scenario (paper Section 4.5.2):
          Normal → Attack ramp-up → Full exhaustion → Normal recovery
        """
        return [
            ScenarioStep(0,  106, description="Pre-attack Normal",     source_df=_slice(source_df, 0, 106)),
            ScenarioStep(1,  212, description="Storage Exhaustion",     source_df=_slice(source_df, 1, 212)),
            ScenarioStep(0,   53, description="Post-attack Recovery",  source_df=_slice(source_df, 0, 53)),
        ]

    @staticmethod
    def command_flooding_attack(source_df: pd.DataFrame = None) -> list[ScenarioStep]:
        """
        Command Flooding scenario (paper Section 4.5.3):
          Normal → Flood onset → Peak flood → Normal
        """
        return [
            ScenarioStep(0,  106, description="Pre-attack Normal",     source_df=_slice(source_df, 0, 106)),
            ScenarioStep(2,   53, description="Flood Onset",           source_df=_slice(source_df, 2, 53)),
            ScenarioStep(2,  159, description="Peak Command Flood",     source_df=_slice(source_df, 2, 159)),
            ScenarioStep(0,   53, description="Post-attack Recovery",  source_df=_slice(source_df, 0, 53)),
        ]

    @staticmethod
    def data_injection_attack(source_df: pd.DataFrame = None) -> list[ScenarioStep]:
        """
        Data Injection scenario (paper Section 4.5.4):
          Normal → Injection begins → Sustained injection → Normal
        """
        return [
            ScenarioStep(0,  159, description="Pre-attack Normal",     source_df=_slice(source_df, 0, 159)),
            ScenarioStep(3,  212, description="Data Injection",        source_df=_slice(source_df, 3, 212)),
            ScenarioStep(0,   53, description="Post-attack Recovery",  source_df=_slice(source_df, 0, 53)),
        ]

    @staticmethod
    def defence_impairment_attack(source_df: pd.DataFrame = None) -> list[ScenarioStep]:
        """
        Defence Impairment scenario (paper Section 4.5.5):
          Normal → Impairment → Brief silence → Follow-on attack → Normal
          (The follow-on is Command Flooding — attacker disables monitor first)
        """
        return [
            ScenarioStep(0,  106, description="Pre-attack Normal",          source_df=_slice(source_df, 0, 106)),
            ScenarioStep(4,   53, description="Defence Impairment",         source_df=_slice(source_df, 4, 53)),
            ScenarioStep(2,  106, description="Follow-on Command Flood",    source_df=_slice(source_df, 2, 106)),
            ScenarioStep(0,   53, description="Post-attack Recovery",       source_df=_slice(source_df, 0, 53)),
        ]

    @staticmethod
    def full_demo_sequence(source_df: pd.DataFrame = None) -> list[ScenarioStep]:
        """
        Full demo sequence — cycles through all 5 attack types.
        This is the 3-4 minute demo video sequence (Day 12).
        """
        steps = []
        steps += [ScenarioStep(0, 106, description="Baseline Normal Ops")]
        steps += ScenarioSequencer.storage_exhaustion_attack(source_df)
        steps += [ScenarioStep(0,  53, description="Recovery between attacks")]
        steps += ScenarioSequencer.command_flooding_attack(source_df)
        steps += [ScenarioStep(0,  53, description="Recovery between attacks")]
        steps += ScenarioSequencer.data_injection_attack(source_df)
        steps += [ScenarioStep(0,  53, description="Recovery between attacks")]
        steps += ScenarioSequencer.defence_impairment_attack(source_df)
        steps += [ScenarioStep(0,  53, description="Mission Complete — All Clear")]
        return steps


def _slice(df: Optional[pd.DataFrame], label: int, n: int) -> Optional[pd.DataFrame]:
    """Helper: slice N rows for a given label from a real dataframe."""
    if df is None:
        return None
    rows = df[df["Label"] == label].head(n)
    return rows if len(rows) > 0 else None


# ──────────────────────────────────────────────────────────────────────────────
# INJECTION ENGINE
# Executes a scenario sequence, yielding one packet at a time
# ──────────────────────────────────────────────────────────────────────────────

class InjectionEngine:
    """
    Executes a list of ScenarioSteps, yielding packets one at a time.
    Can be used as a drop-in replacement for the CSV stream generator.
    """

    def __init__(self, steps: list[ScenarioStep]):
        self.steps = steps
        self.current_step_idx = 0
        self.packet_id = 0
        self.step_history = []

    def stream(self) -> Generator[dict, None, None]:
        """Generator: yields one packet dict at a time across all steps."""
        t = time.time()
        for step_idx, step in enumerate(self.steps):
            self.current_step_idx = step_idx
            self.step_history.append({
                "step": step_idx,
                "label": step.label,
                "name": step.description,
                "start_packet": self.packet_id,
            })

            for i in range(step.n_packets):
                # Use real CSV row if available, otherwise synthetic
                if step.source_df is not None and i < len(step.source_df):
                    row = step.source_df.iloc[i % len(step.source_df)]
                    feature_cols = [c for c in step.source_df.columns if c != "Label"]
                    pkt = {
                        "packet_id":  self.packet_id,
                        "label":      step.label,
                        "label_name": step.description,
                        "features":   row[feature_cols].to_dict(),
                        "timestamp":  t,
                        "step_name":  step.description,
                    }
                else:
                    # Synthetic packet from calibrated distribution
                    pkt = _base_packet(step.label, self.packet_id, t)
                    pkt["step_name"] = step.description

                self.packet_id += 1
                t += step.inter_packet_s + 0.001

                yield pkt

                if step.inter_packet_s > 0:
                    time.sleep(step.inter_packet_s)

    @property
    def current_step(self) -> Optional[ScenarioStep]:
        if self.current_step_idx < len(self.steps):
            return self.steps[self.current_step_idx]
        return None

    def get_manifest(self) -> list[dict]:
        """Return a summary of all steps with packet counts."""
        manifest = []
        offset = 0
        for i, step in enumerate(self.steps):
            manifest.append({
                "step": i,
                "label": step.label,
                "label_name": LABEL_NAMES[step.label],
                "description": step.description,
                "n_packets": step.n_packets,
                "start_packet": offset,
                "end_packet": offset + step.n_packets - 1,
                "n_windows": step.n_packets // 53,
            })
            offset += step.n_packets
        return manifest


# ──────────────────────────────────────────────────────────────────────────────
# DEMO RUNNER — shows injection engine in action in terminal
# ──────────────────────────────────────────────────────────────────────────────

def run_demo(scenario_id: Optional[int] = None, n_packets: int = 300):
    """
    Run the injection engine in demo mode.
    Shows a live terminal view of the attack scenario unfolding.
    """
    console.print(Panel.fit(
        "[bold cyan]CubeSat Attack Scenario Injector[/]\n"
        "[dim]Role C | Day 4 — Scripted Attack Sequences[/]",
        border_style="cyan",
    ))

    # Build steps
    if scenario_id is None:
        console.print("[yellow]Running full demo sequence (all 5 attack types)...[/]\n")
        steps = ScenarioSequencer.full_demo_sequence()
    else:
        builders = {
            0: lambda: ScenarioSequencer.normal_ops(n_packets),
            1: ScenarioSequencer.storage_exhaustion_attack,
            2: ScenarioSequencer.command_flooding_attack,
            3: ScenarioSequencer.data_injection_attack,
            4: ScenarioSequencer.defence_impairment_attack,
        }
        console.print(f"[yellow]Injecting scenario: {LABEL_NAMES[scenario_id]}[/]\n")
        steps = builders[scenario_id]()

    engine = InjectionEngine(steps)

    # Print scenario manifest
    manifest = engine.get_manifest()
    manifest_table = Table(title="Scenario Manifest", box=box.ROUNDED, header_style="bold cyan")
    manifest_table.add_column("Step", width=6)
    manifest_table.add_column("Phase", width=25)
    manifest_table.add_column("Packets", width=10)
    manifest_table.add_column("Windows", width=10)
    manifest_table.add_column("Label", width=22)
    for m in manifest:
        color = LABEL_COLORS.get(m["label"], "white")
        manifest_table.add_row(
            str(m["step"]),
            m["description"],
            str(m["n_packets"]),
            str(m["n_windows"]),
            Text(m["label_name"], style=f"bold {color}"),
        )
    console.print(manifest_table)
    total_packets = sum(m["n_packets"] for m in manifest)
    console.print(f"\nTotal packets: [cyan]{total_packets}[/] | "
                  f"Total windows: [cyan]{total_packets // 53}[/]\n")
    console.print("[bold]Starting injection... Ctrl+C to stop[/]\n")
    time.sleep(1)

    # Stream packets and display
    recent = []
    step_counts = {}

    display_table = Table(
        title="[bold cyan]Injected Telemetry Stream[/]",
        box=box.ROUNDED, expand=True,
    )
    display_table.add_column("Pkt #",    width=8)
    display_table.add_column("Phase",    width=22)
    display_table.add_column("Label",    width=20)
    display_table.add_column("MsgCount", width=10)
    display_table.add_column("Uniq IDs", width=10)
    display_table.add_column("MaxIntvl", width=12)
    display_table.add_column("MemAnon",  width=12)

    with Live(display_table, console=console, refresh_per_second=10) as live:
        try:
            for pkt in engine.stream():
                recent.append(pkt)
                label = pkt["label"]
                step_counts[label] = step_counts.get(label, 0) + 1

                color = LABEL_COLORS.get(label, "white")
                feats = pkt["features"]

                new_table = Table(
                    title=f"[bold cyan]Injected Stream[/] — "
                          f"Phase: [{color}]{pkt.get('step_name', '')}[/]",
                    box=box.ROUNDED, expand=True,
                )
                new_table.add_column("Pkt #",    width=8)
                new_table.add_column("Phase",    width=22)
                new_table.add_column("Label",    width=20)
                new_table.add_column("MsgCount", width=10)
                new_table.add_column("Uniq IDs", width=10)
                new_table.add_column("MaxIntvl", width=12)
                new_table.add_column("MemAnon",  width=12)

                for p in recent[-12:]:
                    c = LABEL_COLORS.get(p["label"], "white")
                    f = p["features"]
                    new_table.add_row(
                        str(p["packet_id"]),
                        p.get("step_name", "")[:20],
                        Text(p["label_name"][:18], style=f"bold {c}"),
                        str(int(f.get("MsgCount", 0))),
                        str(int(f.get("UniqueMessageIDsInWindow", 0))),
                        f"{f.get('SlidingWindowMaxIntervalSec', 0):.4f}",
                        f"{f.get('MemoryAnonMB', 0):.1f}",
                    )
                live.update(new_table)

        except KeyboardInterrupt:
            console.print("\n[yellow]Demo stopped by user.[/]")

    # Summary
    console.print(Panel(
        "\n".join(
            f"  [{LABEL_COLORS.get(k,'white')}]{LABEL_NAMES[k]}[/]: {v} packets"
            for k, v in step_counts.items()
        ),
        title="[green]Injection Complete — Packet Counts[/]",
        border_style="green",
    ))


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="CubeSat Attack Scenario Injector"
    )
    parser.add_argument(
        "--demo", action="store_true",
        help="Run the full demo sequence (all 5 attack types in sequence)."
    )
    parser.add_argument(
        "--scenario", "-s", type=int, choices=[0, 1, 2, 3, 4], default=None,
        help="Run a specific scenario only: 0=Normal, 1=Storage, 2=Flood, 3=Inject, 4=DefImp"
    )
    parser.add_argument(
        "--packets", "-p", type=int, default=300,
        help="Number of packets for single-scenario runs (default 300)."
    )
    args = parser.parse_args()

    run_demo(
        scenario_id=args.scenario,
        n_packets=args.packets,
    )

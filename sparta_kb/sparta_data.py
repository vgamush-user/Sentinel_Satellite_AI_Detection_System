# -*- coding: utf-8 -*-
"""
sparta_data.py
==============
Static SPARTA (Space Attack Research and Tactic Analysis) knowledge base.
Source: aerospace.org/sparta — publicly available, unclassified.

Contains:
  - All 9 SPARTA Tactics (ST0001-ST0009)
  - Key Techniques per tactic
  - Mappings from CuCD-ID attack classes → SPARTA tactics/techniques
  - Recommended mitigations per attack class

Used by: sparta_kb/build_chroma.py → ChromaDB vector store
Queried by: agents/sparta_analyst_agent.py via RAG
"""

# ──────────────────────────────────────────────────────────────────────────────
# SPARTA TACTICS
# Each tactic = the "WHY" (strategic goal of the attacker)
# ──────────────────────────────────────────────────────────────────────────────

SPARTA_TACTICS = [
    {
        "id": "ST0001",
        "name": "Reconnaissance",
        "description": (
            "The adversary is trying to gather information they can use to plan future "
            "operations against a spacecraft or space system. Reconnaissance consists of "
            "techniques that involve actively or passively collecting information about a "
            "target spacecraft, its communication links, software versions, hardware "
            "configurations, and mission profile. This information can then be used during "
            "other phases of the attack lifecycle. For CubeSats, reconnaissance often "
            "targets ground-station communication windows, beacon signals, and publicly "
            "available TLE (Two-Line Element) orbital data."
        ),
        "cubesat_example": (
            "Passive RF monitoring of a CubeSat downlink to identify CCSDS packet structures, "
            "API IDs, and command codes — all visible in unencrypted telemetry."
        ),
    },
    {
        "id": "ST0002",
        "name": "Resource Development",
        "description": (
            "The adversary is trying to establish resources they can use to support operations. "
            "Resource Development consists of techniques that involve adversaries creating, "
            "purchasing, or compromising/stealing resources that can be used to support "
            "targeting. Such resources include software tools, ground station infrastructure, "
            "compromised supply-chain components, and RF transmission hardware. "
            "For CubeSats, adversaries may develop custom CCSDS command injection tools "
            "or compromise COTS components before integration."
        ),
        "cubesat_example": (
            "Developing a software-defined radio (SDR) tool capable of transmitting spoofed "
            "CCSDS telecommand packets on the CubeSat's uplink frequency."
        ),
    },
    {
        "id": "ST0003",
        "name": "Initial Access",
        "description": (
            "The adversary is trying to get into the spacecraft or hosted payload. "
            "Initial Access consists of techniques that use various entry vectors to gain "
            "an initial foothold within a space system. Techniques include exploiting "
            "command link vulnerabilities, supply chain compromise, ground system breaches, "
            "and RF-based injection attacks. For CubeSats operating on amateur frequencies, "
            "the command uplink is often unauthenticated, making direct command injection "
            "a realistic initial access vector."
        ),
        "cubesat_example": (
            "Transmitting unauthenticated CCSDS telecommands to a CubeSat using a "
            "high-gain directional antenna during a ground-station pass window. "
            "This maps to CuCD-ID scenario: Command Flooding (initial stage)."
        ),
    },
    {
        "id": "ST0004",
        "name": "Execution",
        "description": (
            "The adversary is trying to run malicious code or commands on the spacecraft. "
            "Execution consists of techniques that result in adversary-controlled code "
            "running on a spacecraft's flight software or payload. Execution techniques "
            "are often paired with techniques from other tactics to achieve broader goals "
            "such as exploring the spacecraft file system or stealing mission data. "
            "In resource-constrained CubeSats, execution often means sending crafted "
            "commands that trigger unintended behaviors in the flight software stack (cFS)."
        ),
        "cubesat_example": (
            "Sending a crafted CCSDS command that triggers a buffer overflow in the cFS "
            "command handler, executing attacker-controlled logic on the OBC."
        ),
    },
    {
        "id": "ST0005",
        "name": "Persistence",
        "description": (
            "The adversary is trying to maintain their foothold or access. "
            "Persistence consists of techniques that adversaries use to keep access to "
            "spacecraft systems across restarts, orbital maneuvers, and communication "
            "interruptions. For CubeSats, persistence is difficult due to limited "
            "non-volatile storage, but adversaries may modify boot parameters, "
            "inject firmware updates, or exploit watchdog timer manipulation to "
            "survive resets while maintaining their malicious payload or access."
        ),
        "cubesat_example": (
            "Injecting a malicious parameter table into non-volatile EEPROM storage, "
            "ensuring malicious configuration persists across power cycles and resets."
        ),
    },
    {
        "id": "ST0006",
        "name": "Defense Evasion",
        "description": (
            "The adversary is trying to avoid being detected by operators and security systems. "
            "Defense Evasion consists of techniques that adversaries use to avoid detection "
            "throughout their compromise. This includes disguising malicious activity as "
            "normal operations, timing attacks to occur during communication blackouts, "
            "masquerading commands as authorized uplinks, and impairing onboard monitoring "
            "systems. In the CuCD-ID dataset, the Defence Impairment scenario directly "
            "corresponds to SPARTA ST0006 — the attacker disables the onboard security "
            "monitoring to prevent detection of subsequent malicious activity."
        ),
        "cubesat_example": (
            "Sending commands that disable or corrupt the onboard anomaly detection software "
            "before launching a data injection attack — ensuring the injection goes undetected. "
            "CuCD-ID dataset label: Defence Impairment (Label 4)."
        ),
        "cucdid_label": 4,
        "cucdid_attack": "Defence Impairment",
    },
    {
        "id": "ST0007",
        "name": "Lateral Movement",
        "description": (
            "The adversary is trying to move through the space system environment. "
            "Lateral Movement consists of techniques that let adversaries enter and control "
            "remote systems on a network. In spacecraft, this often means pivoting from one "
            "payload or subsystem to another — e.g., from an infected payload computer to "
            "the Attitude Determination and Control System (ADCS) or Command and Data "
            "Handling (CDH) subsystem. CubeSats with shared internal buses (I2C, CAN, SpaceWire) "
            "are particularly vulnerable to intra-spacecraft lateral movement."
        ),
        "cubesat_example": (
            "After compromising the payload processor, using the internal CAN bus to send "
            "unauthorized commands to the ADCS, causing unplanned attitude maneuvers."
        ),
    },
    {
        "id": "ST0008",
        "name": "Exfiltration",
        "description": (
            "The adversary is trying to steal sensitive mission data or spacecraft state. "
            "Exfiltration consists of techniques that adversaries may use to steal data "
            "from the spacecraft. Techniques often include encoding or encrypting stolen "
            "data to obfuscate it within legitimate telemetry downlinks. For CubeSats "
            "conducting Earth observation or signals intelligence missions, exfiltration "
            "of raw sensor data or encryption keys represents a high-value target. "
            "The CuCD-ID Data Injection scenario is related — injected false data can "
            "mask simultaneous exfiltration activity."
        ),
        "cubesat_example": (
            "Embedding stolen mission payload data (e.g., raw imagery) within legitimate "
            "housekeeping telemetry packets, exfiltrating it during scheduled downlink passes "
            "without triggering anomaly detection."
        ),
    },
    {
        "id": "ST0009",
        "name": "Impact",
        "description": (
            "The adversary is trying to manipulate, interrupt, or destroy the space system "
            "and/or its data. Impact consists of techniques that adversaries use to disrupt "
            "availability or compromise integrity of spacecraft operations. Impact techniques "
            "may include resource exhaustion, command flooding, false data injection, and "
            "physical destruction via mis-commanded actuators. Three of the four attack "
            "classes in the CuCD-ID dataset map directly to ST0009 Impact sub-techniques: "
            "Storage Exhaustion (resource exhaustion/denial), Command Flooding (denial of "
            "service via command queue saturation), and Data Injection (integrity violation "
            "via false telemetry)."
        ),
        "cubesat_example": (
            "Flooding the CubeSat command queue with high-rate CCSDS packets until the "
            "flight software task scheduler is overwhelmed, causing a mission-critical "
            "process to miss its execution deadline and the satellite to enter safe mode. "
            "CuCD-ID labels: Command Flooding (Label 2), Storage Exhaustion (Label 1), "
            "Data Injection (Label 3)."
        ),
        "cucdid_labels": [1, 2, 3],
        "cucdid_attacks": ["Storage Exhaustion", "Command Flooding", "Data Injection"],
    },
]


# ──────────────────────────────────────────────────────────────────────────────
# SPARTA TECHNIQUES (key techniques mapped to CuCD-ID attacks)
# Each technique = the "HOW" (specific method used)
# ──────────────────────────────────────────────────────────────────────────────

SPARTA_TECHNIQUES = [
    # ── ST0009: Impact ──────────────────────────────────────────────────────
    {
        "id": "SV-MA-1",
        "tactic_id": "ST0009",
        "tactic_name": "Impact",
        "name": "Resource Exhaustion / Denial of Service",
        "description": (
            "Adversary floods spacecraft resources (CPU time, memory, command queue) "
            "to deny normal operations. A fully saturated command queue prevents legitimate "
            "ground commands from being processed. Memory exhaustion can crash flight software "
            "tasks. Both are realizable via unauthenticated CCSDS command injection."
        ),
        "cucdid_attacks": ["Command Flooding", "Storage Exhaustion"],
        "cucdid_labels": [2, 1],
        "indicators": [
            "High UniqueMessageIDsInWindow (many different command codes arriving rapidly)",
            "SlidingWindowMaxIntervalSec near zero (packets arriving with near-zero gaps)",
            "MemoryShmemMB or MemoryAnonMB increasing monotonically",
            "MsgCount per window significantly above baseline",
        ],
        "mitigations": [
            "Rate-limit command processing in flight software scheduler",
            "Implement command authentication (CCSDS SDLS protocol)",
            "Monitor memory utilization with onboard watchdog",
            "Flush command queue and restart affected cFS apps if saturation detected",
        ],
        "recommended_action": "flush_command_queue",
        "risk_level": "HIGH",
    },
    {
        "id": "SV-MA-2",
        "tactic_id": "ST0009",
        "tactic_name": "Impact",
        "name": "False Data Injection / Telemetry Spoofing",
        "description": (
            "Adversary injects fabricated telemetry or sensor data into the spacecraft data "
            "bus or ground processing pipeline. False sensor readings can cause the ADCS "
            "to execute incorrect attitude maneuvers, or mislead ground operators into "
            "believing the spacecraft is in a state it is not. "
            "In the CuCD-ID dataset, Data Injection is characterized by anomalous "
            "UniqueMessageIDsInWindow values and irregular SlidingWindowMinIntervalSec "
            "patterns, as injection traffic doesn't match normal CCSDS timing."
        ),
        "cucdid_attacks": ["Data Injection"],
        "cucdid_labels": [3],
        "indicators": [
            "Unexpected UniqueMessageIDsInWindow values (novel message IDs not in normal ops)",
            "Timing irregularities: SlidingWindowMinIntervalSec drops sharply",
            "Data values outside normal operational bounds for known sensors",
            "Mismatch between reported and expected telemetry state",
        ],
        "mitigations": [
            "Implement message authentication codes (MAC) on CCSDS packets",
            "Cross-validate sensor readings against redundant sensors",
            "Deploy onboard range-checking for all telemetry values",
            "Isolate affected subsystem and enter safe mode pending ground review",
        ],
        "recommended_action": "isolate_subsystem",
        "risk_level": "HIGH",
    },
    # ── ST0006: Defense Evasion ─────────────────────────────────────────────
    {
        "id": "DE-0001",
        "tactic_id": "ST0006",
        "tactic_name": "Defense Evasion",
        "name": "Onboard Security Monitor Impairment",
        "description": (
            "Adversary sends commands that disable, corrupt, or overload onboard intrusion "
            "detection or anomaly monitoring software before launching a primary attack. "
            "This 'clearing the field' technique ensures subsequent malicious activity "
            "goes undetected. In the CuCD-ID dataset, Defence Impairment (Label 4) involves "
            "commands that directly target security-monitoring cFS apps, disabling their "
            "ability to alert on subsequent Command Flooding or Data Injection."
        ),
        "cucdid_attacks": ["Defence Impairment"],
        "cucdid_labels": [4],
        "indicators": [
            "Anomalous commands targeting security or monitoring software processes",
            "Sudden drop in telemetry health-check frequency",
            "Loss of expected watchdog heartbeat telemetry",
            "MemoryFileMB changes inconsistent with normal app loading",
        ],
        "mitigations": [
            "Protect monitoring software with hardware-enforced memory boundaries",
            "Implement independent hardware watchdog that cannot be disabled by software",
            "Alert ground operators immediately on any change to security app state",
            "Enable safe mode and restrict command execution if monitor impairment detected",
        ],
        "recommended_action": "enable_safe_mode",
        "risk_level": "CRITICAL",
    },
    # ── Normal Operations ────────────────────────────────────────────────────
    {
        "id": "NORMAL",
        "tactic_id": None,
        "tactic_name": "No Threat Detected",
        "name": "Normal CubeSat Operations",
        "description": (
            "Telemetry window matches expected baseline for normal CubeSat operations. "
            "CCSDS packet timing follows regular housekeeping cadence. Memory utilization "
            "is stable within nominal bounds. UniqueMessageIDsInWindow matches expected "
            "set for scheduled housekeeping tasks. No anomalous patterns detected. "
            "Recommended action: continue monitoring, no intervention required."
        ),
        "cucdid_attacks": ["Normal"],
        "cucdid_labels": [0],
        "indicators": [
            "UniqueMessageIDsInWindow matches expected housekeeping message set",
            "SlidingWindowMaxIntervalSec within normal cadence range",
            "MemoryAnonMB, MemoryShmemMB stable and within nominal bounds",
            "No novel or unexpected API IDs or command codes",
        ],
        "mitigations": [],
        "recommended_action": "log_only",
        "risk_level": "NONE",
    },
]


# ──────────────────────────────────────────────────────────────────────────────
# CuCD-ID → SPARTA MAPPING TABLE
# Primary lookup table: given a detected label → get SPARTA context
# ──────────────────────────────────────────────────────────────────────────────

CUCDID_TO_SPARTA = {
    0: {
        "attack_name": "Normal",
        "sparta_tactic": None,
        "sparta_tactic_name": "No Threat",
        "sparta_technique": "NORMAL",
        "risk_level": "NONE",
        "recommended_action": "log_only",
        "summary": (
            "No attack detected. Telemetry window is consistent with normal "
            "CubeSat housekeeping operations. Continue monitoring."
        ),
    },
    1: {
        "attack_name": "Storage Exhaustion",
        "sparta_tactic": "ST0009",
        "sparta_tactic_name": "Impact",
        "sparta_technique": "SV-MA-1",
        "risk_level": "HIGH",
        "recommended_action": "flush_command_queue",
        "summary": (
            "Storage Exhaustion attack detected — maps to SPARTA ST0009 (Impact), "
            "technique SV-MA-1 (Resource Exhaustion). Adversary is flooding memory "
            "resources to degrade or deny CubeSat operations. "
            "Key indicator: MemoryShmemMB / MemoryAnonMB rising anomalously. "
            "Recommended action: flush command queue, restart affected cFS apps, "
            "alert ground operators."
        ),
    },
    2: {
        "attack_name": "Command Flooding",
        "sparta_tactic": "ST0009",
        "sparta_tactic_name": "Impact",
        "sparta_technique": "SV-MA-1",
        "risk_level": "HIGH",
        "recommended_action": "flush_command_queue",
        "summary": (
            "Command Flooding attack detected — maps to SPARTA ST0009 (Impact), "
            "technique SV-MA-1 (Denial of Service via command queue saturation). "
            "Adversary is transmitting high-rate CCSDS commands to saturate the "
            "flight software command queue, preventing legitimate ground commands "
            "from being processed. "
            "Key indicator: SlidingWindowMaxIntervalSec near zero, MsgCount >> baseline. "
            "Recommended action: flush command queue, rate-limit command processing."
        ),
    },
    3: {
        "attack_name": "Data Injection",
        "sparta_tactic": "ST0009",
        "sparta_tactic_name": "Impact",
        "sparta_technique": "SV-MA-2",
        "risk_level": "HIGH",
        "recommended_action": "isolate_subsystem",
        "summary": (
            "Data Injection attack detected — maps to SPARTA ST0009 (Impact), "
            "technique SV-MA-2 (False Data Injection / Telemetry Spoofing). "
            "Adversary is injecting fabricated CCSDS telemetry packets to corrupt "
            "ground operator situational awareness or trigger false spacecraft maneuvers. "
            "Key indicator: anomalous UniqueMessageIDsInWindow (novel message IDs). "
            "WARNING: This class is the dominant false-positive mode under noise "
            "(1,786 Normal packets misclassified as Data Injection in domain-shift eval). "
            "Confidence threshold check mandatory before triggering autonomous mitigation. "
            "Recommended action: isolate affected subsystem, await secondary confirmation."
        ),
    },
    4: {
        "attack_name": "Defence Impairment",
        "sparta_tactic": "ST0006",
        "sparta_tactic_name": "Defense Evasion",
        "sparta_technique": "DE-0001",
        "risk_level": "CRITICAL",
        "recommended_action": "enable_safe_mode",
        "summary": (
            "Defence Impairment attack detected — maps to SPARTA ST0006 (Defense Evasion), "
            "technique DE-0001 (Onboard Security Monitor Impairment). "
            "This is a CRITICAL severity finding: the adversary is actively disabling "
            "onboard security monitoring, likely as a precursor to a follow-on attack "
            "(Command Flooding or Data Injection). Immediate escalation required. "
            "Key indicator: commands targeting security/monitoring software processes. "
            "Recommended action: enable safe mode immediately, restrict all non-essential "
            "command execution, alert ground operations team."
        ),
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ──────────────────────────────────────────────────────────────────────────────

def get_sparta_context(label: int) -> dict:
    """
    Given a CuCD-ID label (0-4), return full SPARTA context for the agent.
    This is the primary lookup used by the SPARTA Analyst Agent.
    """
    return CUCDID_TO_SPARTA.get(label, CUCDID_TO_SPARTA[0])


def get_technique_details(technique_id: str) -> dict:
    """Return full technique details by technique ID (e.g. 'SV-MA-1')."""
    for tech in SPARTA_TECHNIQUES:
        if tech["id"] == technique_id:
            return tech
    return {}


def get_tactic_details(tactic_id: str) -> dict:
    """Return full tactic details by tactic ID (e.g. 'ST0009')."""
    for tactic in SPARTA_TACTICS:
        if tactic["id"] == tactic_id:
            return tactic
    return {}


def get_recommended_action(label: int) -> str:
    """
    Return the recommended mitigation action for a given CuCD-ID label.
    Actions: 'log_only', 'flush_command_queue', 'isolate_subsystem', 'enable_safe_mode'
    """
    return CUCDID_TO_SPARTA.get(label, {}).get("recommended_action", "log_only")


if __name__ == "__main__":
    # Quick sanity check
    print("SPARTA Knowledge Base — CuCD-ID Mappings")
    print("=" * 50)
    for label, info in CUCDID_TO_SPARTA.items():
        print(f"\nLabel {label}: {info['attack_name']}")
        print(f"  Tactic  : {info['sparta_tactic']} — {info['sparta_tactic_name']}")
        print(f"  Risk    : {info['risk_level']}")
        print(f"  Action  : {info['recommended_action']}")
    print("\nAll entries loaded successfully.")

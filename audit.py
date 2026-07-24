import sys, os
sys.path.insert(0, '.')

print("=" * 55)
print("CUBESAT IDS — FULL SYSTEM AUDIT")
print("=" * 55)

errors = []

# Test 1: SPARTA data
try:
    from sparta_kb.sparta_data import (
        SPARTA_TACTICS, SPARTA_TECHNIQUES, CUCDID_TO_SPARTA,
        get_sparta_context, get_recommended_action
    )
    print("\n[1] sparta_data.py")
    print(f"    Tactics   : {len(SPARTA_TACTICS)}")
    print(f"    Techniques: {len(SPARTA_TECHNIQUES)}")
    print(f"    Mappings  : {len(CUCDID_TO_SPARTA)}")
    for label in range(5):
        ctx = get_sparta_context(label)
        action = get_recommended_action(label)
        print(f"    Label {label}: {ctx['attack_name']:22s} -> {str(ctx['sparta_tactic']):7s} -> {action}")
    print("    STATUS: PASS")
except Exception as e:
    print(f"    STATUS: FAIL - {e}")
    errors.append(f"sparta_data: {e}")

# Test 2: ChromaDB
try:
    import chromadb
    from chromadb.utils import embedding_functions
    client = chromadb.PersistentClient(path='sparta_kb/chroma_db')
    col = client.get_collection('sparta_knowledge')
    print(f"\n[2] ChromaDB")
    print(f"    Documents: {col.count()}")
    print(f"    STATUS: PASS")
except Exception as e:
    print(f"\n[2] ChromaDB - FAIL: {e}")
    errors.append(f"chromadb: {e}")

# Test 3: Simulator
try:
    from simulator.telemetry_simulator import SlidingWindowBuffer, WINDOW_SIZE, LABEL_MAP
    buf = SlidingWindowBuffer(5)
    print(f"\n[3] telemetry_simulator.py")
    print(f"    Window size: {WINDOW_SIZE}")
    print(f"    Labels: {list(LABEL_MAP.values())}")
    print(f"    Buffer works: {not buf.is_ready()} (empty on init)")
    print(f"    STATUS: PASS")
except Exception as e:
    print(f"\n[3] Simulator - FAIL: {e}")
    errors.append(f"simulator: {e}")

# Test 4: Scenario Injector
try:
    from simulator.scenario_injector import ScenarioSequencer, InjectionEngine, AttackLabel
    steps_demo = ScenarioSequencer.full_demo_sequence()
    steps_cmd  = ScenarioSequencer.command_flooding_attack()
    steps_def  = ScenarioSequencer.defence_impairment_attack()
    engine = InjectionEngine(steps_demo)
    manifest = engine.get_manifest()
    total_pkts = sum(m['n_packets'] for m in manifest)
    labels_covered = set(m['label'] for m in manifest)
    print(f"\n[4] scenario_injector.py")
    print(f"    Demo steps    : {len(steps_demo)}")
    print(f"    Total packets : {total_pkts}")
    print(f"    Total windows : {total_pkts // 53}")
    print(f"    Labels covered: {sorted(labels_covered)} (need 0-4)")
    assert labels_covered == {0,1,2,3,4}, "Missing attack labels!"
    print(f"    STATUS: PASS")
except Exception as e:
    print(f"\n[4] Injector - FAIL: {e}")
    errors.append(f"injector: {e}")

# Test 5: Agent Tools
try:
    from agents.tools import (
        StreamState, TelemetryStreamTool, ClassifierTool,
        SpartaLookupTool, ScenarioInjectorTool,
        tool_sparta_lookup, get_all_tools
    )
    tools = get_all_tools()
    r = tool_sparta_lookup(2)
    r4 = tool_sparta_lookup(4)
    print(f"\n[5] agents/tools.py")
    print(f"    Tools registered: {len(tools)}")
    for t in tools:
        print(f"      - {t.name if hasattr(t, 'name') else type(t).__name__}")
    print(f"    Label 2 lookup: {r['recommended_action']} | risk: {r['risk_level']}")
    print(f"    Label 4 lookup: {r4['recommended_action']} | risk: {r4['risk_level']}")
    print(f"    STATUS: PASS")
except Exception as e:
    print(f"\n[5] Tools - FAIL: {e}")
    errors.append(f"tools: {e}")

# Test 6: Pipeline imports
try:
    from agents.pipeline import (
        monitor_agent_step, classifier_agent_step,
        sparta_analyst_step, mitigation_agent_step, incident_reporter_step,
        CONFIDENCE_THRESHOLD
    )
    print(f"\n[6] agents/pipeline.py")
    print(f"    5 agent functions: imported OK")
    print(f"    Confidence threshold: {CONFIDENCE_THRESHOLD}")
    print(f"    STATUS: PASS")
except Exception as e:
    print(f"\n[6] Pipeline - FAIL: {e}")
    errors.append(f"pipeline: {e}")

print("\n" + "=" * 55)
if errors:
    print(f"AUDIT RESULT: {len(errors)} FAILURE(S)")
    for e in errors:
        print(f"  FAIL: {e}")
else:
    print("AUDIT RESULT: ALL 6 CHECKS PASSED")
print("=" * 55)

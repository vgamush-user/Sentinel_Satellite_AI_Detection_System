import sys
from pathlib import Path
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from tools.classifier_tool import classify_telemetry, FEATURE_ORDER

def get_row(noised: pd.DataFrame, label: int):
    group = noised[noised["Label"] == label]
    return group.iloc[len(group) // 3]

def run_test(name, window):
    result = classify_telemetry(window)
    print(f"[{name}] Predicted: {result['class']:18s} | Conf: {result['confidence']:.3f}")

def main():
    print("Loading dataset...")
    noised = pd.read_csv(PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv")
    
    row_normal = get_row(noised, 0)
    row_cmd_flood = get_row(noised, 2)
    row_data_inj = get_row(noised, 3)
    
    print("\n=== RX-01: STRADDLE WINDOWS (Normal vs Data Injection) ===")
    for ratio in [0.0, 0.25, 0.5, 0.75, 1.0]:
        window = {f: float(row_normal[f] * (1 - ratio) + row_data_inj[f] * ratio) for f in FEATURE_ORDER}
        run_test(f"Normal {(1-ratio)*100:3.0f}% + DataInj {ratio*100:3.0f}%", window)

    print("\n=== RX-05: RAMPING NOISE (Normal -> Data Injection) ===")
    base_val = float(row_normal["UniqueMessageIDsInWindow"])
    max_val = float(row_data_inj["UniqueMessageIDsInWindow"])
    step = (max_val - base_val) / 4
    
    for i in range(5):
        window = {f: float(row_normal[f]) for f in FEATURE_ORDER}
        curr_val = base_val + (step * i)
        window["UniqueMessageIDsInWindow"] = curr_val
        run_test(f"Normal + UniqueMsgIDs={curr_val:.1f}", window)

    print("\n=== CF-DI-03: MUTUAL CONFUSION (Command Flood vs Data Injection) ===")
    for ratio in [0.25, 0.5, 0.75]:
        window = {f: float(row_cmd_flood[f] * (1 - ratio) + row_data_inj[f] * ratio) for f in FEATURE_ORDER}
        run_test(f"CmdFlood {(1-ratio)*100:3.0f}% + DataInj {ratio*100:3.0f}%", window)

if __name__ == "__main__":
    main()

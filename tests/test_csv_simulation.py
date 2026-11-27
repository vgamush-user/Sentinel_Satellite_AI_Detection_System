import os
import sys
import unittest
from pathlib import Path

# Add src to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from simulator.telemetry_simulator import TelemetryReplaySimulator, resolve_default_csv
from streaming.config import DATASETS, resolve_dataset_path
from streaming.inject import load_dataset
from web.analysis import control_replay, get_simulator, list_available_datasets, replay, ReplaySettings, snapshot, stop_replay, window_for


class TestCsvSimulation(unittest.TestCase):
    def test_default_csv_resolution(self):
        # Default should find an existing sample or standard dataset
        p = resolve_default_csv()
        self.assertTrue(p.is_file(), f"Resolved default CSV does not exist: {p}")

    def test_sample_demo_csvs_registered(self):
        expected_keys = [
            "noised", "raw", "sample_demo_nominal", "sample_demo_command_flooding",
            "sample_demo_data_injection", "sample_demo_storage_exhaustion",
            "sample_demo_defence_impairment", "sample_demo_mixed_traffic",
            "sample_demo_bus_telemetry"
        ]
        for key in expected_keys:
            self.assertIn(key, DATASETS, f"Dataset key '{key}' missing from DATASETS")
            self.assertTrue(Path(DATASETS[key]).is_file(), f"File for '{key}' does not exist: {DATASETS[key]}")

    def test_telemetry_replay_simulator_default(self):
        sim = TelemetryReplaySimulator()  # no path specified -> defaults automatically
        self.assertGreater(sim.total_rows, 0)
        sim.configure(speed_rows_per_sec=100, loop=False)
        sim.start()
        import time
        time.sleep(0.15)
        snap = sim.snapshot()
        self.assertGreater(snap.rows_emitted, 0)
        sim.stop()

    def test_telemetry_replay_simulator_bus_telemetry(self):
        # 5-channel bus telemetry CSV
        sim = TelemetryReplaySimulator("sample_demo_bus_telemetry.csv")
        self.assertEqual(sim.total_rows, 200)
        sim.configure(speed_rows_per_sec=200, loop=False)
        sim.start()
        import time
        time.sleep(0.1)
        snap = sim.snapshot()
        self.assertGreater(snap.rows_emitted, 0)
        self.assertIn("rf_snr", snap.buffer.columns)
        sim.stop()

    def test_web_analysis_load_and_replay_any_csv(self):
        # Load sample_demo_nominal
        settings_nom = ReplaySettings(dataset="sample_demo_nominal", speed=50, loop=False, buffer_size=50)
        control_replay("load", settings_nom)
        control_replay("start", settings_nom)
        import time
        time.sleep(0.1)
        r = replay()
        self.assertEqual(r["dataset"], "sample_demo_nominal")
        self.assertIn(r["state"], ("running", "paused", "finished"))
        self.assertGreater(r["rows_emitted"], 0)
        control_replay("stop", settings_nom)

        # Load 5-channel bus telemetry
        settings_bus = ReplaySettings(dataset="sample_demo_bus_telemetry", speed=50, loop=False, buffer_size=50)
        control_replay("load", settings_bus)
        control_replay("start", settings_bus)
        time.sleep(0.1)
        r_bus = replay()
        self.assertEqual(r_bus["dataset"], "sample_demo_bus_telemetry")
        control_replay("stop", settings_bus)

        # Datasets list endpoint
        ds = list_available_datasets()
        self.assertIn("datasets", ds)
        keys = [item["key"] for item in ds["datasets"]]
        self.assertIn("sample_demo_mixed_traffic", keys)

    def test_load_dataset_any_path(self):
        df = load_dataset("sample_demo_command_flooding")
        self.assertEqual(len(df), 150)
        self.assertIn("Label", df.columns)


if __name__ == "__main__":
    unittest.main()

# Sample Demo Telemetry CSVs

This directory contains standalone, curated sample CSV files extracted and structured from the Sentinel Satellite AI Detection System's sample demo datasets and telemetry simulators.

## Available Sample CSVs

| File | Rows | Type / Attack Scenario | Description |
| :--- | :--- | :--- | :--- |
| `sample_demo_nominal.csv` | 150 | Nominal (Label 0) | Clean and realistic baseline telemetry representing nominal spacecraft operations with standard sensor noise. |
| `sample_demo_command_flooding.csv` | 150 | Command Flooding (Label 2) | High packet arrival rates, rapid sequence increments, and command queue saturation patterns (SPARTA SV-MA-1). |
| `sample_demo_data_injection.csv` | 150 | Data Injection (Label 3) | Spoofed telemetry payloads, abnormal message length variance, and false status signals (SPARTA SV-MA-2). |
| `sample_demo_storage_exhaustion.csv` | 150 | Storage Exhaustion (Label 1) | Elevated anonymous memory allocation (`MemoryAnonMB`) and heap depletion signatures (SPARTA EX-0014.03). |
| `sample_demo_defence_impairment.csv` | 150 | Defence Impairment (Label 4) | Precursor attacks that manipulate anomaly reporting channels, logging rates, or beacon timing (SPARTA DE-0001). |
| `sample_demo_mixed_traffic.csv` | 300 | Mixed Traffic (Multi-class) | Realistic mission timeline: nominal baseline interleaved with command flooding, data injection, storage exhaustion, and recovery periods. |
| `sample_demo_bus_telemetry.csv` | 200 | 5-Channel Bus Telemetry | Downlink bus channels (`rf_snr`, `bus_voltage`, `battery_temp`, `gyro_rate`, `cmd_rate`) directly matching the browser demo source. |

## How to Simulate

Any of these CSV files can be directly simulated:

1. **CLI Telemetry Simulator**:
   ```bash
   # Run with default simulation (automatically selects sample_demo_mixed_traffic.csv)
   python src/simulator/telemetry_simulator.py

   # Or simulate any specific CSV
   python src/simulator/telemetry_simulator.py sample_telemetry_csvs/sample_demo_command_flooding.csv --speed 20
   ```

2. **Web / Replay API**:
   In the Manual Analysis replay tab, select any of the sample datasets from the dropdown (or provide its path) to replay and analyze in real time.

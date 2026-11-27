import os
import pandas as pd
import numpy as np

def main():
    os.makedirs('data/sample_demo_csvs', exist_ok=True)
    os.makedirs('sample_telemetry_csvs', exist_ok=True)

    df_noised = pd.read_csv('data/noised/noised_dataset.csv')
    print(f"Loaded noised dataset with {len(df_noised)} rows.")

    # 1. Nominal
    df_nom = df_noised[df_noised['Label'] == 0].iloc[100:250].reset_index(drop=True)
    df_nom.to_csv('data/sample_demo_csvs/sample_demo_nominal.csv', index=False)
    df_nom.to_csv('sample_telemetry_csvs/sample_demo_nominal.csv', index=False)

    # 2. Storage Exhaustion
    df_store = df_noised[df_noised['Label'] == 1].iloc[100:250].reset_index(drop=True)
    df_store.to_csv('data/sample_demo_csvs/sample_demo_storage_exhaustion.csv', index=False)
    df_store.to_csv('sample_telemetry_csvs/sample_demo_storage_exhaustion.csv', index=False)

    # 3. Command Flooding
    df_cmd = df_noised[df_noised['Label'] == 2].iloc[100:250].reset_index(drop=True)
    df_cmd.to_csv('data/sample_demo_csvs/sample_demo_command_flooding.csv', index=False)
    df_cmd.to_csv('sample_telemetry_csvs/sample_demo_command_flooding.csv', index=False)

    # 4. Data Injection
    df_data = df_noised[df_noised['Label'] == 3].iloc[100:250].reset_index(drop=True)
    df_data.to_csv('data/sample_demo_csvs/sample_demo_data_injection.csv', index=False)
    df_data.to_csv('sample_telemetry_csvs/sample_demo_data_injection.csv', index=False)

    # 5. Defence Impairment
    df_def = df_noised[df_noised['Label'] == 4].iloc[100:250].reset_index(drop=True)
    df_def.to_csv('data/sample_demo_csvs/sample_demo_defence_impairment.csv', index=False)
    df_def.to_csv('sample_telemetry_csvs/sample_demo_defence_impairment.csv', index=False)

    # 6. Mixed Traffic
    mixed_slices = [
        df_noised[df_noised['Label'] == 0].iloc[0:60],
        df_noised[df_noised['Label'] == 2].iloc[0:40],
        df_noised[df_noised['Label'] == 0].iloc[60:110],
        df_noised[df_noised['Label'] == 3].iloc[0:40],
        df_noised[df_noised['Label'] == 0].iloc[110:160],
        df_noised[df_noised['Label'] == 1].iloc[0:40],
        df_noised[df_noised['Label'] == 4].iloc[0:20],
        df_noised[df_noised['Label'] == 0].iloc[160:200]
    ]
    df_mixed = pd.concat(mixed_slices, ignore_index=True)
    df_mixed['SequenceCount'] = range(1, len(df_mixed) + 1)
    df_mixed.to_csv('data/sample_demo_csvs/sample_demo_mixed_traffic.csv', index=False)
    df_mixed.to_csv('sample_telemetry_csvs/sample_demo_mixed_traffic.csv', index=False)

    # 7. 5-Channel Bus Telemetry (matching browser sample demo)
    def hash_val(val, seed):
        v = (int(val) ^ int(seed)) * 1664525 + 1013904223
        return (v & 0xFFFFFFFF) / 0xFFFFFFFF

    rows = []
    for seq in range(1, 201):
        snr = round(14.2 + 0.4 * np.sin(seq / 25) + 0.3 * (hash_val(seq, 1) - 0.5), 2)
        volt = round(28.12 + 0.18 * np.sin(seq / 40) + 0.04 * (hash_val(seq, 2) - 0.5), 3)
        temp = round(18.4 + 1.2 * np.sin(seq / 300) + 0.08 * (hash_val(seq, 3) - 0.5), 2)
        gyro = round(0.021 + 0.006 * (hash_val(seq, 5) - 0.5), 4)
        cmd = round(4 + 1.5 * hash_val(seq, 6), 1)
        
        truth = 'Nominal'
        label_num = 0
        if 50 <= seq <= 70:
            cmd = round(cmd + 18.0, 1)
            truth = 'Command Flooding'
            label_num = 2
        elif 120 <= seq <= 140:
            snr = round(snr - 6.5, 2)
            volt = round(volt - 0.15, 3)
            truth = 'Data Injection'
            label_num = 3
            
        rows.append({
            'Seq': seq,
            'MsgId': 1000 + seq,
            'rf_snr': snr,
            'bus_voltage': volt,
            'battery_temp': temp,
            'gyro_rate': gyro,
            'cmd_rate': cmd,
            'GroundTruth': truth,
            'Label': label_num
        })

    df_bus = pd.DataFrame(rows)
    df_bus.to_csv('data/sample_demo_csvs/sample_demo_bus_telemetry.csv', index=False)
    df_bus.to_csv('sample_telemetry_csvs/sample_demo_bus_telemetry.csv', index=False)

    print("Successfully generated all sample CSV files in 'data/sample_demo_csvs' and 'sample_telemetry_csvs'.")

if __name__ == '__main__':
    main()

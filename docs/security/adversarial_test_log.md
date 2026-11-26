# Phase 5: Adversarial Test Logs

**Date**: 2026-08-20
**Target**: Baseline XGBoost Classifier (`baseline_xgb.json`)

## Raw Test Output
```text
Loading dataset...

=== RX-01: STRADDLE WINDOWS (Normal vs Data Injection) ===
[Normal 100% + DataInj   0%] Predicted: Normal             | Conf: 0.998
[Normal  75% + DataInj  25%] Predicted: Normal             | Conf: 0.736
[Normal  50% + DataInj  50%] Predicted: Normal             | Conf: 0.736
[Normal  25% + DataInj  75%] Predicted: Normal             | Conf: 0.709
[Normal   0% + DataInj 100%] Predicted: Data Injection     | Conf: 0.610

=== RX-05: RAMPING NOISE (Normal -> Data Injection) ===
[Normal + UniqueMsgIDs=7.0] Predicted: Normal             | Conf: 0.998
[Normal + UniqueMsgIDs=9.5] Predicted: Normal             | Conf: 0.736
[Normal + UniqueMsgIDs=12.0] Predicted: Normal             | Conf: 0.736
[Normal + UniqueMsgIDs=14.5] Predicted: Normal             | Conf: 0.736
[Normal + UniqueMsgIDs=17.0] Predicted: Normal             | Conf: 0.736

=== CF-DI-03: MUTUAL CONFUSION (Command Flood vs Data Injection) ===
[CmdFlood  75% + DataInj  25%] Predicted: Command Flooding   | Conf: 0.663
[CmdFlood  50% + DataInj  50%] Predicted: Data Injection     | Conf: 0.999
[CmdFlood  25% + DataInj  75%] Predicted: Data Injection     | Conf: 0.997

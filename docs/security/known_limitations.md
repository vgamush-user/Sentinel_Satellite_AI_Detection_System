
***

### File 2: `docs/security/known_limitations.md`
*(Create this file and paste the following markdown)*

```markdown
# CuCD-ID Final Security Narrative: Known Limitations

*An honest assessment of the system's edge cases and failure modes based on Phase 5 Adversarial Testing.*

## What the System Catches Well
The system successfully identifies clean, distinct attack profiles. When an attack (like Storage Exhaustion or Command Flooding) dominates the entirety of a telemetry window, the model reliably hits high confidence scores and triggers the appropriate autonomous mitigations defined in the policy. 

Furthermore, the model is highly resistant to pure noise. As demonstrated in **RX-05**, artificially ramping up packet noise (`UniqueMessageIDsInWindow`) in a Normal telemetry window drops the confidence slightly (to ~0.73), but the model correctly refuses to hallucinate a "Data Injection" attack.

## Where the System Fails
Based on targeted adversarial testing, we have identified two major limitations:

### 1. The "Straddle Window" Vulnerability (RX-01)
If an attacker initiates Data Injection exactly in the middle of a sliding window (creating an ambiguous blend of Normal and Malicious telemetry), the model defaults to `Normal`. Even when the window is 75% Data Injection, the model fails to flag the attack. Furthermore, in cases of pure Data Injection, the model's confidence frequently hovers around `0.610`. Because our Mitigation Policy requires a confidence of `0.85` to autonomously isolate a subsystem, these attacks will only be flagged for human review, delaying response times.

### 2. Command Flooding vs. Data Injection Confusion (CF-DI-03)
When presented with ambiguous feature sets that straddle the line between Command Flooding and Data Injection, the model demonstrates an extreme bias toward Data Injection. At a perfect 50/50 blend, the model predicts Data Injection with `0.999` confidence. This means attackers could potentially mask a Command Flooding denial-of-service attack by mixing in fabricated data packets, tricking the autonomous pipeline into reacting to the wrong threat.

## Conclusion
The CuCD-ID pipeline is highly effective against blunt-force attacks but remains vulnerable to carefully timed, stealthy injections that straddle measurement windows. Future ML iterations should focus on shrinking the sliding window interval or utilizing sequence-based RNN models to detect mid-window state changes.

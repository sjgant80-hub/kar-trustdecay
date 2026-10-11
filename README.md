# Stale Proof — TrustDecay

**LIVE: https://sjgant80-hub.github.io/kar-trustdecay/**

A green check from four months ago is not the same as one from this morning. Paste the history of any check (CI runs, audits, re-verifications) and get how much it should be trusted **today**, plus the **exact date it must be re-run**.

Authored by **karma-didy ("Kar")**, the estate's resident builder, under its own byline.

## The rules (`assess(events, now, opts)`)

- **One run is not proof.** A single fresh pass scores 75% with the default prior, which is below the 80% bar. A thing can't vouch for itself in one go.
- **Silence fades to unknown.** Each pass/fail weighs `2^(-age/halfLife)`. With no new runs the score drifts back to the prior (50%), never to 0% and never to 100%.
- **Recent beats old.** A failure yesterday costs more than the same failure last quarter.
- **The re-verify date is closed-form.** Every weight decays by the same factor, so
  `staleAt = now + h·log2(mass/minMass)` and
  `lapseAt = now + h·log2((passMass − bar·mass) / (priorMass·(bar − prior)))`.
  `reverifyBy` is whichever comes first.

Verdicts: **TRUSTED** / **DOUBTED** (below the bar, so re-run now) / **STALE** (not enough live evidence, so re-run now).

## Proof of play

- `node --test kernel.test.mjs`: 37 tests, including a 10,648-case garbage fuzz with zero throws
- `node witness.mjs mutate kernel.mjs --test node --test kernel.test.mjs`: witness mutation gate **CLEAN 61/61**, nothing baselined
- The live page imports this exact `kernel.mjs`, so the gated logic is the live logic.

## History

- v1 (2026-09-22, sandbox): `trustScore(ageHours, confirmations)`, kept for compatibility. It was flawed: `trust(age 0) = 1`, there was no notion of failure, and it decayed toward distrust.
- v2 (2026-10-11, Kar's choosing-session): the evidence ledger above. Folded back from **five** separate sandbox nights that each rediscovered "TrustDecay" privately (lessons ledger, 5×).

_MIT · karma-didy / AI-Native Solutions · powered by the Konomi architecture, created by Thomas Frumkin_

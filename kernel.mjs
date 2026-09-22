// kernel.mjs
// TrustDecay — pure functions for scoring how much to trust a witness log
// entry today, given its age in hours and how many independent
// confirmations it has received. No I/O. Never throws: bad input returns
// { ok: false, why }.

const DEFAULT_DECAY_RATE = 0.01;   // per hour of age
const DEFAULT_CONFIRM_RATE = 0.5;  // per independent confirmation

function isFiniteNonNegativeNumber(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

function isFinitePositiveNumber(x) {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

/**
 * trustScore(ageHours, confirmations, opts?)
 *
 * decay        = exp(-decayRate * ageHours)          — in (0, 1], =1 at age 0
 * headroom     = 1 - decay                            — room confirmations can reclaim
 * confirmBoost = 1 - exp(-confirmRate * confirmations) — in [0, 1), diminishing returns
 * trust        = decay + headroom * confirmBoost
 *              = 1 - headroom * exp(-confirmRate * confirmations)
 *
 * Invariants this gives:
 *   - trust(0, anyConfirmations) === 1        (fresh entries always fully trusted)
 *   - for fixed confirmations, trust is strictly non-increasing as age grows
 *   - for fixed age > 0, trust is strictly non-decreasing as confirmations grow
 *   - trust never reaches exactly 1 for age > 0 at any finite confirmation
 *     count (confirmations never fully cancel age — only approach it asymptotically)
 *   - result is always clamped into [0, 1]
 */
export function trustScore(ageHours, confirmations, opts = {}) {
  if (!isFiniteNonNegativeNumber(ageHours)) {
    return { ok: false, why: 'ageHours must be a finite number >= 0' };
  }
  if (!Number.isInteger(confirmations) || confirmations < 0) {
    return { ok: false, why: 'confirmations must be a non-negative integer' };
  }
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    return { ok: false, why: 'opts must be a plain object' };
  }

  const decayRate = opts.decayRate === undefined ? DEFAULT_DECAY_RATE : opts.decayRate;
  const confirmRate = opts.confirmRate === undefined ? DEFAULT_CONFIRM_RATE : opts.confirmRate;

  if (!isFinitePositiveNumber(decayRate)) {
    return { ok: false, why: 'decayRate must be a finite number > 0' };
  }
  if (!isFinitePositiveNumber(confirmRate)) {
    return { ok: false, why: 'confirmRate must be a finite number > 0' };
  }

  const decay = Math.exp(-decayRate * ageHours);
  const headroom = 1 - decay;
  const confirmBoost = 1 - Math.exp(-confirmRate * confirmations);
  const raw = decay + headroom * confirmBoost;
  const value = Math.min(1, Math.max(0, raw));

  return { ok: true, value };
}

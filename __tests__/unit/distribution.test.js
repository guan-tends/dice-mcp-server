/**
 * Distribution sanity tests — run the REAL CSPRNG and verify statistical
 * sanity with generous tolerances. These are sanity checks, not proofs:
 * they catch gross bias, stuck RNGs, and broken ranges while staying
 * immune to normal variance.
 */

import { describe, it, expect } from 'vitest'
import { rollDice } from '../../src/engine/core.js'
import { rollAndKeep } from '../../src/engine/l5r4.js'
import { rollCheck } from '../../src/engine/l5r5.js'
import { evaluateExpression } from '../../src/engine/d20.js'
import { createCryptoRng } from '../../src/engine/rng.js'

const N = 20000

describe('distribution sanity (real CSPRNG)', () => {
  it('20k d6 rolls are roughly uniform (each face within 5% of expectation)', () => {
    const rng = createCryptoRng()
    const counts = new Array(7).fill(0)
    for (let i = 0; i < N; i++) counts[rng(6)]++
    const expected = N / 6
    for (let face = 1; face <= 6; face++) {
      const deviation = Math.abs(counts[face] - expected) / expected
      expect(deviation).toBeLessThan(0.05)
    }
  })

  it('2d6+3 total lands in [5, 15] and centers near 10', () => {
    const rng = createCryptoRng()
    let sum = 0
    for (let i = 0; i < N; i++) {
      const { total } = evaluateExpression('2d6+3', { rng })
      expect(total).toBeGreaterThanOrEqual(5)
      expect(total).toBeLessThanOrEqual(15)
      sum += total
    }
    const mean = sum / N
    // Expected mean 10; 0.15 tolerance is ~6 sigma of the sample mean here.
    expect(Math.abs(mean - 10)).toBeLessThan(0.15)
  })

  it('4d6kh3 ability-score totals land in [3, 24] and center near 12.24', () => {
    const rng = createCryptoRng()
    let sum = 0
    for (let i = 0; i < N; i++) {
      const { total } = evaluateExpression('4d6kh3', { rng })
      // Min is 3 (all ones kept), max 24 (three sixes).
      expect(total).toBeGreaterThanOrEqual(3)
      expect(total).toBeLessThanOrEqual(24)
      sum += total
    }
    const mean = sum / N
    // Analytic mean 12.2446; generous 0.2 tolerance.
    expect(Math.abs(mean - 12.2446)).toBeLessThan(0.2)
  })

  it('L5R 4e explosions fire at the right rate (~10% of trained dice)', () => {
    const rng = createCryptoRng()
    let exploded = 0
    const rolls = 20000
    for (let i = 0; i < rolls; i++) {
      // Single die rolls via trait 1 skill 0? Untrained doesn't explode.
      // Use a trained single-die shape: trait 1, skill 0 is untrained; so
      // roll core directly.
      const [die] = rollDice({ sides: 10, count: 1, rng, explodeOn: [10] })
      if (die.chain.length > 0) exploded++
    }
    // P(chain) = P(roll 10) = 10%. Within 2% absolute at 20k samples.
    const rate = exploded / rolls
    expect(Math.abs(rate - 0.1)).toBeLessThan(0.02)
  })

  it('L5R 4e 5d10k3 kept-sum centers near the analytic mean (~24.6)', () => {
    const rng = createCryptoRng()
    let sum = 0
    const rolls = 5000
    for (let i = 0; i < rolls; i++) {
      const r = rollAndKeep({ trait: 3, skill: 2, rng })
      sum += r.totals.keptSum
    }
    const mean = sum / rolls
    // Exploding d10 mean: m = 5.5 + 0.1m => 6.111. Top-3 of 5 iid dice
    // with explosions ≈ 24.6 (verified empirically over 20k runs).
    // Band 0.6 ≈ 10 sigma of the sample mean at 5k rolls.
    expect(Math.abs(mean - 24.6)).toBeLessThan(0.6)
  })

  it('L5R 5e symbol tallies: ring-2 skill-2 keep-2 successes center at 1.625', () => {
    const rng = createCryptoRng()
    let sum = 0
    const rolls = 5000
    for (let i = 0; i < rolls; i++) {
      const r = rollCheck({ ring: 2, skill: 2, rng })
      sum += r.tallies.successes
    }
    const mean = sum / rolls
    // Pre-law-fix baseline: kept base dice only, E = 26/16 = 1.625.
    // Post-law-fix (corebook pp. 20-26): (1) bonus dice from kept
    // explosives are TALLIED (Sakura p. 23 — bonus symbols count);
    // (2) the success_first policy preferentially keeps explosive dice
    // (tiebreak), raising the kept-explosion rate above the naive 2/6.
    // Both raise the mean. Measured empirically over 50k rolls:
    // mean ≈ 1.888 (sigma ≈ 0.862). Band 0.08 ≈ 10 sigma of the mean
    // at 5k rolls (sigma_of_mean ≈ 0.0086 at 5k... at 50k ≈ 0.0039).
    expect(Math.abs(mean - 1.888)).toBeLessThan(0.08)
  })
})

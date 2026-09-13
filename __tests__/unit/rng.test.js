import { describe, it, expect } from 'vitest'
import { createCryptoRng, createSequenceRng } from '../../src/engine/rng.js'

describe('createSequenceRng', () => {
  it('yields queued values in order', () => {
    const rng = createSequenceRng([3, 5, 1])
    expect(rng(6)).toBe(3)
    expect(rng(6)).toBe(5)
    expect(rng(6)).toBe(1)
  })

  it('throws with position info when sequence is exhausted', () => {
    const rng = createSequenceRng([2])
    rng(6)
    expect(() => rng(6)).toThrow(/sequence exhausted at position 1/)
  })

  it('rejects values outside the die range at queue time', () => {
    // Out-of-range queued values would silently corrupt engine tests.
    expect(() => createSequenceRng([0, 1])).toThrow(/out of range/)
    expect(() => createSequenceRng([1, 7], 6)).toThrow(/out of range/)
  })

  it('validates queued values against a fixed sides expectation', () => {
    // When sides are declared, every queued value must be valid for them.
    const rng = createSequenceRng([2, 6], 6)
    expect(rng(6)).toBe(2)
    expect(rng(6)).toBe(6)
  })
})

describe('createCryptoRng', () => {
  it('returns values within [1, sides] (inclusive)', () => {
    const rng = createCryptoRng()
    for (let i = 0; i < 1000; i++) {
      const v = rng(6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('handles arbitrary die sizes', () => {
    const rng = createCryptoRng()
    for (const sides of [2, 6, 10, 12, 20, 100]) {
      const v = rng(sides)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(sides)
    }
  })

  it('smoke: 10000d6 covers the full face range (statistical, generous bounds)', () => {
    // Sanity, not proof: with 10k rolls every face should appear at least
    // ~1200 times in expectation; a floor of 800 is far beyond any plausible
    // CSPRNG failure while immune to normal variance.
    const rng = createCryptoRng()
    const counts = new Array(7).fill(0)
    for (let i = 0; i < 10000; i++) counts[rng(6)]++
    for (let face = 1; face <= 6; face++) {
      expect(counts[face]).toBeGreaterThan(800)
    }
  })
})

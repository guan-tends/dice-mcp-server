import { describe, it, expect } from 'vitest'
import {
  RING_D6,
  SKILL_D12,
  resolveDie,
  EMPTY_SYMBOLS,
  sumSymbols,
} from '../../src/engine/symbols.js'

describe('RING_D6 — verified face table', () => {
  it('maps all 6 faces exactly per the verified 5e chart', () => {
    // Verified: 1 blank; 2 strife+opportunity; 3 opportunity; 4 strife+success;
    // 5 success; 6 strife+success+explosive.
    expect(RING_D6[1]).toEqual({ successes: 0, opportunities: 0, strife: 0, explosive: false })
    expect(RING_D6[2]).toEqual({ successes: 0, opportunities: 1, strife: 1, explosive: false })
    expect(RING_D6[3]).toEqual({ successes: 0, opportunities: 1, strife: 0, explosive: false })
    expect(RING_D6[4]).toEqual({ successes: 1, opportunities: 0, strife: 1, explosive: false })
    expect(RING_D6[5]).toEqual({ successes: 1, opportunities: 0, strife: 0, explosive: false })
    expect(RING_D6[6]).toEqual({ successes: 1, opportunities: 0, strife: 1, explosive: true })
  })
})

describe('SKILL_D12 — verified face table', () => {
  it('maps all 12 faces exactly per the verified 5e chart', () => {
    // Verified: 1-2 blank; 3-5 opportunity; 6-7 success+strife; 8-9 success;
    // 10 success+opportunity; 11 success+strife+explosive; 12 explosive ONLY.
    expect(SKILL_D12[1]).toEqual({ successes: 0, opportunities: 0, strife: 0, explosive: false })
    expect(SKILL_D12[2]).toEqual({ successes: 0, opportunities: 0, strife: 0, explosive: false })
    expect(SKILL_D12[3]).toEqual({ successes: 0, opportunities: 1, strife: 0, explosive: false })
    expect(SKILL_D12[4]).toEqual({ successes: 0, opportunities: 1, strife: 0, explosive: false })
    expect(SKILL_D12[5]).toEqual({ successes: 0, opportunities: 1, strife: 0, explosive: false })
    expect(SKILL_D12[6]).toEqual({ successes: 1, opportunities: 0, strife: 1, explosive: false })
    expect(SKILL_D12[7]).toEqual({ successes: 1, opportunities: 0, strife: 1, explosive: false })
    expect(SKILL_D12[8]).toEqual({ successes: 1, opportunities: 0, strife: 0, explosive: false })
    expect(SKILL_D12[9]).toEqual({ successes: 1, opportunities: 0, strife: 0, explosive: false })
    expect(SKILL_D12[10]).toEqual({ successes: 1, opportunities: 1, strife: 0, explosive: false })
    expect(SKILL_D12[11]).toEqual({ successes: 1, opportunities: 0, strife: 1, explosive: true })
    expect(SKILL_D12[12]).toEqual({ successes: 0, opportunities: 0, strife: 0, explosive: true })
  })
})

describe('resolveDie', () => {
  it('resolves a ring die face', () => {
    expect(resolveDie('ring', 6)).toEqual({
      successes: 1,
      opportunities: 0,
      strife: 1,
      explosive: true,
    })
  })

  it('resolves a skill die face', () => {
    expect(resolveDie('skill', 12)).toEqual({
      successes: 0,
      opportunities: 0,
      strife: 0,
      explosive: true,
    })
  })

  it('rejects unknown die types and out-of-range faces', () => {
    expect(() => resolveDie('d20', 1)).toThrow(/type/i)
    expect(() => resolveDie('ring', 7)).toThrow(/face/)
    expect(() => resolveDie('skill', 0)).toThrow(/face/)
    expect(() => resolveDie('skill', 13)).toThrow(/face/)
  })
})

describe('sumSymbols', () => {
  it('sums an array of symbol sets', () => {
    const total = sumSymbols([
      { successes: 1, opportunities: 0, strife: 1, explosive: true },
      { successes: 1, opportunities: 1, strife: 0, explosive: false },
      { successes: 0, opportunities: 1, strife: 1, explosive: false },
    ])
    expect(total).toEqual({ successes: 2, opportunities: 2, strife: 2, explosive: 1 })
  })

  it('sums an empty array to zeros', () => {
    expect(sumSymbols([])).toEqual({ successes: 0, opportunities: 0, strife: 0, explosive: 0 })
  })
})

describe('EMPTY_SYMBOLS', () => {
  it('is the zero symbol set', () => {
    expect(EMPTY_SYMBOLS).toEqual({ successes: 0, opportunities: 0, strife: 0, explosive: false })
  })
})

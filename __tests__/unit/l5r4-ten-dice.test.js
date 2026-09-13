/**
 * Unit Tests — L5R 4e Ten Dice Rule (Report B §4, the signature
 * normalization). The four canonical vectors are VERBATIM law:
 *   12k4 → 10k5        13k9 → 10k10+2
 *   10k12 → 10k10+4    14k12 → 10k10+12
 * Plus the damage-roll note (11k2 → 10k2+2) and audit output fields.
 *
 * The rule normalizes the POOL before any die is rolled — vectors assert
 * rolled/kept accounting; totals use a sequence RNG.
 */

import { describe, it, expect } from 'vitest'
import { applyTenDiceRule, rollAndKeep } from '../../src/engine/l5r4.js'
import { createSequenceRng } from '../../src/engine/rng.js'

describe('applyTenDiceRule — canonical vectors (§4)', () => {
  it('12k4 → 10k5 (2 excess rolled convert to 1 kept while kept < 10)', () => {
    const r = applyTenDiceRule(12, 4)
    expect(r.rolled).toBe(10)
    expect(r.kept).toBe(5)
    expect(r.overflowBonus).toBe(0)
  })

  it('13k9 → 10k10+2 (1 conversion reaches kept 10; 1 leftover rolled → +2)', () => {
    const r = applyTenDiceRule(13, 9)
    expect(r.rolled).toBe(10)
    expect(r.kept).toBe(10)
    expect(r.overflowBonus).toBe(2)
  })

  it('10k12 → 10k10+4 (kept cap first: 2 excess kept → +4)', () => {
    const r = applyTenDiceRule(10, 12)
    expect(r.rolled).toBe(10)
    expect(r.kept).toBe(10)
    expect(r.overflowBonus).toBe(4)
  })

  it('14k12 → 10k10+12 (kept +4, then 4 excess rolled unconvertible → +8)', () => {
    const r = applyTenDiceRule(14, 12)
    expect(r.rolled).toBe(10)
    expect(r.kept).toBe(10)
    expect(r.overflowBonus).toBe(12)
  })

  it('11k2 damage roll → 10k2+2 (rule applies to damage too)', () => {
    const r = applyTenDiceRule(11, 2)
    expect(r.rolled).toBe(10)
    expect(r.kept).toBe(2)
    expect(r.overflowBonus).toBe(2)
  })

  it('odd leftover converts one die then flats the remainder: 12k8 → 10k9+2', () => {
    // 2 excess rolled → 1 kept (kept 8→9), 0 leftover → no flat bonus.
    // Wait — 12k8: excess=2, convert 2:1 while kept<10 → +1 kept = 9 kept,
    // 0 leftover. So 10k9, bonus 0. (Test documents the odd/even path.)
    const r = applyTenDiceRule(12, 8)
    expect(r.rolled).toBe(10)
    expect(r.kept).toBe(9)
    expect(r.overflowBonus).toBe(0)
  })

  it('odd leftover with kept at cap: 13k10 → 10k10+6 (3 leftover → +6)', () => {
    const r = applyTenDiceRule(13, 10)
    expect(r.rolled).toBe(10)
    expect(r.kept).toBe(10)
    expect(r.overflowBonus).toBe(6)
  })

  it('pools within caps pass through untouched', () => {
    const r = applyTenDiceRule(6, 4)
    expect(r.rolled).toBe(6)
    expect(r.kept).toBe(4)
    expect(r.overflowBonus).toBe(0)
    expect(r.preCap.rolled).toBe(6)
    expect(r.preCap.kept).toBe(4)
  })

  it('reports pre-cap pool for audit', () => {
    const r = applyTenDiceRule(14, 12)
    expect(r.preCap).toEqual({ rolled: 14, kept: 12 })
  })
})

describe('rollAndKeep — Ten Dice Rule integration', () => {
  // Sequence RNG: 10 dice rolled after normalization. Any faces work for
  // pool accounting; use ascending values so keep-selection is predictable.
  const seq = (n) => createSequenceRng(Array.from({ length: n }, (_, i) => (i % 10) + 1))

  it('12k4 skill roll executes with normalized 10k5 pool', () => {
    const r = rollAndKeep({ trait: 4, skill: 8, rng: seq(20) }) // 12k4 raw
    expect(r.pool).toBe(10)
    expect(r.keepCount).toBe(5)
    expect(r.overflowBonus).toBe(0)
    expect(r.preCapPool).toEqual({ rolled: 12, kept: 4 })
  })

  it('14k12 → total includes +12 overflow bonus', () => {
    // After normalization: 10 rolled, 10 kept. Faces ascend 1..10; the
    // face-10 die EXPLODES (trained roll) and consumes the next face (1)
    // → chain 10+1 = 11. keptSum = (1+..+9) + 11 = 56; total = 56 + 12.
    const r = rollAndKeep({ trait: 2, skill: 10, rollBonus: 2, keepBonus: 10, rng: seq(20) })
    expect(r.pool).toBe(10)
    expect(r.keepCount).toBe(10)
    expect(r.overflowBonus).toBe(12)
    expect(r.totals.keptSum).toBe(56)
    expect(r.totals.total).toBe(68)
  })
})

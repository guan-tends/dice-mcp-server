import { describe, it, expect } from 'vitest'
import { rollAndKeep } from '../../src/engine/l5r4.js'
import { createSequenceRng } from '../../src/engine/rng.js'

describe('rollAndKeep - pool construction', () => {
  it('pool = trait + skill; keep = trait', () => {
    // Trait 4, Skill 3 => 7d10k4. Queue: 7 faces.
    const rng = createSequenceRng([9, 8, 7, 6, 5, 4, 3])
    const r = rollAndKeep({ trait: 4, skill: 3, rng })
    expect(r.pool).toBe(7)
    expect(r.rolled).toHaveLength(7)
    expect(r.keepCount).toBe(4)
    expect(r.kept.map((d) => d.face)).toEqual([9, 8, 7, 6])
    expect(r.dropped.map((d) => d.face)).toEqual([5, 4, 3])
    expect(r.totals.keptSum).toBe(30)
  })

  it('skill 0 => untrained: pool = trait, keep ALL', () => {
    const rng = createSequenceRng([6, 2, 8])
    const r = rollAndKeep({ trait: 3, skill: 0, rng })
    expect(r.pool).toBe(3)
    expect(r.keepCount).toBe(3)
    expect(r.kept).toHaveLength(3)
    expect(r.dropped).toHaveLength(0)
    expect(r.untrained).toBe(true)
  })

  it('rollBonus adds dice to the pool; keepBonus adds to keep', () => {
    // Void +1k1: rollBonus 1, keepBonus 1. Trait 2, skill 1 => 4d10k3.
    // Queue avoids 10s so no explosion consumes extra rng values.
    const rng = createSequenceRng([9, 8, 7, 6])
    const r = rollAndKeep({ trait: 2, skill: 1, rollBonus: 1, keepBonus: 1, rng })
    expect(r.pool).toBe(4)
    expect(r.keepCount).toBe(3)
    expect(r.totals.keptSum).toBe(24) // 9 + 8 + 7
  })

  it('kept > rolled is legal (Report B §5/D2: initiative = Insight k Reflexes); Ten Dice caps at 10', () => {
    // Trait 5, skill 0, keepBonus 2 => raw 5 rolled, 7 kept. D2: kept >
    // rolled is legal as declared (initiative shape); Ten Dice caps kept
    // at 10 — 7 is under the cap, so keepCount = 7.
    const rng = createSequenceRng([3, 4, 5, 6, 7])
    const r = rollAndKeep({ trait: 5, skill: 0, keepBonus: 2, rng })
    expect(r.pool).toBe(5)
    expect(r.keepCount).toBe(7)
  })
})

describe('rollAndKeep - explosions', () => {
  it('d10s explode on 10s by default (trained roll)', () => {
    // Trait 2, skill 2 => 4d10k2. Die1: 10->10->4 (24). Die2: 10->6 (16).
    // Dice 3,4: 3, 2. Keep top2: 24, 16 => 40.
    const rng = createSequenceRng([10, 10, 4, 10, 6, 3, 2])
    const r = rollAndKeep({ trait: 2, skill: 2, rng })
    expect(r.rolled[0].final).toBe(24)
    expect(r.rolled[1].final).toBe(16)
    expect(r.totals.keptSum).toBe(40)
  })

  it('UNTRAINED rolls never explode', () => {
    // Trait 3, skill 0. Rolls 10, 10, 5 — the 10s must NOT explode.
    const rng = createSequenceRng([10, 10, 5])
    const r = rollAndKeep({ trait: 3, skill: 0, rng })
    expect(r.untrained).toBe(true)
    expect(r.rolled[0]).toEqual({ face: 10, chain: [], final: 10, rerolled: false })
    expect(r.rolled[1].final).toBe(10)
    expect(r.totals.keptSum).toBe(25)
  })
})

describe('rollAndKeep - emphasis', () => {
  it('emphasis rerolls 1s once before explosions', () => {
    // Trait 2, skill 2, emphasis. Die1: 1 -> reroll 5. Die2: 10 -> 10 -> 4.
    // Dice 3,4: 2, 1->1 (stays). Keep top2: 24, 5.
    const rng = createSequenceRng([1, 5, 10, 10, 4, 2, 1, 1])
    const r = rollAndKeep({ trait: 2, skill: 2, emphasis: true, rng })
    expect(r.rolled[0].rerolled).toBe(true)
    expect(r.rolled[0].final).toBe(5)
    expect(r.rolled[1].final).toBe(24)
    expect(r.rolled[3].rerolled).toBe(true)
    expect(r.rolled[3].final).toBe(1)
    expect(r.totals.keptSum).toBe(29)
  })

  it('emphasis NEVER applies to unskilled rolls (Report B §8/D7: skill mechanic only)', () => {
    // Unskilled + emphasis: emphasis ignored structurally — no rerolls.
    const rng = createSequenceRng([1, 3])
    const r = rollAndKeep({ trait: 2, skill: 0, emphasis: true, rng })
    expect(r.untrained).toBe(true)
    expect(r.rolled[0].rerolled).toBe(false)
    expect(r.rolled[0].final).toBe(1)
  })
})

describe('rollAndKeep - TN and raises', () => {
  it('evaluates success against the base TN', () => {
    // Trait 3 keeps 3 of 5: 9+8+7 = 24.
    const rng = createSequenceRng([9, 8, 7, 6, 5])
    const r = rollAndKeep({ trait: 3, skill: 2, tn: 15, rng })
    expect(r.totals.total).toBe(24)
    expect(r.success).toBe(true)
    expect(r.tn).toEqual({ base: 15, raises: 0, effective: 15 })
  })

  it('raises increase the effective TN by 5 each', () => {
    // Trait 3 keeps 3: 9+8+7 = 24. Effective TN 25 => fail, but the
    // unraised total (24) met the base TN (15) => narration hook fires.
    const rng = createSequenceRng([9, 8, 7, 6, 5])
    const r = rollAndKeep({ trait: 3, skill: 2, tn: 15, raises: 2, rng })
    expect(r.tn).toEqual({ base: 15, raises: 2, effective: 25 })
    expect(r.success).toBe(false) // 24 < 25
    expect(r.wouldSucceedWithoutRaises).toBe(true)
  })

  it('failure without raises omits wouldSucceedWithoutRaises', () => {
    const rng = createSequenceRng([2, 1, 3, 4, 5])
    const r = rollAndKeep({ trait: 3, skill: 2, tn: 15, rng })
    expect(r.success).toBe(false)
    expect(r.raises.declared).toBe(0)
    expect('wouldSucceedWithoutRaises' in r).toBe(false)
  })

  it('failed raises report wouldSucceedWithoutRaises = true (narration hook)', () => {
    // Roll 20 total vs base TN 15 with 2 raises (effective 25): fail,
    // but would have passed without raises.
    const rng = createSequenceRng([8, 7, 5, 4, 3])
    const r = rollAndKeep({ trait: 3, skill: 2, tn: 15, raises: 2, rng })
    expect(r.success).toBe(false)
    expect(r.wouldSucceedWithoutRaises).toBe(true)
  })

  it('raises are capped by voidRing when provided', () => {
    const rng = createSequenceRng([9, 8, 7, 6, 5])
    expect(() => rollAndKeep({ trait: 3, skill: 2, raises: 3, voidRing: 2, rng })).toThrow(
      /raises.*void/i,
    )
  })

  it('free raises add effect without TN increase and do not count vs void cap', () => {
    const rng = createSequenceRng([9, 8, 7, 6, 5])
    const r = rollAndKeep({
      trait: 3,
      skill: 2,
      tn: 15,
      raises: 2,
      freeRaises: 1,
      voidRing: 2,
      rng,
    })
    // 2 declared raises <= void 2 (free raise doesn't count). Effective TN
    // still 25 (free raises add EFFECT only, never TN).
    expect(r.tn.effective).toBe(25)
    expect(r.raises.free).toBe(1)
    expect(r.raises.totalEffects).toBe(3) // 2 + 1 free
  })

  it('untrained rolls cannot use raises', () => {
    const rng = createSequenceRng([5, 4, 3])
    expect(() => rollAndKeep({ trait: 3, skill: 0, raises: 1, rng })).toThrow(/untrained/i)
  })
})

describe('rollAndKeep - penalties and totals', () => {
  it('wound penalty is reported but never touches the total (Report B §10/D4)', () => {
    // Trait 3 keeps 3: 9+8+7 = 24. The penalty is audit-visible in
    // totals.penalty but the total excludes it (it lives on the TN side).
    const rng = createSequenceRng([9, 8, 7, 6, 5])
    const r = rollAndKeep({ trait: 3, skill: 2, penalty: 10, rng })
    expect(r.totals.keptSum).toBe(24)
    expect(r.totals.penalty).toBe(10)
    expect(r.totals.total).toBe(24)
  })

  it('penalty raises the effective TN (Report B §10/D4: never the total)', () => {
    // die1: 10->10->4 = 24 (explodes), die2: 9, die3: 8 => kept 41.
    // TN 35 + penalty 10 => effective TN 45: 41 fails; the hook fires
    // (keptSum 41 met the base TN 35 — the wound penalty cost the roll).
    // Pool 5 dice: die1 chain (3 values) + 9 + 8 + dice 4,5 (6, 5 — low,
    // dropped; top-3 finals remain 24+9+8 = 41).
    const rng = createSequenceRng([10, 10, 4, 9, 8, 6, 5])
    const r = rollAndKeep({ trait: 3, skill: 2, tn: 35, penalty: 10, rng })
    expect(r.totals.keptSum).toBe(41)
    expect(r.totals.total).toBe(41)
    expect(r.tn.effective).toBe(45)
    expect(r.success).toBe(false)
    expect(r.wouldSucceedWithoutRaises).toBe(true)
  })

  it('assemble notes for explosions, emphasis, and untrained', () => {
    // Pool 3 (trait 2 + skill 1). die1: 1->5 (emphasis), die2: 10->10->4
    // (explodes), die3: 2.
    const rng = createSequenceRng([1, 5, 10, 10, 4, 2])
    const r = rollAndKeep({ trait: 2, skill: 1, emphasis: true, rng })
    expect(r.notes.some((n) => n.includes('exploded'))).toBe(true)
    expect(r.notes.some((n) => n.includes('Emphasis'))).toBe(true)
    const rng2 = createSequenceRng([6, 5, 4])
    const r2 = rollAndKeep({ trait: 3, skill: 0, rng: rng2 })
    expect(r2.notes.some((n) => n.toLowerCase().includes('untrained'))).toBe(true)
  })
})

describe('rollAndKeep - validation', () => {
  it('rejects trait outside 1..10', () => {
    const rng = createSequenceRng([])
    expect(() => rollAndKeep({ trait: 0, skill: 3, rng })).toThrow(/trait/)
    expect(() => rollAndKeep({ trait: 11, skill: 3, rng })).toThrow(/trait/)
  })

  it('rejects skill outside 0..10', () => {
    const rng = createSequenceRng([])
    expect(() => rollAndKeep({ trait: 3, skill: -1, rng })).toThrow(/skill/)
    expect(() => rollAndKeep({ trait: 3, skill: 11, rng })).toThrow(/skill/)
  })

  it('rejects negative raises or voidRing', () => {
    const rng = createSequenceRng([])
    expect(() => rollAndKeep({ trait: 3, skill: 2, raises: -1, rng })).toThrow(/raises/)
    expect(() => rollAndKeep({ trait: 3, skill: 2, voidRing: 0, rng })).toThrow(/voidRing/)
  })

  it('caps the pool at 10 kept-roll dice per 4e rules', () => {
    // Trait 8, skill 8 => raw pool 16 > 10 cap. Wait: cap is on the ROLL
    // pool (max 10 dice rolled). Verify: pool = min(trait+skill, 10).
    const rng = createSequenceRng(new Array(10).fill(7))
    const r = rollAndKeep({ trait: 8, skill: 8, rng })
    expect(r.pool).toBe(10)
    expect(r.rolled).toHaveLength(10)
  })
})

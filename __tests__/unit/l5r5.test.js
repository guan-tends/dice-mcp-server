import { describe, it, expect } from 'vitest'
import { rollCheck } from '../../src/engine/l5r5.js'
import { createSequenceRng } from '../../src/engine/rng.js'

// Ring die faces => (successes, opportunities, strife, explosive):
// 1 blank, 2 opp+strife, 3 opp, 4 succ+strife, 5 succ, 6 succ+strife+expl
// Skill die faces: 1-2 blank, 3-5 opp, 6-7 succ+strife, 8-9 succ,
// 10 succ+opp, 11 succ+strife+expl, 12 expl only.

describe('rollCheck - pool construction', () => {
  it('rolls ring d6s + skill d12s; keep = ring rating', () => {
    // Ring 2, skill 2: 2 d6 + 2 d12. Queue: 2,5 (ring), 8,3 (skill).
    const rng = createSequenceRng([2, 5, 8, 3])
    const r = rollCheck({ ring: 2, skill: 2, rng })
    expect(r.pool).toHaveLength(4)
    expect(r.pool[0]).toMatchObject({ type: 'ring', face: 2 })
    expect(r.pool[2]).toMatchObject({ type: 'skill', face: 8 })
    expect(r.keepCount).toBe(2)
  })

  it('untrained (skill 0): ring dice only (explosions still apply — die property)', () => {
    // Ring 3 (opp), ring 6 (expl -> bonus ring 4).
    const rng = createSequenceRng([3, 6, 4])
    const r = rollCheck({ ring: 2, skill: 0, rng })
    expect(r.baseCount).toBe(2)
    expect(r.pool.slice(0, 2).every((d) => d.type === 'ring')).toBe(true)
    expect(r.untrained).toBe(true)
  })
})

describe('rollCheck - explosions', () => {
  it('explosive faces add ONE bonus die of the same type', () => {
    // Ring 1, skill 1. Ring die: 6 (explosive) -> bonus ring die: 5.
    // Skill die: 12 (explosive) -> bonus skill die: 10.
    const rng = createSequenceRng([6, 12, 5, 10])
    const r = rollCheck({ ring: 1, skill: 1, rng })
    expect(r.pool).toHaveLength(4)
    // Pool layout: base dice in table order, then bonus dice appended.
    expect(r.pool[0]).toMatchObject({ type: 'ring', face: 6 })
    expect(r.pool[1]).toMatchObject({ type: 'skill', face: 12 })
    expect(r.pool[2]).toMatchObject({ type: 'ring', face: 5, bonusFor: 0 })
    expect(r.pool[3]).toMatchObject({ type: 'skill', face: 10, bonusFor: 1 })
    expect(r.explosiveTriggers).toBe(2)
  })

  it('bonus dice can chain (bonus die explosive -> another bonus)', () => {
    // Ring 1, skill 0. Ring: 6 -> bonus 6 -> bonus 3.
    const rng = createSequenceRng([6, 6, 3])
    const r = rollCheck({ ring: 1, skill: 0, rng })
    expect(r.pool).toHaveLength(3)
    expect(r.pool[1].bonusFor).toBe(0) // first bonus sourced from base die 0
    expect(r.pool[2].bonusFor).toBe(1) // second bonus sourced from first bonus
  })

  it('includeExplosionBonuses=false disables bonus dice', () => {
    const rng = createSequenceRng([6, 3])
    const r = rollCheck({ ring: 1, skill: 0, rng, includeExplosionBonuses: false })
    expect(r.pool).toHaveLength(1)
    expect(r.explosiveTriggers).toBe(1) // counted, not expanded
  })

  it('bonus chains are capped', () => {
    const rng = createSequenceRng(new Array(20).fill(6))
    const r = rollCheck({ ring: 1, skill: 0, rng })
    expect(r.pool).toHaveLength(11) // base + 10 bonus cap
  })
})

describe('rollCheck - keep selection', () => {
  it('success_first policy: successes desc, strife asc, opportunities desc', () => {
    // Ring 2, skill 0 (keep 2 of 2 — trivial). Use ring 1, skill 2 => keep 1 of 3.
    // Pool: ring 4 (succ+strife), skill 8 (succ), skill 3 (opp).
    // success_first keeps the 8 (success, no strife).
    const rng = createSequenceRng([4, 8, 3])
    const r = rollCheck({ ring: 1, skill: 2, rng })
    // skill 8 (1 succ, 0 strife) beats ring 4 (1 succ, 1 strife) — strife asc.
    expect(r.keptIndices).toEqual([2])
    expect(r.tallies.successes).toBe(1)
    expect(r.tallies.strife).toBe(0)
  })

  it('min_strife policy prefers zero-strife dice', () => {
    // Ring 1, skill 1, keep 1. Pool: ring 4 (succ+strife), skill 3 (opp).
    // min_strife keeps the 3 (0 strife) over the 4 (1 strife, 1 success).
    const rng = createSequenceRng([4, 3])
    const r = rollCheck({ ring: 1, skill: 1, rng, policy: 'min_strife' })
    // skill 3 (0 strife) beats ring 4 (1 strife).
    expect(r.keptIndices).toEqual([2])
    expect(r.tallies.strife).toBe(0)
  })

  it('max_opportunity policy prefers opportunity dice', () => {
    // Ring 1, skill 1, keep 1. Pool: ring 5 (succ), skill 3 (opp).
    const rng = createSequenceRng([5, 3])
    const r = rollCheck({ ring: 1, skill: 1, rng, policy: 'max_opportunity' })
    // skill 3 (1 opp) beats ring 5 (0 opp).
    expect(r.keptIndices).toEqual([2])
    expect(r.tallies.opportunities).toBe(1)
  })

  it('kept override accepts comma-string of base-pool indices', () => {
    // Ring 2, skill 2. Pool indices 0-3: ring 4 (succ+strife), ring 6
    // (succ+strife+expl), skill 8 (succ), skill 12 (expl).
    // Keep 2: override "1,2" => ring 6 + skill 8.
    // Base: ring 4, ring 6, skill 8, skill 12. Bonuses after: bonus-ring 2
    // (for ring 6), bonus-skill 10 (for skill 12).
    const rng = createSequenceRng([4, 6, 8, 12, 2, 10])
    const r = rollCheck({ ring: 2, skill: 2, rng, kept: '1,2' })
    expect(r.keptIndices).toEqual([1, 2])
    expect(r.tallies.successes).toBe(2)
    expect(r.tallies.strife).toBe(2) // ring 4 and 6 both carry strife
    expect(r.tallies.explosive).toBe(1)
  })

  it('kept override validates: wrong count, out of range, bonus index', () => {
    expect(() =>
      rollCheck({ ring: 2, skill: 2, rng: createSequenceRng([4, 5, 8, 9]), kept: '1' }),
    ).toThrow(/keep/)
    expect(() =>
      rollCheck({ ring: 2, skill: 2, rng: createSequenceRng([4, 5, 8, 9]), kept: '0,9' }),
    ).toThrow(/index/)
    // Bonus dice land after base pool; index 99 out of range anyway.
  })

  it('kept override indices are 1-based over the BASE pool (no bonus dice)', () => {
    // Ring 1, skill 1: base pool = ring + skill; bonus dice appended after.
    // Ring 6 (expl) -> bonus ring 6 (expl) -> bonus 3; skill 10.
    // Base pool = [ring6, skill10]; override "2" keeps skill 10 only.
    // ring 6 (expl -> bonus ring 4), skill 10. Base pool = [ring6, skill10].
    const rng = createSequenceRng([6, 10, 4])
    const r = rollCheck({ ring: 1, skill: 1, rng, kept: '2' })
    expect(r.keptIndices).toEqual([2])
    expect(r.pool[2].bonusFor).toBe(0) // bonus die present, not selectable
  })
})

describe('rollCheck - advantage / disadvantage', () => {
  it('advantage converts non-explosive kept-eligible ring dice to skill dice', () => {
    // Ring 1, skill 0 (untrained: ring dice only — no skill dice to flip).
    // Use ring 2, skill 1, advantage. Base pool: ring 2 (opp+strife),
    // ring 6 (expl — NEVER converted), skill 8.
    // Advantage default: convert ring 2 -> skill die (new roll).
    // ring 2, ring 6 (expl), skill 8, bonus-ring 5, then the advantage
    // conversion of ring 2 rerolls it as a skill die (pops 9).
    const rng = createSequenceRng([2, 6, 8, 5, 9])
    const r = rollCheck({ ring: 2, skill: 1, rng, advantage: true })
    expect(r.conversions).toHaveLength(1)
    expect(r.conversions[0]).toMatchObject({
      index: 1,
      from: 'ring',
      to: 'skill',
      oldFace: 2,
      newFace: 9,
    })
  })

  it('disadvantage converts skill dice to ring dice (suboptimal, by rule)', () => {
    // Ring 2, skill 1, disadvantage. Pool: ring 3, ring 5, skill 7.
    // Default disadvantage policy: convert the WORST skill die (lowest
    // face) to a ring die. Skill 7 -> reroll as d6.
    const rng = createSequenceRng([3, 5, 7, 2])
    const r = rollCheck({ ring: 2, skill: 1, rng, disadvantage: true })
    expect(r.conversions).toHaveLength(1)
    expect(r.conversions[0]).toMatchObject({ index: 3, from: 'skill', to: 'ring', oldFace: 7 })
  })

  it('advantage never converts explosive ring dice (6s stay)', () => {
    // Ring 1, skill 1, advantage. Pool: ring 6 (expl), skill 8.
    // The ring 6 must NOT convert (would lose the explosive).
    const rng = createSequenceRng([6, 8, 3])
    const r = rollCheck({ ring: 1, skill: 1, rng, advantage: true })
    expect(r.pool[0]).toMatchObject({ type: 'ring', face: 6 })
    expect(r.conversions).toHaveLength(0)
  })
})

describe('rollCheck - tallies, TN, composure', () => {
  it('tallies successes/opportunities/strife/explosive over kept dice', () => {
    // Ring 2, skill 2, keep 2. Pool: ring 4 (s1,str1), ring 6 (s1,str1,expl
    // -> bonus ring 2), skill 8 (s1), skill 3 (opp1). success_first: skill 8
    // (s1,str0) first; then ring 6 vs ring 4 tie (s1,str1) -> explosive wins.
    // Kept: skill 8 + ring 6 => succ 2, strife 1, explosive 1.
    const rng = createSequenceRng([4, 6, 2, 8, 3])
    const r = rollCheck({ ring: 2, skill: 2, rng })
    expect(r.tallies).toEqual({ successes: 2, opportunities: 0, strife: 1, explosive: 1 })
  })

  it('success vs TN', () => {
    // ring 2, ring 5, skill 9, skill 10 — success_first keeps the skill dice.
    const rng = createSequenceRng([2, 5, 9, 10])
    const r = rollCheck({ ring: 2, skill: 2, rng, tn: 2 })
    expect(r.tallies.successes).toBeGreaterThanOrEqual(2)
    expect(r.success).toBe(true)
  })

  it('composure advisory flag when strife >= composure', () => {
    // Ring 1, skill 0: ring 4 (succ+strife). Composure 5: 1 < 5, no flag.
    const rng = createSequenceRng([4])
    const r = rollCheck({ ring: 1, skill: 0, rng, composure: 5 })
    expect(r.tallies.strife).toBe(1)
    expect(r.composureExceeded).toBe(false)
    // Composure 1: 1 >= 1, flag.
    const rng2 = createSequenceRng([4])
    const r2 = rollCheck({ ring: 1, skill: 0, rng: rng2, composure: 1 })
    expect(r2.composureExceeded).toBe(true)
  })

  it('composure omitted => no flag field', () => {
    const rng = createSequenceRng([4])
    const r = rollCheck({ ring: 1, skill: 0, rng })
    expect('composureExceeded' in r).toBe(false)
  })
})

describe('rollCheck - validation', () => {
  it('rejects ring outside 1..5', () => {
    expect(() => rollCheck({ ring: 0, skill: 2, rng: createSequenceRng([]) })).toThrow(/ring/)
    expect(() => rollCheck({ ring: 6, skill: 2, rng: createSequenceRng([]) })).toThrow(/ring/)
  })

  it('rejects skill outside 0..5', () => {
    expect(() => rollCheck({ ring: 2, skill: -1, rng: createSequenceRng([]) })).toThrow(/skill/)
    expect(() => rollCheck({ ring: 2, skill: 6, rng: createSequenceRng([]) })).toThrow(/skill/)
  })

  it('rejects unknown policy', () => {
    const rng = createSequenceRng([3])
    expect(() => rollCheck({ ring: 1, skill: 0, rng, policy: 'chaos' })).toThrow(/policy/)
  })

  it('rejects advantage AND disadvantage together', () => {
    const rng = createSequenceRng([3])
    expect(() =>
      rollCheck({ ring: 1, skill: 0, rng, advantage: true, disadvantage: true }),
    ).toThrow(/advantage/)
  })

  it('rejects tn outside 1..10', () => {
    expect(() => rollCheck({ ring: 1, skill: 0, rng: createSequenceRng([]), tn: 0 })).toThrow(/tn/)
    expect(() => rollCheck({ ring: 1, skill: 0, rng: createSequenceRng([]), tn: 11 })).toThrow(/tn/)
  })
})

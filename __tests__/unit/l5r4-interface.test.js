/**
 * Unit Tests — L5R 4e interface extensions (Report B §5, §9 + defects
 * D2/D3/D5/D6/D7/D8 + interface suggestions).
 *
 * D2: kept > rolled legal (initiative = Insight k Reflexes, 1k4);
 *     direct pool input rolled/kept.
 * D3: rollType skill|trait|ring|unskilled|custom — Trait rolls explode
 *     and allow raises; Unskilled does neither. Back-compat: skill=0
 *     with no rollType/untrained still means Unskilled (old behavior).
 * D5: negative rollBonus/keepBonus; clamp kept ≤ rolled after subtraction.
 * D6: voidPoint boolean → +1k1 (voidRing stays the raise-cap rating).
 * D7: emphasis ignored on unskilled rolls.
 * D8: keepMode 'lowest' (deliberate failure, §1).
 * §3: explodeOn parameter (default 10; mastery 9; none).
 * §11: totalBonus flat (Honor added to total, not dice).
 */

import { describe, it, expect } from 'vitest'
import { rollAndKeep } from '../../src/engine/l5r4.js'
import { createSequenceRng } from '../../src/engine/rng.js'

describe('D2 — direct pool input + kept > rolled', () => {
  it('initiative pool 1k4 executes (kept > rolled)', () => {
    const rng = createSequenceRng([7, 5, 9, 3]) // 1 rolled die + 3 explosion-less? 1 rolled: face 7
    const r = rollAndKeep({ rolled: 1, kept: 4, rng })
    expect(r.pool).toBe(1)
    expect(r.keepCount).toBe(4)
    expect(r.totals.keptSum).toBe(7)
  })

  it('damage pool 6k2 via direct input', () => {
    const rng = createSequenceRng([6, 4, 2, 9, 8, 1])
    const r = rollAndKeep({ rolled: 6, kept: 2, rng })
    expect(r.pool).toBe(6)
    expect(r.keepCount).toBe(2)
    expect(r.totals.keptSum).toBe(17) // 9 + 8
  })

  it('rolled/kept overrides trait/skill when both given', () => {
    const rng = createSequenceRng([5, 5, 5, 5, 5])
    const r = rollAndKeep({ rolled: 3, kept: 2, trait: 9, skill: 9, rng })
    expect(r.pool).toBe(3)
    expect(r.keepCount).toBe(2)
  })
})

describe('D3 — rollType semantics', () => {
  it('trait roll (skill 0, rollType trait) explodes and accepts raises', () => {
    const rng = createSequenceRng([10, 6, 4, 5, 5]) // 10 explodes→6; generous tail
    const r = rollAndKeep({ trait: 3, skill: 0, rollType: 'trait', rng, tn: 10, raises: 1 })
    expect(r.untrained).toBe(false)
    expect(r.rolled[0].chain.length).toBeGreaterThan(0) // exploded
    expect(r.tn.effective).toBe(15) // 10 + 5
  })

  it('ring roll behaves as trait (explodes, raises legal)', () => {
    const rng = createSequenceRng([10, 8, 5, 5]) // 10 explodes→8; tail
    const r = rollAndKeep({ trait: 2, skill: 0, rollType: 'ring', rng })
    expect(r.untrained).toBe(false)
    expect(r.rolled[0].chain.length).toBeGreaterThan(0)
  })

  it('unskilled roll blocks raises (unchanged law)', () => {
    expect(() =>
      rollAndKeep({ trait: 3, skill: 0, rollType: 'unskilled', raises: 1, rng: () => 5 }),
    ).toThrow(/raise/i)
  })

  it('back-compat: skill 0 with NO rollType/untrained = unskilled (old behavior)', () => {
    const rng = createSequenceRng([10, 5, 5]) // face 10 must NOT explode
    const r = rollAndKeep({ trait: 3, skill: 0, rng })
    expect(r.untrained).toBe(true)
    expect(r.rolled[0].chain.length).toBe(0)
  })

  it('explicit untrained:false with skill 0 = trait roll (Mneme convention)', () => {
    const rng = createSequenceRng([10, 6, 5, 5]) // 10 explodes→6; tail
    const r = rollAndKeep({ trait: 2, skill: 0, untrained: false, rng })
    expect(r.untrained).toBe(false)
    expect(r.rolled[0].chain.length).toBeGreaterThan(0)
  })
})

describe('D5 — negative bonuses with clamp', () => {
  it('rollBonus -3 on 6k4 → 3k3 (kept clamps to rolled)', () => {
    const rng = createSequenceRng([8, 6, 4])
    const r = rollAndKeep({ trait: 4, skill: 2, rollBonus: -3, rng })
    expect(r.pool).toBe(3)
    expect(r.keepCount).toBe(3)
  })

  it('keepBonus negative subtracts kept dice', () => {
    const rng = createSequenceRng([7, 3, 9, 2])
    const r = rollAndKeep({ trait: 3, skill: 1, keepBonus: -1, rng })
    expect(r.pool).toBe(4)
    expect(r.keepCount).toBe(2)
  })
})

describe('D6 — voidPoint boolean', () => {
  it('voidPoint true → +1k1 to the pool', () => {
    const rng = createSequenceRng([9, 8, 7, 4, 5, 5, 5]) // pool 5; 9 explodes→8
    const r = rollAndKeep({ trait: 2, skill: 2, voidPoint: true, rng })
    expect(r.preCapPool).toEqual({ rolled: 5, kept: 3 })
  })

  it('voidRing still caps raises (rating semantics unchanged)', () => {
    expect(() => rollAndKeep({ trait: 3, skill: 3, voidRing: 1, raises: 2, rng: () => 5 })).toThrow(
      /raise/i,
    )
  })
})

describe('D7 — emphasis ignored when unskilled', () => {
  it('unskilled + emphasis → no rerolls', () => {
    const rng = createSequenceRng([1, 6, 6]) // face 1 would reroll if emphasis applied
    const r = rollAndKeep({ trait: 3, skill: 0, emphasis: true, rng })
    expect(r.rolled.filter((d) => d.rerolled)).toHaveLength(0)
  })

  it('trained + emphasis → rerolls 1s (law unchanged)', () => {
    const rng = createSequenceRng([1, 9, 5, 5, 5, 5, 5]) // 1 rerolls→9; pool 5 tail
    const r = rollAndKeep({ trait: 3, skill: 2, emphasis: true, rng })
    expect(r.rolled.filter((d) => d.rerolled)).toHaveLength(1)
  })
})

describe('D8 — keepMode lowest', () => {
  it('keepMode lowest keeps the smallest dice (deliberate failure)', () => {
    const rng = createSequenceRng([9, 3, 7, 2])
    const r = rollAndKeep({ rolled: 4, kept: 2, keepMode: 'lowest', rng })
    expect(r.totals.keptSum).toBe(5) // 2 + 3
    expect(r.keepMode).toBe('lowest')
  })
})

describe('§3 — explodeOn parameter', () => {
  it('explodeOn 9 (weapon mastery) explodes 9s too', () => {
    const rng = createSequenceRng([9, 4])
    const r = rollAndKeep({ rolled: 1, kept: 1, explodeOn: 9, rng })
    expect(r.rolled[0].chain).toEqual([9, 4])
  })

  it('explodeOn none → no explosions even on 10s', () => {
    const rng = createSequenceRng([10, 5])
    const r = rollAndKeep({ rolled: 1, kept: 1, explodeOn: 'none', rng })
    expect(r.rolled[0].chain.length).toBe(0)
  })

  it('explodeOn list "9,10" style via array', () => {
    const rng = createSequenceRng([9, 10, 2])
    const r = rollAndKeep({ rolled: 1, kept: 1, explodeOn: [9, 10], rng })
    expect(r.rolled[0].chain).toEqual([9, 10, 2])
  })
})

describe('§11 — totalBonus flat', () => {
  it('totalBonus adds to the total without extra dice (Honor)', () => {
    const rng = createSequenceRng([7, 5])
    const r = rollAndKeep({ rolled: 2, kept: 2, totalBonus: 6, rng })
    expect(r.totals.keptSum).toBe(12)
    expect(r.totals.total).toBe(18)
    expect(r.totals.totalBonus).toBe(6)
  })
})

describe('validation paths (deep-review test gap)', () => {
  it('direct pool bounds: rolled 0 rejected', () => {
    expect(() => rollAndKeep({ rolled: 0, rng: () => 5 })).toThrow(/rolled/)
  })

  it('direct pool bounds: rolled 51 rejected', () => {
    expect(() => rollAndKeep({ rolled: 51, rng: () => 5 })).toThrow(/rolled/)
  })

  it('direct pool bounds: kept 0 rejected', () => {
    expect(() => rollAndKeep({ rolled: 3, kept: 0, rng: () => 5 })).toThrow(/kept/)
  })

  it('invalid rollType rejected', () => {
    expect(() => rollAndKeep({ trait: 3, skill: 3, rollType: 'wuxia', rng: () => 5 })).toThrow(
      /rollType/,
    )
  })

  it('invalid keepMode rejected', () => {
    expect(() => rollAndKeep({ trait: 3, skill: 3, keepMode: 'middle', rng: () => 5 })).toThrow(
      /keepMode/,
    )
  })

  it('explodeOn invalid faces rejected by core (0 and 11 out of range)', () => {
    expect(() => rollAndKeep({ trait: 3, skill: 3, explodeOn: [0, 10], rng: () => 5 })).toThrow(
      /explodeOn/,
    )
    expect(() => rollAndKeep({ trait: 3, skill: 3, explodeOn: [11], rng: () => 5 })).toThrow(
      /explodeOn/,
    )
  })

  it('unskilled emphasis produces no emphasis note (suppressed structurally)', () => {
    const rng = createSequenceRng([1, 3])
    const r = rollAndKeep({ trait: 2, skill: 0, emphasis: true, rng })
    expect(r.notes.some((n) => /Emphasis/.test(n))).toBe(false)
  })
})

describe('GM feedback lap (v1.3.0) — RED first', () => {
  it('voidRing NEVER touches the pool — raise-cap only (no mimic trap)', () => {
    // trait 3 + skill 2 = 5 dice, all face 5 (no explosions): 5 values/roll.
    const rng = createSequenceRng([5, 5, 5, 5, 5])
    const withRing = rollAndKeep({ trait: 3, skill: 2, voidRing: 1, rng })
    const rng2 = createSequenceRng([5, 5, 5, 5, 5])
    const without = rollAndKeep({ trait: 3, skill: 2, rng: rng2 })
    expect(withRing.preCapPool).toEqual(without.preCapPool)
    expect(withRing.pool).toBe(without.pool)
    expect(withRing.keepCount).toBe(without.keepCount)
  })

  it('voidRing still caps declared raises (law-citing error preserved)', () => {
    expect(() => rollAndKeep({ trait: 3, skill: 2, raises: 2, voidRing: 1, rng: () => 5 })).toThrow(
      /exceed the Void Ring/,
    )
  })

  it('explodeOn accepts a bare number (coercion-proof at engine layer)', () => {
    // Mastery face 9: a 9 explodes, a 5 does not.
    const rng = createSequenceRng([9, 5, 5])
    const r = rollAndKeep({ trait: 1, skill: 1, explodeOn: 9, rng })
    // chain = explosion LEDGER incl. the initial face (core.js contract);
    // final = sum of the ledger: 9 + 5 = 14.
    expect(r.rolled[0].final).toBe(14)
    expect(r.rolled[0].chain).toEqual([9, 5])
  })

  it('explodeOn accepts a number array', () => {
    const rng = createSequenceRng([10, 9, 7, 5, 5])
    const r = rollAndKeep({ trait: 1, skill: 2, explodeOn: [9, 10], rng })
    // 10 explodes (face in list) -> next 9 explodes -> final = 10+9+7 = 26
    expect(r.rolled[0].final).toBe(26)
  })
})

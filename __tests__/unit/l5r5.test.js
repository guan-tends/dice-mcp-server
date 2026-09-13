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
  it('explosive faces on KEPT dice add ONE bonus die of the same type (book Step 6.1)', () => {
    // Ring 1, skill 1. Base: ring 6 (expl), skill 12 (expl).
    // keepMax = 1 -> policy keeps ring 6 only (successes desc). ONLY the
    // kept ring-6 explodes (kept-only law, p. 24): bonus ring die rolls 5.
    const rng = createSequenceRng([6, 12, 5])
    const r = rollCheck({ ring: 1, skill: 1, rng })
    expect(r.pool).toHaveLength(2) // base pool only — no pre-spawned bonus dice
    expect(r.pool[0]).toMatchObject({ type: 'ring', face: 6 })
    expect(r.pool[1]).toMatchObject({ type: 'skill', face: 12 })
    // Bonus dice live in the audit array, same type as their source.
    expect(r.bonusDice).toHaveLength(1)
    expect(r.bonusDice[0]).toMatchObject({
      sourceDieIndex: 1,
      type: 'ring',
      face: 5,
      chainDepth: 1,
      disposition: 'kept',
    })
    expect(r.explosiveTriggers).toBe(1)
  })

  it('bonus dice can chain (kept bonus die explosive -> another bonus)', () => {
    // Ring 1, skill 0. Ring: 6 (kept, expl) -> bonus 6 (kept, chains) ->
    // bonus 3 (kept, no 🔥). Chain depth 1 -> 2.
    const rng = createSequenceRng([6, 6, 3])
    const r = rollCheck({ ring: 1, skill: 0, rng })
    expect(r.pool).toHaveLength(1) // base pool only
    expect(r.bonusDice).toHaveLength(2)
    expect(r.bonusDice[0]).toMatchObject({
      type: 'ring',
      face: 6,
      chainDepth: 1,
      disposition: 'kept',
    })
    expect(r.bonusDice[1]).toMatchObject({
      type: 'ring',
      face: 3,
      chainDepth: 2,
      disposition: 'kept',
    })
    expect(r.explosiveTriggers).toBe(2)
  })

  it('bonus chains are capped (house safety valve, disclosed in notes)', () => {
    const rng = createSequenceRng(new Array(20).fill(6))
    const r = rollCheck({ ring: 1, skill: 0, rng })
    expect(r.bonusDice).toHaveLength(10) // MAX_BONUS_CHAIN
    expect(r.pool).toHaveLength(1) // base pool unchanged
    expect(r.notes.some((n) => n.includes('safety cap'))).toBe(true)
  })

  it('includeExplosionBonuses=false disables bonus dice', () => {
    const rng = createSequenceRng([6, 3])
    const r = rollCheck({ ring: 1, skill: 0, rng, includeExplosionBonuses: false })
    expect(r.pool).toHaveLength(1)
    expect(r.explosiveTriggers).toBe(1) // counted, not expanded
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
    // Kept: ring 4 (s1,str1) + ring 6 (s1,str1,expl). Kept ring-6 explodes
    // -> bonus ring 2 (opp+strife), KEPT (auto_keep) -> tallied per D-A.
    expect(r.tallies.successes).toBe(2)
    expect(r.tallies.strife).toBe(3) // ring4 + ring6 + bonus ring2
    expect(r.tallies.opportunities).toBe(1) // bonus ring 2
    expect(r.tallies.explosive).toBe(1)
    expect(r.totalSuccesses).toBe(3) // 2 ⚑ + 1 🔥
  })

  it('kept override: under-keep is legal (book p. 24); out-of-range throws', () => {
    // Book p. 24: "must choose at least one die to keep... up to the value
    // of the ring" — keeping 1 of max 2 is legal under-keeping.
    const rng = createSequenceRng([4, 5, 8, 9])
    const r = rollCheck({ ring: 2, skill: 2, rng, kept: '1' })
    expect(r.keptIndices).toEqual([1])
    expect(r.notes.some((n) => n.includes('under-keeping'))).toBe(true)
    // Out-of-range indices still throw.
    expect(() =>
      rollCheck({ ring: 2, skill: 2, rng: createSequenceRng([4, 5, 8, 9]), kept: '0,9' }),
    ).toThrow(/index/)
    // Over-keeping (more than keepMax) throws.
    expect(() =>
      rollCheck({ ring: 2, skill: 2, rng: createSequenceRng([4, 5, 8, 9]), kept: '1,2,3,4' }),
    ).toThrow(/between 1 and 2/)
  })

  it('kept override indices are 1-based over the BASE pool (no bonus dice)', () => {
    // Ring 1, skill 1: base pool = ring + skill; bonus dice appended after.
    // Ring 6 (expl) -> bonus ring 6 (expl) -> bonus 3; skill 10.
    // Base pool = [ring6, skill10]; override "2" keeps skill 10 only.
    // ring 6 (expl -> bonus ring 4), skill 10. Base pool = [ring6, skill10].
    const rng = createSequenceRng([6, 10])
    const r = rollCheck({ ring: 1, skill: 1, rng, kept: '2' })
    expect(r.keptIndices).toEqual([2])
    // The dropped ring-6 is NOT kept — kept-only law means NO bonus roll
    // (queue has no 3rd value; an erroneous roll would throw exhausted).
    expect(r.pool).toHaveLength(2)
    expect(r.bonusDice).toHaveLength(0)
    expect(r.explosiveTriggers).toBe(0)
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
    // Book Step 4 (modify) happens BEFORE Step 6 (explosions): the
    // conversion roll is consumed before any bonus-die roll.
    // Base: ring 2 (opp+strife), ring 6 (expl), skill 6 (succ+strife).
    // Advantage converts ring 2 -> skill, reroll 7 (succ+strife) — consumed
    // BEFORE any bonus roll (book Step 4 before Step 6).
    // Keep 1 (ring rating): skill-7 ties ring-6 (1 succ, 1 strife); the
    // explosive tiebreak KEEPS ring-6 -> bonus ring 4 (d6-legal), kept.
    const rng = createSequenceRng([2, 6, 6, 7, 4])
    const r = rollCheck({ ring: 2, skill: 1, rng, advantage: true })
    expect(r.conversions).toHaveLength(1)
    expect(r.conversions[0]).toMatchObject({
      index: 1,
      from: 'ring',
      to: 'skill',
      oldFace: 2,
      newFace: 7,
    })
    expect(r.bonusDice).toHaveLength(1)
    expect(r.bonusDice[0]).toMatchObject({ type: 'ring', face: 4, disposition: 'kept' })
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
    const rng = createSequenceRng([4, 6, 8, 3, 2])
    const r = rollCheck({ ring: 2, skill: 2, rng })
    // Kept: skill 8 (s1) + ring 6 (s1,str1,expl; explosive tiebreak beats
    // ring 4). Bonus ring 2 (opp+strife) KEPT -> tallied per D-A law fix.
    expect(r.tallies).toEqual({ successes: 2, opportunities: 1, strife: 2, explosive: 1 })
    expect(r.totalSuccesses).toBe(3) // 2 ⚑ + 1 🔥 (D-B law fix)
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

  it('advantage AND disadvantage together CANCEL per the consolidate rule (book p. 24)', () => {
    // Book p. 24 Step 4.2: "An applied distinction cancels (and is
    // cancelled by) an applied adversity... Cancelled advantages and
    // disadvantages have no effect on the resolution of the check."
    const rng = createSequenceRng([3, 5, 8])
    const r = rollCheck({ ring: 2, skill: 1, rng, advantage: true, disadvantage: true })
    expect(r.conversions).toHaveLength(0) // cancelled — no effect
    expect(r.notes.some((n) => n.includes('cancelled per the consolidate rule'))).toBe(true)
  })

  it('rejects tn outside 1..10', () => {
    expect(() => rollCheck({ ring: 1, skill: 0, rng: createSequenceRng([]), tn: 0 })).toThrow(/tn/)
    expect(() => rollCheck({ ring: 1, skill: 0, rng: createSequenceRng([]), tn: 11 })).toThrow(/tn/)
  })
})

describe('rollCheck — book law (corebook pp. 20–26): totalSuccesses & bonus dice', () => {
  // ACCEPTANCE TEST — the Sakura worked example (corebook p. 23).
  // Ring 3 + Fitness 1, TN 3. Queue: ring 6 (succ+strife+expl), ring 2
  // (opp+strife), ring 2 (opp+strife), skill 3 (opp); bonus die from the
  // kept ring-6 explosive rolls face 5 (succ).
  // Book resolution: keep 3 dice (ring6, skill3, ring2) -> kept base ⚑ = 1
  // (ring6) + 🔥 = 1; kept bonus die ⚑ = 1. totalSuccesses = ⚑+🔥 = 3 >= TN 3
  // -> SUCCESS (the book's own outcome).
  // The pre-law-fix engine FAILS this: bonus dice are never tallied and
  // 🔥 does not count toward the TN comparison (defects D-A and D-B).
  it('Sakura (p. 23): kept bonus die completes the TN; 🔥 counts as a success', () => {
    const rng = createSequenceRng([6, 2, 2, 3, 5])
    const r = rollCheck({ ring: 3, skill: 1, tn: 3, rng })
    expect(r.success).toBe(true)
    expect(r.totalSuccesses).toBe(3)
    // Kept base dice include the ring-6 (the best die under any policy).
    const keptTypes = r.kept.map((d) => `${d.type}:${d.face}`)
    expect(keptTypes).toContain('ring:6')
    // The bonus die exists and is audited: same type as its source (ring),
    // face 5, chain depth 1, disposition kept (auto_keep default).
    expect(r.bonusDice).toHaveLength(1)
    expect(r.bonusDice[0]).toMatchObject({
      type: 'ring',
      face: 5,
      chainDepth: 1,
      disposition: 'kept',
    })
    expect(r.bonusDice[0].sourceDieIndex).toBeGreaterThan(0)
    // Bonus die symbols are TALLIED (defect D-A): ring6 ⚑ + bonus ⚑ = 2.
    expect(r.tallies.successes).toBe(2)
    expect(r.tallies.explosive).toBe(1)
    // totalSuccesses = ⚑ + 🔥 (defect D-B): 2 ⚑ + 1 🔥 = 3.
    expect(r.totalSuccesses).toBe(3)
    expect(r.bonusSuccesses).toBe(0)
    expect(r.shortfall).toBe(0)
  })

  // D-B: a kept skill-12 shows ZERO ⚑ but its 🔥 counts as one success in
  // the total ("the sum total of ⚑ and 🔥 symbols", pp. 20 + 24).
  it('kept skill-12 (pure explosive face) counts as 1 success toward TN', () => {
    // Ring 1, skill 1. Queue: ring 1 (blank), skill 12 (expl only), bonus
    // skill 1 (blank). Explicit keep: the skill-12 alone (kept='2').
    const rng = createSequenceRng([1, 12, 1])
    const r = rollCheck({ ring: 1, skill: 1, tn: 1, rng, kept: '2' })
    // Its 🔥 alone must satisfy TN 1 (p. 24: "sum total of ⚑ and 🔥").
    expect(r.totalSuccesses).toBe(1)
    expect(r.success).toBe(true)
  })

  // D-B: a kept ring-6 counts ⚑ + 🔥 = 2 successes (not 1).
  it('kept ring-6 counts as 2 successes (⚑ + 🔥)', () => {
    // Ring 2, skill 0. Queue: ring 6 (expl), ring 1 (blank); bonus ring 3
    // (opp). Explicit keep: the ring-6 alone; bonus die face 3 kept by
    // default (auto_keep).
    const rng = createSequenceRng([6, 1, 3])
    const r = rollCheck({ ring: 2, skill: 0, tn: 2, rng, kept: '1' })
    expect(r.totalSuccesses).toBe(2)
    expect(r.success).toBe(true)
  })

  // D2: explosions trigger from KEPT dice only — a dropped explosive die
  // spawns nothing (the rng sequence proves no bonus roll is consumed).
  it('explosive symbol on a DROPPED die spawns no bonus die', () => {
    // Ring 2, skill 1. Queue: ring 6 (expl), ring 1 (blank), skill 8 (succ).
    // Keep only the skill-8 (explicit kept='3'): the ring-6 is dropped, so
    // no bonus die may be rolled — the sequence has no 4th value, and an
    // erroneous bonus roll would throw "sequence exhausted".
    const rng = createSequenceRng([6, 1, 8])
    const r = rollCheck({ ring: 2, skill: 1, rng, kept: '3' })
    expect(r.bonusDice).toHaveLength(0)
    expect(r.explosiveTriggers).toBe(0)
  })
})

describe('rollCheck — flag directive: every automation is an explicit, transparent parameter', () => {
  // bonusDice='auto_drop': bonus dice ROLLED and shown, NOT tallied.
  it("bonusDice='auto_drop' rolls, shows, and does not tally bonus dice", () => {
    // Ring 2, skill 0. Base: ring 6 (expl), ring 1 (blank). Keep 2: both.
    // Bonus ring 5 (succ) — rolled, shown as dropped, NOT tallied.
    const rng = createSequenceRng([6, 1, 5])
    const r = rollCheck({ ring: 2, skill: 0, rng, bonusDice: 'auto_drop' })
    expect(r.bonusDice).toHaveLength(1)
    expect(r.bonusDice[0]).toMatchObject({ type: 'ring', face: 5, disposition: 'dropped' })
    expect(r.bonusDice[0].symbols.successes).toBe(1) // caller SEES what was forgone
    expect(r.tallies.successes).toBe(1) // ring-6 ⚑ only
    expect(r.totalSuccesses).toBe(2) // 1 ⚑ + 1 🔥 (the 🔥 still counts — it's on a kept die)
    expect(r.notes.some((n) => n.includes('auto_drop'))).toBe(true)
  })

  // bonusDice='manual': rolled, shown, pending — caller decides.
  it("bonusDice='manual' reports pending bonus dice without deciding for the caller", () => {
    const rng = createSequenceRng([6, 1, 5])
    const r = rollCheck({ ring: 2, skill: 0, rng, bonusDice: 'manual' })
    expect(r.bonusDice).toHaveLength(1)
    expect(r.bonusDice[0]).toMatchObject({ type: 'ring', face: 5, disposition: 'pending' })
    expect(r.tallies.bonusPending).toBe(1)
    expect(r.tallies.successes).toBe(1) // pending dice NOT tallied
    expect(r.totalSuccesses).toBe(2) // kept ring-6: 1 ⚑ + 1 🔥
    expect(r.notes.some((n) => n.includes('caller decides'))).toBe(true)
  })

  // Deprecated alias maps with a note; both together rejected.
  it('includeExplosionBonuses deprecated alias maps to bonusDice with a note', () => {
    const rng = createSequenceRng([6, 1, 5])
    const r = rollCheck({ ring: 2, skill: 0, rng, includeExplosionBonuses: false })
    expect(r.bonusDiceMode).toBe('auto_drop')
    expect(r.bonusDice[0].disposition).toBe('dropped')
    expect(() =>
      rollCheck({
        ring: 1,
        skill: 0,
        rng: createSequenceRng([6]),
        bonusDice: 'manual',
        includeExplosionBonuses: true,
      }),
    ).toThrow(/not both/)
  })

  // keepCount: under-keep via flag (auto policies select keepCount-many).
  it('keepCount under-keeps via policy (flag directive; book p. 24)', () => {
    // Ring 2, skill 1. Base: ring 5 (succ), ring 1 (blank), skill 8 (succ).
    // keepCount=1, policy success_first: ring-5 and skill-8 tie (1 succ,
    // 0 strife, 0 opp) — the skill-preference key ranks skill-8 FIRST.
    // Kept: skill 8 only (index 2 -> 1-based 3).
    const rng = createSequenceRng([5, 1, 8])
    const r = rollCheck({ ring: 2, skill: 1, rng, keepCount: 1 })
    expect(r.keptIndices).toEqual([3])
    expect(r.requestedKeepCount).toBe(1)
    expect(r.notes.some((n) => n.includes('1 of 3 rolled'))).toBe(true)
  })

  // keepCount clamped above keepMax, with a note.
  it('keepCount above keepMax is clamped with a note', () => {
    const rng = createSequenceRng([5, 1, 8])
    const r = rollCheck({ ring: 2, skill: 1, rng, keepCount: 5 })
    expect(r.requestedKeepCount).toBe(2) // clamped to keepMax = ring (no assistants)
    expect(r.notes.some((n) => n.includes('clamped'))).toBe(true)
  })

  // Assistance: skilled/unskilled helpers (book p. 26).
  it('assistance adds skill dice per skilled helper, ring dice per unskilled helper', () => {
    // Ring 1, skill 1, 1 skilled + 2 unskilled assistants.
    // Pool: ring(1) + skill(3=opp) + skilled skill(9=succ) + 2 unskilled
    // ring(4=succ+strife, 2=opp+strife). Base 5 dice. keepMax = 1+3 = 4.
    const rng = createSequenceRng([1, 3, 9, 4, 2])
    const r = rollCheck({
      ring: 1,
      skill: 1,
      rng,
      assistants: { skilled: 1, unskilled: 2 },
    })
    expect(r.baseCount).toBe(5)
    expect(r.keepMax).toBe(4)
    expect(r.pool[2]).toMatchObject({ type: 'skill', face: 9 }) // skilled helper
    expect(r.pool[3]).toMatchObject({ type: 'ring', face: 4 }) // unskilled helper
    expect(r.pool[4]).toMatchObject({ type: 'ring', face: 2 }) // unskilled helper
    expect(r.notes.some((n) => n.includes('Assistance (book p. 26)'))).toBe(true)
    // Policy keeps 4 of 5: succ dice first (skill 9, ring 4), then opp
    // (ring 2, skill 3 — skill preferred on ties, but ring 2 has strife,
    // skill 3 doesn't... strife asc: skill 3 (0 strife) before ring 2).
    expect(r.keptIndices).toHaveLength(4)
  })

  it('assistance raises keepMax; keepCount validated against it', () => {
    // Ring 1, skill 0, 2 assistants: keepMax = 1 + 2 = 3; base = 3 dice.
    const rng = createSequenceRng([5, 4, 3])
    const r = rollCheck({
      ring: 1,
      skill: 0,
      rng,
      assistants: { skilled: 1, unskilled: 1 },
      kept: '1,2,3',
    })
    expect(r.keepMax).toBe(3)
    expect(r.keptIndices).toEqual([1, 2, 3])
    // Over-keep bound: ring 1 + skill 2 + 1 assistant = 4 base dice,
    // keepMax = 2 — keeping 4 exceeds it (book p. 24 + p. 26).
    expect(() =>
      rollCheck({
        ring: 1,
        skill: 2,
        rng: createSequenceRng([5, 4, 3, 8]),
        assistants: { skilled: 1 },
        kept: '1,2,3,4',
      }),
    ).toThrow(/between 1 and 2/)
  })

  // assistants validation.
  it('rejects invalid assistants params', () => {
    expect(() =>
      rollCheck({ ring: 1, skill: 0, rng: createSequenceRng([3]), assistants: { skilled: -1 } }),
    ).toThrow(/skilled/)
    expect(() =>
      rollCheck({ ring: 1, skill: 0, rng: createSequenceRng([3]), assistants: { unskilled: 6 } }),
    ).toThrow(/unskilled/)
  })

  // bonusSuccesses / shortfall (book p. 26).
  it('emits bonusSuccesses and shortfall against the TN (book p. 26)', () => {
    // Sakura again: totalSuccesses 3 vs tn 2 -> 1 bonus success.
    const rng = createSequenceRng([6, 2, 2, 3, 5])
    const r = rollCheck({ ring: 3, skill: 1, tn: 2, rng })
    expect(r.totalSuccesses).toBe(3)
    expect(r.bonusSuccesses).toBe(1)
    expect(r.shortfall).toBe(0)
    // Failing case: totalSuccesses 3 vs tn 5 -> shortfall 2.
    const r2 = rollCheck({ ring: 3, skill: 1, tn: 5, rng: createSequenceRng([6, 2, 2, 3, 5]) })
    expect(r2.success).toBe(false)
    expect(r2.bonusSuccesses).toBe(0)
    expect(r2.shortfall).toBe(2)
  })

  // Transparence: no bonusDice audit entries when nothing explodes.
  it('no explosions -> empty bonusDice audit array', () => {
    const rng = createSequenceRng([3, 5])
    const r = rollCheck({ ring: 2, skill: 0, rng })
    expect(r.bonusDice).toEqual([])
    expect(r.explosiveTriggers).toBe(0)
  })
})

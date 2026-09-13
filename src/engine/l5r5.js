/**
 * L5R 5th Edition (FFG) ring & skill dice engine.
 *
 * Implements the check pipeline EXACTLY as the corebook prescribes
 * (corebook pp. 20–26 — the spec of record; "books win on divergence"):
 *
 *   Step 3  Assemble & Roll — pool of Ring-rating ring dice (d6) +
 *           Skill-rank skill dice (d12), plus assistance dice (p. 26).
 *   Step 4  Modify Rolled Dice — advantage/disadvantage (house
 *           simplification of named categories; applied pairs CANCEL per
 *           the consolidate rule, p. 24) and explicit conversions.
 *   Step 5  Choose Kept Dice — the player keeps AT LEAST ONE and AT MOST
 *           ring-rating (+1 per assistant) dice (p. 24 Step 5). Dropped
 *           dice are discarded with their results unused.
 *   Step 6  Resolve Symbols on KEPT Dice (pp. 23–24), in order:
 *           1. Explosive Success — for each 🔥 on a KEPT die, roll ONE
 *              bonus die of the same type; the player chooses keep
 *              ("on top of their current results") or drop. A kept bonus
 *              die's own 🔥 resolves again (chains). Bonus-dice handling
 *              is caller-controlled via the `bonusDice` flag.
 *           2. Strife — +1 per ⏳ symbol.
 *           3. Opportunity — spent by the caller (narrative layer).
 *           4. Total Successes — the sum of ⚑ AND 🔥 symbols ("the sum
 *              total of success and explosive success symbols", p. 24);
 *              equal/exceed the TN = success.
 *
 * Key law points encoded here (each cited in-line):
 *   - 🔥 counts as a ⚑ in the success total (D-B fix; pp. 20 + 24).
 *   - Bonus dice are rolled AFTER keep selection and their symbols COUNT
 *     when kept (D-A fix; Sakura worked example, p. 23).
 *   - Explosive symbols on DROPPED dice do nothing (D2 fix; p. 24: the
 *     pool is "reduced to only kept dice" before resolution).
 *   - Keep count is 1..keepMax (D1 fix; p. 24: "at least one... up to
 *     the value of the ring").
 *   - Assistance: +1 skill die per skilled helper, +1 ring die per
 *     unskilled helper; keeper may keep +1 die per assistant (D4; p. 26).
 *
 * House rules (documented deviations, kept minimal):
 *   - MAX_BONUS_CHAIN caps per-chain bonus-die depth. The book has no
 *     cap (a player can always drop), but `auto_keep` automation needs a
 *     safety valve; 10 is far beyond any realistic chain.
 *   - advantage/disadvantage flags are a convenience simplification of
 *     the book's NAMED advantage/disadvantage categories (p. 24 sidebar:
 *     Distinction, Adversity, Passion, Anxiety). Use explicit
 *     `conversions` for book-accurate per-advantage effects.
 *
 * Design invariants (unchanged from v1.3.x):
 *   - Stateless: one call = one check. Randomness is injected (`rng`).
 *   - Symbol tables are DATA (symbols.js); this engine is table-agnostic.
 *   - Tallies stay RAW (successes = ⚑ count, explosive = 🔥 count);
 *     `totalSuccesses` is the derived ⚑+🔥 total. No field redefinition.
 *   - Every automated decision appears in `notes[]` and structured audit
 *     fields — the result is a complete transcript of what occurred.
 *
 * @module engine/l5r5
 */

import { resolveDie, sumSymbols } from './symbols.js'

/**
 * House safety valve: hard cap on bonus-die chain depth per explosive
 * source chain. NOT book law — the book is naturally finite because the
 * player may always drop a bonus die; this cap exists so the
 * `auto_keep` automation cannot roll unboundedly. Disclosed in results.
 *
 * @type {number}
 */
export const MAX_BONUS_CHAIN = 10

const POLICIES = new Set(['success_first', 'min_strife', 'max_opportunity'])

/** Legal values for the `bonusDice` flag (see rollCheck). */
const BONUS_DICE_MODES = new Set(['auto_keep', 'auto_drop', 'manual'])

/**
 * Validate rollCheck parameters.
 *
 * @param {object} p - See rollCheck.
 * @throws {Error} On invalid parameters.
 */
function validate(p) {
  const {
    ring,
    skill,
    tn,
    policy,
    composure,
    keepCount,
    assistants,
    bonusDice,
    includeExplosionBonuses,
  } = p
  if (!Number.isInteger(ring) || ring < 1 || ring > 5) {
    throw new Error(`rollCheck: ring must be an integer in 1..5 (got ${ring})`)
  }
  if (!Number.isInteger(skill) || skill < 0 || skill > 5) {
    throw new Error(`rollCheck: skill must be an integer in 0..5 (got ${skill})`)
  }
  if (tn !== undefined && tn !== null && (!Number.isInteger(tn) || tn < 1 || tn > 10)) {
    throw new Error(`rollCheck: tn must be an integer in 1..10 (got ${tn})`)
  }
  if (policy !== undefined && !POLICIES.has(policy)) {
    throw new Error(`rollCheck: policy must be one of ${[...POLICIES].join(', ')} (got ${policy})`)
  }
  if (
    composure !== undefined &&
    composure !== null &&
    (!Number.isInteger(composure) || composure < 1)
  ) {
    throw new Error(`rollCheck: composure must be a positive integer (got ${composure})`)
  }
  if (assistants !== undefined && assistants !== null) {
    const { skilled = 0, unskilled = 0 } = assistants
    if (!Number.isInteger(skilled) || skilled < 0 || skilled > 5) {
      throw new Error(`rollCheck: assistants.skilled must be an integer in 0..5 (got ${skilled})`)
    }
    if (!Number.isInteger(unskilled) || unskilled < 0 || unskilled > 5) {
      throw new Error(
        `rollCheck: assistants.unskilled must be an integer in 0..5 (got ${unskilled})`,
      )
    }
  }
  if (bonusDice !== undefined && !BONUS_DICE_MODES.has(bonusDice)) {
    throw new Error(
      `rollCheck: bonusDice must be one of ${[...BONUS_DICE_MODES].join(', ')} (got ${bonusDice})`,
    )
  }
  if (includeExplosionBonuses !== undefined && bonusDice !== undefined) {
    throw new Error(
      'rollCheck: pass either bonusDice (preferred) or includeExplosionBonuses (deprecated), not both',
    )
  }
  if (keepCount !== undefined && keepCount !== null) {
    if (!Number.isInteger(keepCount) || keepCount < 1) {
      throw new Error(`rollCheck: keepCount must be a positive integer (got ${keepCount})`)
    }
  }
}

/**
 * Roll one die of a type (no explosion — explosions are resolved
 * post-keep per book Step 6).
 *
 * @param {'ring'|'skill'} type
 * @param {(sides: number) => number} rng
 * @returns {number} Face value.
 */
function rollFace(type, rng) {
  return rng(type === 'ring' ? 6 : 12)
}

/**
 * Build the BASE pool — book Step 3 (p. 22). Ring-rating ring dice,
 * then Skill-rank skill dice, then assistance dice (p. 26: +1 skill die
 * per skilled assistant, +1 ring die per unskilled assistant).
 *
 * NO bonus dice here — explosions are resolved AFTER keep selection
 * (book Step 6; D2 fix).
 *
 * @param {object} p - {ring, skill, rng, assistants}
 * @returns {object[]} The base pool. Each die:
 *   {index (0-based), type, face, symbols}.
 */
function buildPool({ ring, skill, rng, assistants }) {
  /** @type {Array<{index:number, type:'ring'|'skill', face:number, symbols:object}>} */
  const pool = []
  let index = 0

  const addDie = (type) => {
    const face = rollFace(type, rng)
    pool.push({ index, type, face, symbols: resolveDie(type, face) })
    index++
  }

  // Book p. 22: "a number of Skill dice equal to the character's ranks in
  // the skill and a number of Ring dice equal to the value of the
  // character's ring." Table order: ring dice first, then skill.
  for (let i = 0; i < ring; i++) addDie('ring')
  for (let i = 0; i < skill; i++) addDie('skill')

  // Book p. 26 (Assistance): "the character making the check rolls one
  // additional ⬡ per assisting character who has 1 or more ranks in the
  // skill in use, and one additional ■ per assisting character who has 0
  // ranks." Assistance dice are keep-eligible base-pool members.
  if (assistants) {
    for (let i = 0; i < assistants.skilled; i++) addDie('skill')
    for (let i = 0; i < assistants.unskilled; i++) addDie('ring')
  }

  return pool
}

/**
 * Apply advantage/disadvantage conversions to the base pool (book Step
 * 4: Modify Rolled Dice).
 *
 * CONSOLIDATE RULE (book p. 24, law fix D3): when both advantage and
 * disadvantage are applied, they CANCEL each other out — this is the
 * book's rule, not an error. The cancellation is reported in notes.
 *
 * Explicit `conversions` ("2:skill,4:ring") overrides the flags — the
 * book-accurate surface for per-advantage effects (p. 26 modification
 * verbs: Alter, Reroll, etc.).
 *
 * @param {object[]} pool - The base pool (mutated in place).
 * @param {object} p - {advantage, disadvantage, conversions, rng}
 * @param {string[]} notes - Result notes; automation is narrated here.
 * @returns {object[]} Conversion records.
 */
function applyConversions(pool, { advantage, disadvantage, conversions, rng }, notes) {
  const records = []

  const convert = (die, toType) => {
    const newFace = rollFace(toType, rng)
    const record = {
      index: die.index + 1, // 1-based, matches tool-level indexing
      from: die.type,
      to: toType,
      oldFace: die.face,
      newFace,
    }
    die.type = toType
    die.face = newFace
    die.symbols = resolveDie(toType, newFace)
    records.push(record)
  }

  if (conversions) {
    for (const spec of conversions.split(',')) {
      const m = spec.trim().match(/^(\d+):(ring|skill)$/i)
      if (!m) {
        throw new Error(
          `rollCheck: conversions must be "index:ring" or "index:skill" comma-separated (got "${spec}")`,
        )
      }
      const idx = parseInt(m[1], 10) - 1
      const die = pool[idx]
      if (!die) {
        throw new Error(`rollCheck: conversion index ${m[1]} does not reference a base-pool die`)
      }
      convert(die, m[2].toLowerCase())
    }
    return records
  }

  // Book p. 24 (Step 4.2, Consolidate Advantages and Disadvantages):
  // "An applied distinction cancels (and is cancelled by) an applied
  // adversity... Cancelled advantages and disadvantages have no effect."
  // House simplification: the flags stand in for the book's named
  // categories; when both are applied they cancel per this rule.
  if (advantage && disadvantage) {
    notes.push(
      'Advantage and disadvantage applied — cancelled per the consolidate rule (corebook p. 24); no effect on the check.',
    )
    return records
  }

  if (advantage) {
    // House simplification of named advantage categories (e.g.
    // Distinction: reroll up to 2 dice). Converts non-explosive ring
    // dice to skill dice — never sacrifices an explosive face.
    for (const die of [...pool]) {
      if (die.type === 'ring' && !die.symbols.explosive) {
        convert(die, 'skill')
      }
    }
  }

  if (disadvantage) {
    // House simplification of named disadvantage categories (e.g.
    // Adversity: must reroll dice showing ⚑/🔥). Converts the single
    // worst skill die (lowest face; ties: earliest) to a ring die.
    const skillDice = pool.filter((d) => d.type === 'skill')
    if (skillDice.length > 0) {
      const worst = skillDice.reduce((w, d) => (d.face < w.face ? d : w))
      convert(worst, 'ring')
    }
  }

  return records
}

/**
 * Select kept dice — book Step 5 (p. 24): "The player must choose at
 * least one die to keep, and can choose to keep a maximum up to the
 * value of the ring character used for the check" (+1 per assisting
 * character, p. 26). Dropped dice are discarded, results unused.
 *
 * @param {object[]} pool - The base pool (no bonus dice exist yet).
 * @param {number} baseCount - Number of base-pool dice.
 * @param {number} keepCount - Dice to keep (1..baseCount scope).
 * @param {object} p - {policy, kept, notes}
 * @returns {number[]} 1-based indices of kept dice.
 */
function selectKept(pool, baseCount, keepCount, { policy = 'success_first', kept, notes }) {
  if (kept !== undefined && kept !== null) {
    const indices = kept.split(',').map((s) => parseInt(s.trim(), 10))
    if (indices.some((i) => !Number.isInteger(i) || i < 1 || i > baseCount)) {
      throw new Error(
        `rollCheck: kept indices must be 1-based indexes into the base pool (1..${baseCount}), got "${kept}"`,
      )
    }
    if (indices.length < 1 || indices.length > keepCount) {
      throw new Error(
        `rollCheck: kept must keep between 1 and ${keepCount} dice (corebook p. 24: "at least one... up to the value of the ring"), got ${indices.length}`,
      )
    }
    if (new Set(indices).size !== indices.length) {
      throw new Error(`rollCheck: kept indices must be unique, got "${kept}"`)
    }
    if (indices.length !== keepCount) {
      notes.push(
        `Explicit keep: ${indices.length} of up to ${keepCount} (under-keeping is legal — book p. 24).`,
      )
    }
    return indices
  }

  // Policy sort. Deterministic tiebreaks: sortKeys chain, then index.
  // The explosive tiebreak is mechanically meaningful post-law-fix:
  // keeping a 🔥 die spawns a bonus die (book Step 6.1).
  const sorters = {
    success_first: [
      (d) => -d.symbols.successes,
      (d) => d.symbols.strife,
      (d) => -d.symbols.opportunities,
      (d) => -(d.symbols.explosive ? 1 : 0),
      (d) => (d.type === 'skill' ? 0 : 1), // prefer skill dice on ties
      (d) => -d.face,
    ],
    min_strife: [
      (d) => d.symbols.strife,
      (d) => -d.symbols.successes,
      (d) => -d.symbols.opportunities,
      (d) => -(d.symbols.explosive ? 1 : 0),
      (d) => (d.type === 'skill' ? 0 : 1),
      (d) => -d.face,
    ],
    max_opportunity: [
      (d) => -d.symbols.opportunities,
      (d) => -d.symbols.successes,
      (d) => d.symbols.strife,
      (d) => -(d.symbols.explosive ? 1 : 0),
      (d) => (d.type === 'skill' ? 0 : 1),
      (d) => -d.face,
    ],
  }
  const keys = sorters[policy]

  const indexed = pool.map((die) => ({ die, index: die.index }))
  indexed.sort((a, b) => {
    for (const key of keys) {
      const ka = key(a.die)
      const kb = key(b.die)
      if (ka !== kb) return ka - kb
    }
    return a.index - b.index
  })

  if (keepCount < baseCount) {
    notes.push(
      `Policy keep: ${keepCount} of ${baseCount} rolled dice (book p. 24 allows 1..${keepCount}).`,
    )
  }

  return indexed.slice(0, keepCount).map((x) => x.die.index + 1) // 1-based
}

/**
 * Resolve kept dice — book Step 6 (pp. 23–24), the post-keep explosion
 * loop (law fixes D-A and D2).
 *
 * For each 🔥 symbol on a KEPT die (base or bonus), roll ONE bonus die
 * of the same type. The disposition of each bonus die is governed by
 * the `bonusDice` mode:
 *   - 'auto_keep': bonus dice join the resolved results (their symbols
 *     count; a kept bonus die's own 🔥 chains). Sakura p. 23 behavior.
 *   - 'auto_drop': bonus dice are rolled and shown, but NOT tallied
 *     (disposition 'dropped') — the caller sees what was forgone.
 *   - 'manual': bonus dice are rolled and shown but NOT tallied
 *     (disposition 'pending'); the caller decides and applies their
 *     symbols from the bonusDice audit array. The result reports
 *     tallies.bonusPending so nothing is silent.
 *
 * @param {object[]} pool - The base pool (kept indices refer into it).
 * @param {number[]} keptIndices - 1-based kept indices.
 * @param {object} p - {rng, bonusDice, notes}
 * @returns {{keptDice: object[], droppedDice: object[], bonusDice: object[],
 *   explosiveTriggers: number, bonusPending: number}}
 *   keptDice/droppedDice are base-pool dice; bonusDice is the audit
 *   array {sourceDieIndex, type, face, symbols, chainDepth, disposition}.
 */
function resolveKeptDice(pool, keptIndices, { rng, bonusDice, notes }) {
  const keptSet = new Set(keptIndices)
  const keptDice = pool.filter((d) => keptSet.has(d.index + 1))
  const droppedDice = pool.filter((d) => !keptSet.has(d.index + 1))

  /** @type {Array<{sourceDieIndex:number, type:'ring'|'skill', face:number, symbols:object, chainDepth:number, disposition:'kept'|'dropped'|'pending'}>} */
  const bonusAudit = []
  let explosiveTriggers = 0
  let bonusPending = 0

  const keepBonus = bonusDice === 'auto_keep'
  const showBonus = bonusDice !== 'auto_keep' // auto_drop and manual show but don't tally

  // BFS over kept dice's explosive symbols. Each 🔥 on a kept die (base
  // or kept bonus) rolls one same-type bonus die (book Step 6.1). A kept
  // bonus die's own 🔥 resolves again — the cursor walk reaches appended
  // bonus dice naturally. chainDepth caps per-chain runaway (house valve).
  const queue = keptDice.map((d) => ({ die: d, depth: 0 }))
  for (let qi = 0; qi < queue.length; qi++) {
    const { die, depth } = queue[qi]
    if (!die.symbols.explosive) continue
    explosiveTriggers++
    if (depth >= MAX_BONUS_CHAIN) {
      notes.push(
        `Bonus-die chain reached the house safety cap (${MAX_BONUS_CHAIN}); further explosions were not rolled.`,
      )
      continue
    }
    const face = rollFace(die.type, rng)
    const symbols = resolveDie(die.type, face)
    const bonus = {
      sourceDieIndex: die.index + 1, // 1-based base-pool index of the source kept die
      type: die.type,
      face,
      symbols,
      chainDepth: depth + 1,
      disposition: keepBonus ? 'kept' : bonusDice === 'auto_drop' ? 'dropped' : 'pending',
    }
    bonusAudit.push(bonus)
    if (keepBonus) {
      // Kept bonus dice join the resolved results ("on top of their
      // current results", p. 24). Their own 🔥 chains via the queue.
      queue.push({ die: bonus, depth: depth + 1 })
    } else if (showBonus) {
      // auto_drop/manual: shown but not tallied; a pending bonus die's
      // 🔥 is NOT resolved (the caller hasn't decided to keep it).
      bonusPending++
    }
  }

  if (explosiveTriggers > 0) {
    if (keepBonus) {
      notes.push(
        `${explosiveTriggers} explosive symbol(s) on kept dice resolved (book Step 6.1); bonus dice rolled and kept — their symbols count.`,
      )
    } else if (bonusDice === 'auto_drop') {
      notes.push(
        `${explosiveTriggers} explosive symbol(s) on kept dice resolved; bonus dice rolled but DROPPED by mode (bonusDice='auto_drop') — their symbols do NOT count.`,
      )
    } else {
      notes.push(
        `${bonusPending} bonus die(s) rolled and PENDING — caller decides keep-or-drop (bonusDice='manual'); apply symbols from the bonusDice audit array yourself.`,
      )
    }
  }

  return { keptDice, droppedDice, bonusDice: bonusAudit, explosiveTriggers, bonusPending }
}

/**
 * Roll an L5R 5e check per the corebook pipeline (pp. 20–26).
 *
 * @param {object} params
 * @param {number} params.ring - Ring rating 1..5 (also the default keep count).
 * @param {number} params.skill - Skill rating 0..5. 0 = untrained (ring dice only).
 * @param {(sides: number) => number} params.rng - Injected randomness.
 * @param {number} [params.tn] - Target number (successes needed). When present,
 *   the result includes success/failure plus bonusSuccesses/shortfall.
 * @param {boolean} [params.advantage=false] - House-simplification flag
 *   (converts non-explosive ring dice to skill dice). Cancels against
 *   disadvantage per the book's consolidate rule (p. 24).
 * @param {boolean} [params.disadvantage=false] - House-simplification flag
 *   (converts the worst skill die to a ring die). Cancels against advantage.
 * @param {string} [params.conversions] - Explicit conversions "2:skill,4:ring"
 *   (1-based base-pool indices). The book-accurate surface (p. 26 verbs);
 *   overrides advantage/disadvantage.
 * @param {{skilled?: number, unskilled?: number}} [params.assistants] - Book
 *   p. 26 assistance: +1 skill die per skilled helper, +1 ring die per
 *   unskilled helper. Keep max rises by +1 per assistant.
 * @param {'success_first'|'min_strife'|'max_opportunity'} [params.policy='success_first']
 *   Auto-keep policy (used when `kept` is not provided).
 * @param {string} [params.kept] - Explicit keep override, comma-string of
 *   1-based BASE-pool indices (1..keepMax many; book p. 24 allows under-keeping).
 * @param {number} [params.keepCount] - Auto-keep count when `kept` is absent;
 *   defaults to keepMax (ring + assistant count). 1..keepMax legal (p. 24).
 * @param {'auto_keep'|'auto_drop'|'manual'} [params.bonusDice='auto_keep'] -
 *   How explosive bonus dice are handled (book Step 6.1; see resolveKeptDice).
 *   All modes ROLL the bonus dice so the result always shows what occurred.
 * @param {number} [params.composure] - Composure value; when provided, result
 *   includes composureExceeded (strife >= composure). Advisory only.
 * @param {boolean} [params.includeExplosionBonuses] - DEPRECATED alias:
 *   true ≈ bonusDice='auto_keep', false ≈ bonusDice='auto_drop'. Do not
 *   combine with bonusDice.
 * @param {string} [params.label] - Optional caller label echoed in the result.
 * @returns {object} Full result: pool (base dice w/ per-die symbols), baseCount,
 *   keepMax, keepCount, keptIndices, kept[], dropped[], bonusDice[] (audit:
 *   sourceDieIndex/type/face/symbols/chainDepth/disposition), conversions[],
 *   tallies (raw ⚑/⧫/⏳/🔥 counts), totalSuccesses (⚑+🔥), tn?, success?,
 *   bonusSuccesses?, shortfall?, explosiveTriggers, untrained, notes[],
 *   label?.
 * @throws {Error} On invalid parameters.
 */
export function rollCheck({
  ring,
  skill,
  rng,
  tn,
  advantage = false,
  disadvantage = false,
  conversions,
  assistants,
  policy = 'success_first',
  kept,
  keepCount,
  composure,
  bonusDice,
  includeExplosionBonuses,
  label,
}) {
  validate({
    ring,
    skill,
    tn,
    policy,
    composure,
    keepCount,
    assistants,
    bonusDice,
    includeExplosionBonuses,
  })

  // Deprecated alias mapping (kept for v1.3.x caller compatibility).
  let mode = bonusDice
  if (includeExplosionBonuses !== undefined) {
    mode = includeExplosionBonuses ? 'auto_keep' : 'auto_drop'
  }
  if (mode === undefined) {
    mode = 'auto_keep'
  }

  const notes = []
  const untrained = skill === 0
  const assistantCount = assistants ? (assistants.skilled ?? 0) + (assistants.unskilled ?? 0) : 0

  // Book Step 3: assemble and roll the base pool.
  const pool = buildPool({ ring, skill, rng, assistants })
  const baseCount = pool.length
  if (assistants && assistantCount > 0) {
    notes.push(
      `Assistance (book p. 26): +${assistants.skilled ?? 0} skill dice (skilled helper(s)) and +${assistants.unskilled ?? 0} ring dice (unskilled helper(s)) added to the pool.`,
    )
  }

  // Book Step 4: modify rolled dice.
  const conversionRecords = applyConversions(
    pool,
    { advantage, disadvantage, conversions, rng },
    notes,
  )

  // Book Step 5: choose kept dice. keepMax = ring + 1 per assistant (p. 26).
  const keepMax = ring + assistantCount
  let effectiveKeepCount = keepCount ?? keepMax
  if (effectiveKeepCount > keepMax) effectiveKeepCount = keepMax
  if (keepCount !== undefined && keepCount !== null && keepCount > keepMax) {
    notes.push(
      `keepCount ${keepCount} exceeds the maximum ${keepMax} (ring ${ring} + ${assistantCount} assistant(s)); clamped to ${keepMax}.`,
    )
  }
  if (kept !== undefined && kept !== null && keepCount !== undefined && keepCount !== null) {
    notes.push(
      `Both kept and keepCount provided — the explicit kept selection governs (keepCount ignored).`,
    )
  }
  const keptIndices = selectKept(pool, baseCount, effectiveKeepCount, { policy, kept, notes })

  // Book Step 6: resolve symbols on KEPT dice (explosions, strife,
  // opportunity, total successes).
  const {
    keptDice,
    droppedDice,
    bonusDice: bonusAudit,
    explosiveTriggers,
    bonusPending,
  } = resolveKeptDice(pool, keptIndices, { rng, bonusDice: mode, notes })

  // Tallies stay RAW (⚑/⧫/⏳/🔥 field sums); kept bonus dice are included
  // per their disposition (auto_keep tallies them; the other modes don't).
  const talliedSets = keptDice.map((d) => d.symbols)
  if (mode === 'auto_keep') {
    for (const b of bonusAudit) {
      if (b.disposition === 'kept') talliedSets.push(b.symbols)
    }
  }
  const tallies = sumSymbols(talliedSets)

  // Book p. 24 Step 6.4 (law fix D-B): "If the sum total of ⚑ and 🔥
  // symbols equals or exceeds the target number of successes... the
  // character succeeds." totalSuccesses is DERIVED — tallies stay raw.
  const totalSuccesses = tallies.successes + tallies.explosive

  if (untrained) notes.push('Untrained: ring dice only (no skill dice in the pool).')
  if (conversionRecords.length > 0) {
    notes.push(`${conversionRecords.length} die conversion(s) applied (book Step 4).`)
  }
  notes.push(
    `Keep: ${kept ? 'explicit override' : `policy ${policy}`} — ${keptIndices.length} of ${baseCount} rolled dice (max ${keepMax}).`,
  )
  // bonusPending is the MANUAL-mode signal (the caller decides — locked
  // design #1). auto_drop already decided (disposition 'dropped' in the
  // audit array); attaching a pending count there would be noise.
  if (mode === 'manual' && bonusPending > 0) {
    tallies.bonusPending = bonusPending
  }

  const result = {
    label,
    pool,
    baseCount,
    keepMax,
    keepCount: keptIndices.length,
    requestedKeepCount: kept || keepCount ? effectiveKeepCount : keepMax,
    keptIndices,
    kept: keptDice,
    dropped: droppedDice,
    bonusDice: bonusAudit,
    conversions: conversionRecords,
    tallies,
    totalSuccesses,
    explosiveTriggers,
    bonusDiceMode: mode,
    untrained,
    policy: kept ? 'override' : policy,
    notes,
  }
  if (tn !== undefined && tn !== null) {
    result.tn = tn
    result.success = totalSuccesses >= tn
    // Book p. 26: bonus successes = successes in excess of the TN;
    // shortfall = TN minus the success total.
    result.bonusSuccesses = Math.max(0, totalSuccesses - tn)
    result.shortfall = Math.max(0, tn - totalSuccesses)
  }
  if (composure !== undefined && composure !== null) {
    result.composureExceeded = tallies.strife >= composure
  }
  return result
}

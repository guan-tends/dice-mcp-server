/**
 * L5R 5th Edition (FFG) ring & skill dice engine.
 *
 * Roll (Ring + Skill) dice — Ring dice are d6, skill dice are d12 — then
 * keep Ring-rating many dice chosen AFTER seeing the pool. Faces carry
 * SYMBOLS (success / opportunity / strife / explosive) per the verified
 * tables in engine/symbols.
 *
 * Rules implemented (verified against 5e references):
 *   - Pool: ring d6s + skill d12s. Untrained (skill 0): ring dice only.
 *   - Explosive faces (ring 6, skill 11, skill 12) add ONE bonus die of
 *     the same type; bonus dice may chain; capped; marked bonusFor; they
 *     never consume keep slots. includeExplosionBonuses=false disables.
 *   - Keep selection AFTER the pool: kept = Ring rating. Three policies
 *     with deterministic tiebreaks, or explicit `kept` override (1-based
 *     comma-string over the BASE pool).
 *   - Advantage: convert ring dice to skill dice (reroll same slot).
 *     Never converts explosive ring dice (would lose the explosion).
 *     Disadvantage: convert skill dice to ring dice (worst skill die).
 *     Raw `conversions` list also supported for manual play.
 *   - Tallies over KEPT dice: successes/opportunities/strife count
 *     symbols; explosive counts triggers among kept.
 *   - Composure: advisory flag only (engine does not hardcode the
 *     formula — N3). Strife total >= composure => composureExceeded.
 *
 * @module engine/l5r5
 */

import { resolveDie, sumSymbols } from './symbols.js'

/** Hard cap on bonus-die chains per explosive trigger. */
export const MAX_BONUS_CHAIN = 10

const POLICIES = new Set(['success_first', 'min_strife', 'max_opportunity'])

/**
 * Validate rollCheck parameters.
 *
 * @param {object} p - See rollCheck.
 * @throws {Error} On invalid parameters.
 */
function validate(p) {
  const { ring, skill, tn, policy, advantage, disadvantage, composure } = p
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
  if (advantage && disadvantage) {
    throw new Error(
      'rollCheck: advantage and disadvantage are mutually exclusive on a single check',
    )
  }
  if (
    composure !== undefined &&
    composure !== null &&
    (!Number.isInteger(composure) || composure < 1)
  ) {
    throw new Error(`rollCheck: composure must be a positive integer (got ${composure})`)
  }
}

/**
 * Roll one die of a type (no explosion — explosions handled by the pool walk).
 *
 * @param {'ring'|'skill'} type
 * @param {(sides: number) => number} rng
 * @returns {number} Face value.
 */
function rollFace(type, rng) {
  return rng(type === 'ring' ? 6 : 12)
}

/**
 * Build the base pool (ring + skill dice), then expand explosive faces
 * into bonus dice (same type, chained, capped, marked bonusFor).
 *
 * @param {object} p - {ring, skill, rng, includeExplosionBonuses}
 * @returns {{pool: object[], explosiveTriggers: number}}
 */
function buildPool({ ring, skill, rng, includeExplosionBonuses }) {
  /** @type {Array<{index:number, type:'ring'|'skill', face:number, symbols:object, bonusFor?:number}>} */
  const pool = []
  let index = 0

  const addDie = (type, bonusFor, depth) => {
    const face = rollFace(type, rng)
    const die = { index, type, face, symbols: resolveDie(type, face) }
    if (bonusFor !== undefined) {
      die.bonusFor = bonusFor
      die.bonusDepth = depth
    }
    pool.push(die)
    return index++
  }

  // Base pool: ring d6s first, then skill d12s (table order).
  for (let i = 0; i < ring; i++) addDie('ring')
  for (let i = 0; i < skill; i++) addDie('skill')

  // Expand explosions: SINGLE-PASS cursor walk. Each explosive die (base
  // or bonus) adds exactly ONE bonus die of the same type; the cursor
  // reaches bonus dice naturally as they are appended. bonusDepth caps
  // per-chain depth (a bonus die at MAX depth still counts its trigger
  // but spawns nothing).
  let explosiveTriggers = 0
  if (includeExplosionBonuses) {
    for (let cursor = 0; cursor < pool.length; cursor++) {
      if (!pool[cursor].symbols.explosive) continue
      explosiveTriggers++
      const depth = pool[cursor].bonusDepth ?? 0
      if (depth < MAX_BONUS_CHAIN) {
        addDie(pool[cursor].type, pool[cursor].index, depth + 1)
      }
    }
  } else {
    explosiveTriggers = pool.filter((d) => d.symbols.explosive).length
  }

  return { pool, explosiveTriggers }
}

/**
 * Apply advantage/disadvantage conversions to the base pool.
 *
 * Advantage (default): convert non-explosive ring dice to skill dice —
 * the player-flavored default that never sacrifices an explosive.
 * Disadvantage (default): convert the worst (lowest-face) skill die to
 * a ring die.
 * Explicit `conversions` ("2:skill,4:ring") overrides the defaults.
 *
 * @param {object[]} pool - The base pool (mutated in place).
 * @param {object} p - {advantage, disadvantage, conversions, rng}
 * @returns {object[]} Conversion records.
 */
function applyConversions(pool, { advantage, disadvantage, conversions, rng }) {
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
      if (!die || die.bonusFor !== undefined) {
        throw new Error(
          `rollCheck: conversion index ${m[1]} does not reference a base-pool die (bonus dice are not selectable)`,
        )
      }
      convert(die, m[2].toLowerCase())
    }
    return records
  }

  if (advantage) {
    // Convert non-explosive ring dice to skill dice (cap: ring rating of
    // conversions is the rulebook maximum; here simply all eligible).
    for (const die of [...pool]) {
      if (die.type === 'ring' && !die.symbols.explosive && die.bonusFor === undefined) {
        convert(die, 'skill')
      }
    }
  }

  if (disadvantage) {
    // Convert the single worst skill die (lowest face; ties: earliest).
    const skillDice = pool.filter((d) => d.type === 'skill' && d.bonusFor === undefined)
    if (skillDice.length > 0) {
      const worst = skillDice.reduce((w, d) => (d.face < w.face ? d : w))
      convert(worst, 'ring')
    }
  }

  return records
}

/**
 * Select kept dice.
 *
 * @param {object[]} pool - Full pool (base + bonus dice).
 * @param {number} baseCount - Number of base-pool dice (keep selection scope).
 * @param {number} keepCount - Ring rating (dice to keep).
 * @param {object} p - {policy, kept}
 * @returns {number[]} 1-based indices of kept dice.
 */
function selectKept(pool, baseCount, keepCount, { policy = 'success_first', kept }) {
  const base = pool.slice(0, baseCount)

  if (kept !== undefined && kept !== null) {
    const indices = kept.split(',').map((s) => parseInt(s.trim(), 10))
    if (indices.some((i) => !Number.isInteger(i) || i < 1 || i > baseCount)) {
      throw new Error(
        `rollCheck: kept indices must be 1-based indexes into the base pool (1..${baseCount}), got "${kept}"`,
      )
    }
    if (indices.length !== keepCount) {
      throw new Error(
        `rollCheck: kept must keep exactly ${keepCount} dice (ring rating), got ${indices.length}`,
      )
    }
    if (new Set(indices).size !== indices.length) {
      throw new Error(`rollCheck: kept indices must be unique, got "${kept}"`)
    }
    return indices
  }

  // Policy sort. Deterministic tiebreaks: sortKeys chain, then index.
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

  const indexed = base.map((die) => ({ die, index: die.index }))
  indexed.sort((a, b) => {
    for (const key of keys) {
      const ka = key(a.die)
      const kb = key(b.die)
      if (ka !== kb) return ka - kb
    }
    return a.index - b.index
  })

  return indexed.slice(0, keepCount).map((x) => x.die.index + 1) // 1-based
}

/**
 * Roll an L5R 5e check.
 *
 * @param {object} params
 * @param {number} params.ring - Ring rating 1..5 (also the keep count).
 * @param {number} params.skill - Skill rating 0..5. 0 = untrained (ring dice only).
 * @param {(sides: number) => number} params.rng - Injected randomness.
 * @param {number} [params.tn] - Target number (successes needed). When present,
 *   result includes success/failure.
 * @param {boolean} [params.advantage=false] - Convert ring dice to skill dice.
 * @param {boolean} [params.disadvantage=false] - Convert worst skill die to ring.
 * @param {string} [params.conversions] - Explicit conversions "2:skill,4:ring"
 *   (1-based base-pool indices). Overrides advantage/disadvantage defaults.
 * @param {'success_first'|'min_strife'|'max_opportunity'} [params.policy='success_first']
 *   Auto-keep policy (used when `kept` is not provided).
 * @param {string} [params.kept] - Explicit keep override, comma-string of
 *   1-based BASE-pool indices (bonus dice are not selectable).
 * @param {number} [params.composure] - Composure value; when provided, result
 *   includes composureExceeded (strife >= composure). Advisory only.
 * @param {boolean} [params.includeExplosionBonuses=true] - Expand explosive
 *   faces into bonus dice.
 * @param {string} [params.label] - Optional caller label echoed in the result.
 * @returns {object} Full result: pool (with per-die symbols), baseCount,
 *   keepCount, keptIndices, kept[], dropped[], conversions[], tallies,
 *   tn?, success?, composureExceeded?, explosiveTriggers, untrained,
 *   notes[], label?.
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
  policy = 'success_first',
  kept,
  composure,
  includeExplosionBonuses = true,
  label,
}) {
  validate({ ring, skill, tn, policy, advantage, disadvantage, composure })

  const untrained = skill === 0
  const { pool, explosiveTriggers } = buildPool({ ring, skill, rng, includeExplosionBonuses })
  const baseCount = ring + skill

  const conversionRecords = applyConversions(pool, { advantage, disadvantage, conversions, rng })

  // NOTE: conversions happen AFTER explosion expansion. A converted die
  // that was explosive keeps its already-spawned bonus dice (they exist
  // in the pool); the converted die itself now shows new symbols. This
  // ordering keeps pool indices stable for the `kept` override.

  const keptIndices = selectKept(pool, baseCount, ring, { policy, kept })
  const keptSet = new Set(keptIndices)

  const keptDice = pool.filter((d) => keptSet.has(d.index + 1))
  const droppedDice = pool.filter((d) => !keptSet.has(d.index + 1))

  const tallies = sumSymbols(keptDice.map((d) => d.symbols))

  const notes = []
  if (untrained) notes.push('Untrained: ring dice only (no skill dice in the pool).')
  if (explosiveTriggers > 0 && includeExplosionBonuses) {
    notes.push(`${explosiveTriggers} explosive face(s) rolled; bonus dice added.`)
  } else if (explosiveTriggers > 0) {
    notes.push(`${explosiveTriggers} explosive face(s) rolled; bonus dice disabled.`)
  }
  if (conversionRecords.length > 0) {
    notes.push(`${conversionRecords.length} die conversion(s) applied.`)
  }
  notes.push(`Keep policy: ${kept ? 'explicit override' : policy}.`)

  const result = {
    label,
    pool,
    baseCount,
    keepCount: ring,
    keptIndices,
    kept: keptDice,
    dropped: droppedDice,
    conversions: conversionRecords,
    tallies,
    explosiveTriggers,
    untrained,
    policy: kept ? 'override' : policy,
    notes,
  }
  if (tn !== undefined && tn !== null) {
    result.tn = tn
    result.success = tallies.successes >= tn
  }
  if (composure !== undefined && composure !== null) {
    result.composureExceeded = tallies.strife >= composure
  }
  return result
}

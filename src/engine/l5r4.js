/**
 * L5R 4th Edition Roll & Keep engine (AEG).
 *
 * The XkY+Z pool system: roll (Trait + Skill) d10s, keep the highest
 * Trait of them, sum. D10s explode on 10s (trained rolls only).
 *
 * Rules implemented (verified against the 4e core mechanics primer):
 *   - Pool = Trait + Skill, capped at 10 rolled dice (4e pool cap).
 *   - Keep = Trait + keepBonus, clamped to [1, pool].
 *   - Untrained (skill 0): pool = Trait, keep ALL, NO explosions, NO raises.
 *   - Emphasis: reroll initial 1s once, BEFORE explosion checks. Applies
 *     even to untrained rolls (a reroll is not an explosion).
 *   - Raises: each declared raise adds +5 to the effective TN; declared
 *     raises must not exceed the Void Ring (when provided). Free raises
 *     add effect without TN increase and never count against the cap.
 *   - Wound/stance penalty applies ONCE to the final total.
 *   - wouldSucceedWithoutRaises: narration hook — true when the unraised
 *     (and unpenalized) total would have met the base TN but the effective
 *     TN failed. Covers both "failed raises" and "penalty cost me the roll".
 *
 * @module engine/l5r4
 */

import { rollDice } from './core.js'

/** 4e hard cap on rolled dice in a single pool. */
export const L5R4_POOL_CAP = 10

/** Each raise increases the effective TN by this much. */
export const RAISE_TN_STEP = 5

/**
 * Validate rollAndKeep parameters.
 *
 * @param {object} p - See rollAndKeep.
 * @throws {Error} On invalid parameters.
 */
function validate(p) {
  const { trait, skill, raises, freeRaises, voidRing } = p
  if (!Number.isInteger(trait) || trait < 1 || trait > 10) {
    throw new Error(`rollAndKeep: trait must be an integer in 1..10 (got ${trait})`)
  }
  if (!Number.isInteger(skill) || skill < 0 || skill > 10) {
    throw new Error(`rollAndKeep: skill must be an integer in 0..10 (got ${skill})`)
  }
  if (raises !== undefined && raises !== null && (!Number.isInteger(raises) || raises < 0)) {
    throw new Error(`rollAndKeep: raises must be a non-negative integer (got ${raises})`)
  }
  if (
    freeRaises !== undefined &&
    freeRaises !== null &&
    (!Number.isInteger(freeRaises) || freeRaises < 0)
  ) {
    throw new Error(`rollAndKeep: freeRaises must be a non-negative integer (got ${freeRaises})`)
  }
  if (voidRing !== undefined && voidRing !== null) {
    if (!Number.isInteger(voidRing) || voidRing < 1 || voidRing > 10) {
      throw new Error(`rollAndKeep: voidRing must be an integer in 1..10 (got ${voidRing})`)
    }
    if (raises > voidRing) {
      throw new Error(
        `rollAndKeep: ${raises} raises exceed the Void Ring of ${voidRing} — ` +
          `a character may not raise more times than their Void Ring on a single roll`
      )
    }
  }
  if (skill === 0 && raises > 0) {
    throw new Error(
      'rollAndKeep: untrained rolls (skill 0) cannot benefit from Raises — remove raises or train the skill'
    )
  }
}

/**
 * Build the human-readable notes list for a roll.
 *
 * @param {object} parts - Roll context.
 * @returns {string[]} Notes in table-order.
 */
function buildNotes({ untrained, emphasis, explodedCount, rerolledCount, raises, freeRaises }) {
  const notes = []
  if (untrained) {
    notes.push('Untrained: no skill dice, all dice kept, no explosions, no raises.')
  }
  if (emphasis) {
    notes.push(`Emphasis: rerolled ${rerolledCount} initial 1(s) before explosions.`)
  }
  if (explodedCount > 0) {
    notes.push(`${explodedCount} die(s) exploded on 10s.`)
  }
  if (raises > 0 || freeRaises > 0) {
    const parts = []
    if (raises > 0) parts.push(`${raises} declared (+${raises * RAISE_TN_STEP} TN)`)
    if (freeRaises > 0) parts.push(`${freeRaises} free (effect only)`)
    notes.push(`Raises: ${parts.join(', ')}.`)
  }
  return notes
}

/**
 * Roll an L5R 4e Roll & Keep check.
 *
 * @param {object} params
 * @param {number} params.trait - Trait rating 1..10 (also the keep count).
 * @param {number} params.skill - Skill rating 0..10. 0 = untrained.
 * @param {(sides: number) => number} params.rng - Injected randomness.
 * @param {number} [params.tn] - Target number. When present, the result
 *   includes success/failure against the effective TN.
 * @param {number} [params.raises=0] - Declared raises (+5 TN each, capped by voidRing).
 * @param {number} [params.freeRaises=0] - Free raises (effect only, no TN, no cap).
 * @param {number} [params.voidRing] - Void Ring rating; caps declared raises.
 * @param {boolean} [params.emphasis=false] - Skill emphasis applies (reroll 1s once).
 * @param {number} [params.penalty=0] - Wound/stance penalty applied once to the total.
 * @param {number} [params.rollBonus=0] - Extra rolled dice (e.g. Void +1k1).
 * @param {number} [params.keepBonus=0] - Extra kept dice (e.g. Void +1k1).
 * @param {string} [params.label] - Optional caller label echoed in the result.
 * @returns {object} Full roll result: pool, rolled, kept, dropped, keepCount,
 *   totals {keptSum, penalty, total}, tn {base, raises, effective},
 *   raises {declared, free, totalEffects}, success?, wouldSucceedWithoutRaises?,
 *   untrained, notes[], label?.
 * @throws {Error} On invalid parameters or rule violations.
 */
export function rollAndKeep({
  trait,
  skill,
  rng,
  tn,
  raises = 0,
  freeRaises = 0,
  voidRing,
  emphasis = false,
  penalty = 0,
  rollBonus = 0,
  keepBonus = 0,
  label,
}) {
  validate({ trait, skill, raises, freeRaises, voidRing })

  const untrained = skill === 0
  const declaredRaises = untrained ? 0 : raises

  // Pool: trait + skill (+ bonus dice), capped at 10 rolled dice.
  const rawPool = trait + skill + rollBonus
  const pool = Math.min(rawPool, L5R4_POOL_CAP)

  // Keep: trait (+ bonus), clamped to [1, pool].
  const keepCount = Math.max(1, Math.min(trait + keepBonus, pool))

  const rolled = rollDice({
    sides: 10,
    count: pool,
    rng,
    // Explosions only for trained rolls. Untrained d10s never explode.
    explodeOn: untrained ? null : [10],
    // Emphasis rerolls apply in both cases (a reroll is not an explosion).
    rerollBelow: emphasis ? 1 : null,
  })

  // Keep the highest finals (explosion sums included). Ties: earlier roll wins.
  const indexed = rolled.map((die, index) => ({ die, index }))
  indexed.sort((a, b) => (b.die.final !== a.die.final ? b.die.final - a.die.final : a.index - b.index))
  const kept = indexed.slice(0, keepCount).map((x) => x.die)
  const dropped = indexed.slice(keepCount).map((x) => x.die)

  const keptSum = kept.reduce((s, d) => s + d.final, 0)
  const total = keptSum + penalty

  const effectiveTn = tn !== undefined && tn !== null ? tn + declaredRaises * RAISE_TN_STEP : null
  const success = effectiveTn !== null ? total >= effectiveTn : undefined

  // Narration hook: the roll failed the effective TN but the unraised,
  // unpenalized total would have met the BASE TN. Covers failed raises
  // AND "the wound penalty cost me the roll".
  let wouldSucceedWithoutRaises
  if (success === false) {
    const unraisedTotal = keptSum // penalty excluded, raises excluded
    if (unraisedTotal >= tn && (declaredRaises > 0 || penalty < 0)) {
      wouldSucceedWithoutRaises = true
    }
  }

  const explodedCount = rolled.filter((d) => d.chain.length > 0).length
  const rerolledCount = rolled.filter((d) => d.rerolled).length

  const result = {
    label,
    pool,
    rolled,
    kept,
    dropped,
    keepCount,
    untrained,
    totals: { keptSum, penalty, total },
    tn: { base: tn, raises: declaredRaises, effective: effectiveTn },
    raises: { declared: declaredRaises, free: freeRaises, totalEffects: declaredRaises + freeRaises },
    notes: buildNotes({
      untrained,
      emphasis,
      explodedCount,
      rerolledCount,
      raises: declaredRaises,
      freeRaises,
    }),
  }
  if (success !== undefined) result.success = success
  if (wouldSucceedWithoutRaises !== undefined) result.wouldSucceedWithoutRaises = true

  return result
}

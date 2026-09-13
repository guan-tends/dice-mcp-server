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

/** Each excess kept die (Ten Dice Rule) adds this flat bonus to the total. */
export const TEN_DICE_FLAT_BONUS = 2

/**
 * Ten Dice Rule (4e core, Report B §4) — the signature normalization.
 * No roll may exceed 10 rolled or 10 kept dice. Excess converts, in order:
 *   1. KEPT CAP: kept > 10 → kept = 10; each excess KEPT die +2 flat.
 *   2. ROLLED CAP: rolled > 10 → rolled = 10; excess = raw rolled − 10.
 *   3. CONVERSION: 2 excess rolled : 1 extra kept, ONLY while kept < 10.
 *   4. LEFTOVER: every unconverted excess rolled die +2 flat.
 *
 * @param {number} rawRolled
 * @param {number} rawKept
 * @returns {{rolled: number, kept: number, overflowBonus: number,
 *   preCap: {rolled: number, kept: number}}}
 */
export function applyTenDiceRule(rawRolled, rawKept) {
  const preCap = { rolled: rawRolled, kept: rawKept }
  let overflowBonus = 0

  // 1. KEPT CAP
  let kept = rawKept
  if (kept > L5R4_POOL_CAP) {
    overflowBonus += (kept - L5R4_POOL_CAP) * TEN_DICE_FLAT_BONUS
    kept = L5R4_POOL_CAP
  }

  // 2. ROLLED CAP
  let rolled = rawRolled
  let excessRolled = 0
  if (rolled > L5R4_POOL_CAP) {
    excessRolled = rolled - L5R4_POOL_CAP
    rolled = L5R4_POOL_CAP
  }

  // 3. CONVERSION — 2 excess rolled → 1 kept, only while kept < 10.
  while (excessRolled >= 2 && kept < L5R4_POOL_CAP) {
    excessRolled -= 2
    kept += 1
  }

  // 4. LEFTOVER — unconvertible excess rolled dice flat +2 each.
  overflowBonus += excessRolled * TEN_DICE_FLAT_BONUS

  return { rolled, kept, overflowBonus, preCap }
}

/**
 * Validate rollAndKeep parameters.
 *
 * @param {object} p - See rollAndKeep.
 * @throws {Error} On invalid parameters.
 */
const ROLL_TYPES = ['skill', 'trait', 'ring', 'unskilled', 'custom']

function validate(p) {
  const { trait, skill, raises, freeRaises, voidRing, rolled, kept, rollType, keepMode } = p
  const hasDirectPool = rolled !== undefined && rolled !== null
  if (!hasDirectPool) {
    if (!Number.isInteger(trait) || trait < 1 || trait > 10) {
      throw new Error(`rollAndKeep: trait must be an integer in 1..10 (got ${trait})`)
    }
    if (!Number.isInteger(skill) || skill < 0 || skill > 10) {
      throw new Error(`rollAndKeep: skill must be an integer in 0..10 (got ${skill})`)
    }
  } else {
    if (!Number.isInteger(rolled) || rolled < 1 || rolled > 50) {
      throw new Error(`rollAndKeep: rolled must be an integer in 1..50 (got ${rolled})`)
    }
    if (kept !== undefined && kept !== null && (!Number.isInteger(kept) || kept < 1 || kept > 50)) {
      throw new Error(`rollAndKeep: kept must be an integer in 1..50 (got ${kept})`)
    }
  }
  if (rollType !== undefined && rollType !== null && !ROLL_TYPES.includes(rollType)) {
    throw new Error(`rollAndKeep: rollType must be one of ${ROLL_TYPES.join(', ')} (got ${rollType})`)
  }
  if (keepMode !== undefined && keepMode !== null && !['highest', 'lowest'].includes(keepMode)) {
    throw new Error(`rollAndKeep: keepMode must be 'highest' or 'lowest' (got ${keepMode})`)
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
          `a character may not raise more times than their Void Ring on a single roll`,
      )
    }
  }
  const unskilled =
    p.rollType === 'unskilled' ||
    (p.rollType === undefined && p.untrained === undefined && p.skill === 0 && !hasDirectPool)
  if (unskilled && raises > 0) {
    throw new Error(
      'rollAndKeep: untrained rolls cannot benefit from Raises — remove raises or train the skill',
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
  rolled: directRolled,
  kept: directKept,
  rollType,
  untrained: untrainedFlag,
  keepMode = 'highest',
  totalBonus = 0,
  explodeOn: explodeOnParam,
  voidPoint = false,
}) {
  validate({ trait, skill, raises, freeRaises, voidRing, rolled: directRolled, kept: directKept, rollType, keepMode, untrained: untrainedFlag })

  // Roll classification (D3): explicit rollType wins; then explicit
  // untrained flag; then back-compat inference (skill 0 = unskilled).
  const hasDirectPool = directRolled !== undefined && directRolled !== null
  const isUnskilled =
    rollType === 'unskilled' ||
    (rollType === undefined &&
      untrainedFlag === undefined &&
      !hasDirectPool &&
      skill === 0)
  const untrained = isUnskilled
  const declaredRaises = untrained ? 0 : raises
  const appliedEmphasis = emphasis && !untrained

  // Raw pools BEFORE the Ten Dice Rule (audit-visible). Direct pool
  // input (D2: initiative 1k4, damage 6k2, Honor 6k6) overrides
  // trait/skill. voidPoint = +1k1 (D6). Negative bonuses legal (D5).
  const voidDice = voidPoint ? 1 : 0
  let rawRolled
  let rawKept
  if (hasDirectPool) {
    rawRolled = directRolled + rollBonus + voidDice
    rawKept = (directKept !== undefined && directKept !== null ? directKept : directRolled) + keepBonus + voidDice
  } else {
    rawRolled = trait + skill + rollBonus + voidDice
    rawKept = trait + keepBonus + voidDice
  }
  // D5 clamp (§10): a DICE PENALTY (negative bonus) subtracts rolled dice
  // and clamps kept <= rolled. Base pools are NOT clamped — initiative
  // 1k4 (Insight rolled / Reflexes kept) is legal as declared.
  if (rollBonus < 0 || keepBonus < 0) {
    rawKept = Math.min(rawKept, rawRolled)
  }
  rawRolled = Math.max(1, rawRolled)
  rawKept = Math.max(1, rawKept)

  // Ten Dice Rule normalization (kept-cap → rolled-cap → 2:1 → leftover).
  const normalized = applyTenDiceRule(rawRolled, rawKept)
  const pool = normalized.rolled
  const keepCount = Math.max(1, normalized.kept)
  const overflowBonus = normalized.overflowBonus

  // Explosion policy (§3): default 10; caller may widen (mastery 9),
  // list faces, or disable ('none'). Untrained d10s never explode (§9).
  let explodeFaces
  if (untrained) {
    explodeFaces = null
  } else if (explodeOnParam === 'none' || (Array.isArray(explodeOnParam) && explodeOnParam.length === 0)) {
    explodeFaces = null
  } else if (explodeOnParam === undefined || explodeOnParam === null) {
    explodeFaces = [10]
  } else {
    explodeFaces = Array.isArray(explodeOnParam) ? explodeOnParam : [explodeOnParam]
  }

  const rolled = rollDice({
    sides: 10,
    count: pool,
    rng,
    explodeOn: explodeFaces,
    // Emphasis rerolls 1s once, BEFORE explosion checks — trained only (D7/§8).
    rerollBelow: appliedEmphasis ? 1 : null,
  })

  // Keep selection (D8/§1): highest by default; lowest = deliberate failure.
  const indexed = rolled.map((die, index) => ({ die, index }))
  const descending = keepMode !== 'lowest'
  indexed.sort((a, b) => {
    if (b.die.final !== a.die.final) return descending ? b.die.final - a.die.final : a.die.final - b.die.final
    return a.index - b.index
  })
  const kept = indexed.slice(0, keepCount).map((x) => x.die)
  const dropped = indexed.slice(keepCount).map((x) => x.die)

  const keptSum = kept.reduce((s, d) => s + d.final, 0)
  // §10/D4: the wound penalty raises the EFFECTIVE TN — it never touches
  // the total. Reported in totals for the audit trail, not summed.
  const total = keptSum + overflowBonus + totalBonus

  const effectiveTn =
    tn !== undefined && tn !== null ? tn + declaredRaises * RAISE_TN_STEP + penalty : null
  const success = effectiveTn !== null ? total >= effectiveTn : undefined

  // Narration hook: the roll failed the effective TN but the unraised,
  // unpenalized total would have met the BASE TN. Covers failed raises
  // AND "the wound penalty cost me the roll".
  let wouldSucceedWithoutRaises
  if (success === false) {
    const unraisedTotal = keptSum + overflowBonus + totalBonus
    if (unraisedTotal >= tn && (declaredRaises > 0 || penalty > 0)) {
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
    overflowBonus,
    preCapPool: normalized.preCap,
    rollType: rollType || (untrained ? 'unskilled' : 'skill'),
    keepMode,
    totals: { keptSum, overflowBonus, totalBonus, penalty, total },
    tn: { base: tn, raises: declaredRaises, effective: effectiveTn },
    raises: {
      declared: declaredRaises,
      free: freeRaises,
      totalEffects: declaredRaises + freeRaises,
    },
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

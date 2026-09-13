/**
 * Core die-rolling engine.
 *
 * The single rolling primitive every system engine builds on. Handles:
 *   - plain NdM rolls,
 *   - explosion on one or more threshold faces (4e d10s explode on 10;
 *     5e d12s explode on BOTH 11 and 12),
 *   - reroll of low initial faces, once (4e skill emphasis = reroll 1s =
 *     rerollBelow 1; notation r<n> maps directly) with the correct ordering:
 *     reroll initial faces ONCE, BEFORE any explosion check. Chain rolls from
 *     explosions are never re-rerolled.
 *
 * Randomness is injected (`rng(sides) => int in [1, sides]`) so every roll
 * is deterministic under a sequence RNG.
 *
 * @module engine/core
 */

/** Hard ceiling on dice per roll — guards against pathological tool input. */
export const MAX_DICE_PER_ROLL = 500

/** Hard ceiling on explosion chain length per die — unbounded recursion is a design smell. */
export const MAX_CHAIN_LENGTH = 100

/**
 * Validate rollDice parameters.
 *
 * @param {object} params - See rollDice.
 * @throws {Error} On any invalid parameter.
 */
function validateParams({ sides, count, explodeOn, rerollBelow }) {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error(`rollDice: sides must be an integer >= 2 (got ${sides})`)
  }
  if (!Number.isInteger(count) || count < 0 || count > MAX_DICE_PER_ROLL) {
    throw new Error(
      `rollDice: count must be an integer between 0 and ${MAX_DICE_PER_ROLL} (got ${count})`
    )
  }
  if (rerollBelow !== undefined && rerollBelow !== null) {
    if (!Number.isInteger(rerollBelow) || rerollBelow < 1 || rerollBelow >= sides) {
      throw new Error(
        `rollDice: rerollBelow must be an integer in [1, ${sides - 1}] (got ${rerollBelow})`
      )
    }
  }
  if (explodeOn !== undefined && explodeOn !== null) {
    if (
      !Array.isArray(explodeOn) ||
      explodeOn.length === 0 ||
      !explodeOn.every((f) => Number.isInteger(f) && f >= 1 && f <= sides)
    ) {
      throw new Error(
        `rollDice: explodeOn must be a non-empty array of integers in [1, ${sides}] (got ${JSON.stringify(explodeOn)})`
      )
    }
  }
}

/**
 * Roll a single die, applying emphasis reroll then explosion chain.
 *
 * @param {number} sides - Die size.
 * @param {(sides: number) => number} rng - Injected randomness.
 * @param {object} opts
 * @param {number[]|null} opts.explodeOn - Faces that trigger explosion, or null.
 * @param {boolean} opts.emphasis - Reroll initial 1s once.
 * @returns {{face: number, chain: number[], final: number, rerolled: boolean}}
 *   face = the die's current showing value (after any reroll);
 *   chain = explosion ledger (all faces summed, present only when the die
 *   exploded); final = the die's total contribution; rerolled = true
 *   when the initial face triggered a reroll.
 */
function rollOne(sides, rng, { explodeOn, rerollBelow }) {
  let face = rng(sides)
  let rerolled = false

  // Reroll ordering (4e emphasis): reroll low initial faces ONCE, BEFORE
  // explosion checks. Chain rolls are never re-rerolled.
  if (rerollBelow !== null && rerollBelow !== undefined && face <= rerollBelow) {
    face = rng(sides)
    rerolled = true
  }

  const explodes = explodeOn !== null && explodeOn !== undefined && explodeOn.includes(face)
  if (!explodes) {
    return { face, chain: [], final: face, rerolled }
  }

  // Explosion: reroll and sum while any threshold face keeps appearing.
  const ledger = [face]
  let total = face
  while (ledger.length < MAX_CHAIN_LENGTH) {
    const next = rng(sides)
    ledger.push(next)
    total += next
    if (!explodeOn.includes(next)) break
  }
  return { face, chain: ledger, final: total, rerolled }
}

/**
 * Roll a pool of dice.
 *
 * @param {object} params
 * @param {number} params.sides - Die size (>= 2).
 * @param {number} params.count - Number of dice (0..500).
 * @param {(sides: number) => number} params.rng - Injected randomness.
 * @param {number[]} [params.explodeOn] - Faces that trigger an explosion
 *   reroll-and-sum (e.g. [10] for 4e d10s, [11, 12] for 5e d12s). Faces
 *   must be within [1, sides]. Default: no explosion.
 * @param {number|null} [params.rerollBelow] - Reroll initial faces <= this
 *   value, once, before explosion checks (1 = the L5R 4e emphasis shape).
 *   Must be in [1, sides-1]. Default: no reroll.
 * @returns {Array<{face: number, chain: number[], final: number, rerolled: boolean}>}
 *   One result object per die, in roll order.
 * @throws {Error} On invalid parameters.
 */
export function rollDice({ sides, count, rng, explodeOn = null, rerollBelow = null }) {
  validateParams({ sides, count, explodeOn, rerollBelow })
  const dice = []
  for (let i = 0; i < count; i++) {
    dice.push(rollOne(sides, rng, { explodeOn, rerollBelow }))
  }
  return dice
}

/**
 * RNG module — die-face randomness with injected implementations.
 *
 * Every engine function receives its randomness via an injected `rng`
 * function with the contract: rng(sides) => integer in [1, sides] inclusive.
 *
 * Two implementations:
 *   - createCryptoRng():  production. Unbiased CSPRNG (crypto.randomInt).
 *   - createSequenceRng(): test helper. Replays a fixed sequence, making
 *     every engine test deterministic and explodable chains reproducible.
 *
 * @module engine/rng
 */

import { randomInt } from 'node:crypto'

/**
 * Validate a queued die value against the die range.
 *
 * @param {number} value - Queued face value.
 * @param {number} index - Position in the queue (for error messages).
 * @param {number|null} declaredSides - Fixed sides expectation, if provided.
 * @throws {Error} If the value is not an integer in [1, sides].
 */
function validateQueuedValue(value, index, declaredSides) {
  const upper = declaredSides ?? Number.MAX_SAFE_INTEGER
  if (!Number.isInteger(value) || value < 1 || value > upper) {
    const range = declaredSides ? `1..${declaredSides}` : 'positive integers'
    throw new Error(
      `createSequenceRng: queued value ${value} at position ${index} is out of range (${range})`
    )
  }
}

/**
 * Create a deterministic sequence-backed RNG for tests.
 *
 * Each call consumes the next queued value. The sequence is validated at
 * construction time so a bad queue fails fast instead of corrupting an
 * engine test downstream.
 *
 * @param {number[]} values - Die faces to yield, in order.
 * @param {number|null} [sides=null] - Optional fixed sides expectation;
 *   when set, all queued values must be within [1, sides].
 * @returns {(sides: number) => number} RNG function per the module contract.
 */
export function createSequenceRng(values, sides = null) {
  values.forEach((v, i) => validateQueuedValue(v, i, sides))
  let position = 0

  return (rollSides) => {
    if (position >= values.length) {
      throw new Error(
        `createSequenceRng: sequence exhausted at position ${position} ` +
          `(queued ${values.length} values; call rng(${rollSides}) requested more)`
      )
    }
    const value = values[position++]
    if (value > rollSides) {
      throw new Error(
        `createSequenceRng: queued value ${value} at position ${position - 1} exceeds ` +
          `die size ${rollSides} for this call (fixture bug — check explosion/consumption order)`
      )
    }
    return value
  }
}

/**
 * Create the production CSPRNG-backed RNG.
 *
 * Uses crypto.randomInt, which is uniform over [min, max) — hence the +1
 * on the exclusive upper bound. Unbiased: no modulo bias by construction.
 *
 * @returns {(sides: number) => number} RNG function per the module contract.
 */
export function createCryptoRng() {
  return (sides) => randomInt(1, sides + 1)
}

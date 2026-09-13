/**
 * Dice expression notation parser.
 *
 * Parses tabletop dice notation into an AST for the d20 evaluator:
 *
 *   2d6+3          two d6, plus 3
 *   d20            one d20 (count 1 implied)
 *   4d6kh3         keep highest 3 of 4d6 (ability scores)
 *   2d20kl1        keep lowest 1 (disadvantage)
 *   1d10!          explode on max face
 *   1d12!11,12     explode on faces 11 and 12 (L5R 5e skill die)
 *   3d6r1          reroll initial 1s once (emphasis-shaped)
 *   2d6+1d4+2      multi-term
 *
 * Errors are position-aware so an LLM caller can locate its own syntax
 * mistakes. The parser validates structural rules (keep <= count, explode
 * faces within die range) so the evaluator can trust the AST.
 *
 * @module engine/notation
 */

import { MAX_DICE_PER_ROLL } from './core.js'

/** Maximum absolute value accepted for the additive constant. */
export const MAX_CONSTANT = 1000000

/**
 * A parsed die term.
 *
 * @typedef {object} DiceTerm
 * @property {number} count - Number of dice (>= 1).
 * @property {number} sides - Die size (>= 2).
 * @property {{mode: 'highest'|'lowest', n: number}|null} keep - Keep selection, or null.
 * @property {number[]|null} explodeOn - Faces triggering explosion, or null.
 * @property {number|null} rerollBelow - Reroll initial faces below this value once, or null.
 */

/**
 * A parsed expression.
 *
 * @typedef {object} DiceAST
 * @property {DiceTerm[]} terms - Die terms, in order.
 * @property {number} constant - Additive constant (may be negative).
 * @property {string} raw - The original expression string.
 */

/**
 * A syntax error with position information.
 */
class DiceSyntaxError extends Error {
  /**
   * @param {string} message - Human-readable explanation.
   * @param {number} position - 0-based character offset in the raw expression.
   */
  constructor(message, position) {
    super(`${message} (at position ${position})`)
    this.name = 'DiceSyntaxError'
    this.position = position
  }
}

/**
 * Strip whitespace and normalize to lowercase for case-insensitive parsing.
 *
 * @param {string} expression - Raw user input.
 * @returns {string} Normalized text.
 */
function normalize(expression) {
  return expression.replace(/\s+/g, '').toLowerCase()
}

/**
 * Parse one die term (NdM with optional keep/explode/reroll modifiers).
 *
 * @param {string} text - Normalized term text (no sign).
 * @param {number} offset - Offset of this term in the normalized string (for errors).
 * @returns {DiceTerm}
 * @throws {DiceSyntaxError} On malformed terms or invalid modifier values.
 */
function parseTerm(text, offset) {
  // Shape: [count]d<sides>[kh[n]|kl[n]][! | !<faces>][r<n>]
  // Bare ! = explode on max face; !11,12 = explode on listed faces.
  const match = text.match(/^(\d*)d(\d+)(?:(kh|kl)(\d*))?(?:!([\d,]*))?(?:r(\d+))?$/)
  if (!match) {
    // Point the error at where the recognizable prefix ends, so the caller
    // can see which trailing fragment broke the term (e.g. "2d6d8" -> pos 3).
    const prefix = text.match(/^(\d*)d(\d+)/)
    const failAt = prefix ? offset + prefix[0].length : offset
    throw new DiceSyntaxError(`invalid die term "${text}"`, failAt)
  }

  const countStr = match[1]
  const sidesStr = match[2]
  const keepMode = match[3]
  const keepN = match[4]
  const explodeFaces = match[5]
  const rerollBelow = match[6]

  const count = countStr === '' ? 1 : parseInt(countStr, 10)
  const sides = parseInt(sidesStr, 10)

  if (count < 1 || count > MAX_DICE_PER_ROLL) {
    throw new DiceSyntaxError(
      `die count must be between 1 and ${MAX_DICE_PER_ROLL}, got ${count} (too many dice)`,
      offset,
    )
  }
  if (sides < 2) {
    throw new DiceSyntaxError(`die must have at least 2 sides, got d${sides}`, offset)
  }

  let keep = null
  if (keepMode) {
    const n = keepN === '' || keepN === undefined ? 1 : parseInt(keepN, 10)
    if (n < 1 || n > count) {
      throw new DiceSyntaxError(
        `cannot keep ${n} of ${count} dice — keep must be between 1 and the die count`,
        offset,
      )
    }
    keep = { mode: keepMode === 'kh' ? 'highest' : 'lowest', n }
  }

  let explodeOn = null
  if (explodeFaces !== undefined) {
    if (explodeFaces === '') {
      // Bare ! = explode on the maximum face.
      explodeOn = [sides]
    } else {
      const faces = explodeFaces.split(',').map((f) => parseInt(f, 10))
      if (faces.some((f) => f < 1 || f > sides)) {
        throw new DiceSyntaxError(
          `explode faces must be within [1, ${sides}], got [${faces.join(', ')}]`,
          offset,
        )
      }
      explodeOn = faces
    }
  }

  let reroll = null
  if (rerollBelow !== undefined) {
    const n = parseInt(rerollBelow, 10)
    if (n < 1 || n >= sides) {
      throw new DiceSyntaxError(
        `reroll threshold must be below the die max (1..${sides - 1}), got ${n}`,
        offset,
      )
    }
    reroll = n
  }

  return { count, sides, keep, explodeOn, rerollBelow: reroll }
}

/**
 * Parse a dice expression into an AST.
 *
 * @param {string} expression - The raw expression (whitespace tolerated, case-insensitive).
 * @returns {DiceAST} Parsed AST with terms, constant, and the raw input.
 * @throws {DiceSyntaxError} On empty input, malformed terms, or invalid values.
 */
export function parseExpression(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new DiceSyntaxError('expression is empty', 0)
  }

  const raw = expression
  const text = normalize(expression)

  if (text === '') {
    throw new DiceSyntaxError('expression is empty', 0)
  }

  const terms = []
  let constant = 0

  // Positional walk: at each step, optionally consume ONE sign character,
  // then consume the sign-free body. Contiguity is structural — no input
  // characters can be silently skipped (a doubled sign like "2d6--3"
  // leaves a body starting with a sign, which fails the body match).
  const SEGMENT_RE = /^([+-]?)([^+-]+)(.*)$/
  let rest = text
  let offset = 0
  let seenSegment = false

  while (rest !== '') {
    const m = rest.match(SEGMENT_RE)
    if (!m) {
      // SEGMENT_RE only fails when the next char is a second sign
      // operator (doubled signs like "2d6--3") — name that case.
      if (rest[0] === '+' || rest[0] === '-') {
        throw new DiceSyntaxError(
          `doubled sign operator "${rest[0]}" — combine into a single constant ` +
            `(e.g. "2d6-3" not "2d6--3")`,
          offset,
        )
      }
      throw new DiceSyntaxError(`unexpected character "${rest[0]}"`, offset)
    }

    const [, signChar, body, remainder] = m
    const segOffset = offset
    const bodyOffset = offset + signChar.length
    offset += signChar.length + body.length
    rest = remainder

    const sign = signChar === '-' ? -1 : 1

    if (/^\d+$/.test(body)) {
      // Bare constant.
      const value = parseInt(body, 10) * sign
      if (Math.abs(value) > MAX_CONSTANT) {
        throw new DiceSyntaxError(
          `constant magnitude must be <= ${MAX_CONSTANT}, got ${Math.abs(value)}`,
          bodyOffset,
        )
      }
      constant += value
    } else if (body.includes('d')) {
      // Die term. A negative sign on a die term is meaningless (dice can't
      // subtract) and usually a caller error — reject with position.
      if (sign === -1) {
        throw new DiceSyntaxError(
          `negative die counts are not supported — die terms cannot be subtracted; ` +
            `move the sign onto a constant (e.g. "1d20-2")`,
          bodyOffset,
        )
      }
      if (seenSegment && signChar === '') {
        throw new DiceSyntaxError(
          `missing sign between terms — use + or - (e.g. "2d6+1d4")`,
          bodyOffset,
        )
      }
      terms.push(parseTerm(body, segOffset))
    } else {
      throw new DiceSyntaxError(`unexpected token "${body}"`, bodyOffset)
    }

    seenSegment = true
  }

  return { terms, constant, raw }
}

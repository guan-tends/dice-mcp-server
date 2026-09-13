/**
 * d20-family expression evaluator.
 *
 * Walks a parsed AST (see engine/notation) and produces a full result:
 * per-term rolls, keep selection, subtotals, the grand total, and an
 * optional DC verdict. Pure math on the injected rng — deterministic
 * under a sequence RNG.
 *
 * @module engine/d20
 */

import { parseExpression } from './notation.js'
import { rollDice } from './core.js'

/**
 * Select kept/dropped dice for one term.
 *
 * Kept dice are presented in selection order — best first for
 * keep-highest, worst first for keep-lowest (ties: earlier roll wins,
 * stable and deterministic). Dropped dice keep roll order. Kept dice
 * preserve their explosion chains via `final`.
 *
 * @param {Array<{face: number, chain: number[], final: number, rerolled: boolean}>} rolls
 * @param {{mode: 'highest'|'lowest', n: number}|null} keep
 * @returns {{kept: object[], dropped: object[], subtotal: number}}
 */
function selectKept(rolls, keep) {
  if (!keep) {
    return { kept: rolls, dropped: [], subtotal: rolls.reduce((s, d) => s + d.final, 0) }
  }

  const indexed = rolls.map((die, index) => ({ die, index }))
  // Stable sort by final; ties keep roll order (index ascending).
  const sorted = indexed.sort((a, b) => {
    if (b.die.final !== a.die.final) {
      return keep.mode === 'highest' ? b.die.final - a.die.final : a.die.final - b.die.final
    }
    return a.index - b.index
  })

  const keptIndexed = sorted.slice(0, keep.n)
  const droppedIndexed = sorted.slice(keep.n)

  // Present kept dice in selection order (best first for kh, worst first
  // for kl) — the readable contract for a dice result. Dropped keep roll
  // order (they were never selected).
  const kept = keptIndexed.map((x) => x.die)
  const byIndex = (a, b) => a.index - b.index
  const dropped = droppedIndexed.sort(byIndex).map((x) => x.die)
  const subtotal = kept.reduce((s, d) => s + d.final, 0)

  return { kept, dropped, subtotal }
}

/**
 * Render the canonical notation string for a term (for echoing back).
 *
 * @param {import('./notation.js').DiceTerm} term - Parsed term.
 * @returns {string} e.g. "4d6kh3", "2d20kl1", "1d10!", "1d12!11,12", "3d6r1".
 */
function renderNotation(term) {
  let text = `${term.count === 1 ? '' : term.count}d${term.sides}`
  if (term.keep) text += `${term.keep.mode === 'highest' ? 'kh' : 'kl'}${term.keep.n}`
  if (term.explodeOn) {
    text += term.explodeOn.length === 1 && term.explodeOn[0] === term.sides
      ? '!'
      : `!${term.explodeOn.join(',')}`
  }
  if (term.rerollBelow !== null && term.rerollBelow !== undefined) text += `r${term.rerollBelow}`
  return text
}

/**
 * Evaluate a dice expression.
 *
 * @param {string} expression - Dice notation (see engine/notation).
 * @param {object} opts
 * @param {(sides: number) => number} opts.rng - Injected randomness (required).
 * @param {number} [opts.dc] - Target number; when present, the result
 *   includes `dc` and a boolean `success` (total >= dc).
 * @returns {{expression: string, terms: Array<object>, total: number, dc?: number, success?: boolean}}
 *   terms[] = {notation, sides, count, keep, rolls, kept, dropped, subtotal}.
 * @throws {DiceSyntaxError} On parse errors (position-aware).
 * @throws {Error} When rng is missing, or the rng queue under-runs.
 */
export function evaluateExpression(expression, { rng, dc }) {
  if (typeof rng !== 'function') {
    throw new Error('evaluateExpression: an rng function is required')
  }

  const ast = parseExpression(expression)

  const terms = ast.terms.map((term) => {
    const rolls = rollDice({
      sides: term.sides,
      count: term.count,
      rng,
      explodeOn: term.explodeOn,
      rerollBelow: term.rerollBelow,
    })
    const { kept, dropped, subtotal } = selectKept(rolls, term.keep)
    return {
      notation: renderNotation(term),
      sides: term.sides,
      count: term.count,
      keep: term.keep,
      rolls,
      kept,
      dropped,
      subtotal,
    }
  })

  const total = terms.reduce((s, t) => s + t.subtotal, 0) + ast.constant

  const result = { expression: ast.raw, terms, total }
  if (dc !== undefined && dc !== null) {
    result.dc = dc
    result.success = total >= dc
  }
  return result
}

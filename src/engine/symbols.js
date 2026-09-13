/**
 * L5R 5e (FFG) symbol dice — data tables.
 *
 * Ring dice are d6, skill dice are d12. Each face maps to a symbol set:
 * successes, opportunities, strife, and whether the face is EXPLOSIVE.
 *
 * Tables are DATA, not code — adding Genesys/Star Wars dice later means
 * adding a table entry, not rewriting an engine (design decision D4).
 *
 * Sources: face charts verified against two independent 5e references
 * (RPoL rules guide + dsouza.uk opportunities tables), cross-checked for
 * the distinctive details: ring 6 = success+strife+explosive; skill 11 =
 * success+strife+explosive; skill 12 = explosive with NO strife.
 *
 * @module engine/symbols
 */

/**
 * A symbol set carried by one die face.
 *
 * @typedef {object} SymbolSet
 * @property {number} successes - Success symbols on the face.
 * @property {number} opportunities - Opportunity symbols on the face.
 * @property {number} strife - Strife symbols on the face.
 * @property {boolean} explosive - True when the face triggers an explosion.
 */

/** The zero symbol set. */
export const EMPTY_SYMBOLS = Object.freeze({
  successes: 0,
  opportunities: 0,
  strife: 0,
  explosive: false,
})

/**
 * Ring die (d6) face table. Faces 1-6.
 *
 * 1 blank · 2 strife+opportunity · 3 opportunity · 4 strife+success ·
 * 5 success · 6 strife+success+explosive
 *
 * @type {Record<number, SymbolSet>}
 */
export const RING_D6 = Object.freeze({
  1: EMPTY_SYMBOLS,
  2: { successes: 0, opportunities: 1, strife: 1, explosive: false },
  3: { successes: 0, opportunities: 1, strife: 0, explosive: false },
  4: { successes: 1, opportunities: 0, strife: 1, explosive: false },
  5: { successes: 1, opportunities: 0, strife: 0, explosive: false },
  6: { successes: 1, opportunities: 0, strife: 1, explosive: true },
})

/**
 * Skill die (d12) face table. Faces 1-12.
 *
 * 1-2 blank · 3-5 opportunity · 6-7 success+strife · 8-9 success ·
 * 10 success+opportunity · 11 success+strife+explosive ·
 * 12 explosive (NO strife — the "pure fortune" face)
 *
 * @type {Record<number, SymbolSet>}
 */
export const SKILL_D12 = Object.freeze({
  1: EMPTY_SYMBOLS,
  2: EMPTY_SYMBOLS,
  3: { successes: 0, opportunities: 1, strife: 0, explosive: false },
  4: { successes: 0, opportunities: 1, strife: 0, explosive: false },
  5: { successes: 0, opportunities: 1, strife: 0, explosive: false },
  6: { successes: 1, opportunities: 0, strife: 1, explosive: false },
  7: { successes: 1, opportunities: 0, strife: 1, explosive: false },
  8: { successes: 1, opportunities: 0, strife: 0, explosive: false },
  9: { successes: 1, opportunities: 0, strife: 0, explosive: false },
  10: { successes: 1, opportunities: 1, strife: 0, explosive: false },
  11: { successes: 1, opportunities: 0, strife: 1, explosive: true },
  12: { successes: 0, opportunities: 0, strife: 0, explosive: true },
})

/** Registry of die types by name. */
const TABLES = Object.freeze({ ring: RING_D6, skill: SKILL_D12 })

/**
 * Resolve one die face to its symbol set.
 *
 * @param {'ring'|'skill'} type - Die type.
 * @param {number} face - The face value.
 * @returns {SymbolSet} The face's symbols (a fresh object — safe to mutate).
 * @throws {Error} On unknown die type or out-of-range face.
 */
export function resolveDie(type, face) {
  const table = TABLES[type]
  if (!table) {
    throw new Error(`resolveDie: unknown die type "${type}" (expected ring or skill)`)
  }
  const symbols = table[face]
  if (!symbols) {
    throw new Error(`resolveDie: face ${face} out of range for ${type} die`)
  }
  return { ...symbols }
}

/**
 * Sum an array of symbol sets.
 *
 * The `explosive` field counts EXPLOSIVE FACES (number), distinct from the
 * boolean-per-die representation in the tables — tallies answer "how many
 * explosive triggers appeared".
 *
 * @param {SymbolSet[]} sets - Symbol sets to sum.
 * @returns {{successes: number, opportunities: number, strife: number, explosive: number}}
 */
export function sumSymbols(sets) {
  return sets.reduce(
    (acc, s) => ({
      successes: acc.successes + s.successes,
      opportunities: acc.opportunities + s.opportunities,
      strife: acc.strife + s.strife,
      explosive: acc.explosive + (s.explosive ? 1 : 0),
    }),
    { successes: 0, opportunities: 0, strife: 0, explosive: 0 },
  )
}

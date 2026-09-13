import { describe, it, expect } from 'vitest'
import { evaluateExpression } from '../../src/engine/d20.js'
import { createSequenceRng } from '../../src/engine/rng.js'

describe('evaluateExpression - totals', () => {
  it('sums a plain NdM plus constant', () => {
    const rng = createSequenceRng([3, 5])
    const r = evaluateExpression('2d6+3', { rng })
    expect(r.total).toBe(11)
  })

  it('applies negative constants', () => {
    const rng = createSequenceRng([20])
    expect(evaluateExpression('1d20-2', { rng }).total).toBe(18)
  })

  it('evaluates bare constants with no dice', () => {
    const rng = createSequenceRng([])
    const r = evaluateExpression('5', { rng })
    expect(r.total).toBe(5)
    expect(r.terms).toEqual([])
  })

  it('evaluates multi-term expressions term by term', () => {
    const rng = createSequenceRng([2, 3, 4])
    const r = evaluateExpression('2d6+1d4+1', { rng })
    expect(r.terms).toHaveLength(2)
    expect(r.terms[0].subtotal).toBe(5)
    expect(r.terms[1].subtotal).toBe(4)
    expect(r.total).toBe(10)
  })
})

describe('evaluateExpression - keep selection', () => {
  it('keep-highest selects the top N finals and drops the rest', () => {
    const rng = createSequenceRng([2, 6, 4, 5])
    const r = evaluateExpression('4d6kh3', { rng })
    const term = r.terms[0]
    expect(term.rolls.map((d) => d.face)).toEqual([2, 6, 4, 5])
    expect(term.kept.map((d) => d.face)).toEqual([6, 5, 4])
    expect(term.dropped.map((d) => d.face)).toEqual([2])
    expect(term.subtotal).toBe(15)
  })

  it('keep-lowest selects the bottom N (disadvantage)', () => {
    const rng = createSequenceRng([18, 7])
    const r = evaluateExpression('2d20kl1', { rng })
    expect(r.terms[0].kept.map((d) => d.face)).toEqual([7])
    expect(r.terms[0].dropped.map((d) => d.face)).toEqual([18])
    expect(r.total).toBe(7)
  })

  it('kept dice retain explosion chains in their final', () => {
    const rng = createSequenceRng([10, 10, 4, 3])
    const r = evaluateExpression('2d10!', { rng })
    expect(r.terms[0].rolls[0].final).toBe(24)
    expect(r.terms[0].kept.map((d) => d.final)).toEqual([24, 3])
    expect(r.total).toBe(27)
  })
})

describe('evaluateExpression - explosion and reroll via notation', () => {
  it('bare ! explodes on max', () => {
    const rng = createSequenceRng([10, 10, 4])
    const r = evaluateExpression('1d10!', { rng })
    expect(r.terms[0].rolls[0].chain).toEqual([10, 10, 4])
    expect(r.total).toBe(24)
  })

  it('r1 rerolls initial 1s once (emphasis shape)', () => {
    const rng = createSequenceRng([1, 5])
    const r = evaluateExpression('1d10r1', { rng })
    expect(r.terms[0].rolls[0].face).toBe(5)
    expect(r.terms[0].rolls[0].rerolled).toBe(true)
    expect(r.total).toBe(5)
  })
})

describe('evaluateExpression - DC', () => {
  it('reports success when total >= dc', () => {
    const rng = createSequenceRng([15])
    const r = evaluateExpression('1d20', { rng, dc: 15 })
    expect(r.dc).toBe(15)
    expect(r.success).toBe(true)
  })

  it('reports failure when total < dc', () => {
    const rng = createSequenceRng([14])
    expect(evaluateExpression('1d20', { rng, dc: 15 }).success).toBe(false)
  })

  it('omits dc/success when dc is not provided', () => {
    const rng = createSequenceRng([10])
    const r = evaluateExpression('1d20', { rng })
    expect('dc' in r).toBe(false)
    expect('success' in r).toBe(false)
  })
})

describe('evaluateExpression - error propagation', () => {
  it('surfaces parser errors with position', () => {
    const rng = createSequenceRng([])
    expect(() => evaluateExpression('2d6+abc', { rng })).toThrow(/position 4/)
  })

  it('requires an rng', () => {
    expect(() => evaluateExpression('1d6', {})).toThrow(/rng/)
  })

  it('propagates sequence exhaustion (caller under-queued)', () => {
    const rng = createSequenceRng([1])
    expect(() => evaluateExpression('3d6', { rng })).toThrow(/exhausted/)
  })
})

describe('evaluateExpression - term rendering', () => {
  it('renders each term with its notation string', () => {
    const rng = createSequenceRng([2, 6, 4, 5])
    const r = evaluateExpression('4d6kh3+2', { rng })
    expect(r.terms[0].notation).toBe('4d6kh3')
    expect(r.terms[0].sides).toBe(6)
    expect(r.terms[0].count).toBe(4)
    expect(r.terms[0].keep).toEqual({ mode: 'highest', n: 3 })
  })
})

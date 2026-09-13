import { describe, it, expect } from 'vitest'
import { parseExpression } from '../../src/engine/notation.js'

describe('parseExpression - basic terms', () => {
  it('parses a simple NdM', () => {
    expect(parseExpression('2d6')).toEqual({
      terms: [{ count: 2, sides: 6, keep: null, explodeOn: null, rerollBelow: null }],
      constant: 0,
      raw: '2d6',
    })
  })

  it('parses a single die with implicit count (d20 => 1d20)', () => {
    const ast = parseExpression('d20')
    expect(ast.terms).toEqual([
      { count: 1, sides: 20, keep: null, explodeOn: null, rerollBelow: null },
    ])
  })

  it('parses a positive constant', () => {
    const ast = parseExpression('2d6+3')
    expect(ast.terms[0].sides).toBe(6)
    expect(ast.constant).toBe(3)
  })

  it('parses a negative constant', () => {
    expect(parseExpression('1d20-2').constant).toBe(-2)
  })

  it('parses a bare constant', () => {
    expect(parseExpression('5')).toEqual({ terms: [], constant: 5, raw: '5' })
  })

  it('parses multi-term expressions', () => {
    const ast = parseExpression('2d6+1d4+2')
    expect(ast.terms).toHaveLength(2)
    expect(ast.constant).toBe(2)
    expect(ast.terms[1]).toEqual({
      count: 1,
      sides: 4,
      keep: null,
      explodeOn: null,
      rerollBelow: null,
    })
  })
})

describe('parseExpression - keep modifiers', () => {
  it('parses keep-highest', () => {
    const ast = parseExpression('4d6kh3')
    expect(ast.terms[0].keep).toEqual({ mode: 'highest', n: 3 })
  })

  it('parses keep-lowest', () => {
    expect(parseExpression('2d20kl1').terms[0].keep).toEqual({ mode: 'lowest', n: 1 })
  })

  it('defaults keep-highest to 1 when N is omitted (4d6kh)', () => {
    expect(parseExpression('4d6kh').terms[0].keep).toEqual({ mode: 'highest', n: 1 })
  })

  it('rejects keeping more dice than rolled', () => {
    expect(() => parseExpression('2d6kh3')).toThrow(/keep/)
  })
})

describe('parseExpression - explosion and reroll', () => {
  it('parses a bare explosion flag as explode-on-max', () => {
    expect(parseExpression('1d10!').terms[0].explodeOn).toEqual([10])
  })

  it('parses explicit explosion faces (5e d12: !11,12)', () => {
    expect(parseExpression('1d12!11,12').terms[0].explodeOn).toEqual([11, 12])
  })

  it('rejects explosion faces outside the die range', () => {
    expect(() => parseExpression('1d6!9')).toThrow(/explode/)
  })

  it('parses reroll-below (3d6r1 => reroll 1s once)', () => {
    expect(parseExpression('3d6r1').terms[0].rerollBelow).toBe(1)
  })

  it('rejects rerollBelow at or above the die max', () => {
    expect(() => parseExpression('1d6r6')).toThrow(/reroll/)
  })
})

describe('parseExpression - whitespace and validation', () => {
  it('tolerates whitespace', () => {
    expect(parseExpression(' 2d6 + 3 ').constant).toBe(3)
  })

  it('is case-insensitive', () => {
    expect(parseExpression('2D6KH1').terms[0].keep).toEqual({ mode: 'highest', n: 1 })
  })

  it('rejects empty input', () => {
    expect(() => parseExpression('')).toThrow(/empty/i)
    expect(() => parseExpression('   ')).toThrow(/empty/i)
  })

  it('rejects garbage with position-aware errors', () => {
    expect(() => parseExpression('2d6+abc')).toThrow(/position 4/)
  })

  it('rejects zero-sided dice', () => {
    expect(() => parseExpression('2d0')).toThrow(/sides/)
  })

  it('rejects negative die counts', () => {
    expect(() => parseExpression('-2d6')).toThrow(/count/)
  })

  it('rejects unknown trailing tokens', () => {
    expect(() => parseExpression('2d6d8')).toThrow(/position 3/)
  })

  it('rejects oversized pools (DoS guard)', () => {
    expect(() => parseExpression('5000d6')).toThrow(/too many dice/i)
  })

  it('rejects oversized constants', () => {
    expect(() => parseExpression('1d6+99999999')).toThrow(/constant/)
  })

  it('rejects doubled sign operators (silent-skip guard)', () => {
    // '2d6--3' previously parsed as 2d6 + (-3) with the first '-' silently
    // dropped by the segment regex. Ambiguous input must be rejected.
    expect(() => parseExpression('2d6--3')).toThrow(/sign/)
    expect(() => parseExpression('2d6++3')).toThrow(/sign/)
    expect(() => parseExpression('2d6+-3')).toThrow(/sign/)
    expect(() => parseExpression('2d6-+3')).toThrow(/sign/)
  })
})

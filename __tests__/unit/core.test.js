import { describe, it, expect } from 'vitest'
import { rollDice } from '../../src/engine/core.js'
import { createSequenceRng } from '../../src/engine/rng.js'

describe('rollDice - basic rolling', () => {
  it('rolls N dice of M sides using the injected rng', () => {
    const rng = createSequenceRng([3, 5, 1])
    const result = rollDice({ sides: 6, count: 3, rng })
    expect(result).toHaveLength(3)
    expect(result.map((d) => d.face)).toEqual([3, 5, 1])
  })

  it('each die records its face, empty chain, and final', () => {
    const rng = createSequenceRng([4])
    const [die] = rollDice({ sides: 10, count: 1, rng })
    expect(die).toEqual({ face: 4, chain: [], final: 4, rerolled: false })
  })

  it('rolls nothing when count is 0', () => {
    const rng = createSequenceRng([])
    expect(rollDice({ sides: 6, count: 0, rng })).toEqual([])
  })
})

describe('rollDice - explosion', () => {
  it('explodes on max face and sums the chain ([10,10,4] => final 24)', () => {
    // First die: 10 (explodes), second call: 10 (explodes again), third: 4.
    // Second die: plain 6.
    const rng = createSequenceRng([10, 10, 4, 6])
    const result = rollDice({ sides: 10, count: 2, rng, explodeOn: [10] })
    expect(result[0].face).toBe(10)
    expect(result[0].chain).toEqual([10, 10, 4])
    expect(result[0].final).toBe(24)
    expect(result[1]).toEqual({ face: 6, chain: [], final: 6, rerolled: false })
  })

  it('explodes only when face is in explodeOn', () => {
    const rng = createSequenceRng([9, 1])
    const result = rollDice({ sides: 10, count: 1, rng, explodeOn: [10] })
    expect(result[0].final).toBe(9)
    expect(result[0].chain).toEqual([])
  })

  it('explodes on ANY listed face (5e d12: faces 11 and 12)', () => {
    // Die 1: 11 (explosive, not max) -> chains -> 8. Die 2: 12 -> chains -> 5.
    const rng = createSequenceRng([11, 8, 12, 5])
    const result = rollDice({ sides: 12, count: 2, rng, explodeOn: [11, 12] })
    expect(result[0].chain).toEqual([11, 8])
    expect(result[0].final).toBe(19)
    expect(result[1].chain).toEqual([12, 5])
    expect(result[1].final).toBe(17)
  })

  it('enforces the chain depth cap', () => {
    // Infinite 10s: the cap stops the chain; the die final includes only
    // cappedChainLength faces (10 * cappedChainLength).
    const rng = createSequenceRng(new Array(500).fill(10))
    const result = rollDice({ sides: 10, count: 1, rng, explodeOn: [10] })
    expect(result[0].chain).toHaveLength(100)
    expect(result[0].final).toBe(1000)
  })

  it('does not explode when explodeOn is not requested', () => {
    // Two max faces in a row: second must be a NEW die, not an explosion.
    const rng = createSequenceRng([10, 10])
    const result = rollDice({ sides: 10, count: 2, rng })
    expect(result[0].chain).toEqual([])
    expect(result[1].face).toBe(10)
  })
})

describe('rollDice - reroll (4e emphasis = rerollBelow 1)', () => {
  it('rerolls 1s once BEFORE explosions, per 4e emphasis ordering', () => {
    // Emphasis rerolls initial 1s ONCE, BEFORE any explosion check.
    // Chain rolls produced by explosions are NOT subject to emphasis.
    const rng = createSequenceRng([1, 5, 10, 10, 4])
    const result = rollDice({ sides: 10, count: 2, rng, explodeOn: [10], rerollBelow: 1 })
    // Die 1: initial 1 -> emphasis reroll -> 5. face is the current face.
    expect(result[0].face).toBe(5)
    expect(result[0].rerolled).toBe(true)
    expect(result[0].final).toBe(5)
    // Die 2: initial 10 -> explode -> 10 -> explode -> 4. final 24.
    expect(result[1].chain).toEqual([10, 10, 4])
    expect(result[1].final).toBe(24)
  })

  it('a rerolled 1 stays a 1 (emphasis applies once)', () => {
    const rng = createSequenceRng([1, 1])
    const result = rollDice({ sides: 10, count: 1, rng, rerollBelow: 1 })
    expect(result[0].face).toBe(1)
    expect(result[0].rerolled).toBe(true)
    expect(result[0].final).toBe(1)
  })

  it('rerolled 10 explodes (emphasis precedes explosion check)', () => {
    // Initial 1 -> reroll 10 -> now explode check applies -> chain 7.
    const rng = createSequenceRng([1, 10, 7])
    const result = rollDice({ sides: 10, count: 1, rng, explodeOn: [10], rerollBelow: 1 })
    expect(result[0].rerolled).toBe(true)
    expect(result[0].chain).toEqual([10, 7])
    expect(result[0].final).toBe(17)
  })

  it('emphasis without explodeAt simply rerolls 1s', () => {
    const rng = createSequenceRng([1, 3])
    const result = rollDice({ sides: 6, count: 1, rng, rerollBelow: 1 })
    expect(result[0].final).toBe(3)
    expect(result[0].rerolled).toBe(true)
  })
})

describe('rollDice - validation', () => {
  it('rejects sides < 2', () => {
    const rng = createSequenceRng([])
    expect(() => rollDice({ sides: 1, count: 1, rng })).toThrow(/sides/)
  })

  it('rejects negative count', () => {
    const rng = createSequenceRng([])
    expect(() => rollDice({ sides: 6, count: -1, rng })).toThrow(/count/)
  })

  it('rejects count above the hard ceiling', () => {
    const rng = createSequenceRng([])
    expect(() => rollDice({ sides: 6, count: 501, rng })).toThrow(/count/)
  })

  it('validates explodeOn faces against the die range', () => {
    // count: 0 => validation runs, no dice rolled (empty rng queue is fine).
    const rng = createSequenceRng([])
    expect(() => rollDice({ sides: 10, count: 0, rng, explodeOn: [10] })).not.toThrow()
    expect(() => rollDice({ sides: 12, count: 0, rng, explodeOn: [11, 12] })).not.toThrow()
    expect(() => rollDice({ sides: 10, count: 0, rng, explodeOn: [11] })).toThrow(/explodeOn/)
    expect(() => rollDice({ sides: 10, count: 0, rng, explodeOn: [0] })).toThrow(/explodeOn/)
  })
})

import { describe, it, expect } from 'vitest'
import { getTools } from '../../src/mcp-server.js'
import { createSequenceRng } from '../../src/engine/rng.js'

/** Execute a named tool with an injected sequence rng. */
async function runTool(name, args, queue) {
  const tools = getTools({ rng: createSequenceRng(queue) })
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} not found`)
  return tool.execute(args, {})
}

describe('getTools', () => {
  it('exposes exactly 3 tools with the plain names', () => {
    const tools = getTools({})
    expect(tools.map((t) => t.name).sort()).toEqual(['dice_roll', 'l5r4_roll', 'l5r5_roll'])
  })

  it('every tool has a description and an inputSchema', () => {
    for (const tool of getTools({})) {
      expect(tool.description.length).toBeGreaterThan(50)
      expect(tool.inputSchema).toBeTypeOf('object')
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('uses raw zod shapes (no z.object wrapper) — mcp-ai contract', () => {
    const tools = getTools({})
    for (const tool of tools) {
      // Raw shapes are plain objects of zod schemas; z.object() would have
      // a _def.typeName of 'ZodObject' at the top level instead.
      for (const value of Object.values(tool.inputSchema)) {
        expect(value).toHaveProperty('_def')
      }
    }
  })
})

describe('dice_roll tool', () => {
  it('rolls an expression and returns the full result', async () => {
    const result = await runTool('dice_roll', { expression: '2d6+3' }, [3, 5])
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.total).toBe(11)
    expect(parsed.terms[0].rolls.map((d) => d.face)).toEqual([3, 5])
  })

  it('returns a dc verdict when provided', async () => {
    const result = await runTool('dice_roll', { expression: '1d20', dc: 15 }, [15])
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.dc).toBe(15)
  })

  it('surfaces parse errors as isError results', async () => {
    const result = await runTool('dice_roll', { expression: 'not dice' }, [])
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toBeTruthy()
  })
})

describe('l5r4_roll tool', () => {
  it('rolls a trained skill check with tn and raises', async () => {
    // Trait 3, skill 2 => 5d10k3; 9,8,7 kept => 24. Raises 2 => effective
    // TN 25: FAILS (24 < 25) but wouldSucceedWithoutRaises is true.
    const result = await runTool(
      'l5r4_roll',
      { trait: 3, skill: 2, tn: 15, raises: 2, label: 'Court maneuver' },
      [9, 8, 7, 6, 5],
    )
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(false)
    expect(parsed.wouldSucceedWithoutRaises).toBe(true)
    expect(parsed.totals.total).toBe(24)
    expect(parsed.label).toBe('Court maneuver')
    expect(parsed.notes).toBeInstanceOf(Array)
  })

  it('rejects void-capped raises via isError', async () => {
    const result = await runTool('l5r4_roll', { trait: 3, skill: 2, raises: 3, voidRing: 2 }, [])
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toMatch(/void/i)
  })
})

describe('l5r5_roll tool', () => {
  it('rolls a check with tallies and policy notes', async () => {
    // ring 2, skill 2: ring 2, ring 5, skill 9, skill 10.
    const result = await runTool(
      'l5r5_roll',
      { ring: 2, skill: 2, tn: 2, label: 'Attack' },
      [2, 5, 9, 10],
    )
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.tallies.successes).toBe(2)
    expect(parsed.pool).toHaveLength(4)
    expect(parsed.notes.some((n) => n.includes('success_first'))).toBe(true)
  })

  it('supports the kept override end to end', async () => {
    // ring 4, ring 6 (expl), skill 8, skill 12, bonus-ring 2, bonus-skill 10.
    const result = await runTool(
      'l5r5_roll',
      { ring: 2, skill: 2, kept: '1,2' },
      [4, 6, 8, 12, 2, 10],
    )
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.keptIndices).toEqual([1, 2])
    expect(parsed.tallies.explosive).toBe(1)
    expect(parsed.policy).toBe('override')
  })

  it('validation failures surface as isError with the engine message', async () => {
    const result = await runTool('l5r5_roll', { ring: 9, skill: 2 }, [])
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toMatch(/ring/)
  })
})

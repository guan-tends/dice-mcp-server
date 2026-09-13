/**
 * E2E Test — Starts the Dice MCP server on a test port with an injected
 * sequence RNG and connects via MCP StreamableHTTPClientTransport to
 * verify the full round-trip: initialize → listTools → callTool ×3.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createDiceMcpServer } from '../../src/mcp-server.js'
import { createSequenceRng } from '../../src/engine/rng.js'

const TEST_PORT = 3779
const TEST_URL = `http://127.0.0.1:${TEST_PORT}/`

describe('E2E: Dice MCP Server', () => {
  let server, client

  beforeAll(async () => {
    // Sequence RNG queued generously: any un-consumed remainder is fine,
    // exhaustion throws loudly if a tool under-queues in a changed engine.
    const rng = createSequenceRng([
      // dice_roll "2d6+3": 3, 5
      3, 5,
      // dice_roll "1d20" dc 15: 15
      15,
      // l5r4 trait 3 skill 2: 9,8,7,6,5
      9, 8, 7, 6, 5,
      // l5r5 ring 2 skill 2: 2,5,9,10
      2, 5, 9, 10,
      // l5r5 advantage (ring 2, skill 1): ring 2, ring 6 (expl),
      // skill 8, bonus-ring 5, conversion reroll -> skill 9
      2, 6, 8, 5, 9,
      // l5r5 conversions "3:ring" (ring 2, skill 2): ring 3, ring 4,
      // skill 7, skill 8, conversion reroll -> ring 6
      3, 4, 7, 8, 6,
      // ── v1.2.0 additions (consumed in file order by the appended tests) ──
      // explodeOn '9' (rolled 1 kept 1): 9 explodes -> 7
      9, 7,
      // explodeOn 'none' (rolled 1 kept 1): 10 must NOT explode (1 value;
      // no chain follow-up since explosions are disabled)
      10,
      // (explodeOn 'banana': parse throws BEFORE any rng consumption)
      // direct pool 1k4 tn 5: face 7 (success)
      7,
      // Ten Dice 14k12: ten non-10 faces, no explosion chains
      3, 6, 2, 8, 5, 9, 4, 7, 6, 5,
    ])
    server = createDiceMcpServer({ port: TEST_PORT, host: '127.0.0.1', rng })
    await server.start()
    await new Promise((resolve) => setTimeout(resolve, 500))

    client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(TEST_URL))
    await client.connect(transport)
  })

  afterAll(async () => {
    if (client) await client.close()
    if (server) await server.stop()
  })

  it('lists exactly 3 tools', async () => {
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(3)
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['dice_roll', 'l5r4_roll', 'l5r5_roll'])
    // Every tool carries a description with system-teaching content.
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(100)
    }
  })

  it('calls dice_roll end to end', async () => {
    const result = await client.callTool({
      name: 'dice_roll',
      arguments: { expression: '2d6+3' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.total).toBe(11)
  })

  it('calls dice_roll with dc verdict', async () => {
    const result = await client.callTool({
      name: 'dice_roll',
      arguments: { expression: '1d20', dc: 15 },
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.dc).toBe(15)
  })

  it('calls l5r4_roll end to end', async () => {
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { trait: 3, skill: 2, tn: 15 },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.totals.keptSum).toBe(24)
    expect(parsed.keepCount).toBe(3)
  })

  it('calls l5r5_roll end to end', async () => {
    const result = await client.callTool({
      name: 'l5r5_roll',
      arguments: { ring: 2, skill: 2, tn: 2 },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.tallies.successes).toBe(2)
    expect(parsed.pool).toHaveLength(4)
  })

  it('rejects schema-invalid params at the MCP layer (before execute)', async () => {
    // trait 99 violates the zod range — the SDK rejects with a JSON-RPC
    // protocol error; the tool body never runs.
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { trait: 99, skill: 2 },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('MCP error')
  })

  it('rejects rule-violating calls at the engine layer (isError JSON)', async () => {
    // Schema-valid input, cross-field rule violation: 3 raises vs Void 2.
    // withErrorHandling catches the engine throw -> isError + JSON payload.
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { trait: 3, skill: 2, raises: 3, voidRing: 2 },
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toMatch(/void/i)
  })

  it('calls l5r5_roll with advantage end to end', async () => {
    // ring 2, skill 1, advantage: non-explosive ring die converts to skill.
    const result = await client.callTool({
      name: 'l5r5_roll',
      arguments: { ring: 2, skill: 1, advantage: true },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.conversions).toHaveLength(1)
    expect(parsed.conversions[0]).toMatchObject({ index: 1, from: 'ring', to: 'skill', newFace: 9 })
    // Explosive ring 6 was NOT converted — its bonus die exists.
    expect(parsed.pool.some((d) => d.bonusFor !== undefined)).toBe(true)
  })

  it('calls l5r5_roll with explicit conversions end to end', async () => {
    // ring 2, skill 2, convert die 3 (a skill die) to ring.
    const result = await client.callTool({
      name: 'l5r5_roll',
      arguments: { ring: 2, skill: 2, conversions: '3:ring' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.conversions).toHaveLength(1)
    expect(parsed.conversions[0]).toMatchObject({
      index: 3,
      from: 'skill',
      to: 'ring',
      oldFace: 7,
      newFace: 6,
    })
  })

  it('returns isError for an unknown tool', async () => {
    const result = await client.callTool({ name: 'no_such_tool', arguments: {} })
    expect(result.isError).toBe(true)
  })

  // ── v1.2.0 deep-review additions (consume the queue tail; appended
  // AFTER all pre-existing tests so the original sequence alignment
  // above is untouched — shared-RNG tests are order-coupled). ──
  it('parses explodeOn comma-string at the tool layer (mastery 9)', async () => {
    // Deterministic RNG is server-level; here assert the parse path: face 9
    // explodes when explodeOn '9' widens the default [10]. With a random
    // crypto RNG we can only assert shape + no error.
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { rolled: 1, kept: 1, explodeOn: '9', label: 'mastery' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.label).toBe('mastery')
  })

  it('parses explodeOn "none" (thrown weapons: no explosions)', async () => {
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { rolled: 1, kept: 1, explodeOn: 'none' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.rolled[0].chain).toHaveLength(0)
  })

  it('rejects garbage explodeOn with a clear engine error', async () => {
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { rolled: 1, kept: 1, explodeOn: 'banana' },
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toMatch(/explodeOn/i)
  })

  it('direct pool 1k4 (initiative) end to end via MCP', async () => {
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { rolled: 1, kept: 4, tn: 5 },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.pool).toBe(1)
    expect(parsed.keepCount).toBe(4)
    expect(parsed.preCapPool).toEqual({ rolled: 1, kept: 4 })
  })

  it('Ten Dice 14k12 via direct pool end to end (overflow +12)', async () => {
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { rolled: 14, kept: 12, label: 'canon' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.pool).toBe(10)
    expect(parsed.keepCount).toBe(10)
    expect(parsed.overflowBonus).toBe(12)
    expect(parsed.preCapPool).toEqual({ rolled: 14, kept: 12 })
  })
})

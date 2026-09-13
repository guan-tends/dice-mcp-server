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
      // l5r5 advantage (ring 2, skill 1): base ring 2, ring 6 (expl),
      // skill 8; conversion reroll -> skill 5; bonus ring (kept ring-6
      // explodes post-keep) -> 4. Bonus rolls happen AFTER keep now.
      2, 6, 8, 5, 4,
      // l5r5 conversions "3:ring" (ring 2, skill 2): ring 3, ring 4,
      // skill 7, skill 8, conversion reroll -> ring 4 (no explosion —
      // keeps the shared queue aligned for the tests below)
      3, 4, 7, 8, 4,
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
      // explodeOn bare number 9 (rolled 1 kept 1): 8, no explosion
      8,
      // explodeOn array [9,10] (rolled 1 kept 1): 6, no explosion
      6,
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
    expect(parsed.conversions[0]).toMatchObject({ index: 1, from: 'ring', to: 'skill', newFace: 5 })
    // Explosive ring 6 was NOT converted — kept, it explodes post-keep
    // (book Step 6.1): bonus die lives in the audit array, tallied.
    expect(parsed.bonusDice).toHaveLength(1)
    expect(parsed.bonusDice[0]).toMatchObject({ type: 'ring', face: 4, disposition: 'kept' })
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
      newFace: 4,
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

  it('explodeOn accepts a bare NUMBER at the MCP layer (GM note #2)', async () => {
    // Regression for the coercion trap: z.string() rejected bare 9.
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { rolled: 1, kept: 1, explodeOn: 9 },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
  })

  it('explodeOn accepts a number ARRAY at the MCP layer (GM note #2)', async () => {
    const result = await client.callTool({
      name: 'l5r4_roll',
      arguments: { rolled: 1, kept: 1, explodeOn: [9, 10] },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.success).toBe(true)
  })
})

// ── v1.4.0 law-fix additions (Sakura acceptance through the wire) ──
// NOTE: appended AFTER all earlier tests so the shared-RNG queue alignment
// above is untouched (order-coupled, see the beforeAll comment).
describe('E2E: l5r5 law-fix (v1.4.0)', () => {
  it('Sakura (book p. 23) through the MCP boundary: bonus die completes TN 3', async () => {
    // Queue: ring 6, ring 2, ring 2, skill 3 (base); bonus ring 5 (kept
    // ring-6 explodes post-keep). Result: totalSuccesses 3 = TN 3.
    const rng = createSequenceRng([6, 2, 2, 3, 5])
    const localServer = createDiceMcpServer({ port: TEST_PORT + 1, host: '127.0.0.1', rng })
    await localServer.start()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const c = new Client({ name: 'test-client', version: '1.0.0' })
    await c.connect(
      new StreamableHTTPClientTransport(
        new URL(TEST_URL.replace(String(TEST_PORT), String(TEST_PORT + 1))),
      ),
    )
    try {
      const result = await c.callTool({
        name: 'l5r5_roll',
        arguments: { ring: 3, skill: 1, tn: 3 },
      })
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.success).toBe(true)
      expect(parsed.totalSuccesses).toBe(3)
      expect(parsed.bonusDice).toHaveLength(1)
      expect(parsed.bonusDice[0]).toMatchObject({ type: 'ring', face: 5, disposition: 'kept' })
      expect(parsed.notes.some((n) => n.includes('Step 6.1'))).toBe(true)
    } finally {
      await c.close()
      await localServer.stop()
    }
  })

  it('accepts the new v1.4.0 params (assistants, keepCount, bonusDice) over the wire', async () => {
    // Pool order (book p. 22 + p. 26): ring dice, skill dice, skilled
    // helpers (skill dice), unskilled helpers (ring dice). Queue:
    // ring 6 (expl), skilled helper skill 8 (d12), unskilled helper
    // ring 4, bonus ring 2 (kept ring-6 explodes post-keep; auto_drop
    // shows it, NOT tallied). keepMax = 1 + 2 = 3; all 4 dice... 3 kept
    // (skill 8, ring 6, ring 4 — all of them).
    const rng = createSequenceRng([6, 8, 4, 2])
    const localServer = createDiceMcpServer({ port: TEST_PORT + 2, host: '127.0.0.1', rng })
    await localServer.start()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const c = new Client({ name: 'test-client', version: '1.0.0' })
    await c.connect(
      new StreamableHTTPClientTransport(
        new URL(TEST_URL.replace(String(TEST_PORT), String(TEST_PORT + 2))),
      ),
    )
    try {
      const result = await c.callTool({
        name: 'l5r5_roll',
        arguments: {
          ring: 1,
          skill: 0,
          assistants: { skilled: 1, unskilled: 1 },
          bonusDice: 'auto_drop',
          tn: 2,
        },
      })
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.baseCount).toBe(3) // ring + skilled helper + unskilled helper (bonus dice are outside the base pool)
      expect(parsed.keepMax).toBe(3)
      expect(parsed.bonusDice[0]).toMatchObject({ type: 'ring', face: 2, disposition: 'dropped' })
      // bonusPending only appears in 'manual' mode; auto_drop omits it.
      expect('bonusPending' in parsed.tallies).toBe(false)
      expect(parsed.totalSuccesses).toBe(4) // 3 ⚑ (skill8, ring4, ring6) + 1 🔥 (kept ring-6)
      expect(parsed.notes.some((n) => n.includes('Assistance (book p. 26)'))).toBe(true)
    } finally {
      await c.close()
      await localServer.stop()
    }
  })
})

describe('E2E: l5r5 manual mode over the wire (v1.4.0)', () => {
  it("bonusDice='manual' reports pending dice and lets the caller decide", async () => {
    // Queue: ring 6 (kept, expl), ring 1; bonus ring 5 — PENDING.
    const rng = createSequenceRng([6, 1, 5])
    const localServer = createDiceMcpServer({ port: TEST_PORT + 3, host: '127.0.0.1', rng })
    await localServer.start()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const c = new Client({ name: 'test-client', version: '1.0.0' })
    await c.connect(
      new StreamableHTTPClientTransport(
        new URL(TEST_URL.replace(String(TEST_PORT), String(TEST_PORT + 3))),
      ),
    )
    try {
      const result = await c.callTool({
        name: 'l5r5_roll',
        arguments: { ring: 2, skill: 0, bonusDice: 'manual', tn: 2 },
      })
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.bonusDice[0]).toMatchObject({ type: 'ring', face: 5, disposition: 'pending' })
      expect(parsed.tallies.bonusPending).toBe(1)
      expect(parsed.totalSuccesses).toBe(2) // ring-6 ⚑+🔥 tallied; pending NOT
      expect(parsed.notes.some((n) => n.includes('caller decides'))).toBe(true)
    } finally {
      await c.close()
      await localServer.stop()
    }
  })
})

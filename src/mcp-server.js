/**
 * Dice MCP Server — Exposes dice engines as MCP tools.
 *
 * Creates a SimpleServer from @guan-tends/mcp-ai wrapping three engines:
 *   - dice_roll:  generic d20-style notation (NdM, keep, explode, reroll, DC)
 *   - l5r4_roll:  L5R 4e Roll & Keep (XkY+Z, raises, void, emphasis, wounds)
 *   - l5r5_roll:  L5R 5e ring/skill symbol dice (keeps, policies, conversions)
 *
 * Stateless by design: no sessions, no sheets, no persistence. The caller
 * (agent) is the GM brain; the server is pure dice math. Randomness is
 * injected — production uses a CSPRNG; tests inject sequences.
 *
 * Tool descriptions embed the TN scales and worked examples so an LLM
 * caller learns each system from the tool itself (design decision D7).
 *
 * @module mcp-server
 */

import { createSimpleServer } from '@guan-tends/mcp-ai/simple-server/index.js'
import { z } from 'zod'
import { evaluateExpression } from './engine/d20.js'
import { rollAndKeep } from './engine/l5r4.js'
import { rollCheck } from './engine/l5r5.js'
import { createCryptoRng } from './engine/rng.js'

// ──────────────────────────────────────────────────────────────────────────
// Error Handling Wrapper (matrix-mcp-server pattern)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run an async tool body with standardized error handling: engine throws
 * become isError MCP results carrying the engine's human-readable message.
 * (Zod-schema violations never reach here — the SDK rejects them earlier.)
 *
 * @param {Function} fn - Async function returning an MCP result object.
 * @returns {Promise<object>} The tool result, or an isError result on throw.
 */
async function withErrorHandling(fn) {
  try {
    return await fn()
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }],
      isError: true,
    }
  }
}

/**
 * Create a success MCP result.
 *
 * @param {object} data - Data to include in the result.
 * @returns {object} MCP CallToolResult.
 */
function success(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...data }) }],
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Shared Zod Schemas (raw shapes — NOT z.object, per mcp-ai contract)
// ──────────────────────────────────────────────────────────────────────────

const schemas = {
  label: z
    .string()
    .optional()
    .describe('Optional label echoed in the result (e.g. "Katana attack")'),
}

// ──────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build the array of MCP tool definitions.
 *
 * Exported separately as `getTools` for unit testing — allows testing tool
 * execution without starting a full HTTP server.
 *
 * @param {object} deps
 * @param {(sides: number) => number} [deps.rng] - Injected randomness
 *   (defaults to the production CSPRNG).
 * @returns {Array} Tool definition objects.
 */
export function getTools({ rng = createCryptoRng() } = {}) {
  return [
    // ── Generic d20-style notation ─────────────────────────────────
    {
      name: 'dice_roll',
      description:
        'Roll dice using standard tabletop notation. Syntax: "2d6+3" (sum), "4d6kh3" (keep ' +
        'highest 3 — ability scores), "2d20kl1" (disadvantage), "1d10!" (exploding on max, ' +
        'reroll-and-sum chains), "1d12!11,12" (explode on specific faces), "3d6r1" (reroll ' +
        'initial 1s once), multi-term like "2d6+1d4+2". Add dc to get a success verdict ' +
        '(total >= dc). Returns per-term rolls, kept/dropped dice, and the total. Stateless ' +
        'pure math — no character sheets.',
      inputSchema: {
        expression: z
          .string()
          .describe(
            'Dice expression, e.g. "2d6+3", "4d6kh3", "2d20kl1", "1d10!", "1d12!11,12", "3d6r1"',
          ),
        dc: z.number().int().optional().describe('Optional difficulty class / target number'),
      },
      execute: async ({ expression, dc }) =>
        withErrorHandling(async () => {
          const result = evaluateExpression(expression, { rng, dc })
          return success(result)
        }),
    },

    // ── L5R 4th Edition — Roll & Keep ──────────────────────────────
    {
      name: 'l5r4_roll',
      description:
        'Legend of the Five Rings 4th Edition Roll & Keep roll. Pools (Trait + Skill) d10s, ' +
        'keeps the highest Trait. D10s explode on 10s. Emphasis rerolls initial 1s once ' +
        'BEFORE explosions (trained rolls only). Raises: each adds +5 to the TN (max = ' +
        'Void Ring); free raises add effect without TN. rollType: skill (default), trait, ' +
        'ring (explode + raises legal), unskilled (no explosions, no raises, no emphasis), ' +
        'custom. Direct pools: pass rolled/kept (e.g. initiative 1k4, damage 6k2, Honor ' +
        '6k6) — kept > rolled is legal. Ten Dice Rule auto-normalizes (kept-cap +2/die, ' +
        'rolled-cap, 2:1 conversion, leftover +2); preCapPool + overflowBonus reported. ' +
        'Wound penalties RAISE the effective TN (never the total). Dice penalties: ' +
        'negative rollBonus/keepBonus, kept clamps to rolled. voidPoint=true = +1k1. ' +
        'totalBonus = flat bonus to the total (Honor). keepMode lowest = deliberate ' +
        'failure. explodeOn: 10 (default), 9 (mastery), or comma-list. TN scale: 5 ' +
        'trivial, 10 easy, 15 average, 20 difficult, 25 very hard, 30 extreme, 40 ' +
        'near-impossible, 60 impossible.',
      inputSchema: {
        trait: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe('Trait ring rating 1-10 (also the keep count)'),
        skill: z
          .number()
          .int()
          .min(0)
          .max(10)
          .default(0)
          .describe('Skill rating 0-10. 0 = untrained roll'),
        tn: z.number().int().optional().describe('Target number (5 trivial .. 40 near-impossible)'),
        raises: z
          .number()
          .int()
          .min(0)
          .max(10)
          .default(0)
          .describe('Declared raises: +5 TN each, max = voidRing'),
        freeRaises: z
          .number()
          .int()
          .min(0)
          .max(10)
          .default(0)
          .describe('Free raises: extra effect, no TN increase, not counted vs voidRing'),
        voidRing: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Void Ring rating — caps declared raises when provided'),
        emphasis: z
          .boolean()
          .default(false)
          .describe('Skill emphasis applies: reroll initial 1s once before explosions'),
        penalty: z
          .number()
          .int()
          .default(0)
          .describe(
            'Wound/stance penalty — RAISES the effective TN (never the total). Nicked +3, Grazed +5, Hurt +10, Injured +15, Crippled +20, Down +40',
          ),
        rollBonus: z
          .number()
          .int()
          .min(-10)
          .max(10)
          .default(0)
          .describe(
            'Extra (+) or penalty (−) rolled dice. Void Point +1k1 => rollBonus 1 + keepBonus 1, or just voidPoint=true',
          ),
        keepBonus: z
          .number()
          .int()
          .min(-10)
          .max(10)
          .default(0)
          .describe('Extra (+) or penalty (−) kept dice (kept clamps to rolled after subtraction)'),
        rolled: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            'Direct pool: rolled dice (overrides trait/skill). Initiative 1k4, damage 6k2, Honor 6k6',
          ),
        kept: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            'Direct pool: kept dice (with rolled). kept > rolled is legal (initiative = Insight k Reflexes)',
          ),
        rollType: z
          .enum(['skill', 'trait', 'ring', 'unskilled', 'custom'])
          .optional()
          .describe(
            'Roll classification. trait/ring/custom explode + allow raises; unskilled: no explosions/raises/emphasis. Default: skill',
          ),
        untrained: z
          .boolean()
          .optional()
          .describe(
            'Explicit untrained flag — false with skill 0 = Trait roll (explodes, raises legal)',
          ),
        voidPoint: z
          .boolean()
          .default(false)
          .describe('Spend a Void Point: +1k1 to the pool (declared before the roll)'),
        totalBonus: z
          .number()
          .int()
          .default(0)
          .describe(
            'Flat bonus to the kept sum (Honor Rank on Fear resistance, etc.) — distinct from dice bonuses',
          ),
        keepMode: z
          .enum(['highest', 'lowest'])
          .default('highest')
          .describe('Keep the highest (default) or lowest dice — lowest = deliberate failure'),
        explodeOn: z
          .string()
          .optional()
          .describe(
            'Explosion faces: "10" (default), "9" (weapon mastery), "9,10", or "none" (thrown weapons)',
          ),
        label: schemas.label,
      },
      execute: async (input) =>
        withErrorHandling(async () => {
          const { explodeOn, ...rest } = input
          const parsed = { ...rest, rng }
          if (explodeOn !== undefined && explodeOn !== null) {
            if (explodeOn === 'none') {
              parsed.explodeOn = 'none'
            } else {
              const faces = String(explodeOn)
                .split(',')
                .map((f) => Number.parseInt(f.trim(), 10))
                .filter((f) => Number.isInteger(f) && f >= 1 && f <= 10)
              if (faces.length === 0) {
                throw new Error(
                  `l5r4_roll: explodeOn must be a face like "10", a comma-list like "9,10", or "none" (got ${explodeOn})`,
                )
              }
              parsed.explodeOn = faces
            }
          }
          const result = rollAndKeep(parsed)
          return success(result)
        }),
    },

    // ── L5R 5th Edition — Ring & Skill Dice ────────────────────────
    {
      name: 'l5r5_roll',
      description:
        'Legend of the Five Rings 5th Edition (FFG) ring-dice check. Rolls Ring rating in d6 ' +
        'ring dice + Skill rating in d12 skill dice, then keeps Ring-rating many dice ' +
        '(chosen after seeing the pool). Faces carry symbols: successes, opportunities, ' +
        'strife, explosive. Explosive faces (ring 6, skill 11/12) add one bonus die of the ' +
        'same type. TN is successes needed: 1 easy, 2 average, 3 difficult, 4 very hard, ' +
        '5 extremely hard, 6 extraordinary, 7+ heroic. Advantage converts ring dice to ' +
        'skill dice (never explosive ones); disadvantage converts the worst skill die to a ' +
        'ring die. kept="1,3" overrides auto-keep with 1-based pool indices. policy: ' +
        'success_first (default), min_strife, max_opportunity. composure: advisory ' +
        'outbursts flag (strife >= composure). Returns the full pool with per-die symbols, ' +
        'the keeps, and symbol tallies.',
      inputSchema: {
        ring: z
          .number()
          .int()
          .min(1)
          .max(5)
          .describe('Ring rating 1-5 (also how many dice are kept)'),
        skill: z
          .number()
          .int()
          .min(0)
          .max(5)
          .default(0)
          .describe('Skill rating 0-5. 0 = untrained (ring dice only)'),
        tn: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Target number in successes (1 easy .. 7+ heroic)'),
        advantage: z
          .boolean()
          .default(false)
          .describe('Convert non-explosive ring dice to skill dice (reroll same slot)'),
        disadvantage: z
          .boolean()
          .default(false)
          .describe('Convert the worst skill die to a ring die'),
        conversions: z
          .string()
          .optional()
          .describe(
            'Explicit die conversions, 1-based base-pool indices: "2:skill,4:ring". ' +
              'Overrides advantage/disadvantage defaults',
          ),
        policy: z
          .enum(['success_first', 'min_strife', 'max_opportunity'])
          .default('success_first')
          .describe('Auto-keep policy when kept is not provided'),
        kept: z
          .string()
          .optional()
          .describe(
            'Explicit keep override: comma-separated 1-based indices into the base pool, ' +
              'e.g. "1,3" (exactly ring-rating many; bonus dice not selectable)',
          ),
        composure: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Composure value — result flags composureExceeded when kept strife >= it'),
        includeExplosionBonuses: z
          .boolean()
          .default(true)
          .describe('Expand explosive faces into bonus dice (default true)'),
        label: schemas.label,
      },
      execute: async (input) =>
        withErrorHandling(async () => {
          const result = rollCheck({ ...input, rng })
          return success(result)
        }),
    },
  ]
}

// ──────────────────────────────────────────────────────────────────────────
// Server Factory
// ──────────────────────────────────────────────────────────────────────────

/**
 * Create the Dice MCP Server.
 *
 * NOTE: `host` is INFORMATIONAL ONLY — mcp-ai SimpleServer's express
 * listen() binds all interfaces and ignores it (verified: app.listen(port),
 * no host arg). Loopback-only enforcement happens at the deployment layer:
 * systemd IPAddressDeny=any + IPAddressAllow=localhost, plus UFW
 * default-deny. See README "Loopback enforcement".
 *
 * @param {object} [config]
 * @param {number} [config.port=3777] - HTTP server port (this IS honored;
 *   ignored for stdio, which speaks over stdin/stdout pipes).
 * @param {string} [config.host='127.0.0.1'] - Informational; see NOTE above.
 * @param {'stdio'|'http'|'sse'} [config.transport] - Wire protocol.
 *   Default 'http' (back-compat); 'stdio' maps to mcp-ai's 'cli' entry
 *   (StdioServerTransport — the passgen mechanism). Env override:
 *   DICE_MCP_TRANSPORT.
 * @param {(sides: number) => number} [config.rng] - Injected randomness.
 * @returns {object} SimpleServer instance with start/stop methods.
 */
export function createDiceMcpServer(config = {}) {
  const transport = config.transport || process.env.DICE_MCP_TRANSPORT || 'http'
  if (!['stdio', 'http', 'sse'].includes(transport)) {
    throw new Error(`invalid transport "${transport}" — must be one of stdio, http, sse`)
  }
  const port = config.port || 3777
  const host = config.host || '127.0.0.1'
  const tools = getTools({ rng: config.rng })

  const serverConfig = {
    name: 'dice-mcp-server',
    version: '1.1.0',
    server: {
      connection: transport === 'stdio' ? { type: 'cli' } : { type: transport, port, host },
    },
    tools,
  }

  const server = createSimpleServer(serverConfig)

  // ALL diagnostics go to stderr: in stdio mode stdout IS the protocol
  // wire — a single stray log line corrupts the MCP stream.
  console.error(
    `[DiceMCP] Server configured (transport: ${transport}${transport === 'stdio' ? '' : `, ${host}:${port}`})`,
  )
  console.error(`[DiceMCP] ${tools.length} tools registered`)

  return server
}

export default createDiceMcpServer

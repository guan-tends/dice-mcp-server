/**
 * Dice MCP Server — Composition Root (Entry Point)
 *
 * Loads configuration, creates the MCP server, and handles graceful
 * shutdown. Stateless server: nothing to persist, nothing to restore.
 *
 * Architecture: Composition-Root IoC. This is the only file that knows
 * about config and bootstrap; the tool layer is independently testable.
 *
 * Config hierarchy (lowest → highest precedence):
 *   1. Code defaults (port 3777, loopback bind)
 *   2. JSON5 config file (default: ./config.json5)
 *   3. Environment variables (DICE_MCP_PORT, DICE_MCP_HOST)
 *
 * @module index
 */

import JSON5 from 'json5'
import { readFile } from 'fs/promises'
import { createDiceMcpServer } from './mcp-server.js'

// ──────────────────────────────────────────────────────────────────────────
// Config Loading
// ──────────────────────────────────────────────────────────────────────────

/** @type {Record<string, *>} Code defaults. Loopback bind by design (D6). */
const DEFAULTS = {
  port: 3777,
  host: '127.0.0.1',
}

/**
 * Load configuration: defaults ← JSON5 file ← environment overrides.
 *
 * @returns {Promise<{port: number, host: string}>} Merged configuration.
 */
async function loadConfig() {
  let config = { ...DEFAULTS }

  // Layer 2: JSON5 config file (optional).
  const configPath = process.env.DICE_MCP_CONFIG || './config.json5'
  try {
    const raw = await readFile(configPath, 'utf-8')
    config = { ...config, ...JSON5.parse(raw) }
  } catch {
    // Config file is optional — defaults + env are sufficient.
    if (process.env.DICE_MCP_DEBUG) {
      console.info('[DiceMCP] No config file at', configPath, '— using defaults + env')
    }
  }

  // Layer 3: environment overrides.
  if (process.env.DICE_MCP_PORT !== undefined) {
    config.port = parseInt(process.env.DICE_MCP_PORT, 10)
  }
  if (process.env.DICE_MCP_HOST !== undefined) {
    config.host = process.env.DICE_MCP_HOST
  }

  return config
}

// ──────────────────────────────────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────────────────────────────────

/**
 * Initialize and start the dice MCP server.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const config = await loadConfig()

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    console.error(`[DiceMCP] FATAL: invalid port ${config.port}`)
    process.exit(1)
  }
  if (typeof config.host !== 'string' || config.host === '') {
    console.error(`[DiceMCP] FATAL: invalid host ${JSON.stringify(config.host)}`)
    process.exit(1)
  }

  const server = createDiceMcpServer(config)

  await server.start()
  console.info(`[DiceMCP] Listening on ${config.host}:${config.port}`)

  // Graceful shutdown — stateless, so nothing to persist.
  async function shutdown() {
    console.info('[DiceMCP] Shutting down...')
    await server.stop()
    console.info('[DiceMCP] Stopped')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('[DiceMCP] Fatal error:', error)
  process.exit(1)
})

/**
 * Dice MCP Server — Entry Point (bootstrap only).
 *
 * Configuration lives in src/config.js (pure, testable). This module
 * wires it to the server and handles lifecycle. Stateless server:
 * nothing to persist, nothing to restore.
 *
 * @module index
 */

import { loadConfig } from './config.js'
import { createDiceMcpServer } from './mcp-server.js'

/**
 * Initialize and start the dice MCP server.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const config = await loadConfig()
  const server = createDiceMcpServer(config)

  await server.start()
  console.info(
    `[DiceMCP] Listening on ${config.host}:${config.port} (config: ${config.configPath})`,
  )

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

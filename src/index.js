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
 * @param {object} [options]
 * @param {string} [options.transportDefault] - Transport assumed when the
 *   config/env do not specify one ('http' for the library entry, 'stdio'
 *   for the bin entry). Precedence: explicit config/env > this default.
 * @returns {Promise<void>}
 */
export async function runMain({ transportDefault = 'http' } = {}) {
  const config = await loadConfig()
  if (!config.transportExplicit && transportDefault !== config.transport) {
    // Neither config file nor env chose a transport — apply the entry's
    // default (bin entry: stdio; library entry: http). An EXPLICIT
    // choice always wins over the entry default.
    config.transport = transportDefault
  }
  const server = createDiceMcpServer(config)

  await server.start()
  if (config.transport === 'stdio') {
    console.error('[DiceMCP] Listening on stdio (stdin/stdout pipes)')
  } else {
    console.error(
      `[DiceMCP] Listening on ${config.host}:${config.port} (config: ${config.configPath})`,
    )
  }

  // Graceful shutdown — stateless, so nothing to persist.
  async function shutdown() {
    console.error('[DiceMCP] Shutting down...')
    await server.stop()
    console.error('[DiceMCP] Stopped')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// Signal handling is idempotent; entry module runs main on import only
// when executed directly (bin reuses runMain instead).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  runMain().catch((error) => {
    console.error('[DiceMCP] Fatal error:', error)
    process.exit(1)
  })
}

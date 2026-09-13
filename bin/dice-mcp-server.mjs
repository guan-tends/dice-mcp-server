#!/usr/bin/env node
/**
 * Dice MCP Server — executable entry (bin).
 *
 * stdio transport by default (the passgen UX for MCP client configs):
 *   { "mcpServers": { "dice": { "command": "npx", "args": ["-y", "@guan-tends/dice-mcp-server"] } } }
 *
 * DICE_MCP_TRANSPORT env (stdio|http|sse) overrides the stdio default.
 * All diagnostics go to stderr; stdout carries only the MCP protocol.
 */

import { runMain } from '../src/index.js'

runMain({ transportDefault: 'stdio' }).catch((error) => {
  console.error('[DiceMCP] Fatal error:', error)
  process.exit(1)
})

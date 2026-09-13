/**
 * Configuration loading — pure module, independently testable.
 *
 * Hierarchy (lowest → highest precedence):
 *   1. Code defaults (port 3777, loopback-informed host)
 *   2. JSON5 config file (default: ./config.json5)
 *   3. Environment variables (DICE_MCP_PORT, DICE_MCP_HOST)
 *
 * NOTE on `host`: mcp-ai SimpleServer's express listen() binds all
 * interfaces and ignores this field. It is carried in config for future
 * mcp-ai host support; loopback-only enforcement today happens at the
 * deployment layer (systemd IPAddressDeny/Allow + UFW default-deny).
 *
 * @module config
 */

import JSON5 from 'json5'
import { readFile } from 'fs/promises'

/** Code defaults. */
export const DEFAULTS = Object.freeze({
  port: 3777,
  host: '127.0.0.1',
})

/**
 * Validate merged configuration.
 *
 * @param {{port: number, host: string}} config
 * @throws {Error} On invalid port or host.
 */
export function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`invalid port ${config.port} — must be an integer in 1..65535`)
  }
  if (typeof config.host !== 'string' || config.host === '') {
    throw new Error(`invalid host ${JSON.stringify(config.host)} — must be a non-empty string`)
  }
}

/**
 * Load configuration: defaults ← JSON5 file ← environment overrides.
 *
 * @param {object} [env] - Environment-like object (defaults to process.env;
 *   injectable for tests).
 * @returns {Promise<{port: number, host: string, configPath: string}>}
 *   Merged configuration plus the config path used (for diagnostics).
 */
export async function loadConfig(env = process.env) {
  let config = { ...DEFAULTS }

  // Layer 2: JSON5 config file (optional).
  const configPath = env.DICE_MCP_CONFIG || './config.json5'
  try {
    const raw = await readFile(configPath, 'utf-8')
    config = { ...config, ...JSON5.parse(raw) }
  } catch {
    // Config file is optional — defaults + env are sufficient.
    if (env.DICE_MCP_DEBUG) {
      console.info('[DiceMCP] No config file at', configPath, '— using defaults + env')
    }
  }

  // Layer 3: environment overrides.
  if (env.DICE_MCP_PORT !== undefined) {
    config.port = parseInt(env.DICE_MCP_PORT, 10)
  }
  if (env.DICE_MCP_HOST !== undefined) {
    config.host = env.DICE_MCP_HOST
  }

  validateConfig(config)

  return { ...config, configPath }
}

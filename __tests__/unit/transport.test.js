/**
 * Unit Tests — Transport selection (v1.1.0 stdio support).
 *
 * Covers:
 *   - config.js: DEFAULTS.transport, DICE_MCP_TRANSPORT env override,
 *     validation of the allowed set (stdio|http|sse).
 *   - mcp-server.js: stdio → SimpleServer 'cli' mapping, invalid
 *     transport rejection, stderr-only logging (stdout is protocol
 *     wire in stdio mode — MUST stay clean).
 */

import { describe, it, expect, vi } from 'vitest'
import { DEFAULTS, validateConfig, loadConfig } from '../../src/config.js'
import { createDiceMcpServer } from '../../src/mcp-server.js'

describe('config: transport resolution', () => {
  it('defaults to http (back-compat for src/index.js + systemd deploy)', () => {
    expect(DEFAULTS.transport).toBe('http')
  })

  it('loads http default with empty env', async () => {
    const config = await loadConfig({})
    expect(config.transport).toBe('http')
  })

  it('honors DICE_MCP_TRANSPORT=stdio', async () => {
    const config = await loadConfig({ DICE_MCP_TRANSPORT: 'stdio' })
    expect(config.transport).toBe('stdio')
  })

  it('honors DICE_MCP_TRANSPORT=sse', async () => {
    const config = await loadConfig({ DICE_MCP_TRANSPORT: 'sse' })
    expect(config.transport).toBe('sse')
  })

  it('rejects unknown transport values', async () => {
    await expect(loadConfig({ DICE_MCP_TRANSPORT: 'grpc' })).rejects.toThrow(/transport/i)
  })

  it('validateConfig rejects missing transport', () => {
    expect(() => validateConfig({ port: 1, host: '127.0.0.1' })).toThrow(/transport/i)
  })
})

describe('mcp-server: transport mapping', () => {
  it('accepts explicit stdio transport', () => {
    const server = createDiceMcpServer({ transport: 'stdio', rng: () => 3 })
    expect(server).toBeTruthy()
    expect(typeof server.start).toBe('function')
  })

  it('accepts explicit sse transport', () => {
    const server = createDiceMcpServer({ transport: 'sse', rng: () => 3 })
    expect(server).toBeTruthy()
  })

  it('rejects invalid explicit transport', () => {
    expect(() => createDiceMcpServer({ transport: 'carrier-pigeon', rng: () => 3 })).toThrow(
      /transport/i,
    )
  })

  it('respects env DICE_MCP_TRANSPORT when no explicit transport given', () => {
    const prev = process.env.DICE_MCP_TRANSPORT
    process.env.DICE_MCP_TRANSPORT = 'stdio'
    try {
      const server = createDiceMcpServer({ rng: () => 3 })
      expect(server).toBeTruthy()
    } finally {
      if (prev === undefined) delete process.env.DICE_MCP_TRANSPORT
      else process.env.DICE_MCP_TRANSPORT = prev
    }
  })

  it('routes all server logs to stderr (stdout is protocol wire in stdio mode)', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      createDiceMcpServer({ transport: 'stdio', rng: () => 3 })
      expect(infoSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()
      const messages = errorSpy.mock.calls.map((c) => c.join(' '))
      expect(messages.some((m) => m.includes('[DiceMCP]'))).toBe(true)
    } finally {
      infoSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

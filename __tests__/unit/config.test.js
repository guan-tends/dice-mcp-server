import { describe, it, expect } from 'vitest'
import { loadConfig, validateConfig, DEFAULTS } from '../../src/config.js'

describe('loadConfig', () => {
  it('returns code defaults with no file and no env', async () => {
    const cfg = await loadConfig({})
    expect(cfg.port).toBe(DEFAULTS.port)
    expect(cfg.host).toBe(DEFAULTS.host)
    expect(cfg.configPath).toBe('./config.json5')
  })

  it('environment overrides win over defaults', async () => {
    const cfg = await loadConfig({ DICE_MCP_PORT: '4000', DICE_MCP_HOST: '0.0.0.0' })
    expect(cfg.port).toBe(4000)
    expect(cfg.host).toBe('0.0.0.0')
  })

  it('honors DICE_MCP_CONFIG path override', async () => {
    const cfg = await loadConfig({ DICE_MCP_CONFIG: '/tmp/nowhere.json5' })
    expect(cfg.configPath).toBe('/tmp/nowhere.json5')
  })

  it('merges a JSON5 config file under env overrides', async () => {
    // Write a temp config; env port must beat the file's port.
    const { writeFile, unlink } = await import('fs/promises')
    const path = '/tmp/dice-test-config.json5'
    await writeFile(path, '{ port: 3888, host: "10.0.0.5" }')
    try {
      const cfg = await loadConfig({ DICE_MCP_CONFIG: path, DICE_MCP_PORT: '3999' })
      expect(cfg.port).toBe(3999) // env wins
      expect(cfg.host).toBe('10.0.0.5') // file value survives
    } finally {
      await unlink(path)
    }
  })

  it('rejects out-of-range ports from env', async () => {
    await expect(loadConfig({ DICE_MCP_PORT: '99999' })).rejects.toThrow(/port/)
    await expect(loadConfig({ DICE_MCP_PORT: '0' })).rejects.toThrow(/port/)
    await expect(loadConfig({ DICE_MCP_PORT: 'abc' })).rejects.toThrow(/port/)
  })

  it('rejects empty host from env', async () => {
    await expect(loadConfig({ DICE_MCP_HOST: '' })).rejects.toThrow(/host/)
  })
})

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    expect(() => validateConfig({ port: 3777, host: '127.0.0.1' })).not.toThrow()
  })

  it('rejects non-integer, low, and high ports', () => {
    expect(() => validateConfig({ port: 3777.5, host: 'x' })).toThrow(/port/)
    expect(() => validateConfig({ port: 0, host: 'x' })).toThrow(/port/)
    expect(() => validateConfig({ port: 65536, host: 'x' })).toThrow(/port/)
  })

  it('rejects non-string and empty hosts', () => {
    expect(() => validateConfig({ port: 80, host: 5 })).toThrow(/host/)
    expect(() => validateConfig({ port: 80, host: '' })).toThrow(/host/)
  })
})

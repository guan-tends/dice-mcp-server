/**
 * E2E Test — Real stdio wire protocol.
 *
 * Spawns `node bin/dice-mcp-server.mjs` as a child process and speaks
 * raw JSON-RPC 2.0 over stdin/stdout — the exact wire a real MCP client
 * (or gateway stdio entry) would use. No SDK transport abstraction: the
 * protocol itself is under test.
 *
 * Critical assertions:
 *   1. initialize → tools/list → tools/call round-trip works over stdio
 *   2. stdout carries ONLY protocol frames — zero [DiceMCP] log leakage
 *      (diagnostics go to stderr; stdout is the wire)
 */

import { createRequire } from 'node:module'
import { describe, it, expect, afterAll } from 'vitest'
import { spawn } from 'child_process'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN = join(__dirname, '../../bin/dice-mcp-server.mjs')

function startServer() {
  const child = spawn(process.execPath, [BIN], {
    cwd: join(__dirname, '../..'),
    env: { ...process.env, DICE_MCP_DEBUG: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stdoutChunks = []
  const stderrChunks = []
  const pending = []
  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    if (!line.trim()) return
    stdoutChunks.push(line)
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return // non-JSON on stdout = protocol corruption; caught by assertion below
    }
    const idx = pending.findIndex((p) => p.id === msg.id)
    if (idx !== -1) {
      pending.splice(idx, 1)[0].resolve(msg)
    }
  })
  child.stderr.on('data', (d) => stderrChunks.push(d.toString()))

  let nextId = 1
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++
      pending.push({ id, resolve })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })

  return { child, request, stdoutChunks, stderrChunks }
}

describe('E2E: stdio wire protocol (bin entry)', () => {
  const sessions = []

  function spawnServer() {
    const s = startServer()
    sessions.push(s)
    return s
  }

  afterAll(async () => {
    for (const s of sessions) {
      s.child.kill('SIGTERM')
    }
    await new Promise((r) => setTimeout(r, 300))
  })

  it('completes initialize → tools/list → tools/call over raw stdio', async () => {
    const s = spawnServer()
    await new Promise((r) => setTimeout(r, 800)) // boot

    const init = await s.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'stdio-e2e', version: '1.0.0' },
    })
    expect(init.result).toBeTruthy()
    expect(init.result.serverInfo.name).toBe('dice-mcp-server')
    // SSOT mirror: the wire announcement must equal package.json's
    // version (the server derives it via createRequire) — asserting a
    // hand-pinned literal here would break on every version bump.
    const pkgVersion = createRequire(import.meta.url)('../../package.json').version
    expect(init.result.serverInfo.version).toBe(pkgVersion)

    s.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    )

    const tools = await s.request('tools/list', {})
    const names = tools.result.tools.map((t) => t.name).sort()
    expect(names).toEqual(['dice_roll', 'l5r4_roll', 'l5r5_roll'])

    const call = await s.request('tools/call', {
      name: 'dice_roll',
      arguments: { expression: '2d6+3' },
    })
    expect(call.result.isError).toBeFalsy()
    const parsed = JSON.parse(call.result.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.terms[0].rolls).toHaveLength(2)
    expect(parsed.total).toBeGreaterThanOrEqual(5)
    expect(parsed.total).toBeLessThanOrEqual(15)
  }, 15000)

  it('keeps stdout protocol-pure — diagnostics on stderr only', async () => {
    const s = spawnServer()
    await new Promise((r) => setTimeout(r, 800))
    await s.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'stdio-e2e-2', version: '1.0.0' },
    })
    await s.request('tools/call', { name: 'dice_roll', arguments: { expression: '1d20' } })

    const stdoutAll = s.stdoutChunks.join('')
    expect(stdoutAll).not.toContain('[DiceMCP]')
    expect(stderrAll(s)).toContain('[DiceMCP]')

    function stderrAll(s) {
      return s.stderrChunks.join('')
    }
  }, 15000)

  it('bin honors DICE_MCP_TRANSPORT=http override (env beats bin default)', async () => {
    const child = spawn(process.execPath, [BIN], {
      cwd: join(__dirname, '../..'),
      env: { ...process.env, DICE_MCP_TRANSPORT: 'http', DICE_MCP_PORT: '3791' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    sessions.push({
      child,
      stdoutChunks: [],
      stderrChunks: [],
      request: () => Promise.resolve({}),
    })
    await new Promise((r) => setTimeout(r, 1000))

    // HTTP mode: the wire is a socket, not stdio — probe the port.
    const res = await fetch('http://127.0.0.1:3791/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'env-override-e2e', version: '1.0.0' },
        },
      }),
    })
    expect(res.ok).toBe(true)
    child.kill('SIGTERM')
  }, 15000)
})

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-13

### Added

- **stdio transport** — the server now speaks JSON-RPC over stdin/stdout
  (mcp-ai's `cli` entry, SDK `StdioServerTransport`), matching the
  passgen UX. Zero-config for MCP clients:
  `{ "command": "npx", "args": ["-y", "@guan-tends/dice-mcp-server"] }`.
- `bin` entry `dice-mcp-server` (stdio by default).
- `DICE_MCP_TRANSPORT` env (stdio|http|sse) and JSON5 `transport` config
  key; explicit choice always beats entry defaults. Library entry keeps
  `http` default (back-compat with existing HTTP deployments).
- `sse` transport selectable via the same precedence chain.

### Changed

- ALL server diagnostics now go to **stderr** (stdout is the protocol
  wire in stdio mode — log leakage there corrupts the stream). HTTP-mode
  log text unchanged in content.
- `validateConfig` error precedence: port → host → transport (new field
  checked last; pre-existing port/host errors surface unchanged).

### Tests

- 11 unit tests (transport resolution, stdio→cli mapping, stderr-only
  logging) + 3 e2e tests (raw JSON-RPC over real stdio pipes: full
  initialize→tools/list→tools/call; stdout protocol purity; env override
  beats bin default). 168 total.

## [1.0.0] - 2026-09-13

### Added

- `dice_roll`: generic d20-style notation — NdM, +/-Z, kh/kl keeps,
  exploding (!, !11,12), reroll (rN), multi-term, optional DC verdict.
  Position-aware parse errors.
- `l5r4_roll`: L5R 4e Roll & Keep — pools, explosions (trained only),
  emphasis (reroll 1s before explosions), raises (+5 TN, Void-capped,
  free raises), untrained rules, wound penalties, GM narration hook
  (`wouldSucceedWithoutRaises`).
- `l5r5_roll`: L5R 5e ring/skill symbol dice — verified symbol tables,
  explosive bonus dice (chained, capped), keep policies
  (success_first/min_strife/max_opportunity) + explicit kept override,
  advantage/disadvantage conversions, tallies, composure advisory flag.
- Stateless design: injected RNG (CSPRNG production / sequence tests),
  loopback bind default, config via defaults <- JSON5 <- env.
- 142 tests: engines (deterministic), MCP tool layer, e2e MCP
  round-trip, CSPRNG distribution sanity with derived constants.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-09-13

### GM feedback lap — two iteration points from the retest report (PASS, 26 probes)

- **`explodeOn` union type** — accepts `9` (number), `"9"`, `[9, 10]`,
  `"9,10"`, or `"none"`. The call layer no longer coerces a bare number
  into a rejection (GM note #2). Engine already accepted
  number | number[] | 'none'; the MCP schema now matches.
- **`voidRing` contract made explicit** — verified pure raise-cap (a
  dedicated test proves it never touches the pool); its description now
  states "caps declared raises ONLY — never adds dice; spend voidPoint
  for +1k1" (GM note #1: the observed "+1 kept" came from a client-side
  convention shim mapping the old documented rollBonus/keepBonus path,
  which the ratified `voidPoint=true` convention replaces).

### Internal
- Die-chain ledger semantics documented in the interface test
  (`chain` includes the initial face; `final` = sum of the ledger).

## [1.2.1] — 2026-09-13

### Fixed
- **serverInfo.version single source of truth**: the MCP `initialize`
  response now derives its version from `package.json` (via
  `createRequire`) instead of a hand-synced literal — v1.2.0 shipped
  with the server announcing "1.1.0" because the literal was never
  bumped. This class of drift can no longer occur.

## [1.2.0] — 2026-09-13

### L5R 4e engine — full table-law conformance (community field report, D1–D8)

The 4e engine was torture-tested against the published rules by an independent
RPG agent; this release closes every defect found and adopts the verbatim
table-law spec (Report B).

**Fixed**
- **D1 — Ten Dice Rule** (§4): the signature normalization is now implemented
  verbatim — kept-cap first (+2 per excess kept die), rolled-cap, 2:1
  rolled→kept conversion *while kept < 10*, leftover +2 flat. Canonical
  vectors: 12k4→10k5 · 13k9→10k10+2 · 10k12→10k10+4 · 14k12→10k10+12 ·
  11k2 damage→10k2+2. Output adds `preCapPool` + `overflowBonus` for audit.
- **D2 — kept > rolled legal** (§5): initiative = Insight k Reflexes (1k4),
  damage 6k2, Honor 6k6 — all expressible via the new direct pool input
  (`rolled`/`kept`).
- **D3 — rollType** (§9): `skill | trait | ring | unskilled | custom`.
  Trait/ring rolls explode and allow raises; unskilled does neither.
  Back-compat: `skill: 0` with no flags still means unskilled.
- **D4 — wound penalty semantics** (§10): the penalty RAISES the effective
  TN and never touches the total (was previously added to the total).
  Wound-rank ladder documented in the tool description.
- **D5 — dice penalties** (§10): negative `rollBonus`/`keepBonus` accepted;
  after subtraction kept clamps to rolled (6k4 under −3k0 → 3k3).
- **D6 — Void Point**: new `voidPoint: true` = +1k1. (`voidRing` remains
  the raise-cap rating, matching the established +1k1 bonus convention.)
- **D7 — emphasis**: never applies to unskilled rolls (§8 — skill mechanic).
- **D8 — keepMode**: `lowest` keeps the smallest dice (§1 — deliberate
  failure is legal).

**Added**
- `totalBonus` — flat bonus to the kept sum (Honor Rank on Fear resistance,
  §11), distinct from dice bonuses.
- `explodeOn` — explosion faces: `10` (default), `9` (weapon mastery),
  `9,10`, or `none` (thrown weapons), §3.
- Richer output: `preCapPool`, `overflowBonus`, `rollType`, `keepMode`,
  `totals.totalBonus`.

**Tests**: 198 (from 168) — 11 Ten-Dice vectors, 19 interface/semantics
tests, 4 spec-change fixture flips with citations.

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

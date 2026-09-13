# @guan-tends/dice-mcp-server

Stateless dice engine MCP tool server. Pure dice math — no character sheets, no sessions, no persistence.

Three tools via the Model Context Protocol:

| Tool | System | Character |
|---|---|---|
| `dice_roll` | Generic d20-style notation | expression in, number out |
| `l5r4_roll` | Legend of the Five Rings 4e Roll & Keep (XkY+Z) | structured in, number + raises out |
| `l5r5_roll` | Legend of the Five Rings 5e (FFG) ring/skill symbol dice | structured in, symbols out |

Built on [@guan-tends/mcp-ai](https://github.com/guan-tends/mcp-ai) SimpleServer (HTTP transport, raw zod-shape schemas). Design follows the same composition-root pattern as `@guan-tends/matrix-mcp-server`.

## Tools

### `dice_roll` — generic notation

```
2d6+3        sum of 2d6 plus 3
d20          one d20
4d6kh3       keep highest 3 of 4d6 (ability scores)
2d20kl1      keep lowest 1 (disadvantage)
1d10!        exploding: reroll-and-sum while max faces appear
1d12!11,12   exploding on specific faces (L5R 5e skill die: 11 and 12)
3d6r1        reroll initial 1s once (emphasis shape)
2d6+1d4+2    multi-term
```

Add `dc` for a success verdict (`total >= dc`). Results include per-term
rolls, kept/dropped dice, and totals. Parse errors are position-aware
(`... at position 4`) so callers can fix their own syntax.

### `l5r4_roll` — Roll & Keep (4e)

Pools `(Trait + Skill)` d10s, keeps the highest `Trait`. D10s explode on
10s (trained rolls only). Parameters:

- `trait` 1–10 (keep count), `skill` 0–10 (0 = untrained)
- `tn` — target number. Scale: 5 trivial · 10 easy · 15 average · 20 difficult · 25 very hard · 30 extreme · 40 near-impossible
- `raises` (+5 TN each, capped by `voidRing`), `freeRaises` (effect only)
- `emphasis` — reroll initial 1s once, BEFORE explosion checks
- `penalty` — wound/stance penalty, applied once to the total
- `rollBonus`/`keepBonus` — e.g. a Void Point is +1k1

Untrained (skill 0): trait dice only, ALL kept, no explosions, no raises.
The result includes `wouldSucceedWithoutRaises` — the GM-narration hook
that says "he'd have made it, but the flourish cost him."

### `l5r5_roll` — Ring & Skill dice (5e)

Rolls `Ring` d6 ring dice + `Skill` d12 skill dice, then keeps
`Ring`-rating dice chosen AFTER seeing the pool. Faces carry symbols
(successes / opportunities / strife / explosive) per the verified charts:

| Ring d6 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| symbols | — | opp+strife | opp | succ+strife | succ | succ+strife+**expl** |

| Skill d12 | 1–2 | 3–5 | 6–7 | 8–9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|
| symbols | — | opp | succ+strife | succ | succ+opp | succ+strife+**expl** | **expl** (no strife) |

Explosive faces add one bonus die of the same type (chained, capped,
marked `bonusFor`, never consuming keep slots). TN is successes needed:
1 easy · 2 average · 3 difficult · 4 very hard · 5 extremely hard ·
6 extraordinary · 7+ heroic.

- `advantage` converts non-explosive ring dice to skill dice;
  `disadvantage` converts the worst skill die to a ring die.
- `kept="1,3"` overrides auto-keep with 1-based base-pool indices.
- `policy`: `success_first` (default), `min_strife`, `max_opportunity`.
- `composure` sets the advisory outburst flag (`strife >= composure`).

Results return the full pool with per-die symbols, the keeps, and tallies.

## Architecture

Functional core, imperative shell. All randomness is constructor-injected
(`rng(sides) => int in [1, sides]`): production uses `crypto.randomInt`
(unbiased CSPRNG); tests inject sequence RNGs, making every engine test
deterministic. Symbol tables are data — adding Genesys/Star Wars dice
later is a table entry, not a rewrite.

```
src/
├── index.js        composition root (config: defaults ← JSON5 ← env)
├── mcp-server.js   tool definitions + SimpleServer wiring
└── engine/
    ├── rng.js      createCryptoRng / createSequenceRng
    ├── core.js     rollDice: explode-on-faces, reroll, caps
    ├── notation.js expression parser (position-aware errors)
    ├── d20.js      expression evaluator
    ├── symbols.js  5e symbol tables (data)
    ├── l5r4.js     Roll & Keep engine
    └── l5r5.js     ring/skill symbol engine
```

Error rejection is two-layer: zod-schema violations (out-of-range params)
are rejected at the MCP protocol layer before the tool body runs;
cross-field rule violations (e.g. raises > Void Ring) surface as
`isError` JSON results with the engine's human-readable message.

## Running

```bash
npm install
npm test          # 142 tests (engines, tools, e2e round-trip, distribution)
npm start         # binds 127.0.0.1:3777 by default
```

Config (optional `config.json5`):

```json5
{
  port: 3777,        // HTTP port
  host: '127.0.0.1', // NOTE: inert (see below)
}
```

Environment overrides: `DICE_MCP_PORT`, `DICE_MCP_HOST`, `DICE_MCP_CONFIG`.

**Loopback enforcement**: mcp-ai SimpleServer's express `listen()` binds
all interfaces and ignores the `host` field. Loopback-only is enforced at
the deployment layer instead — systemd `IPAddressDeny=any` +
`IPAddressAllow=localhost` (cgroup packet filter) with UFW default-deny.
Until mcp-ai supports a server-side bind host, deploy the service with
both controls.

### Gateway wiring (mcp-ai aggregator)

Add to the aggregator's `mcps` array (back up config.json first):

```json
{ "id": "dice", "connection": { "type": "http", "url": "http://localhost:3777" } }
```

Then restart the gateway.

## Interpretation notes

Rules readings that are parameterized and documented, adjustable if a
table ruling differs:

- **5e untrained**: ring dice only (skill dice require the skill).
- **Advantage conversion timing**: implemented pre-keep, and never
  converts an explosive ring die (converting would lose the explosion).
- **Composure**: accepted as an explicit input with an advisory flag;
  the engine does not hardcode a composure formula.
- **4e wound penalties**: applied once to the total (the kept-dice total).

## License

MIT — see [LICENSE](LICENSE).

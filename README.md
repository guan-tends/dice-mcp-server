# @guan-tends/dice-mcp-server

Stateless dice engine MCP tool server. Pure dice math — no character sheets, no sessions, no persistence.

Three tools via the Model Context Protocol:

| Tool        | System                                                   | Character                          |
| ----------- | -------------------------------------------------------- | ---------------------------------- |
| `dice_roll` | Generic d20-style notation                               | expression in, number out          |
| `l5r4_roll` | Legend of the Five Rings 4e Roll & Keep (XkY+Z)          | structured in, number + raises out |
| `l5r5_roll` | Legend of the Five Rings 5e (FFG) ring/skill symbol dice | structured in, symbols out         |

Built on [@guan-tends/mcp-ai](https://github.com/guan-tends/mcp-ai) SimpleServer (HTTP transport, raw zod-shape schemas). Same composition-root pattern as `@guan-tends/matrix-mcp-server`.

## Quick Start

```bash
npm install
npm test    # 154 tests
npm start   # serves MCP HTTP on 127.0.0.1:3777
```

Point any MCP client at `http://localhost:3777/` (Streamable HTTP transport).

### Example: a d20 attack roll with advantage

```json
{
  "name": "dice_roll",
  "arguments": { "expression": "2d20kl1+5", "dc": 15 }
}
```

```json
{
  "success": true,
  "expression": "2d20kl1+5",
  "terms": [
    {
      "notation": "2d20kl1",
      "rolls": [
        { "face": 17, "chain": [], "final": 17, "rerolled": false },
        { "face": 8, "chain": [], "final": 8, "rerolled": false }
      ],
      "kept": [{ "face": 8, "chain": [], "final": 8, "rerolled": false }],
      "dropped": [{ "face": 17, "chain": [], "final": 17, "rerolled": false }],
      "subtotal": 13
    }
  ],
  "total": 18,
  "dc": 15,
  "success": true
}
```

### Example: a 4e katana strike (Agility 3, Kenjutsu 4, emphasis, Void spent)

```json
{
  "name": "l5r4_roll",
  "arguments": {
    "trait": 3,
    "skill": 4,
    "tn": 25,
    "emphasis": true,
    "rollBonus": 1,
    "keepBonus": 1,
    "label": "Katana strike"
  }
}
```

Returns `7d10k4` — pool, kept/dropped dice with explosion chains, totals,
TN verdict, and a `notes[]` array explaining every rule that fired. A
failed roll with raises carries `wouldSucceedWithoutRaises: true` — the
GM-narration hook ("he'd have made it, but the flourish cost him").

### Example: a 5e Fire check (Fire 3, Tactics 2, advantage)

```json
{
  "name": "l5r5_roll",
  "arguments": { "ring": 3, "skill": 2, "tn": 3, "advantage": true }
}
```

Returns the full pool with per-die symbols, kept indices, conversions,
and tallies:

```json
{
  "tallies": { "successes": 3, "opportunities": 1, "strife": 1, "explosive": 2 },
  "success": true,
  "composureExceeded": false
}
```

## Tool Reference

### `dice_roll` — generic notation

```
2d6+3        sum of 2d6 plus 3
d20          one d20
4d6kh3       keep highest 3 of 4d6 (ability scores)
2d20kl1      keep lowest 1 (disadvantage)
1d10!        exploding: reroll-and-sum while max faces appear
1d12!11,12   exploding on specific faces (5e skill die: 11 and 12)
3d6r1        reroll initial 1s once (emphasis shape)
2d6+1d4+2    multi-term
```

| Param        | Type          | Notes                                               |
| ------------ | ------------- | --------------------------------------------------- |
| `expression` | string        | required; whitespace-tolerant, case-insensitive     |
| `dc`         | int, optional | adds `dc` + `success` (`total >= dc`) to the result |

Parse errors are position-aware (`... at position 4`) so callers can fix
their own syntax. Doubled signs (`2d6--3`) and signless term
concatenation (`2d61d4`) are rejected with named errors.

### `l5r4_roll` — Roll & Keep (4e)

Pools `(Trait + Skill)` d10s, keeps the highest `Trait`. D10s explode on
10s (trained rolls only).

| Param                     | Range | Default  | Notes                                                                                            |
| ------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------ |
| `trait`                   | 1–10  | required | also the keep count                                                                              |
| `skill`                   | 0–10  | 0        | 0 = untrained                                                                                    |
| `tn`                      | —     | —        | 5 trivial · 10 easy · 15 average · 20 difficult · 25 very hard · 30 extreme · 40 near-impossible |
| `raises`                  | 0–10  | 0        | +5 TN each; capped by `voidRing`                                                                 |
| `freeRaises`              | 0–10  | 0        | effect only, no TN, never counts vs cap                                                          |
| `voidRing`                | 1–10  | —        | caps declared raises                                                                             |
| `emphasis`                | bool  | false    | reroll initial 1s once, BEFORE explosions                                                        |
| `penalty`                 | int   | 0        | wound/stance penalty, applied once to the total                                                  |
| `rollBonus` / `keepBonus` | 0–10  | 0        | Void Point = +1k1                                                                                |

Untrained (skill 0): trait dice only, ALL kept, no explosions, no raises
(raises on untrained rolls are rejected with an explanatory error).

### `l5r5_roll` — Ring & Skill dice (5e)

Rolls `Ring` d6 ring dice + `Skill` d12 skill dice, keeps `Ring`-rating
dice chosen AFTER seeing the pool.

| Param                     | Range  | Default       | Notes                                                                                                             |
| ------------------------- | ------ | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ring`                    | 1–5    | required      | also the keep count                                                                                               |
| `skill`                   | 0–5    | 0             | 0 = untrained (ring dice only)                                                                                    |
| `tn`                      | 1–10   | —             | successes needed: 1 easy · 2 average · 3 difficult · 4 very hard · 5 extremely hard · 6 extraordinary · 7+ heroic |
| `advantage`               | bool   | false         | convert non-explosive ring dice → skill dice                                                                      |
| `disadvantage`            | bool   | false         | convert worst skill die → ring die                                                                                |
| `conversions`             | string | —             | explicit `"2:skill,4:ring"` (1-based, overrides adv/disadv)                                                       |
| `policy`                  | enum   | success_first | `min_strife`, `max_opportunity`                                                                                   |
| `kept`                    | string | —             | `"1,3"` explicit keep (1-based, exactly ring-count)                                                               |
| `composure`               | int    | —             | advisory `composureExceeded` flag (kept strife ≥ value)                                                           |
| `includeExplosionBonuses` | bool   | true          | expand explosive faces into bonus dice                                                                            |

Verified symbol charts (cross-checked against two independent 5e
references):

| Ring d6 | 1   | 2          | 3   | 4           | 5    | 6                    |
| ------- | --- | ---------- | --- | ----------- | ---- | -------------------- |
| symbols | —   | opp+strife | opp | succ+strife | succ | succ+strife+**expl** |

| Skill d12 | 1–2 | 3–5 | 6–7         | 8–9  | 10       | 11                   | 12                   |
| --------- | --- | --- | ----------- | ---- | -------- | -------------------- | -------------------- |
| symbols   | —   | opp | succ+strife | succ | succ+opp | succ+strife+**expl** | **expl** (no strife) |

Explosive faces add one bonus die of the same type — chained, capped,
marked `bonusFor`, never consuming keep slots.

## Architecture

Functional core, imperative shell. All randomness is constructor-injected
(`rng(sides) => int in [1, sides]`): production uses `crypto.randomInt`
(unbiased CSPRNG); tests inject sequence RNGs, making every engine test
deterministic. Symbol tables are data — adding Genesys/Star Wars dice
later is a table entry, not a rewrite.

```
src/
├── index.js        bootstrap only (lifecycle, graceful shutdown)
├── config.js       config layers (defaults ← JSON5 ← env) + validation
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

## Design Decisions

- **Stateless.** No sheets, no sessions, no persistence. The caller is
  the GM brain; the server is dice math. Restart-safe by construction.
- **Teaching descriptions.** Every tool description embeds its system's
  TN scale and worked examples — an LLM caller learns the system from
  the tool itself.
- **Deterministic tests.** Sequence RNG injection makes explosion chains
  and keep decisions exactly reproducible; distribution tests with
  derived constants cover the real CSPRNG.
- **Dice-as-data.** 5e symbol tables are frozen data; new symbol systems
  are new tables, not new engines.
- **No array-typed tool params.** Kept indices, conversions, and explode
  faces are comma-strings — an MCP-gateway compatibility choice.
- **Interpretation notes** (parameterized, documented, adjustable if a
  table ruling differs): 5e untrained = ring dice only; advantage
  converts pre-keep and never sacrifices an explosive ring die;
  composure is an explicit input with an advisory flag (no hardcoded
  formula); 4e wound penalties apply once to the total. `dc` is
  permissive (any integer) — permissive inputs, strict dice math.

## Deployment

### Systemd (oryx pattern)

```ini
[Unit]
Description=Dice MCP Server
After=network.target

[Service]
Type=simple
User=guan
WorkingDirectory=/home/guan/src/dice-mcp-server
Environment="PATH=/home/guan/.nvm/versions/node/v22.22.2/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HOME=/home/guan"
ExecStart=/home/guan/.nvm/versions/node/v22.22.2/bin/node src/index.js
Restart=on-failure
RestartSec=5
# Loopback-only enforcement (see below)
IPAddressDeny=any
IPAddressAllow=localhost
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Loopback enforcement

mcp-ai SimpleServer's express `listen()` binds all interfaces and
ignores the `host` config field. Loopback-only is therefore enforced at
the deployment layer — systemd `IPAddressDeny=any` +
`IPAddressAllow=localhost` (cgroup packet filter) with UFW default-deny.
Until mcp-ai supports a server-side bind host, deploy with both
controls. (The `port` config IS honored.)

### Gateway wiring (mcp-ai aggregator)

Add to the aggregator's `mcps` array (back up config.json first):

```json
{ "id": "dice", "connection": { "type": "http", "url": "http://localhost:3777" } }
```

Then restart the gateway.

## Testing

```bash
npm test              # 154 tests: engines, tools, e2e, distribution
npm run test:coverage # with coverage
npm run lint          # eslint
npm run format:check  # prettier
```

Test layers:

1. **Engine units** — deterministic via sequence RNG; every rule path
   (explosions, emphasis ordering, untrained, raises/void, policies,
   conversions, overrides) asserted exactly.
2. **Tool units** — schema shape contract (raw zod shapes), happy paths,
   engine-error surfacing.
3. **E2E** — real MCP client over Streamable HTTP: initialize →
   listTools → callTool for every tool, both error layers.
4. **Distribution sanity** — real CSPRNG with derived constants
   (geometric-series explosion means, binomial success expectations).

## Roadmap

- **Genesys / Star Wars dice** — new symbol tables (data), same engine.
- **mcp-ai upstream**: server-side bind-host support for express
  `listen()` (removes the systemd-level loopback workaround).
- **Fate / other systems** — candidate engines behind the same tool
  interface.

## License

MIT — see [LICENSE](LICENSE).

# @guan-tends/dice-mcp-server

Stateless dice engine MCP tool server. Pure dice math — no sheets, no sessions, no persistence.

Three tools via the Model Context Protocol:

| Tool | System | Character |
|---|---|---|
| `dice_roll` | Generic d20-style notation (`2d6+3`, `4d6kh3`, `1d10!`, `3d6r1`) | expression in, number out |
| `l5r4_roll` | Legend of the Five Rings 4e Roll & Keep (XkY+Z) | structured in, number + raises out |
| `l5r5_roll` | Legend of the Five Rings 5e ring/skill symbol dice | structured in, symbols out |

Built on [@guan-tends/mcp-ai](https://github.com/guan-tends/mcp-ai) SimpleServer.

## Status

WIP — see CHANGELOG.md.

## License

MIT — see [LICENSE](LICENSE).

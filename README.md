<p align="center">
  <img src="plugins/test-them/assets/logo-full.png" alt="test them" width="420">
</p>

<h1 align="center">test them</h1>

<p align="center">
  Live HTTP evidence for AI agents.<br>
  Diagnose one endpoint. Write a fail-first HTML report. Never mock.
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-8a7048">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D18-339933">
  <img alt="mcp" src="https://img.shields.io/badge/MCP-stdio-555555">
  <img alt="hosts" src="https://img.shields.io/badge/Grok%20%7C%20Claude%20Code%20%7C%20Codex-111111">
</p>

## What this is

An agent asks **test them** to probe a real URL. The MCP server sends the request you named, then a matrix of validation / auth / protocol / contract cases against that same URL. Every case is a live `fetch`. The result is a standalone HTML report with pass/fail first, redacted wire, and a brand stamp.

It does **not**:

- mock (`nock`, `msw`, fixtures that skip the network)
- invent status codes or JSON
- assume Nest, JWT, or `{ statusCode, data, message }`
- generate Jest / pytest / Go tests unless you ask after the report exists

Auth examples in docs are fixtures for the self-check server, not a required API shape.

## Features

- **Live only** — connection failure is status `0`, verdict `fail`
- **Diagnosis matrix** — happy, validation, auth, protocol, contract
- **Fail-first HTML report** — scenario, purpose, expected, unexpected API result
- **Secret redaction** — passwords, tokens, cookies, JWTs (`eyJ***`) stay out of chat and HTML
- **Optional spec map** — OpenAPI, Swagger, or Postman JSON for a coverage note
- **Optional UI probe** — Playwright screenshots when you name a page
- **Brand stamp** — lockup image embedded as base64 so the HTML moves alone

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- One host: [Grok](https://grok.x.ai/), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), or [Codex](https://github.com/openai/codex)
- A reachable HTTP API (local or remote)
- Playwright only if you want `ui_probe`

## Install

Clone, then add this repo as a plugin marketplace.

```bash
git clone https://github.com/tonamson/test-it.git
cd test-it
```

```bash
# Grok
grok plugin marketplace add .
grok plugin install test-them --trust

# Claude Code (in the host)
# /plugin marketplace add .
# /plugin install test-them@test-them

# Codex
codex plugin marketplace add .
```

If the host did not install Node dependencies:

```bash
cd plugins/test-them && npm install
```

## Quick start

In the agent:

```text
test http://localhost:2054/auth/login with body {"username":"admin","password":"123123"}
```

The agent reads the skill, calls MCP `diagnose`, then `render`. You get `reports/*.html`.

Reply from the agent is only:

1. pass / fail counts
2. up to 5 findings
3. report path

Optional:

- pass a spec URL (`/docs-json`, Swagger, Postman) for a coverage note
- name a browser page to attach Playwright screenshots (`ui_probe`)

Stamp report ownership:

```text
configure({ brand: { name: "test them", owner: "Your Lab", product: "HTTP evidence", mark: "tt" } })
```

## How it works

```text
you name a URL
        │
        ▼
   skill (brain)
        │
        ▼
   MCP diagnose  ── live fetch per case
        │
        ▼
   MCP render    ── templates/report.html + Run JSON
        │
        ▼
   reports/<method>-<host-path>-<time>.html
```

| Piece | Path | Role |
| --- | --- | --- |
| Skill | `plugins/test-them/skills/test-them/SKILL.md` | When to run, what not to invent |
| MCP | `plugins/test-them/src/server.mjs` | Live tools over stdio |
| Template | `plugins/test-them/templates/report.html` | Fail-first paper |
| Schema | `plugins/test-them/schemas/run.schema.json` | Run + case shape |

## Diagnosis matrix

Default families: `happy`, `validation`, `auth`, `protocol`, `contract`.

| Family | Cases | Expected status |
| --- | --- | --- |
| `happy` | Seed request as given | `200`, `201` (other 2xx still pass) |
| `validation` | Drop each JSON field, empty string, `null`, wrong type | `400`, `422` |
| `auth` | Drop `Authorization`/`Cookie`, bad bearer, wrong secret fields | `401`, `403` |
| `protocol` | Malformed JSON, `text/plain`, omitted `Content-Type`, wrong method | `400`, `404`, `405`, `415`, `501` |
| `contract` | Extra `__probe` field, oversized strings (1k / 10k) | Prefer reject; 2xx is `warn` |

A case that gets the wrong success or the wrong error is marked **unexpected** in the report. Transport failure is status `0`.

Pass `families` on `diagnose` to run a subset.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `configure` | `baseUrl`, default headers, `allowWrite`, `timeoutMs` (default 15000), `brand` |
| `load_spec` | OpenAPI / Swagger / Postman JSON from URL or file |
| `call` | One live request |
| `diagnose` | Seed + matrix. Live only |
| `auth_from` | Copy a token from a prior case into `Authorization` |
| `render` | Write `templates/report.html` filled with the last Run |
| `ui_probe` | Playwright flow. Only when the user named a page |

Standalone MCP (stdio):

```bash
cd plugins/test-them && npm start
```

## Safety

- **Writes.** `allowWrite` defaults `false`. The seed `POST` / `PATCH` / `DELETE` on the URL you named is allowed. Extra write targets need an explicit yes in chat.
- **Secrets.** Keys matching password / token / authorization / cookie / api-key are `***`. JWT-shaped strings become `eyJ***`. Do not paste raw secrets into chat; the report is already redacted.
- **Redirects.** Same host only, max 5 hops. Cross-host redirect is blocked.
- **Bodies.** Captured response bodies cap at 64 KiB.
- **UI.** `ui_probe` is off unless you ask. Playwright is an optional dependency.

This tool hits real servers. Point it at environments you own or have permission to probe.

## Report

Output path (cwd):

```text
reports/<method>-<host-path>-<iso-time>.html
```

The file is standalone: brand lockup is a base64 `<img>`, run data is inlined JSON. No extra asset path.

Brand assets:

```text
plugins/test-them/assets/logo-full.png   # lockup (mark + wordmark)
plugins/test-them/assets/logo-mark.png   # icon only
```

## Development

```bash
cd plugins/test-them
npm install
npm run check
```

`npm run check` starts a local echo login server, runs the matrix, asserts redaction + English copy + logo embed, writes `reports/self-check.html`.

Node 18+. No extra test runner.

## Layout

```text
.
├── plugins/test-them/
│   ├── skills/test-them/SKILL.md   # brain
│   ├── src/                        # MCP hands
│   ├── templates/report.html       # paper
│   ├── schemas/run.schema.json
│   ├── assets/                     # brand images
│   └── bin/run.sh                  # host entry
├── .grok-plugin/marketplace.json
├── .claude-plugin/marketplace.json
└── .agents/plugins/marketplace.json
```

## Status

`0.1.0`. One endpoint per run. No Jest codegen, no Allure, no spec-wide fuzzer. Playwright is opt-in.

## Contributing

Issues and pull requests are welcome.

1. Keep traffic live. Do not add mocks.
2. Keep report copy English.
3. Run `npm run check` in `plugins/test-them` before you send a change.

## License

No license file is published yet. All rights reserved until one is added.

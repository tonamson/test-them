# API Probe design

See the approved implementation plan. v1 ships skill + MCP + one HTML template.

- Skill: `plugins/test-them/skills/test-them/SKILL.md`
- MCP: `plugins/test-them/src/server.mjs`
- Template: `plugins/test-them/templates/report.html`
- Schema: `plugins/test-them/schemas/run.schema.json`

Non-goals stay out: Jest codegen, Allure, default Playwright, spec-wide fuzzer.

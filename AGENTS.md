# AGENTS.md

Instructions for coding agents (and people) contributing to this repository.

## What this repository is

The Agent Harness Profile: a specification (`spec/agent-harness-profile.md`), JSON Schemas (`schemas/0.2/`), a Cedar schema, a zero-dependency reference implementation (`reference/`), test vectors (`test-vectors/0.2/`), a conformance runner (`scripts/conformance.mjs`), example template bundles (`examples/`), an Agent Skill (`skills/agent-harness-design/`) and plugin manifests.

## Setup and checks

- Node.js 22 or later.
- Install with `npm ci` (never `npm install` without a lockfile update reason).
- Run `npm test` before every commit. It must pass.
- To check one template bundle: `node scripts/conformance.mjs l1 <template-dir>`.
- To run the reference implementation against the vectors: `node scripts/conformance.mjs vectors`.

## Rules

1. **Keep BCP 14.** In the specification, MUST, MUST NOT, SHOULD, SHOULD NOT, MAY and the other RFC 2119 / RFC 8174 key words are used in capitals only with their normative meaning. Do not add capitalized key words for emphasis.
2. **Spec, schemas, reference code and vectors change together.** A change to a field name, type, value set or rule updates the specification prose, the schema, the reference code, the vectors and the examples in the same pull request.
3. **Update vectors only through the reference code.** Never edit expected values in `test-vectors/` by hand. Change `reference/`, regenerate, and explain the change.
4. **Update digests.** When you change any file in a template bundle, recompute its `sha256` in that bundle's `template.json`.
5. **Reference code has zero runtime dependencies.** Use Node.js built-ins only. Development dependencies are pinned to exact versions.
6. **Pin and cite.** Every external standard gets a pinned version and a URL in the References section of the specification. Do not invent versions; check the primary source.
7. **Never commit secrets.** No API keys, tokens, private keys or credentials of any kind, including in examples, test vectors or fixtures. Checkpoint test keys in vectors must be clearly generated test keys.
8. **Never add customer or personal data.** Use `example.com`, `example.org`, `example.net` and fictional organizations such as "Example Co.". No real names, email addresses, hostnames or customer content.
9. **No model names in templates.** `harness.json` states capabilities, never a model, model family or vendor.
10. **Skills are instruction-only.** No `scripts/` directory in template skills or in `skills/`. Never instruct a user or an agent to download and run a binary, to pipe a script into a shell, or to edit `~/.claude/settings.json` or any other agent configuration.
11. **No unverifiable claims.** Do not write that the profile is the first or the only one, do not describe conformance as certification, and do not claim that any product conforms.
12. **Do not commit or push unless asked.** Sign off commits with `git commit -s` (DCO) when you do.

## Style

Plain English, short sentences. Field tables give a requirement level for every field (Required, Conditionally Required, Recommended, Opt-In). `README.zh-TW.md` is written in Traditional Chinese as used in Taiwan, in a formal register.

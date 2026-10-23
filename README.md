# Agent Harness Profile

**Status: Draft, version 0.1.0.** Every section may change before 1.0.

Teams that put an AI agent to work for an organization keep asking Claude Code or Codex to build the same harness from scratch: which tools the agent may call, which actions a person must approve first, how to avoid sending the same email twice after a retry, what to log, and how to test it. Each result is different, and none of them can be checked by anyone else. The Agent Harness Profile is a written standard for that harness. It reuses existing specifications from major vendors and foundations wherever one exists, and defines only what is missing: approval records bound to the exact arguments of an action, an exactly-once write ledger, a verifiable audit format, and acceptance tests. An agent described this way is a *recipe bundle* that people can review, sign, exchange and check with a conformance runner.

Read the specification: [spec/agent-harness-profile.md](spec/agent-harness-profile.md)

## Built on existing standards

| Concern | Standard used | How |
|---|---|---|
| Agent definition | Oracle Open Agent Specification 26.3.1 | As published; `agent.json` is unmodified |
| Skills | Agent Skills (`SKILL.md`) | As published, instruction-only |
| Tool hints | MCP 2026-07-28 `ToolAnnotations` | Untrusted hints only |
| Authorization policy | Cedar 4 | As published, with a profile schema |
| Approval verdicts | Microsoft Agent Control Specification v0.4.0-beta.1 | Adopted and extended |
| Exactly-once writes | IETF Idempotency-Key draft -08, Stripe semantics | Adopted and extended |
| Audit records | CloudEvents 1.0.2, RFC 8785, RFC 9162, C2SP signed checkpoints | Adopted, plus two extension attributes |
| Tracing | OpenTelemetry GenAI conventions, W3C Trace Context | As published |
| Release signing | in-toto attestations, Sigstore, GitHub artifact attestations | As published |
| Defined here | Approval request and decision records, write ledger, harness sidecar, acceptance samples | No existing standard found |

Section 4 of the specification lists every standard with its pinned version and status.

## The recipe bundle

```
reception-enquiry/
  recipe.json              manifest: every file with its SHA-256 digest
  agent.json               Oracle Agent Spec 26.3.1 agent, unmodified
  harness.json             role, knowledge, tool permissions, work steps,
                           boundaries and approvals, model requirements and budget
  policy.cedar             Cedar policies: default deny, writes only with approval
  acceptance.json          acceptance samples, including a prompt-injection case
  skills/reception-reply/SKILL.md
```

Three complete examples are in [examples/](examples/): `reception-enquiry`, `ap-reconciliation` and `code-review`.

## Quick start

### Check a recipe bundle

Requires Node.js 22 or later.

```sh
npm ci && node scripts/conformance.mjs l1 examples/reception-enquiry
```

Other commands:

```sh
node scripts/conformance.mjs vectors   # reference implementation against all test vectors
npm test                               # everything CI runs
```

### Design a recipe with the skill

The repository includes an Agent Skill, `agent-harness-design`, that interviews you about an agent's job and writes a recipe bundle. It is instruction-only: it writes files in the recipe directory you choose and does not change your agent settings.

Claude Code, from a terminal:

```sh
claude plugin marketplace add orbanplatform/agent-harness
claude plugin install agent-harness@orbanplatform
```

or inside a Claude Code session:

```
/plugin marketplace add orbanplatform/agent-harness
/plugin install agent-harness@orbanplatform
```

Codex, from a terminal:

```sh
codex plugin marketplace add orbanplatform/agent-harness
codex plugin add agent-harness@orbanplatform
```

or inside Codex, open `/plugins` and install `agent-harness`.

## Conformance levels

| Level | Applies to | Meaning |
|---|---|---|
| **L1 Describe** | Recipe bundles | Every file validates against its schema, every digest matches, the lint rules pass, the skills pass `skills-ref validate`, and `agent.json` loads in `pyagentspec` 26.3.1. |
| **L2 Gate** | Harnesses | Unclassified tools are treated as writes, writes wait for approval, Cedar denies by default, approvals are bound to the exact arguments, agents never approve, and a timeout is a deny. |
| **L3 Prove** | Harnesses | Exactly-once write ledger, hash-chained audit events, RFC 9162 Merkle root and signed checkpoints that a third party can verify. |

Conformance is self-assessed with the runner and test vectors in this repository. There is no certification. See Section 16 of the specification.

## Repository layout

```
spec/agent-harness-profile.md   the specification
schemas/0.1/                    JSON Schemas (2020-12) and the Cedar schema
reference/                      reference implementation, zero runtime dependencies
test-vectors/0.1/               test vectors and bundles that must fail L1
scripts/conformance.mjs         conformance runner
examples/                       example recipe bundles
skills/agent-harness-design/    Agent Skill for designing recipes
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off, no CLA) and [GOVERNANCE.md](GOVERNANCE.md). Changes to conforming behaviour start as a GitHub issue labelled `proposal`.

## Security

Report vulnerabilities privately through GitHub private vulnerability reporting (Security tab) or to contact@orbanplatform.com. See [SECURITY.md](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Maintained by Orban Platform Inc.

[繁體中文說明](README.zh-TW.md)

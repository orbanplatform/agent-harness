---
name: agent-harness-design
description: Turns a short description of an AI agent's job into a complete template bundle that conforms to the Agent Harness Profile 0.2 (template.json, an Oracle Agent Spec 26.3.1 agent.json, harness.json with six chapters, a Cedar policy, acceptance samples including a prompt-injection sample, and Agent Skills). Use when someone asks to design, specify, scaffold, review, or fix an agent harness, agent template, tool permissions, human approval rules, or acceptance tests for an agent, or mentions agent-harness, harness.json, or template bundles.
license: Apache-2.0
metadata:
  profile: "https://orbanplatform.com/agent-harness/0.2"
  profile-version: "0.1.0"
---

# Agent harness design

Use this skill to turn a one-paragraph request ("an agent that answers website
enquiries and drafts replies") into a template bundle that conforms to the Agent
Harness Profile 0.1. The bundle describes the agent's job, its tool permissions,
the human approvals it needs, and how to test it. It contains no code.

The profile composes existing standards. Do not invent replacements for them:

| File | Standard | Notes |
|---|---|---|
| `agent.json` | Oracle Open Agent Specification 26.3.1 | A pure Agent Spec `Agent` document. No profile fields inside it. |
| `harness.json` | This profile | Six chapters. Linked to `agent.json` by the Agent component `id`. |
| `policy.cedar` | Cedar 4 | Default deny. Write tools need an approval bound to the call's arguments. |
| `acceptance.json` | This profile (field names follow UK AISI Inspect `Sample`) | At least six samples, including a prompt-injection sample. |
| `skills/<name>/SKILL.md` | Agent Skills (agentskills.io) | Instruction-only. No `scripts/`. |
| `template.json` | This profile | Manifest with a SHA-256 digest of every file. |

If the repository you are working in contains `spec/agent-harness-profile.md`
and `schemas/0.2/`, those files are authoritative. Read them when a rule below
seems ambiguous, and follow them if they differ from this skill. The
`examples/` directory of the profile repository has three complete bundles to
compare against.

## Safety rules for this skill

- Write only inside the template directory the user agreed on. Do not edit the
  settings, permission files, or hooks of any coding tool (for example
  `~/.claude/settings.json`, `.claude/settings.json`, `.codex/config.toml`,
  `hooks/hooks.json`). A template describes permissions for the agent it defines;
  it never grants permissions to the tool you are running in.
- Do not download or run binaries, installers, or scripts from the internet.
  Use validators only if they are already installed or present in the
  repository, and ask the user before installing anything.
- Do not put personal data in any file. Use fictional organizations
  ("Example Co.") and `example.com`, `example.org`, or `example.net` addresses
  in samples, even if the user offers real records.
- Do not put model names, API keys, endpoint URLs, or credentials in any file.
  The deployer binds the model at load time.
- Do not claim that a bundle is certified or that any product conforms. Report
  which checks were run and what they printed.

## Workflow

Follow these steps in order and keep a checklist in your reply.

1. **Map the request.** Assign every sentence of the request to one of the six
   chapters below and note what is missing.
2. **Interview once.** If required information is missing, ask all open
   questions in a single message, grouped by chapter, each with a proposed
   default the user can accept. Use the question bank in
   [references/interview.md](references/interview.md). Do not ask about things
   the request already answers. If the user says "use your defaults", use the
   fail-closed defaults listed there.
3. **List and classify the tools.** One entry per tool the agent may call.
   Apply the classification rules below. Show the user a table of tools with
   `kind`, `approval`, and `limit`, and get confirmation before writing files.
4. **Write the files** in this order: `agent.json`, `harness.json`,
   `policy.cedar`, `skills/<name>/SKILL.md`, `acceptance.json`, and
   `template.json` last. Field-by-field guidance is in
   [references/bundle-files.md](references/bundle-files.md).
5. **Compute digests last**, after every other file is final (see "Digests").
6. **Validate** (see "Validation") and fix every reported problem.
7. **Report** the file list, the tool table, open assumptions, and the exact
   validator output.

## The six chapters of harness.json

| # | Chapter | Key | Must contain |
|---|---|---|---|
| 1 | Role and voice | `role` | `title`, at least one `duties` item, `acts_on_behalf_of`, a non-empty `reports_to`; recommended `voice`, `locale` |
| 2 | Knowledge sources | `knowledge` | Each source with `name`, `kind` (document, database, api, web), `access: "read"`, `citation` (required, recommended, none) |
| 3 | System permissions | `tools` | Exactly one entry per Agent Spec tool, matched by tool `name`: `kind`, `approval`, `limit`, `classification`, optional `recipient_binding` |
| 4 | Work steps | `workflow` | `triggers` (kind: event, schedule, message, manual), ordered `steps`, `on_failure` (stop_and_report, retry_then_report), `handoffs` (`to`, `when`) |
| 5 | Boundaries and approvals | `boundaries` | `may_do_alone`, `must_ask`, `never`, `escalate_when`, `approval`, `separation_of_duties` |
| 6 | Model and budget | `model` | Required capabilities only, never a model name; `min_context_tokens`; `languages`; `budget.monthly_tokens` greater than zero; `on_exceed` |

## Classification rules

Every tool gets exactly one `kind`: `read` or `write`.

- A tool is `read` only if calling it cannot change anything outside the agent's
  own run: it does not send, post, publish, create, update, delete, book, pay,
  approve, merge, deploy, or trigger another system.
- Everything else is `write`. If you are unsure, it is `write`.
- **Unclassified means write.** The declared `kind` takes effect only when
  `classification.source` is `"operator"`, meaning the deployer or operator
  confirmed it. With `"mcp_annotations"`, `"unclassified"`, or no
  `classification`, the effective kind is `write` (fail closed). Never mark a
  tool `operator` unless the user confirmed the classification.
- **MCP tool annotations are hints, not facts.** `readOnlyHint`,
  `destructiveHint`, `idempotentHint`, and `openWorldHint` come from the tool's
  server and are untrusted unless the server is trusted. Copy them into
  `classification.mcp_annotations` to explain a suggestion. An annotation never
  makes a tool `read` by itself.
- A `read` tool that sends arguments to an open-world system (web search, a
  third-party API) can leak data through its arguments. Point this out and
  suggest a narrower tool or a `write` classification.
- Every tool name in `harness.json` MUST exist in `agent.json`, and every tool in
  `agent.json` MUST appear in `harness.json`.

## Approval levels

| Effective kind | Allowed `approval` | Meaning |
|---|---|---|
| `read` | `never` | Runs without a human decision. |
| `write` | `always` | Every call needs a human approval bound to its exact arguments. |
| `write` | `over_limit` | Needs approval when the call exceeds `limit`, for example `{"field": "amount", "max": 500, "unit": "USD"}`. `limit.field` names a tool input. `limit` is required. |

Rules that always apply:

- A write tool MUST NOT have `approval: "never"`. Use `"limit": null` unless
  `approval` is `over_limit`.
- A write tool in `agent.json` sets `"requires_confirmation": true`, and a tool
  with `requires_confirmation: true` MUST NOT have `approval: "never"`.
- `boundaries.approval.on_timeout` MUST be `"deny"`: an expired request is a
  denial. `default_resolver` names a key of `resolvers` whose `type` is
  `"human"`.
- `boundaries.separation_of_duties.requester_may_approve` MUST be `false`. No
  agent, including the requesting agent, ever approves.
- An approval is valid only for the exact arguments it showed. The decision
  echoes `enforced_identity`, which equals the request's `arguments_digest`
  (hex SHA-256 of the RFC 8785 canonical JSON of the arguments). Changed
  arguments, including an approver's edit, need a new request.
- When a write reaches a person or an outside system, bind the target to a
  record the model did not write (for example the sender address stored on an
  enquiry), describe it in `recipient_binding`, and prefer tool inputs that take
  a record ID over inputs that take a free-form address.
- MCP elicitation alone is not an approval mechanism: it does not guarantee a
  human, does not bind arguments, and is unsigned.

## Cedar policy pattern

`policy.cedar` is validated in strict mode against the profile's Cedar schema
(`schemas/0.2/harness.cedarschema`, namespace `OrbanHarness`) extended with one
action per `harness.json` tool. Entity types are `Agent`, `Human`, `Tool`; the
context is `{ approval: { granted, decision_id, enforced_identity },
arguments_digest, run_id, task_id }`. Cedar denies every request that no
`permit` allows and that any `forbid` matches. Write:

```cedar
// Read tools: no approval needed.
@id("read-tools")
permit (
  principal == OrbanHarness::Agent::"<agent id>",
  action in [OrbanHarness::Action::"<read tool 1>", OrbanHarness::Action::"<read tool 2>"],
  resource
);

// Each write tool: only with a granted approval bound to these exact arguments.
@id("<write tool>-approved")
permit (
  principal == OrbanHarness::Agent::"<agent id>",
  action == OrbanHarness::Action::"<write tool>",
  resource
)
when {
  context.approval.granted &&
  context.approval.enforced_identity == context.arguments_digest
};
```

Then add an explicit `forbid` for each `boundaries.never` item that this
vocabulary can express, with a comment quoting the item. Policies may name only
the template's own tool actions, so a `never` item about an action the agent has
no tool for (merge, push, pay) is covered by default deny: say so in a comment
instead of inventing an action. Items about content (for example "never quote
a price that is not in the price list") stay in `harness.json` and in the
acceptance samples. See
[references/policy-and-acceptance.md](references/policy-and-acceptance.md).

## Acceptance samples

`acceptance.json` holds at least six samples, at least one per scenario:

| Scenario | What it tests |
|---|---|
| `baseline` | The normal job end to end, including the approval request for each write tool. |
| `missing_data` | Required information is absent; the agent asks or escalates instead of guessing. |
| `tool_error` | A tool fails; the agent follows `workflow.on_failure` and does not invent results. |
| `human_edit` | The approver changes the draft; the edited arguments get their own approval. |
| `interruption` | The run stops after approval and resumes; `expect.max_executions` bounds each write tool it exercises to 1. |
| `injection` | Untrusted data contains a hidden instruction; the agent does not follow it. |

The `injection` sample is mandatory. Hide an instruction inside data the agent
reads (an email body, an invoice memo, a pull request description) that tries
to make it write to a target the attacker chose. List every write tool in
`expect.must_not_call` and the attacker's target in `expect.forbidden_targets`.
Every write tool MUST appear in `expect.approvals_requested` of at least one
sample. Use only fictional names and `example.com`, `example.org`, or
`example.net` values in sample data.

## Digests

`template.json` lists every file with its `role`, `path`, `standard`, and
`sha256`: the lowercase hex SHA-256 of the file bytes exactly as stored.
Compute digests only after every other file is final, because any later edit
changes them:

```sh
shasum -a 256 agent.json harness.json policy.cedar acceptance.json skills/*/SKILL.md
# or: sha256sum <files>
```

Exactly one file each for the roles `agent`, `harness`, `policy`, and
`acceptance`; one or more `skill` files. If you edit any file afterwards,
recompute its digest.

## Validation

Run what is available, in this order, and report each result verbatim:

1. `node scripts/conformance.mjs l1 <template-dir>` if the repository contains
   `scripts/conformance.mjs`. It checks the schemas, digests, lint rules, and
   the Cedar policy. Fix every error and run it again until it passes.
2. `skills-ref validate <template-dir>/skills/<name>` if the Agent Skills
   reference validator is already installed.
3. Loading `agent.json` with pyagentspec 26.3.1, if it is already installed,
   supplying the deployer's LLM configuration under the key `llm` through
   `components_registry`.

If a validator is not available, say so instead of claiming the check passed.

## Common mistakes

- Putting harness fields inside `agent.json`. Only `metadata` carries the link
  `{"com.orbanplatform/harness": "harness.json"}`.
- Naming a model, provider, or endpoint. Use `{"$component_ref": "llm"}` for
  `llm_config`.
- Classifying a tool as `read` because its MCP annotation says so.
- A write tool with `approval: "never"`, or `over_limit` without `limit`.
- A Cedar `permit` for a write tool without the `enforced_identity` check, or a
  policy that names an action that is not one of the template's tools.
- An injection sample that checks only the final text and not the tool calls.
- Editing a file after computing digests.

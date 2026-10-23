# Bundle files, field by field

A recipe bundle is one directory:

```
<recipe-id>/
  recipe.json
  agent.json
  harness.json
  policy.cedar
  acceptance.json
  skills/<skill-name>/SKILL.md
```

`<recipe-id>` uses lowercase letters, digits, and hyphens (2 to 63 characters).
The JSON Schemas in `schemas/0.1/` are authoritative; this page summarizes them.

## agent.json (Oracle Agent Spec 26.3.1)

A pure Agent Spec document whose top-level component is an `Agent`. Use the
Agent Spec serialization exactly:

- `component_type` (not `type`) names the component class: `"Agent"` at the
  top, `"ServerTool"` for each tool the runtime executes.
- `agentspec_version` is `"26.3.1"`, at the top level only.
- `id` of the Agent is the value of `harness.json` `agent_ref`. Every component
  `id` in the file is unique; using the tool name as the tool `id` is fine.
- `metadata` is `{"com.orbanplatform/harness": "harness.json"}`. Nothing else of
  this profile goes into `agent.json`.
- `llm_config` is `{"$component_ref": "llm"}`. The deployer supplies the LLM
  configuration under the key `llm` when loading (Agent Spec disaggregated
  configuration; in pyagentspec, `components_registry={"llm": <LlmConfig>}`).
- `system_prompt` states the job, the steps, which data is untrusted, and when
  to stop and report. Placeholders such as `{{enquiry_id}}` must match the
  Agent's `inputs`.
- `inputs` and `outputs` are lists of JSON Schema objects, each with at least
  `title` and `type`, plus `description` and `default` where useful.
- `tools`: one `ServerTool` per tool with `name`, `description`, `inputs`,
  `outputs`, `metadata: {}`, and `requires_confirmation` (`true` for write
  tools, `false` for read tools).
- Tool names may use letters, digits, `_`, `-`, and `.` (for example
  `mail_send`). Some model providers do not accept `.` in function names; the
  runtime maps names if needed, the recipe keeps the canonical name.
- Also include `toolboxes: []`, `human_in_the_loop: true`, and
  `transforms: []` so the document matches what Agent Spec 26.3.1 serializers
  produce.

Minimal shape:

```json
{
  "component_type": "Agent",
  "id": "reception",
  "name": "Reception",
  "description": "One sentence on the agent's job.",
  "metadata": {"com.orbanplatform/harness": "harness.json"},
  "inputs": [{"title": "enquiry_id", "type": "string"}],
  "outputs": [],
  "llm_config": {"$component_ref": "llm"},
  "system_prompt": "You are ... Your task is enquiry {{enquiry_id}} ...",
  "tools": [
    {
      "component_type": "ServerTool",
      "id": "mail_send",
      "name": "mail_send",
      "description": "Send a reply to the sender recorded on the enquiry.",
      "metadata": {},
      "inputs": [{"title": "enquiry_id", "type": "string"}, {"title": "body", "type": "string"}],
      "outputs": [{"title": "message_id", "type": "string"}],
      "requires_confirmation": true
    }
  ],
  "toolboxes": [],
  "human_in_the_loop": true,
  "transforms": [],
  "agentspec_version": "26.3.1"
}
```

Design write-tool inputs so the model cannot choose a dangerous target: take a
record ID (`enquiry_id`, `supplier_id`) and let the runtime resolve the
recipient from the record. Inputs named in `limit.field` must exist on the tool.

## harness.json

| Path | Required | Values and rules |
|---|---|---|
| `$schema` | Recommended | `https://orbanplatform.com/agent-harness/schemas/0.1/harness.schema.json` |
| `profile_version` | Required | `"0.1.0"` |
| `agent_ref` | Required | The Agent `id` in `agent.json` |
| `role.title` | Required | Job title |
| `role.duties` | Required | At least one short sentence |
| `role.voice` | Recommended | For example `"formal, concise"` |
| `role.acts_on_behalf_of` | Required | Organization the agent acts for |
| `role.reports_to` | Required | Non-empty human role or principal id |
| `role.locale` | Recommended | BCP 47 tag |
| `knowledge[]` | Required (may be empty) | `name`, `kind` (document, database, api, web), `access: "read"`, `citation` (required, recommended, none), optional `description` |
| `tools[]` | Required | `name`, `kind` (read, write), `approval` (always, over_limit, never), `limit` (object for over_limit, otherwise `null`), `classification` (`source`: operator, mcp_annotations, unclassified; optional `mcp_annotations`), optional `recipient_binding`, optional `description` |
| `workflow.triggers[]` | Required | `kind` (event, schedule, message, manual), `description` |
| `workflow.steps[]` | Required | Ordered short sentences; put an approval step before each write |
| `workflow.on_failure` | Required | `stop_and_report` or `retry_then_report` |
| `workflow.handoffs[]` | Recommended | `to` (role, principal, or component id), `when` |
| `boundaries.may_do_alone[]`, `must_ask[]`, `never[]`, `escalate_when[]` | Required (may be empty) | Short sentences |
| `boundaries.approval` | Required | `default_resolver`, `timeout_seconds`, `on_timeout: "deny"`, optional `fatigue_threshold`, `fatigue_window_seconds`, and `resolvers` as a map: `{"human": {"type": "human", "channels": ["console", "email_link"]}}` |
| `boundaries.separation_of_duties` | Required | `requester_may_approve: false`, `dispatcher_may_approve`, `record_dispatcher_self_approval` |
| `model.requirements.capabilities` | Required | From: tool_calling, parallel_tool_calling, structured_output, vision, audio_input, long_context, reasoning, streaming |
| `model.requirements.min_context_tokens` | Recommended | Integer |
| `model.requirements.languages` | Recommended | BCP 47 tags |
| `model.budget.monthly_tokens` | Required | Integer greater than 0 |
| `model.budget.on_exceed` | Required | `pause_and_notify`, `notify_only`, or `stop` |
| `extensions` | Opt-In | Keys namespaced like `com.example/name`; never relax a rule |

`boundaries.approval` keeps the field names of the Microsoft Agent Control
Specification approval section so it can be copied into such a manifest.

Tool entry examples:

```json
{"name": "pricelist_lookup", "kind": "read", "approval": "never", "limit": null,
 "classification": {"source": "operator", "mcp_annotations": {"readOnlyHint": true}}}

{"name": "ledger_post_adjustment", "kind": "write", "approval": "over_limit",
 "limit": {"field": "amount", "max": 500, "unit": "USD"},
 "classification": {"source": "operator"}}

{"name": "mail_send", "kind": "write", "approval": "always", "limit": null,
 "classification": {"source": "operator"}, "recipient_binding": "request_record"}
```

## policy.cedar

See [policy-and-acceptance.md](policy-and-acceptance.md).

## acceptance.json

| Path | Required | Values and rules |
|---|---|---|
| `$schema` | Recommended | `https://orbanplatform.com/agent-harness/schemas/0.1/acceptance.schema.json` |
| `profile_version` | Required | `"0.1.0"` |
| `recipe_id` | Required | `recipe.json` `id` |
| `samples[].id` | Required | Unique |
| `samples[].description` | Recommended | What the sample checks |
| `samples[].input` | Required | Task text, or a list of chat messages |
| `samples[].target` | Required | What a correct outcome contains (grader guidance) |
| `samples[].metadata` | Required | `scenario` (baseline, missing_data, tool_error, human_edit, interruption, injection) and `grader` (code, model, human); other keys allowed |
| `samples[].files` | Opt-In | Map of file name to inline text, for example stubbed tool responses |
| `samples[].setup`, `sandbox` | Opt-In | Declarative only; never ask anyone to download or run binaries |
| `samples[].expect` | Required | `must_call`, `must_not_call`, `approvals_requested`, `must_ask`, `outcome_includes`, `outcome_excludes`, `forbidden_targets`, `max_executions` |

See [policy-and-acceptance.md](policy-and-acceptance.md) for what each scenario
must assert.

## skills/<name>/SKILL.md

An Agent Skill with YAML front matter and Markdown instructions:

```markdown
---
name: reception-reply
description: What the skill does and when to use it (at most 1024 characters).
license: Apache-2.0
---

# Reception reply

Step-by-step instructions, examples, and edge cases.
```

- `name`: 1 to 64 characters, lowercase letters, digits, and single hyphens,
  equal to the folder name.
- `description`: 1 to 1024 characters, says what the skill does and when to use
  it.
- Instruction-only: no `scripts/` folder and no instructions to download or run
  binaries. `allowed-tools` is experimental and is not a security boundary.
- Keep it under 500 lines; it should repeat the untrusted-data rule for the data
  the skill handles.

## recipe.json

| Path | Required | Values and rules |
|---|---|---|
| `$schema` | Recommended | `https://orbanplatform.com/agent-harness/schemas/0.1/recipe.schema.json` |
| `profile` | Required | `https://orbanplatform.com/agent-harness/0.1` |
| `profile_version` | Required | `"0.1.0"` |
| `id` | Required | `^[a-z0-9][a-z0-9-]{1,62}$`, usually the directory name |
| `title` | Required | Short title |
| `summary` | Required | At most 500 characters |
| `locale` | Required | BCP 47 tag of the bundle's text |
| `files[]` | Required | `role`, `path`, `standard`, `sha256` for every file except `recipe.json` |
| `provenance` | Required | `generated_by` (`human` or the tool name), `reviewed_by_human` (true only if a person reviewed the whole bundle), `created` (RFC 3339) |

File entries:

| role | path | standard |
|---|---|---|
| agent | `agent.json` | `agentspec@26.3.1` |
| harness | `harness.json` | `agent-harness@0.1.0` |
| policy | `policy.cedar` | `cedar@4` |
| acceptance | `acceptance.json` | `agent-harness@0.1.0` |
| skill | `skills/<name>/SKILL.md` | `agentskills` |

Set `reviewed_by_human` to `false` for a bundle you generated; the user changes
it after reviewing.

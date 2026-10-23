# Agent Harness Profile

**Version 0.1.0 (Draft)**

| | |
|---|---|
| Profile URI | `https://orbanplatform.com/agent-harness/0.1` |
| Version | 0.1.0 |
| Status | Draft |
| Date | 2026-10-22 |
| Editors | Orban Platform Inc. maintainers (contact@orbanplatform.com) |
| Repository | https://github.com/orbanplatform/agent-harness |
| Schemas | `schemas/0.1/` (JSON Schema 2020-12, `$id` base `https://orbanplatform.com/agent-harness/schemas/0.1/`) |

Copyright 2026 Orban Platform Inc.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

## Abstract

This document defines the Agent Harness Profile, a profile of existing specifications for describing and running an AI agent that acts on behalf of an organization. A profile, in the sense used by the OpenID FAPI profiles of OAuth 2.0 [FAPI], selects and constrains existing standards and defines only what they leave unspecified.

The profile specifies a *recipe bundle*: a directory that describes an agent's job (as an Oracle Open Agent Specification document), its tool permissions, its human approval rules, its authorization policy (in Cedar), its acceptance tests, and the Agent Skills it uses. It further specifies the runtime behaviour a *harness* needs to execute such a recipe safely: tool classification that fails closed, approval records bound to the exact arguments of an action, exactly-once execution of writes, tamper-evident audit records that a third party can verify, and trace correlation.

The profile adopts, as published, the Oracle Open Agent Specification, Agent Skills, Cedar, CloudEvents (adding two extension attributes through the CloudEvents extension mechanism), RFC 8785, RFC 9162, the C2SP signed-note and tlog-checkpoint specifications, OpenTelemetry GenAI semantic conventions, W3C Trace Context and the in-toto Attestation Framework. It extends the Microsoft Agent Control Specification approval model and the IETF Idempotency-Key draft. It defines new formats only for approval request and decision records, the write ledger, the harness sidecar, and acceptance samples, because no existing specification covers them.

## Status of This Document

This is a Draft of version 0.1.0 of the Agent Harness Profile. It is published by Orban Platform Inc. to collect review and implementation experience. It is not a standard of the IETF, W3C, the Linux Foundation, the Agentic AI Foundation or any other standards body, and none of them has reviewed or endorsed it.

The profile is versioned with Semantic Versioning 2.0.0 [SEMVER] (see [Section 20](#20-versioning-and-change-process)). While the major version is 0, any minor release can contain breaking changes. Implementations SHOULD state the exact version they implement.

Each section carries a stability marker, following the convention of the OpenTelemetry specification [OTEL-STATUS]:

| Marker | Meaning |
|---|---|
| **Development** | The section can change in any way, including incompatibly, in any minor release. Feedback is requested. |
| **Stable** | The section changes incompatibly only in a new major version. Deprecated items are kept for at least 12 months after 1.0.0 (see [Section 20](#20-versioning-and-change-process)). |

**Every section of version 0.1.0 is Development.** No section is Stable.

Comments are welcome as GitHub issues at https://github.com/orbanplatform/agent-harness/issues. Security problems are reported privately as described in `SECURITY.md`.

Known open issues in this Draft are listed in [Section 1.4](#14-open-issues).

## Table of Contents

1. [Conventions](#1-conventions)
2. [Terminology](#2-terminology)
3. [Design Principles](#3-design-principles)
4. [Standards This Profile Builds On](#4-standards-this-profile-builds-on)
5. [Recipe Bundle](#5-recipe-bundle)
6. [Agent Definition](#6-agent-definition)
7. [Harness Sidecar](#7-harness-sidecar)
8. [Tool Classification](#8-tool-classification)
9. [Policy](#9-policy)
10. [Approval](#10-approval)
11. [Exactly-Once Writes](#11-exactly-once-writes)
12. [Audit](#12-audit)
13. [Tracing](#13-tracing)
14. [Acceptance Tests](#14-acceptance-tests)
15. [Distribution and Signing](#15-distribution-and-signing)
16. [Conformance](#16-conformance)
17. [Security Considerations](#17-security-considerations)
18. [Privacy Considerations](#18-privacy-considerations)
19. [Relationship to Other Work](#19-relationship-to-other-work)
20. [Versioning and Change Process](#20-versioning-and-change-process)
- [Appendix A. Control Mappings (Informative)](#appendix-a-control-mappings-informative)
- [References](#references)

---

## 1. Conventions

**Stability: Development**

### 1.1 Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

### 1.2 Field Requirement Levels

Field tables in this document give each field one of the following requirement levels, following the OpenTelemetry semantic conventions:

| Level | Meaning |
|---|---|
| Required | The field MUST be present. |
| Conditionally Required | The field MUST be present when the stated condition holds, and otherwise SHOULD be absent unless stated. |
| Recommended | The field SHOULD be present. |
| Opt-In | The field MAY be present. Producers include it only by deliberate choice. |

The JSON Schemas in `schemas/0.1/` are normative for syntax. Where a schema and the prose of this document disagree, the prose of this document is authoritative and the disagreement is a defect to be reported. Schema validation is necessary but not sufficient: the lint rules in this document are checked by the conformance runner ([Section 16](#16-conformance)).

### 1.3 Notation

- `JCS(x)` is the RFC 8785 [RFC8785] canonical serialization of the JSON value `x`, as UTF-8 bytes.
- `SHA-256(b)` is the SHA-256 hash [FIPS180-4] of the byte string `b`. `hex(...)` is lowercase hexadecimal with no prefix. `base64(...)` is standard base64 with padding [RFC4648].
- `‖` is byte-string concatenation.
- All JSON documents defined by this profile MUST be I-JSON [RFC7493]. Integers outside the range ±(2^53 − 1) MUST be encoded as strings.
- Timestamps are RFC 3339 [RFC3339] date-time strings. Producers SHOULD use UTC with the `Z` suffix.
- Examples use `example.com`, `example.org` and the fictional organization "Example Co.". Examples are not normative unless stated.

### 1.4 Open Issues

The following are known gaps in this Draft. Each is tracked as a GitHub issue labelled `proposal`.

1. **Argument values in policy.** The Cedar context ([Section 9.2](#92-cedar-schema)) carries the arguments digest and one value the harness computes from the arguments, `limit_exceeded`, but not the argument values themselves. Policies that depend on other argument values cannot yet be written in Cedar under this profile.
2. **Per-approver signatures.** Approval decisions are authenticated by the harness, not signed by the approver. Checkpoint signatures ([Section 12.7](#127-signed-checkpoints)) are signatures of the log operator. Non-repudiation of an individual approver is out of scope for 0.1.0.
3. **COSE Receipts.** RFC 9942 COSE Receipts [RFC9942] are a candidate encoding for inclusion and consistency proofs in a later version.
4. **A2A Agent Card generation.** Generating an A2A Agent Card [A2A] from `agent.json` and `harness.json` is described only informatively ([Section 6.5](#65-discovery-informative)).

---

## 2. Terminology

**Stability: Development**

This document uses the following terms. Terms from the Anthropic article "Demystifying evals for AI agents" [ANTHROPIC-EVALS] (task, trial, grader, transcript, outcome, pass@k, pass^k) are used with the meanings given there and are summarised in [Section 14](#14-acceptance-tests).

**Agent**
: A software system in which a language model selects and invokes tools to accomplish a task. In this profile, an agent is described by an Agent Spec `Agent` component [AGENT-SPEC].

**Harness**
: The runtime that hosts an agent and enforces this profile: it classifies tools, evaluates policy, holds actions for approval, keeps the write ledger, executes tools, and writes audit events. The Anthropic article cited above calls this "the system that enables a model to act as an agent". In ACS [ACS] terms, the harness is the *host*.

**Recipe**
: A recipe bundle ([Section 5](#5-recipe-bundle)): the directory that describes one agent's job and the rules that govern it. A recipe contains no credentials, no personal data and no model names.

**Deployer**
: The party that installs a recipe into a harness. The deployer supplies the model configuration, credentials and bindings of tools to real systems, and accepts the tool classification.

**Operator**
: The party that runs the harness and is accountable for its configuration, including tool classification. The deployer and the operator MAY be the same party.

**Principal**
: An authenticated identity on whose authority an action is evaluated. A principal is either a *human principal* or an *agent principal*. Every agent is an agent principal.

**Requester**
: The agent principal that proposed an action that requires approval.

**Dispatcher**
: The human principal that assigned the task to the agent, if any.

**Approver**
: A human principal that is eligible to decide a given approval request.

**Resolver**
: The component that obtains an approver's decision for an action that was denied pending approval, through a channel such as a console or an email link. The term and the configuration fields are those of ACS ([Section 10.1](#101-verdict-model)).

**Run**
: One execution of an agent on one task, identified by a `run_id`.

**Task**
: A unit of work assigned to an agent, identified by a `task_id`. A task can span several runs, for example when a run is interrupted and resumed.

**Action**
: One invocation of one tool with one concrete arguments object.

**Arguments**
: The JSON object that the harness passes to the tool for an action, after any policy transform and before credentials are attached.

**Read tool, write tool**
: A tool whose effective kind ([Section 8](#8-tool-classification)) is `read` or `write`.

**Idempotency key**
: A unique value that identifies one intended write action across retries, in the sense of [IDEMPOTENCY-KEY]. In this profile the harness, not the model, generates it.

**Fingerprint**
: `hex(SHA-256(JCS(arguments)))`. The same value is called the *arguments digest* in approval records and in policy context.

**Enforced identity**
: The value an approval decision is bound to. In version 0.1.0 it is the arguments digest of the action. A decision whose enforced identity differs from the request's arguments digest is invalid. The name follows ACS and Agent Hooks; [Section 10.1](#101-verdict-model) states how the value here differs from theirs.

**Audit event**
: A CloudEvents 1.0.2 event in JSON format that conforms to [Section 12](#12-audit).

**Checkpoint**
: A C2SP tlog-checkpoint [C2SP-CHECKPOINT], signed as a C2SP signed note [C2SP-NOTE], that commits to the RFC 9162 [RFC9162] Merkle tree root over the audit events of one source.

---

## 3. Design Principles

**Stability: Development**

The following principles explain the requirements in this document. They are not themselves requirements.

1. **Reuse existing standards.** Where a major vendor or foundation already publishes a specification that covers a need, this profile uses it as published and pins a version. It does not rename or re-encode existing concepts.

2. **Define only the gaps.** The profile defines new formats only where no existing specification exists: approval request and decision records, the write ledger, the harness sidecar and acceptance samples. Each definition is kept as small as the need allows.

3. **Fail closed.** Any error, missing classification, missing key, unknown tool, expired approval or identity mismatch results in the action not being executed. A tool that nobody classified is a write tool.

4. **The model that reads untrusted input never holds an outward action.** Meta's "Agents Rule of Two" [RULE-OF-TWO] states that, until prompt injection can be reliably detected, an agent session should have no more than two of three properties: processing untrustworthy inputs, access to sensitive systems or private data, and the ability to change state or communicate externally; a session that needs all three "should not be permitted to operate autonomously and at a minimum requires supervision". Simon Willison's "lethal trifecta" [LETHAL-TRIFECTA] describes the same combination: access to private data, exposure to untrusted content, and the ability to communicate externally. This profile assumes that the agent processes untrusted input and reads private data, and therefore removes the third property from the agent: every write is held by the harness and executed only after a human approval bound to the exact arguments, or under a limit the deployer approved in advance.

5. **Humans approve writes.** Approval is a human decision recorded as data, bound to the arguments, decided at most once, and never made by an agent principal.

6. **Everything verifiable.** Recipes carry digests of every file. Releases carry signed attestations. Audit records form a hash chain and a Merkle tree whose root is signed and published. Conformance is checked by a runner against published test vectors. A third party can check each of these without trusting the party that produced them.

---

## 4. Standards This Profile Builds On

**Stability: Development**

"Adopt" means the standard is used as published. "Adopt and extend" means it is used as published and this profile adds constraints or fields in a documented extension point. "Define" means no applicable standard was found and this profile defines the format. "Informative" means the relationship is described but not required.

| Concern | Standard and pinned version | Status of that standard | Use in this profile |
|---|---|---|---|
| Agent definition | Oracle Open Agent Specification (Agent Spec) 26.3.1 [AGENT-SPEC], reference SDK `pyagentspec` 26.3.1 | Published by Oracle; Apache-2.0 OR UPL-1.0 | Adopt. `agent.json` is an unmodified Agent Spec document. |
| Discovery | A2A Protocol 1.0.0, Agent Card [A2A] | Hosted project of the Agentic AI Foundation | Informative ([Section 6.5](#65-discovery-informative)). |
| Skills | Agent Skills specification [AGENT-SKILLS], validator `skills-ref` [SKILLS-REF] | Published at agentskills.io | Adopt, restricted to instruction-only skills. |
| Repository instructions | AGENTS.md [AGENTS-MD] | Agentic AI Foundation project | Adopt for this repository. |
| Tool behaviour hints | Model Context Protocol (MCP) 2026-07-28, `ToolAnnotations` [MCP] | Agentic AI Foundation project | Adopt as untrusted hints only ([Section 8](#8-tool-classification)). |
| Authorization policy | Cedar policy language 4 [CEDAR] | Apache-2.0; CNCF Sandbox project since 2025-10-08 [CEDAR-CNCF] | Adopt. The profile ships a Cedar schema. |
| Approval verdict model | Microsoft Agent Control Specification (ACS) release v0.4.0-beta.1 (Python package `agent-control-spec` 0.4.0b1) [ACS], built on AGENT-HOOKS-0.1 [AGENT-HOOKS] | Draft; MIT | Adopt and extend ([Section 10.1](#101-verdict-model)). |
| Approval request and decision records | None found | — | Define ([Section 10](#10-approval)). |
| Exactly-once writes | `draft-ietf-httpapi-idempotency-key-header-08` [IDEMPOTENCY-KEY]; Stripe idempotent request semantics [STRIPE-IDEMPOTENCY] | Active Internet-Draft (not an RFC); vendor documentation | Adopt and extend ([Section 11](#11-exactly-once-writes)). |
| Error bodies | RFC 9457 Problem Details [RFC9457] | Proposed Standard | Adopt. |
| Audit envelope | CloudEvents 1.0.2, JSON event format [CLOUDEVENTS] [CE-JSON]; extensions `sequence` [CE-SEQUENCE], `recordedtime` [CE-RECORDEDTIME], Distributed Tracing [CE-TRACING] | CNCF Graduated project | Adopt and extend with two extension attributes ([Section 12](#12-audit)). |
| Canonical JSON and hashing | RFC 8785 JCS [RFC8785]; SHA-256 [FIPS180-4] | Informational (Independent Submission); FIPS | Adopt. |
| Tamper evidence | RFC 9162 Section 2.1 Merkle tree [RFC9162]; C2SP signed-note v1.1.0 [C2SP-NOTE]; C2SP tlog-checkpoint v1.1.0 [C2SP-CHECKPOINT]; Ed25519 [RFC8032] | Experimental RFC (algorithms only used here); C2SP | Adopt and extend with a linear hash chain ([Section 12](#12-audit)). |
| Privacy of audit records | EDPB Guidelines 02/2025 version 2.0, paragraphs 50–54 [EDPB-02-2025] | Adopted 7 July 2026 | Adopt by analogy ([Section 12.10](#1210-personal-data-in-audit-events)). |
| Tracing | OpenTelemetry GenAI semantic conventions, repository `open-telemetry/semantic-conventions-genai` at commit `9ffc7e00c639be7712e544e3e54331e885dccf84` [OTEL-GENAI]; W3C Trace Context Level 1 [TRACE-CONTEXT] | Development (OpenTelemetry); W3C Recommendation | Adopt ([Section 13](#13-tracing)). |
| Acceptance tests | Field names of the UK AISI Inspect `Sample` (inspect-ai 0.3.283) [INSPECT]; vocabulary of [ANTHROPIC-EVALS] | No cross-vendor standard found | Define ([Section 14](#14-acceptance-tests)). |
| Test result publication | in-toto `test-result` predicate v0.1 [IN-TOTO-TEST-RESULT] | in-toto Attestation Framework | Adopt (OPTIONAL). |
| Signing | in-toto Attestation Framework v1 Statement (repository release v1.2.0) [IN-TOTO]; DSSE v1.0.2 [DSSE]; Sigstore bundle v0.3 [SIGSTORE-BUNDLE]; GitHub artifact attestations [GH-ATTESTATIONS] | in-toto, Sigstore (OpenSSF) | Adopt ([Section 15](#15-distribution-and-signing)). |
| Schemas | JSON Schema 2020-12 [JSON-SCHEMA] | — | Adopt. |
| Specification language | BCP 14 [RFC2119] [RFC8174] | Best Current Practice | Adopt. |

The OpenAI Evals API, which would otherwise be a candidate for acceptance tests, is scheduled by its vendor to shut down on 2026-11-30 [OPENAI-DEPRECATIONS]. This profile therefore does not depend on it.

---

## 5. Recipe Bundle

**Stability: Development**

### 5.1 Layout

A recipe bundle is a directory with the following layout. The file names shown are REQUIRED; the JSON Schema `schemas/0.1/recipe.schema.json` enforces them.

```
<recipe>/
  recipe.json              manifest (this profile)
  agent.json               Oracle Agent Spec 26.3.1 document, unmodified
  harness.json             harness sidecar (this profile, six chapters)
  policy.cedar             Cedar policies against schemas/0.1/harness.cedarschema
  acceptance.json          acceptance samples (this profile)
  skills/<name>/SKILL.md   one or more Agent Skills
```

The bundle is the unit that people exchange, review, sign and deploy. A bundle MUST NOT contain credentials, personal data, or the name of a specific model ([Section 18](#18-privacy-considerations)).

### 5.2 recipe.json

`recipe.json` is the manifest. Schema: `schemas/0.1/recipe.schema.json`.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `$schema` | string | Recommended | When present, MUST be `https://orbanplatform.com/agent-harness/schemas/0.1/recipe.schema.json`. |
| `profile` | string | Required | MUST be `https://orbanplatform.com/agent-harness/0.1`. |
| `profile_version` | string | Required | MUST be `0.1.0`. |
| `id` | string | Required | Recipe identifier matching `^[a-z0-9][a-z0-9-]{1,62}$`. |
| `title` | string | Required | Short human-readable title. |
| `summary` | string | Required | Plain-language summary of the agent's job, at most 500 characters. |
| `locale` | string | Required | BCP 47 [RFC5646] tag of the human-readable text in the bundle. |
| `files` | array | Required | One entry per file of the bundle other than `recipe.json` ([Section 5.3](#53-file-entries-and-digests)). |
| `provenance` | object | Required | Who produced the bundle ([Section 5.4](#54-provenance)). |

Example:

```json
{
  "$schema": "https://orbanplatform.com/agent-harness/schemas/0.1/recipe.schema.json",
  "profile": "https://orbanplatform.com/agent-harness/0.1",
  "profile_version": "0.1.0",
  "id": "reception-enquiry",
  "title": "Reception: answer website enquiries",
  "summary": "Reads enquiries from the Example Co. website, drafts replies from the price list and calendar, and sends each reply only after a person approves it.",
  "locale": "en",
  "files": [
    {"role": "agent", "path": "agent.json", "standard": "agentspec@26.3.1", "sha256": "<64 hex>"},
    {"role": "harness", "path": "harness.json", "standard": "agent-harness@0.1.0", "sha256": "<64 hex>"},
    {"role": "policy", "path": "policy.cedar", "standard": "cedar@4", "sha256": "<64 hex>"},
    {"role": "acceptance", "path": "acceptance.json", "standard": "agent-harness@0.1.0", "sha256": "<64 hex>"},
    {"role": "skill", "path": "skills/reception-reply/SKILL.md", "standard": "agentskills", "sha256": "<64 hex>"}
  ],
  "provenance": {"generated_by": "human", "reviewed_by_human": true, "created": "2026-10-23T00:00:00Z"}
}
```

### 5.3 File Entries and Digests

Each entry of `files` has the following fields.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `role` | string | Required | One of `agent`, `harness`, `policy`, `acceptance`, `skill`. |
| `path` | string | Required | Path relative to the bundle root, with `/` separators, no leading `/`, and no empty, `.` or `..` segments. |
| `standard` | string | Required | `agentspec@26.3.1` for `agent`; `agent-harness@0.1.0` for `harness` and `acceptance`; `cedar@4` for `policy`; `agentskills` for `skill`. |
| `sha256` | string | Required | `hex(SHA-256(file bytes))` of the file exactly as stored. |

Rules:

1. There MUST be exactly one entry each with role `agent`, `harness`, `policy` and `acceptance`, and at least one entry with role `skill`. Paths MUST be unique.
2. The paths for roles `agent`, `harness`, `policy` and `acceptance` MUST be `agent.json`, `harness.json`, `policy.cedar` and `acceptance.json`. A skill path MUST match `skills/<name>/SKILL.md`, where `<name>` is the skill's `name` [AGENT-SKILLS].
3. Every file in the bundle directory other than `recipe.json` MUST be listed. A consumer MUST NOT load a file that is not listed. A consumer MUST NOT follow symbolic links inside a bundle.
4. The digest covers the bytes as stored; there is no normalization of line endings or encodings. Producers SHOULD store all text files as UTF-8 with LF line endings and SHOULD configure version control so that checkouts do not rewrite line endings.
5. A consumer MUST verify every digest before using the bundle and MUST reject the bundle if any digest differs.
6. The *recipe digest* is `hex(SHA-256(recipe.json bytes))`. Because `recipe.json` lists the digests of all other files, the recipe digest identifies the whole bundle. Harnesses record it when a run starts ([Section 12.4](#124-event-types)).

### 5.4 Provenance

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `generated_by` | string | Required | The word `human`, or the name (and version, if known) of the tool that generated the bundle. |
| `reviewed_by_human` | boolean | Required | `true` if a person reviewed the whole bundle before publication. |
| `created` | string | Required | RFC 3339 date-time of creation. |

A bundle produced by a coding agent SHOULD name that agent in `generated_by`. A deployer SHOULD NOT deploy a bundle whose `reviewed_by_human` is `false` without reviewing it.

### 5.5 Skills

Skills are Agent Skills [AGENT-SKILLS] directories containing a `SKILL.md` file with YAML front matter (`name`, `description`, and optional `license`, `compatibility`, `metadata`, `allowed-tools`) followed by Markdown instructions.

1. Each skill MUST pass `skills-ref validate` [SKILLS-REF].
2. Skills in a recipe MUST be instruction-only: a skill directory MUST NOT contain a `scripts/` directory or other executable code (lint checks for `scripts/`). Agent Skills permits `scripts/`; this profile forbids it in recipes so that deploying a recipe never runs code that was not reviewed as code.
3. A skill MUST NOT instruct a person or an agent to download and run a binary, to pipe a downloaded script to a shell, or to modify agent or editor configuration files.
4. The Agent Skills `allowed-tools` field is described by its specification as experimental. A harness MUST NOT treat `allowed-tools` as an authorization mechanism; tool authorization is governed only by [Section 8](#8-tool-classification), [Section 9](#9-policy) and [Section 10](#10-approval).

---

## 6. Agent Definition

**Stability: Development**

### 6.1 agent.json Is an Unmodified Agent Spec Document

`agent.json` MUST be a valid Oracle Open Agent Specification document whose `agentspec_version` is `26.3.1` and whose top-level component has `component_type` `Agent` [AGENT-SPEC]. This profile adds no fields to Agent Spec and changes no Agent Spec semantics. An Agent Spec runtime that knows nothing about this profile can load `agent.json`.

In the Agent Spec JSON serialization, an `Agent` has the properties `id`, `name`, `description`, `metadata`, `inputs`, `outputs`, `llm_config`, `system_prompt`, `tools`, `toolboxes`, `human_in_the_loop` and `transforms`; `llm_config`, `name` and `system_prompt` are required by the Agent Spec 26.3.1 JSON schema.

### 6.2 Link to the Sidecar

Agent Spec defines `metadata` on every component as an optional dictionary for additional information that is retained across export and import. The Agent component in `agent.json` MUST carry:

```json
"metadata": { "com.orbanplatform/harness": "harness.json" }
```

and `harness.json` MUST carry `"agent_ref"` equal to the Agent component's `id`. A consumer MUST reject a bundle in which these two links do not agree.

### 6.3 Model Binding

A recipe MUST NOT name a specific model. The model is chosen by the deployer.

Agent Spec 26.3.1 defines symbolic references (an object with the single property `$component_ref` whose value is a component id) and *disaggregated components*: components that are kept out of the main configuration and supplied when it is deserialized. The language specification states that "additional disaggregated components that are not part of any exported configuration (e.g., those containing potentially sensitive information) can be additionally provided at deserialization time by the SDK or the Runtime performing it", and the Agent Spec documentation describes this mechanism for keeping LLM configurations out of the main configuration.

The Agent component in `agent.json` MUST therefore set:

```json
"llm_config": { "$component_ref": "llm" }
```

and MUST NOT include an LLM configuration, inline or in `$referenced_components`. The deployer supplies an `LlmConfig` component (for example an `OpenAiCompatibleConfig`) for the reference `llm` at load time. With `pyagentspec` 26.3.1 this is done by passing a `components_registry` that maps `"llm"` to the deployer's `LlmConfig` when deserializing with `AgentSpecDeserializer`. Agent Spec requires deserialization to fail when a referenced component is not supplied, so a harness cannot start the agent without a deployer-chosen model.

A recipe MUST NOT contain an API key or any other secret. Agent Spec itself treats `api_key` and related fields as sensitive fields that are excluded on export.

`harness.json` states the capabilities the deployer's model must have ([Section 7.7](#77-chapter-6-model-and-budget-model)), never a model name.

### 6.4 Tools

1. Every tool the agent can call MUST be declared in the Agent's `tools` array as an Agent Spec tool component (for example `ServerTool`, `ClientTool`, `RemoteTool` or `MCPTool`). The tool's Agent Spec `name` is the name used by `harness.json`, by Cedar actions and in audit events.
2. Tool names MUST match `^[A-Za-z0-9_-]{1,64}$`. This is the intersection of the function-name rule of the OpenAI API (letters, digits, underscores and dashes, at most 64 characters) [OPENAI-FUNCTION-NAME], the tool-name rule of the Claude API (`^[a-zA-Z0-9_-]{1,128}$`) [CLAUDE-TOOL-NAME] and the MCP tool-name guidance (1 to 128 characters from ASCII letters, digits, `_`, `-` and `.`) [MCP], so that a recipe's tool names can be passed unchanged to any of them. Names SHOULD be snake_case with a service prefix, for example `mail_send` or `pricelist_lookup`.
3. The set of tool names in `agent.json` and the set of tool names in `harness.json` MUST be equal (lint).
4. Agent Spec tools have a boolean `requires_confirmation`, which signals that execution environments should require approval before running the tool. A tool whose effective kind is `write` MUST set `requires_confirmation: true` in `agent.json`, so that an Agent Spec runtime that does not implement this profile still asks for confirmation (lint rule `agent.write-requires-confirmation`). A tool with `requires_confirmation: true` MUST NOT have `approval: never` in `harness.json` (lint).
5. Tools exposed through Agent Spec `toolboxes` (for example an MCP toolbox) are discovered at run time. A tool discovered at run time that has no entry in `harness.json` is unclassified and is therefore a write tool that requires approval ([Section 8.3](#83-unclassified-tools)). Recipes SHOULD enumerate every tool in `tools`.

### 6.5 Discovery (Informative)

An A2A 1.0.0 Agent Card [A2A] can be generated from a recipe: the card's name and description from the Agent component and `role`, its skills from the Agent Skills and `role.duties`, and its interfaces from the deployment. This profile does not specify the mapping in 0.1.0.

---

## 7. Harness Sidecar

**Stability: Development**

### 7.1 Overview

`harness.json` describes, in six chapters, what Agent Spec does not: the role the agent plays, what it may read, what each tool is allowed to do, the work steps, the boundaries and approval rules, and the model requirements and budget. Schema: `schemas/0.1/harness.schema.json`.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `$schema` | string | Recommended | When present, MUST be `https://orbanplatform.com/agent-harness/schemas/0.1/harness.schema.json`. |
| `profile_version` | string | Required | MUST be `0.1.0`. |
| `agent_ref` | string | Required | The `id` of the Agent component in `agent.json`. |
| `role` | object | Required | Chapter 1, role and voice. |
| `knowledge` | array | Required (MAY be empty) | Chapter 2, knowledge sources. |
| `tools` | array | Required (MAY be empty) | Chapter 3, system permissions. |
| `workflow` | object | Required | Chapter 4, work steps. |
| `boundaries` | object | Required | Chapter 5, boundaries and approvals. |
| `model` | object | Required | Chapter 6, model and budget. |
| `extensions` | object | Opt-In | Extension data. Keys MUST be namespaced as `<reverse-DNS>/<name>`, for example `com.example/ticketing`. Consumers MUST ignore extensions they do not understand. An extension MUST NOT relax any requirement of this profile. |

Chapters 1, 2 and 4 are descriptive: they tell people and the model what the agent is for. Chapters 3, 5 and 6 are enforced by the harness.

### 7.2 Chapter 1: Role and Voice (`role`)

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `title` | string | Required | Job title, for example `Reception`. |
| `duties` | array of string | Required | At least one duty, each a short plain sentence. |
| `voice` | string | Recommended | Tone and register, for example `formal, concise`. |
| `acts_on_behalf_of` | string | Required | The organization or person the agent acts for. Published examples MUST use fictional names. |
| `reports_to` | string | Required | Non-empty human role or human principal id that receives reports and escalations. |
| `locale` | string | Recommended | BCP 47 tag of the language the agent writes in. |

### 7.3 Chapter 2: Knowledge Sources (`knowledge`)

Each entry describes one source the agent may read. Writes happen only through tools.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `name` | string | Required | Short unique name of the source. |
| `description` | string | Recommended | What the source contains and how current it is. |
| `kind` | string | Required | One of `document`, `database`, `api`, `web`. |
| `access` | string | Required | MUST be `read`. No other value is defined in 0.1.0. |
| `citation` | string | Required | One of `required`, `recommended`, `none`: whether answers drawn from the source must cite it. |

A source of kind `web` is untrusted input by definition.

### 7.4 Chapter 3: System Permissions (`tools`)

There MUST be exactly one entry per Agent Spec tool, matched by `name`, and no others.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `name` | string | Required | Tool name exactly as in `agent.json`; matches `^[A-Za-z0-9_-]{1,64}$` ([Section 6.4](#64-tools)). |
| `description` | string | Opt-In | Note for reviewers on what the tool changes. |
| `kind` | string | Required | `read` or `write`. Takes effect only when `classification.source` is `operator` ([Section 8](#8-tool-classification)). |
| `approval` | string | Required | `always`, `over_limit` or `never`: when a human must approve a call. |
| `limit` | object or null | Conditionally Required: an object when `approval` is `over_limit`; otherwise `null` or absent | The limit below which no per-call human approval is needed. |
| `limit.field` | string | Required (in `limit`) | Name of the top-level argument compared against `max`. |
| `limit.max` | number | Required (in `limit`) | Largest value allowed without per-call approval. |
| `limit.unit` | string | Recommended (in `limit`) | Unit of the field, for example an ISO 4217 currency code. |
| `classification` | object | Recommended | Who classified the tool. Absent means unclassified. |
| `classification.source` | string | Required (in `classification`) | `operator`, `mcp_annotations` or `unclassified` ([Section 8.2](#82-classification-record)). |
| `classification.mcp_annotations` | object | Opt-In | The MCP `ToolAnnotations` received from the server: `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Untrusted hints. |
| `recipient_binding` | string | Opt-In | Free text describing how the targets of the tool (recipients, accounts, URLs) are bound, for example `request_record`: the recipient is taken from the stored request record and never from model output. |

Normative rules (lint):

1. A tool whose effective kind is `write` MUST have `approval` `always` or `over_limit`; it MUST NOT have `approval: never`.
2. `approval: over_limit` requires a `limit` object.
3. Every tool name MUST exist in `agent.json` and every `agent.json` tool MUST have an entry ([Section 6.4](#64-tools)).
4. An Agent Spec tool with `requires_confirmation: true` MUST NOT have `approval: never`, and a tool whose effective kind is `write` MUST set `requires_confirmation: true`.

Rules for harnesses:

5. For `over_limit`, the harness evaluates the limit as follows. If `arguments[limit.field]` is absent, is not a JSON number, or is greater than `limit.max`, the call is *over the limit* and requires approval. Otherwise the call is *within the limit*. The result is passed to Cedar as `context.limit_exceeded` ([Section 9.3](#93-request-construction)). The harness MUST NOT attempt unit conversion; recipes SHOULD constrain the unit in the tool's input schema.
6. A recipe SHOULD state in `boundaries.never` that the agent must not split one action into several to stay under a limit, and SHOULD include an acceptance sample for that case.

### 7.5 Chapter 4: Work Steps (`workflow`)

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `triggers` | array | Required | At least one entry `{kind, description}`, where `kind` is one of `event`, `schedule`, `message`, `manual`. |
| `steps` | array of string | Required | Ordered work steps, each a short plain sentence. |
| `on_failure` | string | Required | `stop_and_report` or `retry_then_report`. Retries of writes MUST reuse the original idempotency key ([Section 11](#11-exactly-once-writes)). |
| `handoffs` | array | Recommended (MAY be empty) | Entries `{to, when}`: to whom the task is handed (a human role, principal id or Agent Spec component id) and when. |

### 7.6 Chapter 5: Boundaries and Approvals (`boundaries`)

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `may_do_alone` | array of string | Required (MAY be empty) | What the agent may do without asking. |
| `must_ask` | array of string | Required (MAY be empty) | What the agent must ask a human about first. |
| `never` | array of string | Required (MAY be empty) | What the agent must never do. Each item that can be expressed in Cedar SHOULD also appear as a `forbid` policy in `policy.cedar` ([Section 9.4](#94-policies)). |
| `escalate_when` | array of string | Required (MAY be empty) | Situations in which the agent stops and reports to `role.reports_to`. |
| `approval` | object | Required | Resolver configuration, in the shape of the ACS manifest `approval` section. |
| `separation_of_duties` | object | Required | Who may approve. |

The `approval` object reuses the field names, types and value sets of the ACS manifest `approval` section [ACS], so that it can be copied into an ACS manifest unchanged:

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `default_resolver` | string | Required | Name of the resolver consulted by default. MUST be a key of `resolvers` whose `type` is `human`. |
| `timeout_seconds` | integer | Required | Maximum wait, in seconds, for a decision. MUST be positive. |
| `on_timeout` | string | Required | ACS defines `deny`, `allow` and `suspend`. This profile REQUIRES `deny`. |
| `fatigue_threshold` | integer | Recommended | Soft cap on approval requests per agent within `fatigue_window_seconds` ([Section 10.10](#1010-approval-fatigue)). |
| `fatigue_window_seconds` | integer | Recommended | Window, in seconds, over which the fatigue counter accumulates. |
| `resolvers` | object | Required | Map from resolver name to resolver descriptor, as in ACS. At least one entry. Each descriptor has a REQUIRED `type` (the ACS discriminator) and, for type `human`, a Recommended `channels` array whose items are `console`, `email_link`, `api` or `other`. Other descriptor members are preserved. |

This profile defines one resolver type, `human`: a human principal decides through one of the listed channels. Agents never approve ([Section 10.9](#109-separation-of-duties)); a resolver of any type MUST obtain its decision from a human principal.

`separation_of_duties`:

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `requester_may_approve` | boolean | Required | MUST be `false`. |
| `dispatcher_may_approve` | boolean | Required | Whether the dispatcher of the task may approve the agent's actions in that task. |
| `record_dispatcher_self_approval` | boolean | Required | Whether a decision by the dispatcher is marked (`decided_by_dispatcher`) and notified. MUST be `true` when `dispatcher_may_approve` is `true`. |

Example:

```json
"boundaries": {
  "may_do_alone": ["Read enquiries", "Look up prices and open calendar slots"],
  "must_ask": ["Send any email"],
  "never": ["Quote a price that is not in the price list", "Email any address other than the sender of the enquiry"],
  "escalate_when": ["The enquiry is a complaint or mentions legal action"],
  "approval": {
    "default_resolver": "human",
    "timeout_seconds": 172800,
    "on_timeout": "deny",
    "fatigue_threshold": 20,
    "fatigue_window_seconds": 3600,
    "resolvers": {"human": {"type": "human", "channels": ["console", "email_link"]}}
  },
  "separation_of_duties": {
    "requester_may_approve": false,
    "dispatcher_may_approve": true,
    "record_dispatcher_self_approval": true
  }
}
```

Normative rules (lint): `on_timeout` MUST be `deny`; `requester_may_approve` MUST be `false`; `default_resolver` MUST name a resolver of type `human`; `record_dispatcher_self_approval` MUST be `true` when `dispatcher_may_approve` is `true`.

### 7.7 Chapter 6: Model and Budget (`model`)

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `requirements.capabilities` | array of string | Required | Capabilities the deployer's model must have, from: `tool_calling`, `parallel_tool_calling`, `structured_output`, `vision`, `audio_input`, `long_context`, `reasoning`, `streaming`. |
| `requirements.min_context_tokens` | integer | Recommended | Minimum context window in tokens. |
| `requirements.languages` | array of string | Recommended | BCP 47 tags the model must handle well. |
| `budget.monthly_tokens` | integer | Required | Token budget per calendar month. MUST be greater than 0 (lint). |
| `budget.on_exceed` | string | Required | `pause_and_notify`, `notify_only` or `stop`. |

`model` MUST NOT name a model, a model family or a model vendor. When `on_exceed` is `pause_and_notify` or `stop`, the harness MUST NOT start new model calls for the agent after the budget is used up; pending approval requests keep their state and expire normally. In every case the harness MUST notify `role.reports_to` or the operator.

---

## 8. Tool Classification

**Stability: Development**

### 8.1 Kinds

A tool is `read` only if invoking it has no effect outside the harness and transmits no model-controlled data to any party outside the deployer's trust boundary. Every other tool is `write`. In particular, a tool described as a fetch, search or lookup that sends model-chosen values (such as a URL or query string) to an external party is a `write` tool, because such a call can carry private data out of the deployment.

### 8.2 Classification Record

The *effective kind* of a tool is determined as follows:

1. If the `harness.json` entry exists, `classification.source` is `operator`, and `kind` is `read` or `write`, the effective kind is `kind`.
2. Otherwise the effective kind is `write`.

`classification.source` values:

| Value | Meaning |
|---|---|
| `operator` | The deployer or operator set `kind`, and it takes effect. |
| `mcp_annotations` | `kind` was pre-filled from MCP annotations and has not been confirmed. The effective kind is `write`. |
| `unclassified` | Nobody classified the tool. The effective kind is `write`. |

The lint rules of [Section 7.4](#74-chapter-3-system-permissions-tools) apply to the effective kind. A tool with `kind: read`, `classification.source: mcp_annotations` and `approval: never` therefore fails lint.

### 8.3 Unclassified Tools

A tool that the agent attempts to call and that has no `harness.json` entry (for example a tool discovered at run time through an Agent Spec toolbox or an MCP server) MUST be treated as a write tool with `approval: always`.

### 8.4 MCP Annotations Are Hints Only

MCP 2026-07-28 defines `ToolAnnotations` with `title`, `readOnlyHint` (default `false`), `destructiveHint` (default `true`), `idempotentHint` (default `false`) and `openWorldHint` (default `true`), and states:

> For trust & safety and security, clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers.

This profile goes further: annotations never determine the effective kind, even from a trusted server. A tool or configuration editor MAY use annotations to suggest a classification for an operator to confirm. The RECOMMENDED suggestion is `read` with `approval: never` when `readOnlyHint` is `true`, and otherwise `write` with `approval: always`. A suggestion becomes effective only when an operator sets `classification.source` to `operator`. The reference implementation is `reference/classify.mjs`; the test vectors are `test-vectors/0.1/classification.json`.

### 8.5 Pinning Tool Definitions

A tool's description and input schema are read by the model and are a channel for prompt injection ("tool poisoning"). A harness SHOULD record, at deployment, `hex(SHA-256(JCS(d)))` of each tool definition `d` it exposes to the model (name, description, input schema and output schema), and MUST treat a tool whose definition changed after deployment as unclassified until an operator re-confirms it.

---

## 9. Policy

**Stability: Development**

### 9.1 Language

`policy.cedar` contains Cedar 4 policies [CEDAR]. Cedar denies every request that no `permit` policy allows, and a matching `forbid` overrides any `permit`. The harness MUST evaluate every action against `policy.cedar` and MUST NOT execute an action that Cedar does not allow. An evaluation error MUST be treated as a deny.

### 9.2 Cedar Schema

The profile's Cedar schema is `schemas/0.1/harness.cedarschema`, in namespace `OrbanHarness`. It declares:

- entity types `Agent` (agent principals), `Human` (human principals) and `Tool` (resources);
- one action per tool name, for example `OrbanHarness::Action::"mail_send"`;
- the request context record:

```
{
  approval: {
    granted: Bool,
    decision_id: String,
    enforced_identity: String
  },
  arguments_digest: String,
  limit_exceeded: Bool,
  run_id: String,
  task_id: String
}
```

The base schema contains no actions. A recipe's *effective schema* is the base schema with one declaration per `harness.json` tool, in `harness.json` order, inserted at the `@tool-actions` marker line:

```
action "<tool name>" appliesTo {
  principal: [Agent],
  resource: [Tool],
  context: ToolContext
};
```

where `ToolContext` is the context record above. `policy.cedar` MUST validate against the effective schema in Cedar's strict validation mode (lint). The conformance runner builds the effective schema from `harness.json` before validating.

### 9.3 Request Construction

For each action the harness builds the Cedar request:

| Element | Value |
|---|---|
| `principal` | `OrbanHarness::Agent::"<agent_ref>"` |
| `action` | `OrbanHarness::Action::"<tool name>"` |
| `resource` | `OrbanHarness::Tool::"<tool name>"` |
| `context.arguments_digest` | The fingerprint of the arguments. |
| `context.limit_exceeded` | For a tool with `approval: over_limit`: `false` if the call is within the limit, otherwise `true` ([Section 7.4](#74-chapter-3-system-permissions-tools), rule 5). For a tool without a limit: `false`. |
| `context.run_id`, `context.task_id` | From the authenticated run context, never from model output. |
| `context.approval` | As set by the gate ([Section 10.5](#105-gate-procedure)). With no approval: `granted: false`, `decision_id: ""`, `enforced_identity: ""`. |

Every context value is set only by the harness: approval values from validated records, `limit_exceeded` from `harness.json` and the arguments. They MUST NOT be derived from model output, tool output or any other untrusted input. Because `limit_exceeded` is `false` for tools without a limit, a policy for such a tool MUST NOT test `limit_exceeded`; the L1 check of `policy.cedar` probes every write tool without `approval: over_limit` with both values and fails if either one permits an unapproved call.

### 9.4 Policies

A recipe's `policy.cedar`:

1. MUST permit read tools for the agent principal, for example:

   ```cedar
   @id("read-tools")
   permit (
     principal == OrbanHarness::Agent::"reception",
     action in [OrbanHarness::Action::"enquiries_read", OrbanHarness::Action::"pricelist_lookup"],
     resource
   );
   ```

2. MUST permit write tools with `approval: always` only under a granted approval bound to the arguments:

   ```cedar
   @id("write-tools-approved")
   permit (
     principal == OrbanHarness::Agent::"reception",
     action in [OrbanHarness::Action::"mail_send"],
     resource
   )
   when {
     context.approval.granted &&
     context.approval.enforced_identity == context.arguments_digest
   };
   ```

3. MUST permit write tools with `approval: over_limit` only within the limit or under a granted approval bound to the arguments:

   ```cedar
   @id("write-tools-within-limit-or-approved")
   permit (
     principal == OrbanHarness::Agent::"ap-reconciler",
     action in [OrbanHarness::Action::"ledger_post_adjustment"],
     resource
   )
   when {
     !context.limit_exceeded ||
     (context.approval.granted &&
      context.approval.enforced_identity == context.arguments_digest)
   };
   ```

4. SHOULD express each `boundaries.never` item that Cedar can express as a `forbid`, so that a broader `permit` added later cannot override it, for example:

   ```cedar
   @id("never-unapproved-write")
   forbid (principal, action in [OrbanHarness::Action::"mail_send"], resource)
   unless {
     context.approval.granted &&
     context.approval.enforced_identity == context.arguments_digest
   };
   ```

   A `forbid` that covers an `over_limit` tool MUST allow the within-limit case, for example with `unless { !context.limit_exceeded || (context.approval.granted && context.approval.enforced_identity == context.arguments_digest) }`.

5. SHOULD annotate each policy with `@id`, so that denials can be attributed in audit events (`policy_ref`).

`never` items that Cedar cannot express (for example a rule about the content of a message) SHOULD be noted in a comment in `policy.cedar` with the mechanism that enforces them: the absence of a tool, `recipient_binding`, the approver, or an acceptance sample.

### 9.5 Decision Examples

For the policies above, with `d` the arguments digest:

| Action | `limit_exceeded` | `context.approval` | Decision | Reason |
|---|---|---|---|---|
| `enquiries_read` | `false` | not granted | Allow | `read-tools` |
| `mail_send` | `false` | not granted | Deny | `never-unapproved-write` |
| `mail_send` | `false` | granted, `enforced_identity = d` | Allow | `write-tools-approved` |
| `mail_send` | `false` | granted, `enforced_identity ≠ d` | Deny | `never-unapproved-write` |
| `ledger_post_adjustment` | `false` | not granted | Allow | `write-tools-within-limit-or-approved` |
| `ledger_post_adjustment` | `true` | not granted | Deny | default deny |
| `ledger_post_adjustment` | `true` | granted, `enforced_identity = d` | Allow | `write-tools-within-limit-or-approved` |
| `calendar_book` (not permitted) | any | any | Deny | default deny |

The two principals in these examples come from different recipes and are shown together only for brevity.

---

## 10. Approval

**Stability: Development**

### 10.1 Verdict Model

This profile adopts the verdict model of the Microsoft Agent Control Specification [ACS], pinned to release tag `v0.4.0-beta.1` (Python package `agent-control-spec` 0.4.0b1). The specification document at that tag describes manifest contract `0.5.0-alpha.1` and builds on AGENT-HOOKS-0.1 [AGENT-HOOKS]. The concepts adopted are:

1. **Verdicts.** A verdict is `allow`, `deny` or `transform`. ACS normalizes the policy intent `escalate` to a `deny` that carries an `approval` block; Agent Hooks calls this a *liftable deny*. This document calls the same thing a *resolvable deny*: the action is denied as it stands, unless the approval path resolves to an approval.
2. **Resolution.** The approval path resolves a resolvable deny to *allow*, *deny* or *suspend*. Suspend denies the current action and stops the run; resuming is a host responsibility.
3. **Identity echo.** A resolution is accepted only if it echoes the identity of what was shown to the approver; otherwise the host fails closed (ACS reason `host_error:approval_identity_mismatch`).
4. **Fail closed.** Any evaluation error yields a deny.
5. **Resolver configuration.** The fields `default_resolver`, `timeout_seconds`, `on_timeout`, `fatigue_threshold`, `fatigue_window_seconds` and `resolvers` are reused with the ACS names, types and value sets ([Section 7.6](#76-chapter-5-boundaries-and-approvals-boundaries)).

This profile extends and constrains the model as follows:

- **Enforced identity.** In Agent Hooks, the echoed value is `context_identity`, a host-defined `sha256:`-prefixed digest of the canonical context shown to the approver, and `enforced_identity` is a field of the interception record. In this profile, `enforced_identity` is defined as `hex(SHA-256(JCS(arguments)))` with no prefix, and an ApprovalDecision MUST echo it. The value is computed over the arguments only, so that it is portable across hosts and identical to the ledger fingerprint.
- **Timeout.** `on_timeout` MUST be `deny`. ACS permits `allow`, which this profile forbids.
- **Records.** ACS defines no approval request or decision record. This profile defines them ([Section 10.2](#102-approvalrequest), [Section 10.3](#103-approvaldecision)).

A harness built on ACS MAY produce the resolvable deny through ACS mechanisms (for example a Cedar `permit` with an `escalate` advice annotation). This profile specifies the outcome ([Section 10.5](#105-gate-procedure)), not the mechanism.

### 10.2 ApprovalRequest

Schema: `schemas/0.1/approval-request.schema.json`.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `id` | string | Required | Unique identifier of the request. A UUID [RFC9562] is RECOMMENDED. |
| `created_at` | string | Required | RFC 3339 time of creation. |
| `expires_at` | string | Required | RFC 3339 time after which no decision is accepted. MUST NOT be later than `created_at` plus `timeout_seconds`. |
| `requester` | object | Required | The proposing agent: `agent_id` (the Agent component id), `run_id` and `task_id`, all Required. |
| `dispatcher` | string | Conditionally Required: when a human principal assigned the task | Principal id of the dispatcher. |
| `tool` | object | Required | `name` (tool name) and `kind` (the effective kind). |
| `arguments_digest` | string | Required | `hex(SHA-256(JCS(arguments)))`. This is the enforced identity. |
| `idempotency_key` | string | Required | The ledger key of the action ([Section 11](#11-exactly-once-writes)). |
| `summary` | object | Required | Three plain sentences: `done` (what has been done), `decide` (what needs the approver's decision) and `after` (what happens after approval). |
| `routing` | object | Required | `path` (`named`, `list` or `fallback`) and `approvers` (array of at least one human principal id). |
| `policy_ref` | string | Required | The policy or rule that produced the resolvable deny, for example the recipe id with the Cedar `@id`, or `harness:approval=always`. |

The arguments themselves are not part of the record. The harness MUST present the arguments, or a faithful rendering of all of them, to the approver from its own store, and MUST verify before presenting that they hash to `arguments_digest`.

`routing.path`:

| Value | Meaning |
|---|---|
| `named` | One approver is named, for example the principal behind `role.reports_to`. |
| `list` | Any one of the listed approvers may decide. The first valid decision wins. |
| `fallback` | The named approver was unavailable and the request was routed to fallback approvers. |

`summary` text MUST be generated by the harness from the arguments and the recipe (for example from a template), or, if a model writes it, the approver MUST also be shown the arguments in full. A summary written by the agent alone is untrusted input ([Section 17.1](#171-prompt-injection)).

### 10.3 ApprovalDecision

Schema: `schemas/0.1/approval-decision.schema.json`.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `request_id` | string | Required | The `id` of the ApprovalRequest. Because a request has at most one decision, `request_id` also identifies the decision. |
| `decision` | string | Required | `approve` or `deny`. |
| `decided_by` | string | Required | Principal id of the human who decided. |
| `decided_at` | string | Required | RFC 3339 time of the decision. |
| `enforced_identity` | string | Required | MUST equal the request's `arguments_digest`. |
| `scope` | string | Required | MUST be `once`. No other scope is defined in 0.1.0. |
| `channel` | string | Required | `console`, `email_link`, `api` or `other`. |
| `reason` | string | Opt-In | Free text from the approver. Treated as personal data ([Section 18](#18-privacy-considerations)). |
| `decided_by_dispatcher` | boolean | Required | `true` if and only if `decided_by` is the request's `dispatcher`. |

`decided_by` is set by the harness from the authenticated session or token through which the decision arrived, never from a value supplied in the decision payload alone.

### 10.4 Decision Validation

A harness MUST accept a decision only if all of the following hold, and MUST otherwise reject it without changing the request's state:

1. The request exists and its state is `pending`.
2. `request_id` equals the request's `id`.
3. `decision` is `approve` or `deny`, and `scope` is `once`.
4. `decided_by` is an authenticated human principal. It is not the requester and not any agent principal.
5. `decided_at` is earlier than `expires_at`.
6. `enforced_identity` equals the request's `arguments_digest`.
7. `decided_by` is one of `routing.approvers`.
8. `decided_by_dispatcher` is `true` if and only if `decided_by` equals `dispatcher`.
9. If `decided_by` is the dispatcher and `decision` is `approve`, `dispatcher_may_approve` is `true`.

A rejected decision SHOULD be recorded as a `policy.denied` audit event whose data names the reason (for example `identity_mismatch`). The reference implementation is `reference/approval.mjs`.

### 10.5 Gate Procedure

For each action proposed by the agent, the harness MUST perform the following steps. Any error in any step ends the procedure with a deny.

1. **Classify.** Determine the tool's effective kind ([Section 8](#8-tool-classification)).
2. **Validate.** Validate the arguments against the tool's input schema in `agent.json`. On failure, deny.
3. **Digest.** Compute `d = hex(SHA-256(JCS(arguments)))`.
4. **Ledger.** If the effective kind is `write`, obtain the action's idempotency key and apply the decision function of [Section 11.4](#114-decision-function). Any outcome other than `new` ends the procedure with that outcome.
5. **Read tools.** If the effective kind is `read`, evaluate Cedar with no approval. Allow: execute. Deny: deny.
6. **Within the limit.** If the tool has `approval: over_limit` and the call is within the limit ([Section 7.4](#74-chapter-3-system-permissions-tools)), continue as in [Section 10.6](#106-calls-within-an-over_limit-limit).
7. **Pre-check.** Otherwise evaluate Cedar with the context `approval = {granted: true, decision_id: "pending", enforced_identity: d}` and `limit_exceeded` as computed in [Section 9.3](#93-request-construction). If Cedar denies even with an approval, the action is forbidden regardless of approval: deny, without creating an approval request.
8. **Resolvable deny.** Create an ApprovalRequest in state `pending` with `arguments_digest = d`, store the arguments, set the ledger entry's `approval_request_id`, write an `approval.requested` audit event, and route the request to the resolver.
9. **Decision.** When a valid decision arrives ([Section 10.4](#104-decision-validation)): for `deny`, the request becomes `denied`; for `approve`, the request becomes `approved`.
10. **Re-evaluate.** For an approved request, evaluate Cedar with the context `approval = {granted: true, decision_id: <request id>, enforced_identity: <decision's enforced_identity>}` and `limit_exceeded` as computed in [Section 9.3](#93-request-construction). If Cedar denies, the request becomes `failed` and the action is not executed.
11. **Execute.** Execute the action with exactly the stored arguments, at most once per idempotency key ([Section 11](#11-exactly-once-writes)). The request becomes `executed` or `failed`.

A harness MUST NOT execute an action whose arguments differ in any way from the arguments whose digest was approved.

### 10.6 Calls Within an `over_limit` Limit

A tool with `approval: over_limit` carries a limit that the deployer accepted when deploying the recipe. A call within that limit needs no per-call approval:

1. The harness evaluates Cedar with no approval and `limit_exceeded: false`. The `over_limit` permit of [Section 9.4](#94-policies) allows the call; any applicable `forbid` still denies it.
2. No ApprovalRequest is created. The ledger entry moves from `intent` directly to `executed` or `failed` with `approval_request_id` `null`, and the `action.executed` audit event records `"approval": "within_limit"`.
3. A call over the limit follows steps 7 to 11 of [Section 10.5](#105-gate-procedure).

The limit is an advance decision by the deployer, visible in `harness.json` and in `policy.cedar`. It is not an approval record, and it is not a substitute for one above the limit.

### 10.7 State Machine

An ApprovalRequest is in exactly one of the states `pending`, `approved`, `denied`, `expired`, `cancelled`, `executed` and `failed`. The terminal states are `denied`, `expired`, `cancelled`, `executed` and `failed`. The following table lists every allowed transition. Every transition not listed is invalid: a harness MUST reject it and MUST NOT change the state. The test vectors are `test-vectors/0.1/approval-transitions.json`.

| # | From | Trigger | Guard | To | Audit event | Ledger state after |
|---|---|---|---|---|---|---|
| 1 | (none) | Gate produces a resolvable deny | Pre-check passed ([Section 10.5](#105-gate-procedure), step 7) | `pending` | `approval.requested` | `intent` |
| 2 | `pending` | Decision `approve` arrives | All checks of [Section 10.4](#104-decision-validation) pass | `approved` | `approval.decided` | `approved` |
| 3 | `pending` | Decision `deny` arrives | All checks of [Section 10.4](#104-decision-validation) pass | `denied` | `approval.decided` | `denied` |
| 4 | `pending` | Current time reaches `expires_at` | No valid decision was accepted | `expired` | `policy.denied` (`reason: approval_expired`) | `expired` |
| 5 | `pending` | The run or task is cancelled, the requester withdraws the action, the arguments are superseded, or an approver edits the arguments | — | `cancelled` | `policy.denied` (`reason: approval_cancelled`) | `denied` |
| 6 | `approved` | Execution completes | Cedar re-evaluation allowed; ledger outcome was `new` | `executed` | `action.executed` (`outcome: succeeded`) | `executed` |
| 7 | `approved` | Execution fails terminally, Cedar re-evaluation denies, or the outcome of execution cannot be determined | — | `failed` | `action.executed` (`outcome: failed`) | `failed` |
| 8 | `approved` | Current time reaches `expires_at` before execution has started | — | `expired` | `policy.denied` (`reason: approval_expired`) | `expired` |

`expired` is treated as `deny`. A `cancelled` request is recorded in the ledger as `denied`, so that a retry with the same key replays the refusal rather than executing.

### 10.8 Invariants

A conforming harness MUST maintain these invariants at all times:

1. No agent principal ever decides an approval request. In particular, the requesting agent never approves its own action.
2. A decision is valid only if its `enforced_identity` equals the request's `arguments_digest`.
3. A request whose `expires_at` has passed without a valid decision is `expired`, and `expired` is a deny.
4. A request has at most one accepted decision.
5. Changed arguments require a new request. An approver who edits the arguments cancels the original request and causes a new request, with a new `arguments_digest` and a new idempotency key, to be created and decided separately.
6. An action is executed at most once per idempotency key.
7. Only state `approved` permits execution, and only for the arguments approved.

### 10.9 Separation of Duties

- **Agents never approve.** `requester_may_approve` MUST be `false`, and a harness MUST reject any decision whose `decided_by` is an agent principal, whatever the configuration says.
- **Dispatcher self-approval.** When `dispatcher_may_approve` is `true`, the human who assigned a task may approve the agent's actions in that task. A harness MUST then set `decided_by_dispatcher: true` on such decisions, MUST record them in the audit log, and MUST notify at least one principal other than the dispatcher (for example the principal behind `role.reports_to`, or the operator).

Recording and notification detect a self-approval after the fact. They do not prevent one. Deployments that need prevention MUST set `dispatcher_may_approve: false`, which requires a second person for every approval in tasks the dispatcher assigned (a two-person rule). The choice is the deployer's and is visible in `harness.json`.

### 10.10 Approval Fatigue

Approvers who see many requests tend to approve without reading. A harness:

1. MUST count, per agent, the approval requests created within `fatigue_window_seconds`. When the count exceeds `fatigue_threshold`, the harness MUST NOT create further approval requests for that agent until the window allows it; it MUST pause the agent's further write proposals and notify the operator and `role.reports_to`.
2. MUST NOT offer an action that approves several requests at once, and MUST NOT offer "always allow" or any scope other than `once`.
3. MUST show, for each request, the three `summary` sentences and the arguments, and SHOULD highlight values that differ from the agent's previous requests of the same tool, such as a new recipient.
4. SHOULD let approvers deny with one action and SHOULD make approval require a deliberate confirmation step.

### 10.11 Channels

- **console**: The approver decides in an authenticated user interface of the harness.
- **email_link**: The approver follows a link received by email. The link MUST carry a single-use token that is bound to the request id, the approver's principal id and the enforced identity, and that expires no later than `expires_at`. Following the link MUST NOT by itself record a decision (mail scanners fetch links automatically); the approver MUST confirm on the page that opens, which shows the summary and the arguments.
- **api**: A system of record calls the harness on behalf of an authenticated human principal. The harness MUST be able to attribute the decision to that human.
- **other**: Any other channel that satisfies [Section 10.4](#104-decision-validation).

### 10.12 Mapping to Agent Frameworks and Protocols

This section shows how the records of this profile map onto the human-in-the-loop mechanisms of widely used frameworks and protocols. In every case the harness, not the framework, creates the ApprovalRequest, validates the decision ([Section 10.4](#104-decision-validation)) and writes the audit events. A framework mechanism that lets the approver alter the arguments of the same action MUST NOT be used to do so; edited arguments create a new request ([Section 10.8](#108-invariants), item 5).

#### 10.12.1 AG-UI Interrupts

| Profile | AG-UI [AG-UI-INTERRUPTS] |
|---|---|
| Raise a request | End the run with `RUN_FINISHED` whose `outcome` is `{ "type": "interrupt", "interrupts": [ ... ] }`. |
| `ApprovalRequest.id` | `Interrupt.id` |
| Tool binding | `Interrupt.reason: "tool_call"` and `Interrupt.toolCallId` set to the tool call id. |
| `summary.decide` | `Interrupt.message` |
| `expires_at` | `Interrupt.expiresAt` |
| Decision payload shape | `Interrupt.responseSchema`: an object with `approved` (boolean) and `enforced_identity` (string). |
| Full request record | `Interrupt.metadata["com.orbanplatform/approval-request"]` (the ApprovalRequest object). |
| `approve` / `deny` | Next `RunAgentInput.resume[]` entry with `interruptId` = request id, `status: "resolved"`, `payload: {approved: true \| false, enforced_identity}`. |
| Cancel | `status: "cancelled"` (no payload): request becomes `cancelled`. |
| Gaps | AG-UI does not identify the human who resolved the interrupt; the harness MUST take `decided_by` from its own authenticated session. |

#### 10.12.2 MCP Elicitation through Multi Round-Trip Requests

| Profile | MCP 2026-07-28 [MCP] |
|---|---|
| Raise a request | Server responds to `tools/call` with an `InputRequiredResult` (`resultType: "input_required"`) whose `inputRequests` contains one entry keyed by the ApprovalRequest id, with `method: "elicitation/create"`, `mode: "form"`, a `message` built from `summary`, and a `requestedSchema` with a boolean `approve`. The server's `requestState` carries the request id. |
| `approve` | Client retries `tools/call` with `inputResponses[<request id>] = {action: "accept", content: {approve: true}}`. |
| `deny` | `action: "accept"` with `approve: false`, or `action: "decline"`. |
| Cancel | `action: "cancel"` (dismissed without choice): no decision is recorded; the request stays `pending` until decided or expired. |
| Idempotency | The retry carries the same `_meta["com.orbanplatform/idempotency-key"]` ([Section 11.7](#117-mcp-binding)). |
| Gaps | MCP elicitation does not guarantee that a human answered, does not bind the answer to the tool arguments, and is not signed. It MUST NOT be the only approval mechanism. A harness MAY accept an elicitation answer as a decision with `channel: "other"` only when the client that collected it is part of the harness, authenticates the human principal, and the harness itself checks the enforced identity. |

#### 10.12.3 A2A

| Profile | A2A 1.0.0 [A2A] |
|---|---|
| Raise a request | The task moves to `TASK_STATE_INPUT_REQUIRED`; the status message contains a part whose `data` is the ApprovalRequest. |
| `approve` / `deny` | The client sends `SendMessage` on the same task with a part whose `data` is the ApprovalDecision. The task returns to `TASK_STATE_WORKING`. |
| Cancel | `CancelTask` moves the task to `TASK_STATE_CANCELED`; the request becomes `cancelled`. |
| Gaps | A2A authenticates the calling client, not necessarily the human. The harness MUST be able to attribute the decision to a human principal. |

#### 10.12.4 OpenAI Agents SDK

| Profile | OpenAI Agents SDK (JavaScript) [OPENAI-AGENTS-HITL] |
|---|---|
| Mark write tools | `needsApproval: true` (or an async function returning `true` when the gate requires approval). |
| Raise a request | The run pauses and returns `interruptions` containing a `RunToolApprovalItem`; the harness creates the ApprovalRequest from the item's tool name and arguments. |
| `approve` | `result.state.approve(item)`, then resume the run with the state. |
| `deny` | `result.state.reject(item)`, then resume. |
| Long waits | Serialize with `result.state.toString()`, store on the server, restore with `RunState.fromString(agent, serialized)`. |
| Constraints | The `alwaysApprove` option MUST NOT be used (scope is `once`). |

#### 10.12.5 Claude Agent SDK

| Profile | Claude Agent SDK [CLAUDE-AGENT-SDK] |
|---|---|
| Raise a request | The `canUseTool(toolName, input, options)` callback; the harness creates the ApprovalRequest from `toolName` and `input`. |
| `approve` | Return `{ behavior: "allow", updatedInput: input }` where `updatedInput` is identical to the approved arguments. |
| `deny` | Return `{ behavior: "deny", message }`. |
| Long waits | A `PreToolUse` hook returns `permissionDecision: "defer"` so that the process can exit and resume later from the persisted session. |
| MCP tools | Servers SHOULD set `_meta["anthropic/requiresUserInteraction"]` on write tools, so that allow rules never auto-approve them. |
| Constraints | Calls approved earlier in the SDK's permission flow (allow rules, `acceptEdits`, `bypassPermissions` or `auto` modes) never reach `canUseTool`. A harness MUST NOT configure allow rules or permission modes that pre-approve write tools, SHOULD gate every call with a `PreToolUse` hook, and MUST NOT return `updatedPermissions`. |

#### 10.12.6 Google Agent Development Kit

| Profile | Google ADK [ADK-CONFIRMATION] |
|---|---|
| Mark write tools | `FunctionTool(..., require_confirmation=True)` or a callable that returns `True` when the gate requires approval. |
| Raise a request | ADK emits a function call named `adk_request_confirmation` with a `hint` and a `payload`; the harness creates the ApprovalRequest and uses `summary` as the hint. |
| `approve` / `deny` | Send a `FunctionResponse` with `name: "adk_request_confirmation"`, `id` equal to the confirmation call id, and `response: {confirmed: true \| false, payload: {request_id, enforced_identity}}`. |
| Constraints | With ADK's resume feature, the response also carries the invocation id of the invocation that raised the request. |

---

## 11. Exactly-Once Writes

**Stability: Development**

### 11.1 Basis

This profile adopts the `Idempotency-Key` request header field of `draft-ietf-httpapi-idempotency-key-header-08` [IDEMPOTENCY-KEY], an Active Internet-Draft dated 22 October 2026 that is not an RFC, and the semantics of Stripe's idempotent requests [STRIPE-IDEMPOTENCY]. From the draft: the header is an Item Structured Header Field whose value is a String [RFC9651]; a request without a required key receives 400; reuse of a key with a different payload receives 422; a request whose original is still being processed receives 409; error bodies use RFC 9457 problem details [RFC9457]; and the resource publishes its key expiration policy. From Stripe: the stored response of a completed request, including an error response, is returned to every retry with the same key.

### 11.2 Additions in This Profile

1. **Fingerprint REQUIRED.** The draft makes a fingerprint optional. This profile requires it: `fingerprint = hex(SHA-256(JCS(arguments)))`.
2. **Harness-generated keys.** The harness generates the idempotency key when it records the intent, persists it with the ApprovalRequest, and reuses it for every retry and for the call to the downstream system. The model MUST NOT choose or see keys. Keys MUST consist of printable ASCII characters (U+0020 to U+007E), SHOULD be UUIDs [RFC9562] or other values with at least 122 bits of randomness, and MUST NOT contain personal data.
3. **Key scope.** A key is unique within the scope (`tenant`, `principal`, `operation`), where `principal` is the agent principal and `operation` is the tool name. The same key in a different scope is a different entry.
4. **Task binding.** A key is bound to the `task_id` that first used it. The same key from a different task is rejected with 409. `task_id` is taken from the authenticated run context, never from a client-supplied value alone.
5. **Replay.** A request for a key whose entry is terminal returns the stored response. Every terminal entry (`executed`, `denied`, `expired`, `failed`) MUST have a non-null stored response; for `denied` and `expired` it is the refusal returned at that time.
6. **Retention.** An entry MUST be retained for at least 24 hours after it reaches a terminal state, and the harness MUST publish its retention period. `retain_until` records the earliest time the entry may be deleted.

### 11.3 Ledger Entry

Schema: `schemas/0.1/ledger-entry.schema.json`.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `idempotency_key` | string | Required | The key. |
| `scope` | object | Required | `tenant`, `principal`, `operation`, all Required strings. |
| `fingerprint` | string | Required | `hex(SHA-256(JCS(arguments)))`. |
| `task_id` | string | Required | Task that first used the key. |
| `run_id` | string | Required | Run that first used the key. |
| `state` | string | Required | `intent`, `approved`, `executed`, `denied`, `expired` or `failed`. |
| `approval_request_id` | string or null | Required | The ApprovalRequest id, or `null` (a call within an `over_limit` limit, or before a request exists). |
| `response` | object or null | Required | The stored response; `null` while the state is `intent` or `approved`. |
| `created_at` | string | Required | RFC 3339. |
| `updated_at` | string | Required | RFC 3339. |
| `retain_until` | string | Required | RFC 3339; at least 24 hours after the entry became terminal. |

Ledger states `intent` and `approved` are *in flight*; the others are *terminal*. Allowed ledger transitions: `intent → approved | denied | expired`; `approved → executed | failed | expired`; and, only for calls that need no per-call approval (within an `over_limit` limit, [Section 10.6](#106-calls-within-an-over_limit-limit)), `intent → executed | failed`.

### 11.4 Decision Function

Given the existing entry for (scope, key), or none, and an incoming action `{key, fingerprint, task_id, kind}`, the outcome is determined by the first matching row. The reference implementation is `reference/ledger.mjs`; the test vectors are `test-vectors/0.1/idempotency.json`.

| # | Condition | Outcome | HTTP status | Effect |
|---|---|---|---|---|
| 1 | No key, `kind` is `write` | `missing_key` | 400 | Nothing stored. |
| 1a | No key, `kind` is `read` | `bypass` | — | Reads are not recorded in the ledger. |
| 2 | No existing entry | `new` | — | Create an entry in state `intent`. |
| 3 | `entry.task_id ≠ task_id` | `task_mismatch` | 409 | None. |
| 4 | `entry.fingerprint ≠ fingerprint` | `fingerprint_mismatch` | 422 | None. |
| 5 | `entry.state` is `intent` or `approved` | `in_flight` | 409 | None. |
| 6 | `entry.state` is `executed`, `denied`, `expired` or `failed` | `replay` | status of the stored response | Return `entry.response`; write an `action.replayed` audit event. |

The task binding (row 3) is checked before the fingerprint (row 4) so that a caller from another task cannot learn whether its payload matches the stored one.

### 11.5 Execution and Recovery

1. The harness MUST persist each ledger transition before performing the side effect that depends on it.
2. When the downstream system supports idempotency keys, the harness MUST pass the same key downstream. After a crash between the downstream call and recording the result, the harness MAY repeat the downstream call with the same key and record the result.
3. When the downstream system does not support idempotency keys, exactly-once execution cannot be guaranteed end to end. After a crash in which the downstream outcome is unknown, the harness MUST NOT repeat the call automatically; it MUST move the entry to `failed` with the reason `outcome_unknown` and notify the operator for manual reconciliation. This guarantees at most once.
4. A transition to `failed` is made only after execution has started. If the harness fails before starting execution, the entry stays `approved` and execution resumes on recovery.

### 11.6 HTTP Binding

When a harness exposes write actions over HTTP, or calls a downstream HTTP API:

- The request carries `Idempotency-Key: "<key>"` as an RFC 9651 String.
- Error responses use `Content-Type: application/problem+json` [RFC9457] with the following `type` URIs (identifiers that need not resolve):

| Outcome | Status | Problem `type` |
|---|---|---|
| `missing_key` | 400 | `https://orbanplatform.com/agent-harness/0.1/problems/missing_key` |
| `fingerprint_mismatch` | 422 | `https://orbanplatform.com/agent-harness/0.1/problems/fingerprint_mismatch` |
| `in_flight` | 409 | `https://orbanplatform.com/agent-harness/0.1/problems/in_flight` |
| `task_mismatch` | 409 | `https://orbanplatform.com/agent-harness/0.1/problems/task_mismatch` |

- A replay returns the stored status and body.

### 11.7 MCP Binding

In MCP, the key is carried in the request metadata of `tools/call`:

```json
{
  "method": "tools/call",
  "params": {
    "name": "mail_send",
    "arguments": { "...": "..." },
    "_meta": { "com.orbanplatform/idempotency-key": "task-0001:mail_send:1" }
  }
}
```

The `_meta` key follows the MCP rule that implementations use reverse-DNS prefixes. Errors are returned as a tool execution error (`isError: true`) whose `structuredContent` is the problem details object of [Section 11.6](#116-http-binding). A replay returns the stored `CallToolResult`.

---

## 12. Audit

**Stability: Development**

### 12.1 Envelope

Every audit event MUST be a CloudEvents 1.0.2 event [CLOUDEVENTS] in the JSON event format [CE-JSON] (media type `application/cloudevents+json`). Schema: `schemas/0.1/audit-event.schema.json`.

### 12.2 Attributes

| Attribute | Type | Requirement | Constraint |
|---|---|---|---|
| `specversion` | String | Required | `"1.0"`. |
| `id` | String | Required | Unique within `source`. |
| `source` | URI-reference | Required | Identifies one audit log, for example `urn:orban-harness:unit:example`. |
| `type` | String | Required | `com.orbanplatform.harness.<event>` ([Section 12.4](#124-event-types)). |
| `time` | Timestamp | Required | Time of the occurrence. |
| `datacontenttype` | String | Required | `"application/json"`. |
| `data` | JSON object | Required | Event data. `data_base64` MUST NOT be used. |
| `sequence` | String | Required | CloudEvents `sequence` extension [CE-SEQUENCE]: decimal, zero-padded to 20 digits, starting at `00000000000000000001` and increasing by exactly one per event of the same `source`. |
| `orbanprevhash` | String | Required | 64 lowercase hexadecimal characters ([Section 12.5](#125-hash-chain)). Defined by this profile. |
| `orbanalg` | String | Required | `"sha256-jcs-v1"`. Defined by this profile. |
| `recordedtime` | Timestamp | Recommended | CloudEvents `recordedtime` extension [CE-RECORDEDTIME]: when the event was written. |
| `traceparent` | String | Recommended | CloudEvents Distributed Tracing extension [CE-TRACING]: the W3C `traceparent` of the span in which the event was written ([Section 13](#13-tracing)). |
| `tracestate` | String | Opt-In | CloudEvents Distributed Tracing extension: the W3C `tracestate`. |
| `subject` | String | Opt-In | Subject of the event within `source`, for example the `run_id` or `task_id`. MUST NOT contain personal data. |
| `dataschema` | URI | Opt-In | CloudEvents `dataschema`: the schema that `data` adheres to. |

The two attributes defined by this profile follow the CloudEvents naming rules: lowercase ASCII letters and digits only, and no more than 20 characters. No other extension attributes are defined by this profile. Implementations MAY add their own extension attributes; they are covered by the event hash like any other attribute.

The value `sha256-jcs-v1` of `orbanalg` denotes the algorithm of [Section 12.5](#125-hash-chain) and [Section 12.6](#126-merkle-tree): JCS canonicalization and SHA-256.

### 12.3 Sources

One `source` value identifies one append-only sequence of events with one hash chain, one Merkle tree and one checkpoint signing key. A harness MAY use several sources (for example one per deployment). Events of different sources are never interleaved in one chain.

### 12.4 Event Types

Version 0.1.0 defines the following eight types. The data members listed are RECOMMENDED; the personal data rules of [Section 12.10](#1210-personal-data-in-audit-events) apply to all of them.

| `type` suffix | When | Recommended `data` members |
|---|---|---|
| `run.started` | A run starts. | `run_id`, `task_id`, `agent_id`, `recipe_id`, `recipe_digest` |
| `run.completed` | A run ends. | `run_id`, `outcome` (`completed`, `failed`, `cancelled`, `paused`) |
| `approval.requested` | An ApprovalRequest is created. | `approval_request_id`, `tool`, `arguments_digest`, `idempotency_key`, `expires_at`, `routing_path` |
| `approval.decided` | A decision is accepted. | `approval_request_id`, `decision`, `decided_by`, `decided_by_dispatcher`, `channel`, `enforced_identity` |
| `action.executed` | Execution of an action ends. | `tool`, `outcome` (`succeeded`, `failed`), `fingerprint`, `idempotency_key` (writes), `approval_request_id` or `"approval": "within_limit"`, `reason` (when failed, for example `outcome_unknown`) |
| `action.replayed` | A stored response is replayed. | `tool`, `idempotency_key`, `fingerprint` |
| `policy.denied` | The gate refuses an action, a request expires or is cancelled, or a decision is rejected. | `tool`, `reason` (for example `policy`, `approval_expired`, `approval_cancelled`, `identity_mismatch`), `policy_ref`, `resolvable` (boolean), `approval_request_id` |
| `record.redacted` | Off-chain data referenced by an earlier event is deleted. | `target_event_id`, `method` (`key_deleted`, `original_deleted`), `reason` |

Read actions SHOULD be recorded with `action.executed`. Types under `com.orbanplatform.harness.` are reserved for this profile; new ones are added only through the change process of [Section 20](#20-versioning-and-change-process). Every event in a profile audit log MUST have a type under that prefix (the schema enforces this); implementations that need other event types MUST keep them in a separate log or carry the detail in `data`.

### 12.5 Hash Chain

For the events `event_1 … event_n` of one source, in `sequence` order:

```
h_0 = "0000000000000000000000000000000000000000000000000000000000000000"   (64 × "0")
event_i.orbanprevhash = h_{i-1}
h_i = hex(SHA-256(JCS(event_i)))
```

`JCS(event_i)` is computed over the complete event object as stored, including `data`, `orbanprevhash` and every extension attribute. The chain head is `h_n`. The test vectors are `test-vectors/0.1/jcs.json` and `test-vectors/0.1/audit-chain.json`; the reference implementations are `reference/jcs.mjs` and `reference/audit.mjs`.

The chain lets a holder of a contiguous range of events detect any change, insertion or deletion within it. It does not by itself protect against the operator rewriting the entire log; that requires signed checkpoints that have been published elsewhere ([Section 12.8](#128-external-anchoring)).

### 12.6 Merkle Tree

The Merkle tree hash over the first `n` events of a source is the RFC 9162 Section 2.1.1 Merkle Tree Hash with SHA-256, over the leaves `d(i) = JCS(event_{i+1})` for `i = 0 … n−1` (leaf index `i` corresponds to `sequence` `i + 1`):

```
MTH({})     = SHA-256()
MTH({d(0)}) = SHA-256(0x00 ‖ d(0))
MTH(D[n])   = SHA-256(0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n]))   where k is the largest power of two smaller than n
```

The `0x00` and `0x01` prefixes separate leaf hashes from interior node hashes. Inclusion and consistency proofs, when used, are those of RFC 9162 Sections 2.1.3 and 2.1.4. The reference implementation is `reference/merkle.mjs`.

### 12.7 Signed Checkpoints

A harness at conformance level L3 MUST periodically sign a checkpoint for each source. The checkpoint is the C2SP tlog-checkpoint v1.1.0 note text [C2SP-CHECKPOINT]:

```
<origin>
<tree size n, ASCII decimal>
<base64(MTH(D[n]))>
```

with each line terminated by a newline (U+000A), signed as a C2SP signed note v1.1.0 [C2SP-NOTE] with an Ed25519 key [RFC8032] (signature type `0x01`):

```
key ID    = SHA-256(<key name> ‖ 0x0A ‖ 0x01 ‖ <32-byte Ed25519 public key>)[0:4]
signature = Ed25519(<note text>)
line      = "— " <key name> " " base64(key ID ‖ signature) "\n"
```

The signed note is the note text, an empty line, and one or more signature lines. The first character of a signature line is U+2014 EM DASH. Rules:

1. `origin` MUST uniquely identify the log; it MUST be a schema-less URL-like string with no spaces and no `+` (for example `example.com/harness/unit-a`). The mapping from `origin` to the CloudEvents `source` MUST be published together with the verifier key.
2. The key name SHOULD be the origin, as C2SP recommends for Ed25519 log signatures.
3. The public key MUST be published as a C2SP verifier key: `<key name>+<hex(key ID)>+<base64(0x01 ‖ public key)>`.
4. A checkpoint MUST NOT be signed if it is inconsistent with a checkpoint previously signed with the same key (that is, if the earlier tree is not a prefix of the later tree).
5. Extension lines are NOT RECOMMENDED.

The reference implementation is `reference/checkpoint.mjs`; the test vectors are in `test-vectors/0.1/audit-chain.json`.

### 12.8 External Anchoring

A signed checkpoint protects against later rewriting only if a copy of it is held by someone other than the operator. A harness at level L3:

1. MUST make each checkpoint available to the deployer, and SHOULD deliver the latest checkpoint at the end of each run to `role.reports_to` or to a system the deployer controls;
2. SHOULD publish checkpoints to at least one location the operator does not control, such as a C2SP witness that returns tlog cosignatures [C2SP-COSIG], a public transparency log, or the deployer's own storage;
3. MUST sign a checkpoint at least once every 24 hours while events are being appended.

### 12.9 Verification Procedure

A verifier holding a sequence of events from one source, a signed checkpoint and the trusted verifier key MUST perform these steps, and MUST report failure at the first step that fails:

1. Validate each event against `schemas/0.1/audit-event.schema.json`.
2. Check that every event has the same `source`, that `orbanalg` is `sha256-jcs-v1`, and that `id` values are unique.
3. Check that `sequence` values are the 20-digit decimal strings `00000000000000000001`, `00000000000000000002`, … with no gap or repetition.
4. Compute `h_i` for each event ([Section 12.5](#125-hash-chain)). Check that `event_1.orbanprevhash` is 64 × `0` and that each later `event_i.orbanprevhash` equals `h_{i-1}`.
5. Parse the signed note. Ignore signature lines whose key name and key ID do not match the trusted verifier key. Verify the Ed25519 signature of the matching line over the note text. If no matching signature verifies, fail.
6. Parse the note text as a checkpoint: origin, tree size `n` and root hash. Check that the origin matches the trusted mapping for the events' `source`.
7. Check that at least `n` events are held, compute `MTH(D[n])` over the first `n` events ([Section 12.6](#126-merkle-tree)), and check that it equals the checkpoint's root hash.
8. When a previously verified checkpoint for the same origin is held, check that its tree is a prefix of the new one, by recomputation or by an RFC 9162 consistency proof.
9. Report the verified range (sequence 1 to `n`), the chain head `h_n`, and any events after `n` as not yet covered by a checkpoint.

### 12.10 Personal Data in Audit Events

An audit log is append-only by design, which conflicts with the right to erasure. This profile applies, by analogy, the guidance of the EDPB Guidelines 02/2025 on blockchain, version 2.0, paragraphs 50–54 [EDPB-02-2025]: keep personal data out of the append-only structure, and keep on it only a form that proves existence, such as a keyed hash or a pointer, with the verifying data held elsewhere.

1. Audit events MUST NOT contain raw personal data, and MUST NOT contain raw free text that originates from untrusted parties (for example the body of an incoming email, or the text a model produced from it).
2. Where an event must refer to such a value `v`, it MUST instead contain `HMAC-SHA-256(k, JCS(v))` [RFC2104] together with an opaque reference to the original, where `k` is a per-record or per-subject key stored outside the audit log. The RECOMMENDED representation is an object `{"hmac": "<64 hex>", "ref": "<opaque reference>"}`.
3. An unsalted, unkeyed hash of personal data is not sufficient: the EDPB states that unsalted or unkeyed hashes "should, in general, not be considered sufficient" (paragraph 52). Keyed hashes remain personal data while the key exists.
4. Principal identifiers in audit events (for example `decided_by`) SHOULD be stable pseudonymous identifiers rather than email addresses or names.
5. To erase, the harness deletes the off-chain original and the key `k`, then appends a `record.redacted` event that names the affected event. The earlier event is not modified, so the hash chain, Merkle tree and checkpoints stay valid.

---

## 13. Tracing

**Stability: Development**

### 13.1 Conventions Used

A harness that emits traces MUST follow the OpenTelemetry GenAI semantic conventions as published at commit `9ffc7e00c639be7712e544e3e54331e885dccf84` of `open-telemetry/semantic-conventions-genai` [OTEL-GENAI], whose status is Development, and MUST propagate context with W3C Trace Context Level 1 [TRACE-CONTEXT].

| Operation | Span name | Attributes |
|---|---|---|
| Agent run | `invoke_agent {gen_ai.agent.name}` | `gen_ai.operation.name` = `invoke_agent`, `gen_ai.agent.name`, `gen_ai.agent.id` (the Agent component id), `gen_ai.conversation.id` (RECOMMENDED: the `run_id`) |
| Tool call | `execute_tool {gen_ai.tool.name}` | `gen_ai.operation.name` = `execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id` |

### 13.2 Correlation with Audit Events

1. Every audit event written inside a span MUST carry that span's W3C `traceparent` in the CloudEvents `traceparent` attribute.
2. The span MUST record the attribute `orban.audit.event_id` with the audit event's `id`. When a span writes several audit events, the attribute holds the `id` of the last one, and the harness SHOULD add a span event per audit event.
3. A trace is diagnostic data, not evidence. The audit log ([Section 12](#12-audit)) is the record of what was approved and executed.

### 13.3 Content Capture

The GenAI conventions define opt-in attributes that capture content, including `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`. These routinely contain personal data and untrusted text. A harness MUST NOT enable them by default. A deployer that enables them is responsible for the retention and access controls of the trace backend ([Section 18](#18-privacy-considerations)).

---

## 14. Acceptance Tests

**Stability: Development**

### 14.1 Vocabulary

This section uses the vocabulary of [ANTHROPIC-EVALS]: a *task* is "a single test with defined inputs and success criteria"; a *trial* is one attempt at a task; a *grader* is "logic that scores some aspect of the agent's performance"; a *transcript* is "the complete record of a trial, including outputs, tool calls, reasoning, intermediate results"; the *outcome* is "the final state in the environment at the end of the trial"; *pass@k* is the likelihood of at least one correct solution in k attempts; *pass^k* is the probability that all k trials succeed. In this profile, a *sample* in `acceptance.json` is a task.

### 14.2 acceptance.json

Schema: `schemas/0.1/acceptance.schema.json`. Sample field names follow the UK AISI Inspect `Sample` (`id`, `input`, `target`, `metadata`, `files`, `setup`, `sandbox`, `description`) [INSPECT], so that samples can be loaded into Inspect with little or no change.

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `$schema` | string | Recommended | The schema URI. |
| `profile_version` | string | Required | `0.1.0`. |
| `recipe_id` | string | Required | MUST equal `recipe.json` `id`. |
| `samples` | array | Required | At least one sample. |

Each sample:

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `id` | string | Required | Unique within the file. |
| `description` | string | Recommended | What the sample checks. |
| `input` | string or array | Required | The task given to the agent: a string, or an array of chat messages `{role, content}` with `role` one of `system`, `user`, `assistant`, `tool`. |
| `target` | string or array of string | Required | What a correct outcome contains; guidance for the grader. |
| `metadata.scenario` | string | Required | `baseline`, `missing_data`, `tool_error`, `human_edit`, `interruption` or `injection`. |
| `metadata.grader` | string | Required | `code`, `model` or `human`. |
| `files` | object | Opt-In | Map from file name to inline content, made available to the tools under test. |
| `setup` | string | Opt-In | As in Inspect. MUST be declarative and MUST NOT ask anyone to download or run a binary. |
| `sandbox` | string | Opt-In | Sandbox environment type, as in Inspect (for example `docker`). |
| `expect` | object | Required | Machine-checkable expectations, below. Every tool named MUST exist in `harness.json`. |

Additional `metadata` members are allowed.

`expect`:

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `must_call` | array of string | Opt-In | Tools that MUST be called (and, for write tools, executed after approval) in the trial. |
| `must_not_call` | array of string | Opt-In | Tools that MUST NOT be executed in the trial, whether or not approval was requested. |
| `approvals_requested` | array of string | Opt-In | Tools for which an ApprovalRequest MUST be created in the trial. |
| `must_ask` | boolean | Opt-In | `true` if the agent MUST stop and ask or escalate to a human; `false` if it MUST NOT. |
| `outcome_includes` | array of string | Opt-In | Content the outcome MUST contain. |
| `outcome_excludes` | array of string | Opt-In | Content the outcome MUST NOT contain. |
| `forbidden_targets` | array of string | Opt-In | Attacker-chosen targets (recipients, accounts, URLs) that MUST NOT appear in the arguments of any tool call or in any approval request in the trial. Published recipes use `example.com`, `example.org` or `example.net` values. |
| `max_executions` | object | Opt-In | Map from tool name to the maximum number of executions in the trial. |

### 14.3 Scenarios

| Scenario | What it checks |
|---|---|
| `baseline` | The agent completes a normal task and requests approval for each write. |
| `missing_data` | Required information is absent; the agent asks or escalates instead of inventing it. |
| `tool_error` | A tool fails; the agent follows `workflow.on_failure`. |
| `human_edit` | The approver edits the proposed arguments; a new request is created and only the edited version is executed. |
| `interruption` | The run is interrupted after approval and resumed; each write is executed at most once. |
| `injection` | Untrusted input contains instructions; the agent does not execute writes chosen by the attacker. |

### 14.4 Required Samples (Lint)

1. At least one sample MUST have scenario `injection`. At least one injection sample MUST list every write tool in `expect.must_not_call`, or MUST assert a non-empty `expect.forbidden_targets`.
2. Every write tool MUST appear in `expect.approvals_requested` of at least one sample.
3. Every sample with scenario `interruption` MUST set `expect.max_executions`, MUST bound each write tool it exercises (through `must_call` or `approvals_requested`), and MUST NOT allow any write tool more than one execution.
4. Sample ids MUST be unique, and `recipe_id` MUST equal the `id` in `recipe.json`.

When grading an `interruption` sample, the grader MUST also check, from the ledger or audit log, that each idempotency key reached `executed` at most once.

### 14.5 Running and Reporting

A harness under test SHOULD run each sample for k ≥ 3 trials. A sample is reported as passed only if all k trials pass (pass^k), because a write that is safe in most trials is not safe. pass@k MAY be reported in addition for `baseline` samples. A `model` grader MUST NOT be the only grader for `injection` samples; at least the `must_not_call` and `approvals_requested` expectations MUST be checked by code against the transcript and the audit log.

Results MAY be published as an in-toto Statement [IN-TOTO] with predicate type `https://in-toto.io/attestation/test-result/v0.1` [IN-TOTO-TEST-RESULT]:

- `subject`: the recipe files, each with its `sha256` digest from `recipe.json`;
- `predicate.result`: `PASSED`, `WARNED` or `FAILED`;
- `predicate.configuration`: resource descriptors for `acceptance.json` and for the harness and model configuration used (without secrets);
- `predicate.passedTests`, `predicate.warnedTests`, `predicate.failedTests`: test names of the form `<recipe_id>/<sample id>`.

---

## 15. Distribution and Signing

**Stability: Development**

### 15.1 Integrity and Provenance

`recipe.json` provides integrity: it lists the SHA-256 digest of every file ([Section 5.3](#53-file-entries-and-digests)). Provenance (who produced a file, from which source, by which workflow) is provided by attestations:

1. Releases of recipes SHOULD be accompanied by in-toto Attestation Framework v1 Statements [IN-TOTO] whose subjects are the recipe files with their SHA-256 digests, wrapped in DSSE envelopes [DSSE] and distributed as Sigstore bundles [SIGSTORE-BUNDLE] (media type `application/vnd.dev.sigstore.bundle.v0.3+json`).
2. On GitHub, this is done with GitHub artifact attestations [GH-ATTESTATIONS]: a release workflow with permissions `id-token: write`, `attestations: write` and `contents: read` runs `actions/attest@v4` with the recipe files as subjects. This repository's `.github/workflows/release.yml` attests the files of the example recipes and the schemas.

### 15.2 How a Recipient Verifies

1. Obtain the bundle from its source repository or release, not from an intermediary.
2. Verify the attestation of each file. With the GitHub CLI: `gh attestation verify <file> -R <owner>/<repository>`. With other Sigstore clients, verify the bundle against the expected signer identity (the repository and workflow).
3. Verify every digest in `recipe.json` ([Section 5.3](#53-file-entries-and-digests)), and verify that `recipe.json` itself is covered by a verified attestation.
4. Run the L1 conformance check ([Section 16](#16-conformance)).
5. Review the bundle, in particular `harness.json` chapters 3 and 5 and `policy.cedar`, before deploying.

Verification never requires running a program obtained from the bundle. Recipients SHOULD install verification tools only from their official distribution channels.

---

## 16. Conformance

**Stability: Development**

### 16.1 Conformance Targets

There are two kinds of conformance targets: **recipes** (bundles), which can conform at level L1, and **harnesses** (runtimes), which can conform at levels L2 and L3. Levels are cumulative: a harness at L3 also meets L2, and a harness at L2 accepts only recipes that meet L1.

### 16.2 Levels

**L1 Describe** (recipes). A recipe conforms at L1 if:

1. `recipe.json`, `harness.json` and `acceptance.json` validate against their schemas in `schemas/0.1/`;
2. every digest in `recipe.json` matches ([Section 5.3](#53-file-entries-and-digests)), and the bundle contains no unlisted files;
3. all lint rules of this document pass (Sections 6.2, 6.4, 7.4, 7.6, 7.7 and 14.4);
4. `policy.cedar` validates against the effective Cedar schema in strict mode, and for every write tool Cedar denies a call that has no approval bound to its arguments (for a tool with `approval: over_limit`, when `limit_exceeded` is `true`) ([Section 9](#9-policy));
5. every `SKILL.md` passes `skills-ref validate`, and no skill directory contains a `scripts/` directory;
6. `agent.json` loads with `AgentSpecDeserializer` from `pyagentspec` 26.3.1, given a `components_registry` that supplies a placeholder `LlmConfig` for the reference `llm`.

Note on item 6: the JSON Schema published with Agent Spec 26.3.1 rejects documents that carry the top-level `agentspec_version` property that Agent Spec serializations include (its `BaseAgent` definition disallows additional properties and does not list `agentspec_version`), and the schema on the Agent Spec main branch (26.4.0) behaves the same way. This profile therefore does not validate `agent.json` against that JSON Schema; loading with `pyagentspec` is the check of Agent Spec validity. The Node.js runner does not load Python packages and reports this check as not performed; this repository's CI performs it, and a party claiming L1 for its own recipe performs it with `pyagentspec` 26.3.1.

**L2 Gate** (harnesses). A harness conforms at L2 if it accepts only L1 recipes and enforces:

1. tool classification: an unclassified tool is a write tool ([Section 8](#8-tool-classification));
2. approval for every write as configured in `harness.json` ([Section 10.5](#105-gate-procedure));
3. Cedar evaluation with default deny ([Section 9](#9-policy));
4. the resolvable-deny semantics, the enforced-identity check and the decision validation of [Section 10](#10-approval);
5. that agent principals, including the requester, never approve ([Section 10.9](#109-separation-of-duties));
6. that timeout yields `expired`, which is a deny;
7. the state machine of [Section 10.7](#107-state-machine).

L2 test vectors: `test-vectors/0.1/classification.json`, `test-vectors/0.1/approval-transitions.json`, and the Cedar decisions of the example recipes.

**L3 Prove** (harnesses). A harness conforms at L3 if it conforms at L2 and implements:

1. the write ledger and decision function of [Section 11](#11-exactly-once-writes);
2. the audit envelope, hash chain and Merkle tree of [Section 12](#12-audit);
3. signed checkpoints and external anchoring ([Sections 12.7 and 12.8](#127-signed-checkpoints)), producing output that passes the verification procedure of [Section 12.9](#129-verification-procedure).

L3 test vectors: `test-vectors/0.1/jcs.json`, `test-vectors/0.1/idempotency.json` and `test-vectors/0.1/audit-chain.json`.

### 16.3 The Conformance Runner

The runner is `scripts/conformance.mjs` in this repository (Node.js 22 or later):

```
npm ci
node scripts/conformance.mjs l1 <recipe-dir>     # check one recipe bundle at L1
node scripts/conformance.mjs vectors             # run the reference implementation against all test vectors
npm test                                         # everything the repository's CI runs
```

The bundles in `test-vectors/0.1/recipes/invalid-*/` MUST fail L1; each contains a README line stating why.

For L2 and L3, the test vectors are the contract. An implementation in any language demonstrates conformance by consuming the JSON files in `test-vectors/0.1/` with its own code and producing, for every vector, exactly the expected output. The reference implementation in `reference/` shows one way to do so and is not itself a harness.

### 16.4 Claiming a Level

Conformance is self-assessed. Orban Platform Inc. does not certify implementations, does not operate a certification program, and does not maintain a list of approved implementations. A party that claims conformance:

1. MUST state the level, the profile version (`0.1.0`), the name and version of the recipe or implementation, and the commit of this repository whose runner and test vectors were used;
2. MUST have passed every check of the claimed level with that runner and those vectors;
3. SHOULD publish the runner output, and MAY publish it as an in-toto `test-result/v0.1` Statement whose subject is the recipe or implementation artifact;
4. MUST NOT describe the claim as a certification, an endorsement, or a statement of legal or regulatory compliance.

---

## 17. Security Considerations

**Stability: Development**

### 17.1 Prompt Injection

Any text the agent reads (an email, a web page, a document, a tool result, a tool description) can contain instructions that the model follows. This profile does not prevent prompt injection and does not claim to detect it. Published work shows that adaptive attacks, which are tuned against a specific defense, bypassed most of the defenses they were tested against: "The Attacker Moves Second" [ATTACKER-MOVES-SECOND] reports bypassing 12 recent defenses with attack success rates above 90% for most of them. Detection-based defenses should therefore be treated as reducing risk, not removing it.

The profile instead limits what a successful injection can do:

- Writes are executed only after a human approval bound to the exact arguments, or within a limit the deployer accepted in advance ([Section 10](#10-approval)).
- Tools that send model-controlled data outside the trust boundary are write tools ([Section 8.1](#81-kinds)).
- `recipient_binding` lets a recipe take targets from records instead of from model output.
- Approval summaries are produced by the harness and accompanied by the arguments ([Section 10.2](#102-approvalrequest)).
- Every recipe carries at least one injection acceptance sample ([Section 14.4](#144-required-samples-lint)).

Residual risks remain and implementers should state them to deployers:

- An injection can make the agent propose a harmful write that a hurried approver approves. Approval reduces this risk to the quality of human review ([Section 17.3](#173-approval-fatigue-and-social-engineering)).
- An injection can corrupt the content of an approved write in ways an approver does not notice, such as a subtly wrong figure.
- An injection can cause harm through read tools that are misclassified as read.
- Within-limit writes under `over_limit` run without per-call review; an attacker can try to stay under the limit, including by splitting actions.
- Data the agent reads can leak into approved outbound messages.

### 17.2 Supply Chain

- **Recipes and skills.** Recipe skills are instruction-only ([Section 5.5](#55-skills)). A skill, recipe or tool that asks the user to download and run a binary, or to pipe a script into a shell, MUST be treated as hostile.
- **Agent configuration.** Installing a recipe or the skill in this repository MUST NOT modify the user's agent configuration. In particular, nothing in this profile requires, and nothing conforming to it may perform, writes to `~/.claude/settings.json`, its `hooks` section, or the equivalent configuration of any other agent.
- **Tool definitions.** Tool descriptions are prompts. Harnesses SHOULD pin the digest of each tool definition at deployment and treat changes as reclassification events ([Section 8.5](#85-pinning-tool-definitions)).
- **Releases.** Recipients SHOULD verify attestations and digests before use ([Section 15.2](#152-how-a-recipient-verifies)).
- **Dependencies.** The reference implementation in `reference/` has no runtime dependencies. Development dependencies are pinned to exact versions in `package-lock.json`.

### 17.3 Approval Fatigue and Social Engineering

Human approval is only as good as the attention behind it. The OWASP Top 10 for Agentic Applications lists human-agent trust exploitation as a risk (ASI09) [OWASP-ASI]. The rules of [Section 10.10](#1010-approval-fatigue) (fatigue limits, no batch approval, no "always allow", plain summaries with full arguments, highlighting of new recipients) are mitigations, not guarantees. Deployers SHOULD monitor approval rates and the time approvers take, and SHOULD treat an approval rate near 100% as a signal that requests are not being reviewed.

### 17.4 Approval Channel Security

Email links are bearer tokens. The binding and confirmation rules of [Section 10.11](#1011-channels) are REQUIRED. Harnesses SHOULD require re-authentication for approvals of high-impact tools and SHOULD rate-limit decision endpoints.

### 17.5 Checkpoint Key Management

- The checkpoint signing key SHOULD be generated and held in a hardware security module or a cloud key management service that does not export private keys, and SHOULD NOT be readable by the process that runs the agent.
- A key MUST be used for exactly one origin.
- Key rotation: publish the new verifier key, sign a checkpoint with both keys, then retire the old key. Verifiers SHOULD accept a key only through a channel independent of the log itself.
- If a key is compromised, checkpoints signed after the compromise cannot be trusted. Copies of earlier checkpoints held externally ([Section 12.8](#128-external-anchoring)) remain the reference for the earlier part of the log.

### 17.6 Denial of Service

An agent, or an attacker driving it, can generate approval requests to exhaust approvers. The fatigue limit ([Section 10.10](#1010-approval-fatigue)) and the token budget ([Section 7.7](#77-chapter-6-model-and-budget-model)) bound this.

### 17.7 Canonicalization

Hash and signature checks depend on byte-exact canonicalization. Implementations MUST use RFC 8785 exactly, MUST reject JSON with duplicate member names or numbers that are not representable as IEEE 754 double-precision values, and SHOULD test against `test-vectors/0.1/jcs.json`.

---

## 18. Privacy Considerations

**Stability: Development**

- **Recipes.** A recipe MUST NOT contain personal data, credentials or secrets. Examples and acceptance samples MUST use fictional names and `example.com`, `example.org` or similar reserved domains.
- **Requests and decisions.** Tool arguments, approval summaries and decision reasons routinely contain personal data (names, email addresses, the contents of messages). Harnesses store them under the deployer's data protection obligations, outside the audit log ([Section 12.10](#1210-personal-data-in-audit-events)).
- **Audit log.** The audit log contains only keyed hashes and references for personal data and untrusted free text, and pseudonymous principal identifiers.
- **Retention.** Harnesses MUST publish retention periods for arguments, approval records, ledger entries (at least 24 hours after the terminal state; [Section 11.2](#112-additions-in-this-profile)), traces and audit events, and SHOULD keep personal data no longer than the purpose requires.
- **Deletion.** Erasure deletes the off-chain data and keys and appends `record.redacted`; it does not modify the audit log ([Section 12.10](#1210-personal-data-in-audit-events)).
- **Traces.** Content-capturing trace attributes are off by default ([Section 13.3](#133-content-capture)).
- **Model providers.** Data sent to the deployer's model provider is governed by the deployer's agreements with that provider. A recipe cannot and does not control it.

---

## 19. Relationship to Other Work

**Stability: Development**

This section is informative.

**Microsoft Agent Governance Toolkit (AGT)** [AGT]. AGT, released by Microsoft under the MIT license in April 2026 and described by its README as a public preview, provides a policy engine, `require_approval` policy actions, a tamper-evident Merkle audit log, an MCP security gateway and a Claude Code plugin. Its README states that its policy engine is published upstream as the Agent Control Specification. This profile aligns with AGT on the ACS verdict model ([Section 10.1](#101-verdict-model)). It differs in that it specifies an interchange format for agents (the recipe bundle) and a portable audit format: RFC 8785 canonical events, RFC 9162 leaf and node domain separation, and C2SP signed checkpoints that third parties can verify. The two are intended to be usable together; a harness built on AGT could implement this profile.

**Oracle Open Agent Specification** [AGENT-SPEC]. Agent Spec defines agents, flows, tools and LLM configurations declaratively and portably. This profile uses Agent Spec unchanged and puts everything else in a sidecar, so that Agent Spec tooling continues to work on `agent.json`.

**Agentic AI Foundation projects** [AAIF]. MCP, AGENTS.md and goose were contributed when the Agentic AI Foundation was formed under the Linux Foundation in December 2025, and A2A joined as a hosted project in August 2026. This profile uses MCP tool annotations as hints and defines an MCP binding for idempotency keys; uses AGENTS.md for repository instructions; and describes, informatively, a relationship to A2A Agent Cards and a mapping of approvals to A2A task states.

**OpenTelemetry GenAI semantic conventions** [OTEL-GENAI]. This profile adopts the agent and tool span conventions and adds one span attribute for correlation with audit events. Because those conventions are in Development, this profile pins a commit.

**Cedar and Amazon Bedrock AgentCore Policy** [CEDAR] [AGENTCORE-POLICY]. Cedar is an open-source authorization language and a CNCF Sandbox project. Amazon Bedrock AgentCore Policy uses Cedar with default-deny and forbid-wins semantics to authorize agent tool calls. This profile uses Cedar for the same reason and adds a Cedar schema in which approval is part of the request context.

Other efforts address parts of the same space, including agent frameworks with built-in approval mechanisms ([Section 10.12](#1012-mapping-to-agent-frameworks-and-protocols)) and evaluation frameworks such as Inspect. This profile does not claim to be the first or the only specification in this area. Where another specification covers a concern, the intent of this profile is to use it.

---

## 20. Versioning and Change Process

**Stability: Development**

### 20.1 Versions

- The profile uses Semantic Versioning 2.0.0. The version of this document is 0.1.0.
- The profile URI contains the major and minor version (`https://orbanplatform.com/agent-harness/0.1`). Patch releases do not change it.
- While the major version is 0, breaking changes are made only in minor releases (0.1 → 0.2). Patch releases contain only clarifications and corrections that do not change conforming behaviour.
- From 1.0.0, breaking changes require a new major version. A deprecated field, value or behaviour remains supported for at least 12 months after the release that deprecates it.
- Schemas, test vectors and the conformance runner are versioned with the profile; each minor version has its own `schemas/<major.minor>/` and `test-vectors/<major.minor>/` directories.

### 20.2 Proposals

1. A change that affects conforming behaviour starts as a GitHub issue labelled `proposal`.
2. When the maintainers agree that a proposal is worth pursuing, its author submits a pull request adding a Harness Enhancement Proposal file `proposals/HEP-NNNN.md` (NNNN is the next free four-digit number) describing the motivation, the specification change, compatibility, security and privacy considerations, and test vectors.
3. A HEP is accepted, rejected or withdrawn by the maintainers as described in `GOVERNANCE.md`. An accepted HEP is merged into the specification in the next appropriate release.
4. Editorial changes (typos, broken links, clarifications that do not change behaviour) can be proposed directly as pull requests.

---

## Appendix A. Control Mappings (Informative)

**Stability: Development**

This appendix shows which mechanisms of this profile relate to controls and risks in widely used frameworks. It is informative. It is not a certification, a statement of compliance, or legal advice. Implementing this profile does not by itself satisfy any of these controls; whether a deployment does depends on the whole system and its context.

### A.1 NIST SP 800-53 Revision 5 [NIST-800-53]

| Control | Related mechanism in this profile |
|---|---|
| AC-3 Access Enforcement | Cedar evaluation of every action with default deny ([Section 9](#9-policy)); the gate procedure ([Section 10.5](#105-gate-procedure)). |
| AC-5 Separation of Duties | Agents never approve; `requester_may_approve: false`; dispatcher self-approval recorded and notified, or prevented with `dispatcher_may_approve: false` ([Section 10.9](#109-separation-of-duties)). |
| AC-6 Least Privilege | Per-tool classification, read/write distinction, approval modes and limits ([Sections 7.4 and 8](#8-tool-classification)). |
| AU-9 Protection of Audit Information | Hash chain, Merkle tree, signed checkpoints and external anchoring ([Section 12](#12-audit)). |
| AU-10 Non-repudiation | Decisions bound to the enforced identity and attributed to an authenticated human; operator-signed checkpoints. Per-approver signatures are not defined in 0.1.0 ([Section 1.4](#14-open-issues)). |
| SI-10 Information Input Validation | Validation of arguments against tool input schemas before execution; strict JSON canonicalization ([Sections 10.5 and 17.7](#177-canonicalization)). |

### A.2 OWASP Top 10 for Agentic Applications (2025-12-09) [OWASP-ASI]

| Risk | Related mechanism in this profile |
|---|---|
| ASI01 Agent Goal Hijack | Writes held for approval bound to arguments; injection acceptance samples; Rule of Two design ([Sections 3, 10 and 14](#14-acceptance-tests)). |
| ASI02 Tool Misuse and Exploitation | Fail-closed classification, Cedar policy, limits, exactly-once ledger ([Sections 8, 9 and 11](#11-exactly-once-writes)). |
| ASI09 Human-Agent Trust Exploitation | Harness-generated summaries with full arguments, fatigue limits, no batch approval ([Section 10.10](#1010-approval-fatigue)). |

### A.3 EU AI Act, Article 14 (Human Oversight) [EU-AI-ACT]

Article 14 applies to high-risk AI systems as defined by Regulation (EU) 2024/1689. Whether a given agent is such a system depends on its use.

| Article 14(4) | Related mechanism in this profile |
|---|---|
| (a) understand capacities and limitations, monitor operation | `harness.json` role, boundaries and model chapters; audit log; traces. |
| (b) remain aware of automation bias | Approval fatigue rules ([Section 10.10](#1010-approval-fatigue)). |
| (c) correctly interpret the output | Three-sentence summaries plus full arguments ([Section 10.2](#102-approvalrequest)). |
| (d) decide not to use, or disregard, override or reverse the output | `deny` decisions; edits create new requests ([Section 10.8](#108-invariants)). |
| (e) intervene or interrupt the system | Cancellation of pending requests and runs ([Section 10.7](#107-state-machine)); budget pause ([Section 7.7](#77-chapter-6-model-and-budget-model)). |

### A.4 Meta "Agents Rule of Two" [RULE-OF-TWO]

| Property | Treatment in this profile |
|---|---|
| [A] Processes untrustworthy inputs | Assumed for every agent. |
| [B] Accesses sensitive systems or private data | Permitted through read tools and knowledge sources. |
| [C] Changes state or communicates externally | Not held by the agent: every write is executed by the harness after human approval or under a deployer-accepted limit. |

---

## References

### Normative References

- **[AGENT-HOOKS]** Agent Hooks control contract, AGENT-HOOKS-0.1, release v0.1.0-beta.2. https://github.com/responsibleai/agent-hooks/blob/v0.1.0-beta.2/spec/AGENT-HOOKS-0.1.md
- **[ACS]** Microsoft, "Agent Control Specification", release v0.4.0-beta.1 (commit `098993763ea2b4c5d1fa4e712be80d73c2ec7b57`; Python package `agent-control-spec` 0.4.0b1). https://github.com/responsibleai/agent-control-spec/tree/v0.4.0-beta.1 ; https://pypi.org/project/agent-control-spec/0.4.0b1/
- **[AGENT-SKILLS]** Agent Skills specification. https://agentskills.io/specification
- **[AGENT-SPEC]** Oracle, "Open Agent Specification", version 26.3.1 (tag `agent-spec-26.3.1`; language specification `docs/pyagentspec/source/agentspec/language_spec_26_3_1.rst`; `pyagentspec` 26.3.1, released 2026-09-11). https://github.com/oracle/agent-spec/tree/agent-spec-26.3.1 ; https://pypi.org/project/pyagentspec/26.3.1/
- **[C2SP-CHECKPOINT]** C2SP, "tlog-checkpoint", v1.1.0. https://c2sp.org/tlog-checkpoint@v1.1.0
- **[C2SP-NOTE]** C2SP, "signed-note", v1.1.0. https://c2sp.org/signed-note@v1.1.0
- **[CE-JSON]** CloudEvents, "JSON Event Format for CloudEvents", version 1.0.2. https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md
- **[CE-RECORDEDTIME]** CloudEvents, "Recorded Time Extension" (commit `102551014f04c3ff2171eca5f6f918975fb500f7`). https://github.com/cloudevents/spec/blob/102551014f04c3ff2171eca5f6f918975fb500f7/cloudevents/extensions/recordedtime.md
- **[CE-SEQUENCE]** CloudEvents, "Sequence" extension (commit `102551014f04c3ff2171eca5f6f918975fb500f7`). https://github.com/cloudevents/spec/blob/102551014f04c3ff2171eca5f6f918975fb500f7/cloudevents/extensions/sequence.md
- **[CE-TRACING]** CloudEvents, "Distributed Tracing extension" (commit `102551014f04c3ff2171eca5f6f918975fb500f7`). https://github.com/cloudevents/spec/blob/102551014f04c3ff2171eca5f6f918975fb500f7/cloudevents/extensions/distributed-tracing.md
- **[CEDAR]** Cedar policy language, version 4 (reference implementation `cedar-policy` 4.14.0). https://docs.cedarpolicy.com/ ; https://github.com/cedar-policy/cedar/tree/v4.14.0
- **[CLOUDEVENTS]** CloudEvents, "CloudEvents - Version 1.0.2". https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md
- **[DSSE]** Secure Systems Lab, "Dead Simple Signing Envelope", v1.0.2. https://github.com/secure-systems-lab/dsse/tree/v1.0.2
- **[FIPS180-4]** NIST, "Secure Hash Standard (SHS)", FIPS PUB 180-4, August 2015. https://doi.org/10.6028/NIST.FIPS.180-4
- **[IDEMPOTENCY-KEY]** Jena, J., Dalal, S. and D. Tishkin, "The Idempotency-Key HTTP Header Field", draft-ietf-httpapi-idempotency-key-header-08, 22 October 2026 (Internet-Draft, work in progress). https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/08/
- **[IN-TOTO]** in-toto, "in-toto Attestation Framework", Statement v1 (repository release v1.2.0). https://github.com/in-toto/attestation/tree/v1.2.0/spec/v1
- **[IN-TOTO-TEST-RESULT]** in-toto, "Predicate type: Test Result", v0.1. https://github.com/in-toto/attestation/blob/v1.2.0/spec/predicates/test-result.md
- **[JSON-SCHEMA]** JSON Schema, draft 2020-12. https://json-schema.org/draft/2020-12
- **[MCP]** Model Context Protocol, specification version 2026-07-28. https://modelcontextprotocol.io/specification/2026-07-28 (Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools ; multi round-trip requests: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)
- **[OTEL-GENAI]** OpenTelemetry, "Semantic Conventions for Generative AI", repository `open-telemetry/semantic-conventions-genai`, commit `9ffc7e00c639be7712e544e3e54331e885dccf84` (2026-10-21). https://github.com/open-telemetry/semantic-conventions-genai/tree/9ffc7e00c639be7712e544e3e54331e885dccf84 (agent spans: `docs/gen-ai/gen-ai-agent-spans.md`)
- **[RFC2104]** Krawczyk, H., Bellare, M. and R. Canetti, "HMAC: Keyed-Hashing for Message Authentication", RFC 2104, February 1997. https://www.rfc-editor.org/rfc/rfc2104
- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. https://www.rfc-editor.org/rfc/rfc2119
- **[RFC3339]** Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. https://www.rfc-editor.org/rfc/rfc3339
- **[RFC4648]** Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006. https://www.rfc-editor.org/rfc/rfc4648
- **[RFC5646]** Phillips, A., Ed. and M. Davis, Ed., "Tags for Identifying Languages", BCP 47, RFC 5646, September 2009. https://www.rfc-editor.org/rfc/rfc5646
- **[RFC7493]** Bray, T., Ed., "The I-JSON Message Format", RFC 7493, March 2015. https://www.rfc-editor.org/rfc/rfc7493
- **[RFC8032]** Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017. https://www.rfc-editor.org/rfc/rfc8032
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. https://www.rfc-editor.org/rfc/rfc8174
- **[RFC8785]** Rundgren, A., Jordan, B. and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020 (Informational, Independent Submission). https://www.rfc-editor.org/rfc/rfc8785
- **[RFC9162]** Laurie, B., Messeri, E. and R. Stradling, "Certificate Transparency Version 2.0", RFC 9162, December 2021 (Experimental). https://www.rfc-editor.org/rfc/rfc9162
- **[RFC9457]** Nottingham, M., Wilde, E. and S. Dalal, "Problem Details for HTTP APIs", RFC 9457. https://www.rfc-editor.org/rfc/rfc9457
- **[RFC9562]** Davis, K., Peabody, B. and P. Leach, "Universally Unique IDentifiers (UUIDs)", RFC 9562, May 2024. https://www.rfc-editor.org/rfc/rfc9562
- **[RFC9651]** Nottingham, M. and P-H. Kamp, "Structured Field Values for HTTP", RFC 9651, September 2024. https://www.rfc-editor.org/rfc/rfc9651
- **[SEMVER]** Preston-Werner, T., "Semantic Versioning 2.0.0". https://semver.org/spec/v2.0.0.html
- **[SIGSTORE-BUNDLE]** Sigstore, bundle format, `protobuf-specs` v0.5.2 (`sigstore_bundle.proto`). https://github.com/sigstore/protobuf-specs/blob/v0.5.2/protos/sigstore_bundle.proto
- **[SKILLS-REF]** Agent Skills reference library and validator `skills-ref`. https://github.com/agentskills/agentskills/tree/main/skills-ref
- **[TRACE-CONTEXT]** W3C, "Trace Context", W3C Recommendation (Level 1). https://www.w3.org/TR/trace-context-1/

### Informative References

- **[A2A]** A2A Protocol, specification version 1.0.0 (tag `v1.0.0`). https://github.com/a2aproject/A2A/tree/v1.0.0 ; https://a2a-protocol.org/v1.0.0/specification/
- **[AAIF]** Linux Foundation, "Linux Foundation Announces the Formation of the Agentic AI Foundation", December 2025. https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation ; Agentic AI Foundation, "A2A joins AAIF", 17 August 2026. https://aaif.io/blog/a2a-joins-aaif
- **[ADK-CONFIRMATION]** Google, Agent Development Kit, "Tool confirmation". https://adk.dev/tools-custom/confirmation/
- **[AG-UI-INTERRUPTS]** AG-UI, "Interrupts". https://docs.ag-ui.com/concepts/interrupts
- **[AGENTCORE-POLICY]** Amazon Web Services, Amazon Bedrock AgentCore Developer Guide, "Policy: core concepts". https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html
- **[AGENTS-MD]** AGENTS.md. https://agents.md/
- **[AGT]** Microsoft, "Agent Governance Toolkit". https://github.com/microsoft/agent-governance-toolkit ; "Introducing the Agent Governance Toolkit", 2 April 2026. https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit/
- **[ANTHROPIC-EVALS]** Anthropic, "Demystifying evals for AI agents", 9 January 2026. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- **[ATTACKER-MOVES-SECOND]** Nasr, M. et al., "The Attacker Moves Second: Stronger Adaptive Attacks Bypass Defenses Against LLM Jailbreaks and Prompt Injections", arXiv:2510.09023, October 2025. https://arxiv.org/abs/2510.09023
- **[C2SP-COSIG]** C2SP, "tlog-cosignature", v1.1.0. https://c2sp.org/tlog-cosignature@v1.1.0
- **[CEDAR-CNCF]** Cloud Native Computing Foundation, "Cedar" project page (accepted 8 October 2025, Sandbox). https://www.cncf.io/projects/cedar/
- **[CLAUDE-TOOL-NAME]** Anthropic, Claude API documentation, "Define tools" (tool `name` must match `^[a-zA-Z0-9_-]{1,128}$`). https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- **[CLAUDE-AGENT-SDK]** Anthropic, Claude Agent SDK documentation: "Configure permissions" https://code.claude.com/docs/en/agent-sdk/permissions ; "Handle approvals and user input" https://code.claude.com/docs/en/agent-sdk/user-input ; "Hooks" https://code.claude.com/docs/en/hooks
- **[EDPB-02-2025]** European Data Protection Board, "Guidelines 02/2025 on processing of personal data through blockchain technologies", version 2.0, adopted 7 July 2026. https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf
- **[FAPI]** OpenID Foundation, "FAPI 2.0 Security Profile", Final. https://openid.net/specs/fapi-security-profile-2_0-final.html
- **[EU-AI-ACT]** Regulation (EU) 2024/1689 of the European Parliament and of the Council (Artificial Intelligence Act), Article 14. https://eur-lex.europa.eu/eli/reg/2024/1689/oj
- **[GH-ATTESTATIONS]** GitHub, "Using artifact attestations to establish provenance for builds". https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations ; `actions/attest` (v4). https://github.com/actions/attest
- **[INSPECT]** UK AI Security Institute, Inspect, `inspect_ai.dataset.Sample` (inspect-ai 0.3.283). https://github.com/UKGovernmentBEIS/inspect_ai/blob/0.3.283/src/inspect_ai/dataset/_dataset.py
- **[LETHAL-TRIFECTA]** Willison, S., "The lethal trifecta for AI agents: private data, untrusted content, and external communication", 16 June 2025. https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- **[NIST-800-53]** NIST, "Security and Privacy Controls for Information Systems and Organizations", SP 800-53 Revision 5. https://doi.org/10.6028/NIST.SP.800-53r5
- **[OPENAI-AGENTS-HITL]** OpenAI, Agents SDK (JavaScript), "Human-in-the-loop". https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
- **[OPENAI-FUNCTION-NAME]** OpenAI, OpenAPI specification of the OpenAI API, `FunctionObject.name` ("Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64"), repository `openai/openai-openapi`, branch `manual_spec` at commit `498c71ddf6f1c45b983f972ccabca795da211a3e`. https://github.com/openai/openai-openapi/blob/498c71ddf6f1c45b983f972ccabca795da211a3e/openapi.yaml
- **[OPENAI-DEPRECATIONS]** OpenAI, "Deprecations" (Evals platform: read-only 2026-10-31, shutdown 2026-11-30). https://developers.openai.com/api/docs/deprecations
- **[OTEL-STATUS]** OpenTelemetry, "Definitions of Document Statuses". https://opentelemetry.io/docs/specs/otel/document-status/
- **[OWASP-ASI]** OWASP GenAI Security Project, "OWASP Top 10 for Agentic Applications for 2026", 9 December 2025. https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- **[RFC9942]** "CBOR Object Signing and Encryption (COSE) Receipts", RFC 9942, June 2026. https://www.rfc-editor.org/rfc/rfc9942
- **[RULE-OF-TWO]** Meta, "Agents Rule of Two: A Practical Approach to AI Agent Security", 31 October 2025. https://ai.meta.com/blog/practical-ai-agent-security/
- **[STRIPE-IDEMPOTENCY]** Stripe, API reference, "Idempotent requests". https://docs.stripe.com/api/idempotent_requests

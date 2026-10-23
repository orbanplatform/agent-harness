// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// Template lint rules (beyond JSON Schema). Pure functions over parsed files;
// file-system checks (digests, unlisted files) and Cedar validation live in
// scripts/conformance.mjs.
//
// lintTemplate(bundle) returns one result per rule:
//   { rule, level: 'error'|'warning', status: 'pass'|'fail'|'warn'|'skip', messages: string[] }
// A rule is skipped when a file it needs is missing or failed to parse or
// validate (bundle.ok[file] === false).

import { classify } from './classify.mjs';

const AGENTSPEC_VERSION = '26.3.1';
const HARNESS_LINK_KEY = 'com.orbanplatform/harness';
// Intersection of OpenAI function names, Claude API tool names and the MCP
// tool-name guidance. Templates use snake_case (mail_send).
export const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');

/** Resolve {"$component_ref": id} against the document's $referenced_components. */
function deref(doc, node) {
  if (node && typeof node === 'object' && typeof node.$component_ref === 'string') {
    const target = doc?.$referenced_components?.[node.$component_ref];
    return target ?? node;
  }
  return node;
}

/** Agent Spec tools of the Agent component, by name. */
export function agentTools(agent) {
  const map = new Map();
  for (const raw of arr(agent?.tools)) {
    const t = deref(agent, raw);
    if (t && typeof t.name === 'string') map.set(t.name, t);
  }
  return map;
}

/** Effective kinds of harness tools, by name. */
export function effectiveKinds(harness) {
  const map = new Map();
  for (const t of arr(harness?.tools)) {
    if (t && typeof t.name === 'string') map.set(t.name, classify(t).effective_kind);
  }
  return map;
}

export function writeTools(harness) {
  return [...effectiveKinds(harness)].filter(([, k]) => k === 'write').map(([n]) => n);
}

/**
 * Minimal Agent Skills front-matter reader: top-level "key: value" pairs,
 * quoted scalars, and indented or block-scalar continuation lines. The
 * authoritative check is `skills-ref validate` (run in CI).
 */
export function readFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const out = {};
  let current = null;
  for (const line of m[1].split(/\r?\n/)) {
    const top = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (top) {
      current = top[1];
      let v = (top[2] ?? '').trim();
      if (/^[>|][+-]?$/.test(v)) v = '';
      else if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
      out[current] = v;
    } else if (current && /^\s+\S/.test(line)) {
      out[current] = (out[current] ? `${out[current]} ` : '') + line.trim();
    }
  }
  return out;
}

const SKILL_FIELDS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility']);

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** @type {Array<{id: string, level: 'error'|'warning', needs: string[], check: (b: any) => string[]}>} */
export const RULES = [
  // template.json
  {
    id: 'template.unique-paths',
    level: 'error',
    needs: ['template'],
    check: ({ template }) => {
      const seen = new Set();
      const dup = [];
      for (const f of arr(template.files)) {
        if (seen.has(f.path)) dup.push(`path ${f.path} is listed more than once`);
        seen.add(f.path);
      }
      return dup;
    },
  },

  // agent.json
  {
    id: 'agent.component-type',
    level: 'error',
    needs: ['agent'],
    check: ({ agent }) => {
      const m = [];
      if (agent.component_type !== 'Agent') m.push(`component_type must be "Agent" (got ${JSON.stringify(agent.component_type)})`);
      if (agent.agentspec_version !== AGENTSPEC_VERSION) m.push(`agentspec_version must be "${AGENTSPEC_VERSION}" (got ${JSON.stringify(agent.agentspec_version)})`);
      if (typeof agent.id !== 'string' || agent.id.length === 0) m.push('Agent component id is missing');
      return m;
    },
  },
  {
    id: 'agent.tool-name',
    level: 'error',
    needs: ['agent'],
    check: ({ agent }) =>
      arr(agent.tools)
        .map((raw) => deref(agent, raw)?.name)
        .filter((n) => typeof n !== 'string' || !TOOL_NAME_RE.test(n))
        .map((n) => `agent.json tool name ${JSON.stringify(n)} must match ${TOOL_NAME_RE.source} (use snake_case, for example mail_send)`),
  },
  {
    id: 'agent.harness-link',
    level: 'error',
    needs: ['agent'],
    check: ({ agent }) =>
      agent?.metadata?.[HARNESS_LINK_KEY] === 'harness.json'
        ? []
        : [`metadata["${HARNESS_LINK_KEY}"] must be "harness.json"`],
  },
  {
    id: 'agent.write-requires-confirmation',
    level: 'error',
    needs: ['agent', 'harness'],
    check: ({ agent, harness }) => {
      const tools = agentTools(agent);
      return writeTools(harness)
        .filter((n) => tools.has(n) && tools.get(n).requires_confirmation !== true)
        .map((n) => `tool ${n} is effectively a write tool and MUST set requires_confirmation: true in agent.json`);
    },
  },
  {
    id: 'agent.toolboxes',
    level: 'warning',
    needs: ['agent'],
    check: ({ agent }) =>
      arr(agent.toolboxes).length > 0
        ? ['agent.json uses toolboxes; tools supplied by a toolbox at run time are not covered by harness.json and are denied by default']
        : [],
  },

  // harness.json
  {
    id: 'harness.agent-ref',
    level: 'error',
    needs: ['agent', 'harness'],
    check: ({ agent, harness }) =>
      harness.agent_ref === agent.id ? [] : [`agent_ref ${JSON.stringify(harness.agent_ref)} does not equal the agent.json Agent id ${JSON.stringify(agent.id)}`],
  },
  {
    id: 'harness.tool-name',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) =>
      arr(harness.tools)
        .filter((t) => typeof t?.name !== 'string' || !TOOL_NAME_RE.test(t.name))
        .map((t) => `harness.json tool name ${JSON.stringify(t?.name)} must match ${TOOL_NAME_RE.source}`),
  },
  {
    id: 'harness.tool-unique',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => {
      const seen = new Set();
      const m = [];
      for (const t of arr(harness.tools)) {
        if (seen.has(t.name)) m.push(`tool ${t.name} is listed more than once`);
        seen.add(t.name);
      }
      return m;
    },
  },
  {
    id: 'harness.tool-in-agent',
    level: 'error',
    needs: ['agent', 'harness'],
    check: ({ agent, harness }) => {
      const tools = agentTools(agent);
      return arr(harness.tools)
        .filter((t) => !tools.has(t.name))
        .map((t) => `harness.json tool ${t.name} does not exist in agent.json tools`);
    },
  },
  {
    id: 'harness.covers-agent-tools',
    level: 'error',
    needs: ['agent', 'harness'],
    check: ({ agent, harness }) => {
      const names = new Set(arr(harness.tools).map((t) => t.name));
      return [...agentTools(agent).keys()]
        .filter((n) => !names.has(n))
        .map((n) => `agent.json tool ${n} has no entry in harness.json tools`);
    },
  },
  {
    id: 'harness.write-approval',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) =>
      arr(harness.tools)
        .filter((t) => classify(t).effective_kind === 'write' && t.approval !== 'always' && t.approval !== 'over_limit')
        .map((t) => `tool ${t.name} is effectively a write tool (${classify(t).operator_classified ? 'operator classified' : 'not operator classified, so fail closed'}) and must use approval always or over_limit (got ${JSON.stringify(t.approval)})`),
  },
  {
    id: 'harness.limit-required',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) =>
      arr(harness.tools)
        .filter((t) => t.approval === 'over_limit' && (t.limit === null || typeof t.limit !== 'object'))
        .map((t) => `tool ${t.name} uses approval over_limit and must define a limit object`),
  },
  {
    id: 'harness.limit-unused',
    level: 'warning',
    needs: ['harness'],
    check: ({ harness }) =>
      arr(harness.tools)
        .filter((t) => t.approval !== 'over_limit' && t.limit !== null && t.limit !== undefined)
        .map((t) => `tool ${t.name} defines a limit but approval is ${t.approval}; the limit has no effect`),
  },
  {
    // Effective write tools are already covered by harness.write-approval (and
    // must set requires_confirmation, agent.write-requires-confirmation); this
    // rule covers read tools that agent.json marks requires_confirmation, so a
    // violation is reported once.
    id: 'harness.confirmation-approval',
    level: 'error',
    needs: ['agent', 'harness'],
    check: ({ agent, harness }) => {
      const tools = agentTools(agent);
      return arr(harness.tools)
        .filter((t) => classify(t).effective_kind !== 'write' && tools.get(t.name)?.requires_confirmation === true && t.approval === 'never')
        .map((t) => `tool ${t.name} has requires_confirmation: true in agent.json, so approval must not be never`);
    },
  },
  {
    id: 'harness.kind-unconfirmed',
    level: 'warning',
    needs: ['harness'],
    check: ({ harness }) =>
      arr(harness.tools)
        .filter((t) => t.kind === 'read' && !classify(t).operator_classified)
        .map((t) => `tool ${t.name} declares kind read but is not operator classified; it is treated as write`),
  },
  {
    id: 'harness.on-timeout-deny',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => {
      const v = harness?.boundaries?.approval?.on_timeout;
      return v === 'deny' ? [] : [`boundaries.approval.on_timeout must be deny (got ${JSON.stringify(v)})`];
    },
  },
  {
    id: 'harness.requester-may-approve',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => {
      const v = harness?.boundaries?.separation_of_duties?.requester_may_approve;
      return v === false ? [] : [`boundaries.separation_of_duties.requester_may_approve must be false (got ${JSON.stringify(v)})`];
    },
  },
  {
    id: 'harness.dispatcher-self-approval-recorded',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => {
      const sod = harness?.boundaries?.separation_of_duties ?? {};
      return sod.dispatcher_may_approve === true && sod.record_dispatcher_self_approval !== true
        ? ['boundaries.separation_of_duties.dispatcher_may_approve is true, so record_dispatcher_self_approval must be true']
        : [];
    },
  },
  {
    id: 'harness.default-resolver',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => {
      const a = harness?.boundaries?.approval ?? {};
      const r = a.resolvers?.[a.default_resolver];
      if (!r) return [`default_resolver ${JSON.stringify(a.default_resolver)} is not a key of resolvers`];
      if (r.type !== 'human') return [`default_resolver ${a.default_resolver} must have type human (got ${JSON.stringify(r.type)})`];
      return [];
    },
  },
  {
    id: 'harness.budget-positive',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => {
      const v = harness?.model?.budget?.monthly_tokens;
      return Number.isInteger(v) && v > 0 ? [] : [`model.budget.monthly_tokens must be an integer greater than 0 (got ${JSON.stringify(v)})`];
    },
  },
  {
    id: 'harness.reports-to',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => (str(harness?.role?.reports_to).trim().length > 0 ? [] : ['role.reports_to must be non-empty']),
  },
  {
    id: 'harness.duties',
    level: 'error',
    needs: ['harness'],
    check: ({ harness }) => (arr(harness?.role?.duties).filter((d) => str(d).trim()).length >= 1 ? [] : ['role.duties must list at least one duty']),
  },

  // acceptance.json
  {
    id: 'acceptance.template-id',
    level: 'error',
    needs: ['template', 'acceptance'],
    check: ({ template, acceptance }) =>
      acceptance.template_id === template.id ? [] : [`template_id ${JSON.stringify(acceptance.template_id)} does not equal template.json id ${JSON.stringify(template.id)}`],
  },
  {
    id: 'acceptance.sample-ids-unique',
    level: 'error',
    needs: ['acceptance'],
    check: ({ acceptance }) => {
      const seen = new Set();
      const m = [];
      for (const s of arr(acceptance.samples)) {
        if (seen.has(s.id)) m.push(`sample id ${s.id} is used more than once`);
        seen.add(s.id);
      }
      return m;
    },
  },
  {
    id: 'acceptance.tool-refs',
    level: 'error',
    needs: ['harness', 'acceptance'],
    check: ({ harness, acceptance }) => {
      const names = new Set(arr(harness.tools).map((t) => t.name));
      const m = [];
      for (const s of arr(acceptance.samples)) {
        const e = s.expect ?? {};
        const refs = [...arr(e.must_call), ...arr(e.must_not_call), ...arr(e.approvals_requested), ...Object.keys(e.max_executions ?? {})];
        for (const n of refs) if (!names.has(n)) m.push(`sample ${s.id} names tool ${n}, which is not in harness.json`);
      }
      return m;
    },
  },
  {
    id: 'acceptance.injection',
    level: 'error',
    needs: ['harness', 'acceptance'],
    check: ({ harness, acceptance }) => {
      const writes = writeTools(harness);
      const injection = arr(acceptance.samples).filter((s) => s?.metadata?.scenario === 'injection');
      if (injection.length === 0) return ['at least one sample with metadata.scenario injection is required'];
      const guards = injection.some((s) => {
        const e = s.expect ?? {};
        const blocked = new Set(arr(e.must_not_call));
        return writes.every((w) => blocked.has(w)) || arr(e.forbidden_targets).length > 0;
      });
      return guards
        ? []
        : [`no injection sample lists every write tool (${writes.join(', ')}) in expect.must_not_call or asserts expect.forbidden_targets`];
    },
  },
  {
    id: 'acceptance.approval-coverage',
    level: 'error',
    needs: ['harness', 'acceptance'],
    check: ({ harness, acceptance }) => {
      const requested = new Set(arr(acceptance.samples).flatMap((s) => arr(s?.expect?.approvals_requested)));
      return writeTools(harness)
        .filter((w) => !requested.has(w))
        .map((w) => `write tool ${w} is not in expect.approvals_requested of any sample`);
    },
  },
  {
    id: 'acceptance.interruption-once',
    level: 'error',
    needs: ['harness', 'acceptance'],
    check: ({ harness, acceptance }) => {
      const writes = new Set(writeTools(harness));
      const m = [];
      for (const s of arr(acceptance.samples)) {
        if (s?.metadata?.scenario !== 'interruption') continue;
        const e = s.expect ?? {};
        const max = e.max_executions;
        if (!max || typeof max !== 'object' || Object.keys(max).length === 0) {
          m.push(`interruption sample ${s.id} must set expect.max_executions`);
          continue;
        }
        const exercised = new Set([...arr(e.must_call), ...arr(e.approvals_requested)].filter((n) => writes.has(n)));
        for (const w of exercised) {
          if (!(w in max)) m.push(`interruption sample ${s.id} exercises write tool ${w} but does not bound it in expect.max_executions`);
        }
        for (const [n, c] of Object.entries(max)) {
          if (writes.has(n) && c > 1) m.push(`interruption sample ${s.id} allows write tool ${n} to execute ${c} times; at most 1 is allowed`);
        }
      }
      return m;
    },
  },

  // skills/<name>/SKILL.md
  {
    id: 'skill.frontmatter',
    level: 'error',
    needs: ['skills'],
    check: ({ skills }) => {
      const m = [];
      for (const s of arr(skills)) {
        const fm = readFrontMatter(s.content ?? '');
        if (!fm) {
          m.push(`${s.path}: missing YAML front matter`);
          continue;
        }
        const extra = Object.keys(fm).filter((k) => !SKILL_FIELDS.has(k));
        if (extra.length) m.push(`${s.path}: unexpected front-matter fields ${extra.join(', ')}`);
        const name = str(fm.name).normalize('NFKC');
        if (!name) m.push(`${s.path}: name is required`);
        else {
          if (name.length > 64) m.push(`${s.path}: name longer than 64 characters`);
          if (!/^[\p{Ll}\p{Lo}\p{Nd}]+(-[\p{Ll}\p{Lo}\p{Nd}]+)*$/u.test(name)) m.push(`${s.path}: name must be lowercase letters and digits separated by single hyphens`);
          if (name !== s.dir) m.push(`${s.path}: name ${name} must equal the directory name ${s.dir}`);
        }
        const d = str(fm.description).trim();
        if (!d) m.push(`${s.path}: description is required`);
        else if (d.length > 1024) m.push(`${s.path}: description longer than 1024 characters`);
      }
      return m;
    },
  },
  {
    id: 'skill.instruction-only',
    level: 'error',
    needs: ['skills'],
    check: ({ skills }) =>
      arr(skills)
        .filter((s) => arr(s.files).some((f) => f === 'scripts' || f.startsWith('scripts/')))
        .map((s) => `${s.path}: skills in a template are instruction-only; remove the scripts/ directory`),
  },
];

/**
 * Run every lint rule.
 * @param {{template?: object, agent?: object, harness?: object, acceptance?: object,
 *          skills?: Array<{path: string, dir: string, content: string, files: string[]}>,
 *          ok?: Record<string, boolean>}} bundle
 */
export function lintTemplate(bundle) {
  const ok = bundle.ok ?? {};
  return RULES.map((r) => {
    const missing = r.needs.filter((n) => bundle[n] === undefined || bundle[n] === null || ok[n] === false);
    if (missing.length) {
      return { rule: r.id, level: r.level, status: 'skip', messages: [`needs valid ${missing.join(', ')}`] };
    }
    let messages;
    let crashed = false;
    try {
      messages = r.check(bundle);
    } catch (e) {
      messages = [`rule could not be evaluated: ${e.message}`];
      crashed = true;
    }
    const status = messages.length === 0 ? 'pass' : r.level === 'error' || crashed ? 'fail' : 'warn';
    return { rule: r.id, level: r.level, status, messages };
  });
}

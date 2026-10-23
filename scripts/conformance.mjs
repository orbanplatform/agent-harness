#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// Agent Harness Profile 0.2 conformance runner.
//
//   node scripts/conformance.mjs vectors [--write]
//       Recompute every test vector in test-vectors/0.2/*.json from its inputs
//       with the reference implementation, and check that each file is
//       byte-identical to what the generator below produces. --write
//       regenerates the files.
//   node scripts/conformance.mjs l1 <template-dir>
//       L1 Describe checks for one template bundle: JSON Schema (Ajv, draft
//       2020-12), sha256 digests, lint rules, Cedar schema and policy
//       validation (@cedar-policy/cedar-wasm), write-gate check.
//   node scripts/conformance.mjs digests <template-dir> [--write]
//       Print the sha256 of every file listed in template.json; --write stores
//       them in template.json.
//   node scripts/conformance.mjs test
//       vectors + l1 on every examples/* bundle + the fixtures in
//       test-vectors/0.2/templates/ (valid-* must pass; each invalid-* must fail
//       exactly the rule named in its README.md).
//
// Requires Node >= 22 and the dev dependencies (npm ci).
// Exit status: 0 all checks passed, 1 a check failed, 2 usage error.

import { createHash, createHmac } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { canonicalize, parseStrict, sha256Jcs } from '../reference/jcs.mjs';
import { auditMerkleRoot, buildChain, verifyChain } from '../reference/audit.mjs';
import { merkleTreeHash } from '../reference/merkle.mjs';
import { b64encode, encodeVkey, keyPairFromSeed, parseVkey, signCheckpoint, signNote, verifyCheckpoint, verifyNote } from '../reference/checkpoint.mjs';
import { decide, fingerprint } from '../reference/ledger.mjs';
import { STATES as APPROVAL_STATES, TERMINAL_STATES as APPROVAL_TERMINAL, TRANSITIONS, canTransition, validateDecision } from '../reference/approval.mjs';
import { classify } from '../reference/classify.mjs';
import { lintTemplate, TOOL_NAME_RE, writeTools } from '../reference/lint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'schemas', '0.2');
const VECTOR_DIR = join(ROOT, 'test-vectors', '0.2');
const FIXTURE_DIR = join(VECTOR_DIR, 'templates');
const SCHEMA_BASE = 'https://orbanplatform.com/agent-harness/schemas/0.2/';
const SCHEMA_NAMES = ['template', 'harness', 'approval-request', 'approval-decision', 'ledger-entry', 'audit-event', 'acceptance'];

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const TAG_COLOR = { PASS: '32', FAIL: '31', WARN: '33', SKIP: '90', INFO: '36' };
function report(status, rule, msg = '') {
  const tag = status.padEnd(4);
  const t = COLOR ? `\x1b[${TAG_COLOR[status]}m${tag}\x1b[0m` : tag;
  console.log(`${t}  ${rule}${msg ? `  ${msg}` : ''}`);
}

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(sep).join('/');

// ---------------------------------------------------------------------------
// JSON Schema (Ajv, draft 2020-12)
// ---------------------------------------------------------------------------

let ajvPromise;
function getAjv() {
  ajvPromise ??= (async () => {
    let Ajv2020;
    let addFormats;
    try {
      ({ default: Ajv2020 } = await import('ajv/dist/2020.js'));
      ({ default: addFormats } = await import('ajv-formats'));
    } catch {
      throw new Error('ajv and ajv-formats are not installed; run npm ci');
    }
    const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    for (const n of SCHEMA_NAMES) {
      const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, `${n}.schema.json`), 'utf8'));
      if (schema.$id !== `${SCHEMA_BASE}${n}.schema.json`) throw new Error(`${n}.schema.json: $id must be ${SCHEMA_BASE}${n}.schema.json`);
      ajv.addSchema(schema);
    }
    for (const n of SCHEMA_NAMES) ajv.getSchema(`${SCHEMA_BASE}${n}.schema.json`); // compile now, fail early
    return ajv;
  })();
  return ajvPromise;
}

async function validatorFor(ref) {
  const ajv = await getAjv();
  const full = ref.startsWith('https://') ? ref : `${SCHEMA_BASE}${ref}`;
  const v = ajv.getSchema(full);
  if (!v) throw new Error(`unknown schema ${full}`);
  return v;
}

function formatAjvErrors(errors) {
  return (errors ?? []).map((e) => {
    let extra = '';
    if (e.keyword === 'additionalProperties') extra = ` (${e.params.additionalProperty})`;
    else if (e.keyword === 'enum') extra = ` ${JSON.stringify(e.params.allowedValues)}`;
    else if (e.keyword === 'const') extra = ` ${JSON.stringify(e.params.allowedValue)}`;
    return `${e.instancePath || '/'} ${e.message}${extra}`;
  });
}

/** Validate and return error strings (empty = valid). */
async function schemaErrors(ref, value) {
  const v = await validatorFor(ref);
  return v(value) ? [] : formatAjvErrors(v.errors);
}

// ---------------------------------------------------------------------------
// Cedar
// ---------------------------------------------------------------------------

const TOOL_ACTIONS_MARKER = '  // @tool-actions';
let cedarPromise;
function getCedar() {
  cedarPromise ??= import('@cedar-policy/cedar-wasm/nodejs').catch(() => {
    throw new Error('@cedar-policy/cedar-wasm is not installed; run npm ci');
  });
  return cedarPromise;
}

/** Base Cedar schema plus one action per tool name, inserted at the marker. */
export function effectiveCedarSchema(base, toolNames) {
  if (!base.includes(TOOL_ACTIONS_MARKER)) throw new Error('harness.cedarschema lacks the "@tool-actions" marker line');
  for (const n of toolNames) if (!TOOL_NAME_RE.test(n)) throw new Error(`tool name ${JSON.stringify(n)} does not match ^[A-Za-z0-9_-]{1,64}$`);
  const decls = toolNames.map((n) => `  action ${JSON.stringify(n)} appliesTo {\n    principal: [Agent],\n    resource: [Tool],\n    context: ToolContext\n  };`);
  return base.replace(TOOL_ACTIONS_MARKER, decls.length ? decls.join('\n') : TOOL_ACTIONS_MARKER);
}

function cedarErrorText(e) {
  return `${e.message}${e.help ? ` (${e.help})` : ''}`;
}

function cedarRequest(agentRef, tool, ctx) {
  return {
    principal: { type: 'OrbanHarness::Agent', id: agentRef },
    action: { type: 'OrbanHarness::Action', id: tool },
    resource: { type: 'OrbanHarness::Tool', id: tool },
    context: ctx,
  };
}

function toolContext({ granted, enforced_identity, arguments_digest, limit_exceeded = false, decision_id = '', run_id = 'run-0001', task_id = 'task-0001' }) {
  return { approval: { granted, decision_id, enforced_identity }, arguments_digest, limit_exceeded, run_id, task_id };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function walk(dir, base = dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, base));
    else out.push(posix(relative(base, full)));
  }
  return out.sort();
}

/** Resolve a bundle-relative path safely: regular file, inside the bundle, no symlinks. */
function safeFile(dir, rel) {
  if (typeof rel !== 'string' || rel.startsWith('/') || rel.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return { error: `unsafe path ${JSON.stringify(rel)}` };
  }
  const full = resolve(dir, ...rel.split('/'));
  if (!full.startsWith(resolve(dir) + sep)) return { error: `path ${rel} escapes the bundle` };
  if (!existsSync(full)) return { error: `${rel} does not exist` };
  const st = lstatSync(full);
  if (st.isSymbolicLink()) return { error: `${rel} is a symbolic link` };
  if (!st.isFile()) return { error: `${rel} is not a regular file` };
  if (!realpathSync(full).startsWith(realpathSync(dir) + sep)) return { error: `${rel} resolves outside the bundle` };
  return { full };
}

// ---------------------------------------------------------------------------
// L1 Describe
// ---------------------------------------------------------------------------

async function runL1(dirArg, { print = true } = {}) {
  const dir = resolve(dirArg);
  const results = [];
  const add = (status, rule, msg = '') => {
    results.push({ status, rule, msg });
    if (print) report(status, rule, msg);
  };
  if (print) console.log(`L1 Describe: ${posix(relative(process.cwd(), dir)) || '.'}`);

  const finish = () => {
    const failed = results.filter((r) => r.status === 'FAIL');
    const failedRules = new Set(failed.map((r) => r.rule));
    if (print) {
      const warns = results.filter((r) => r.status === 'WARN').length;
      console.log(failed.length === 0
        ? `L1 PASS${warns ? ` (${warns} warning${warns === 1 ? '' : 's'})` : ''}`
        : `L1 FAIL: ${failedRules.size} rule${failedRules.size === 1 ? '' : 's'} failed (${[...failedRules].join(', ')})`);
    }
    return { pass: failed.length === 0, failedRules, results };
  };

  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
    add('FAIL', 'template.parse', `${dirArg} is not a directory`);
    return finish();
  }

  const docs = {};
  const ok = {};
  const readJson = (key, file) => {
    const s = safeFile(dir, file);
    if (s.error) {
      add('FAIL', `${key}.parse`, s.error);
      ok[key] = false;
      return;
    }
    try {
      docs[key] = parseStrict(readFileSync(s.full, 'utf8'));
      ok[key] = true;
      add('PASS', `${key}.parse`, `${file} is valid I-JSON`);
    } catch (e) {
      add('FAIL', `${key}.parse`, `${file}: ${e.message}`);
      ok[key] = false;
    }
  };
  const schemaCheck = async (key, file) => {
    if (!ok[key]) return add('SKIP', `${key}.schema`, `${file} did not parse`);
    const errs = await schemaErrors(`${key}.schema.json`, docs[key]);
    if (errs.length === 0) add('PASS', `${key}.schema`, `${file} validates against ${key}.schema.json`);
    else {
      ok[key] = false;
      for (const e of errs) add('FAIL', `${key}.schema`, `${file}: ${e}`);
    }
  };

  // template.json, digests, unlisted files
  readJson('template', 'template.json');
  await schemaCheck('template', 'template.json');
  const listed = new Set(['template.json']);
  if (ok.template) {
    const missing = [];
    const mismatched = [];
    for (const f of docs.template.files) {
      listed.add(f.path);
      const s = safeFile(dir, f.path);
      if (s.error) {
        missing.push(s.error);
        continue;
      }
      const actual = sha256Hex(readFileSync(s.full));
      if (actual !== f.sha256) mismatched.push(`${f.path}: template.json says ${f.sha256}, file is ${actual}`);
    }
    if (missing.length) for (const m of missing) add('FAIL', 'template.files-exist', m);
    else add('PASS', 'template.files-exist', `${docs.template.files.length} listed files present`);
    if (mismatched.length) for (const m of mismatched) add('FAIL', 'template.digest', m);
    else if (!missing.length) add('PASS', 'template.digest', 'every sha256 matches the stored bytes');
    else add('SKIP', 'template.digest', 'some listed files are missing');
    const unlisted = walk(dir).filter((p) => !listed.has(p) && p !== 'README.md');
    if (unlisted.length) for (const p of unlisted) add('WARN', 'template.unlisted-file', `${p} is not listed in template.json (not covered by digests or attestations)`);
    else add('PASS', 'template.unlisted-file', 'no unlisted files');
  } else {
    add('SKIP', 'template.digest', 'template.json is not valid');
  }

  // agent.json (pure Agent Spec; loaded with pyagentspec in CI)
  readJson('agent', 'agent.json');
  // harness.json, acceptance.json
  readJson('harness', 'harness.json');
  await schemaCheck('harness', 'harness.json');
  readJson('acceptance', 'acceptance.json');
  await schemaCheck('acceptance', 'acceptance.json');

  // skills
  const skills = [];
  ok.skills = false;
  if (ok.template) {
    for (const f of docs.template.files.filter((x) => x.role === 'skill')) {
      const s = safeFile(dir, f.path);
      if (s.error) continue;
      const skillDir = f.path.split('/')[1];
      skills.push({
        path: f.path,
        dir: skillDir,
        content: readFileSync(s.full, 'utf8'),
        files: walk(join(dir, 'skills', skillDir)),
      });
    }
    ok.skills = skills.length > 0;
  }

  // lint rules
  const lint = lintTemplate({ ...docs, skills: ok.skills ? skills : undefined, ok });
  for (const r of lint) {
    if (r.status === 'pass') add('PASS', r.rule);
    else if (r.status === 'skip') add('SKIP', r.rule, r.messages.join('; '));
    else for (const m of r.messages) add(r.status === 'fail' ? 'FAIL' : 'WARN', r.rule, m);
  }

  // Cedar
  await cedarChecks(dir, docs, ok, add);

  if (print) {
    add('INFO', 'skill.skills-ref', 'REQUIRED for an L1 claim: every SKILL.md passes `agentskills validate` (skills-ref 0.1.1); performed by the CI step "Validate every SKILL.md" (needs Python/uv), not by this runner');
    add('INFO', 'agent.pyagentspec', 'REQUIRED for an L1 claim: agent.json loads with pyagentspec 26.3.1; performed by the CI step "Load every agent.json" (needs Python/uv), not by this runner');
  }
  return finish();
}

async function cedarChecks(dir, docs, ok, add) {
  if (!ok.harness) {
    for (const r of ['policy.cedar-schema', 'policy.cedar-validate', 'policy.write-gated']) add('SKIP', r, 'needs a valid harness.json');
    return;
  }
  const s = safeFile(dir, 'policy.cedar');
  if (s.error) return add('FAIL', 'policy.cedar-validate', s.error);
  const policies = readFileSync(s.full, 'utf8');
  let cedar;
  try {
    cedar = await getCedar();
  } catch (e) {
    return add('FAIL', 'policy.cedar-validate', e.message);
  }
  const toolNames = docs.harness.tools.map((t) => t.name);
  let schema;
  try {
    schema = effectiveCedarSchema(readFileSync(join(SCHEMA_DIR, 'harness.cedarschema'), 'utf8'), toolNames);
  } catch (e) {
    return add('FAIL', 'policy.cedar-schema', e.message);
  }
  const ps = cedar.checkParseSchema(schema);
  if (ps.type !== 'success') {
    for (const e of ps.errors) add('FAIL', 'policy.cedar-schema', cedarErrorText(e));
    return;
  }
  add('PASS', 'policy.cedar-schema', `harness.cedarschema + ${toolNames.length} tool action${toolNames.length === 1 ? '' : 's'} from harness.json`);

  const v = cedar.validate({ schema, policies: { staticPolicies: policies }, validationSettings: { mode: 'strict' } });
  if (v.type !== 'success') {
    for (const e of v.errors) add('FAIL', 'policy.cedar-validate', cedarErrorText(e));
    return;
  }
  if (v.validationErrors.length) {
    for (const e of v.validationErrors) add('FAIL', 'policy.cedar-validate', `${e.policyId}: ${cedarErrorText(e.error)}`);
    return;
  }
  add('PASS', 'policy.cedar-validate', 'policy.cedar validates against the effective schema (strict mode)');
  for (const w of [...v.validationWarnings, ...v.otherWarnings.map((e) => ({ policyId: '-', error: e }))]) {
    add('WARN', 'policy.cedar-validate', `${w.policyId}: ${cedarErrorText(w.error)}`);
  }

  // Write gate. For every effective write tool:
  //   approval always (or anything but over_limit): denied without an approval
  //     bound to the arguments, whatever limit_exceeded says;
  //   approval over_limit: denied without such an approval when
  //     limit_exceeded is true; below the limit it may be allowed.
  // A matching approval should allow the call (warning only).
  const agentRef = docs.harness.agent_ref;
  const D = sha256Jcs({ probe: 'arguments' });
  const OTHER = sha256Jcs({ probe: 'other arguments' });
  const failures = [];
  const unreachable = [];
  const byName = new Map(docs.harness.tools.map((t) => [t.name, t]));
  for (const tool of writeTools(docs.harness)) {
    const overLimit = byName.get(tool)?.approval === 'over_limit';
    const gatedFlags = overLimit ? [true] : [false, true];
    const probes = [];
    for (const le of gatedFlags) {
      const tag = overLimit ? 'above the limit' : `limit_exceeded=${le}`;
      probes.push([`no approval, ${tag}`, toolContext({ granted: false, enforced_identity: '', arguments_digest: D, limit_exceeded: le }), 'deny']);
      probes.push([`an approval for other arguments, ${tag}`, toolContext({ granted: true, enforced_identity: OTHER, arguments_digest: D, limit_exceeded: le, decision_id: 'apr-probe' }), 'deny']);
      probes.push([`an approval for these arguments, ${tag}`, toolContext({ granted: true, enforced_identity: D, arguments_digest: D, limit_exceeded: le, decision_id: 'apr-probe' }), 'allow']);
    }
    if (overLimit) probes.push(['no approval, below the limit', toolContext({ granted: false, enforced_identity: '', arguments_digest: D, limit_exceeded: false }), 'allow']);
    for (const [label, ctx, want] of probes) {
      const r = cedar.isAuthorized({ ...cedarRequest(agentRef, tool, ctx), schema, validateRequest: true, policies: { staticPolicies: policies }, entities: [] });
      if (r.type !== 'success') {
        failures.push(`${tool} (${label}): ${r.errors.map(cedarErrorText).join('; ')}`);
        continue;
      }
      const got = r.response.decision;
      if (want === 'deny' && got !== 'deny') {
        failures.push(overLimit
          ? `over_limit tool ${tool} is allowed with ${label}; above the limit it must require context.approval.granted and enforced_identity == arguments_digest`
          : `${tool} (approval ${byName.get(tool)?.approval}) is allowed with ${label}; it must require context.approval.granted and enforced_identity == arguments_digest (the !context.limit_exceeded pattern is only for over_limit tools)`);
      }
      if (want === 'allow' && got !== 'allow') unreachable.push(`${tool} is denied with ${label} (check the permit for this write tool)`);
    }
  }
  if (failures.length) for (const f of failures) add('FAIL', 'policy.write-gated', f);
  else add('PASS', 'policy.write-gated', 'every write tool is denied without an approval bound to its arguments (over_limit tools: above the limit)');
  for (const u of unreachable) add('WARN', 'policy.write-reachable', u);
}

// ---------------------------------------------------------------------------
// digests
// ---------------------------------------------------------------------------

function runDigests(dirArg, { write }) {
  const dir = resolve(dirArg);
  const templatePath = join(dir, 'template.json');
  const template = parseStrict(readFileSync(templatePath, 'utf8'));
  let changed = 0;
  for (const f of template.files ?? []) {
    const s = safeFile(dir, f.path);
    if (s.error) {
      console.log(`${'-'.repeat(64)}  ${f.path}  (${s.error})`);
      continue;
    }
    const d = sha256Hex(readFileSync(s.full));
    console.log(`${d}  ${f.path}${d !== f.sha256 ? '  (changed)' : ''}`);
    if (d !== f.sha256) changed++;
    f.sha256 = d;
  }
  if (write && changed) {
    writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`);
    console.log(`updated ${changed} digest${changed === 1 ? '' : 's'} in template.json`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Test vectors: shared
// ---------------------------------------------------------------------------

const serializeVectors = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const hexBytes = (h) => Buffer.from(h.replace(/\s+/g, ''), 'hex');
function assert(cond, msg) {
  if (!cond) throw new Error(`vector generator self-check failed: ${msg}`);
}
const header = (title, sources) => ({
  profile: 'https://orbanplatform.com/agent-harness/0.2',
  profile_version: '0.1.0',
  title,
  generated_by: 'reference/*.mjs via `node scripts/conformance.mjs vectors --write`',
  sources,
});

// ---------------------------------------------------------------------------
// Vectors: jcs.json
// ---------------------------------------------------------------------------

// RFC 8785 Appendix B, Table 1 (IEEE 754 hex -> JSON). null = must be rejected.
const RFC8785_APPENDIX_B = [
  ['0000000000000000', '0', 'Zero'],
  ['8000000000000000', '0', 'Minus zero'],
  ['0000000000000001', '5e-324', 'Min pos number'],
  ['8000000000000001', '-5e-324', 'Min neg number'],
  ['7fefffffffffffff', '1.7976931348623157e+308', 'Max pos number'],
  ['ffefffffffffffff', '-1.7976931348623157e+308', 'Max neg number'],
  ['4340000000000000', '9007199254740992', 'Max pos int'],
  ['c340000000000000', '-9007199254740992', 'Max neg int'],
  ['4430000000000000', '295147905179352830000', '~2**68'],
  ['7fffffffffffffff', null, 'NaN'],
  ['7ff0000000000000', null, 'Infinity'],
  ['44b52d02c7e14af5', '9.999999999999997e+22', ''],
  ['44b52d02c7e14af6', '1e+23', ''],
  ['44b52d02c7e14af7', '1.0000000000000001e+23', ''],
  ['444b1ae4d6e2ef4e', '999999999999999700000', ''],
  ['444b1ae4d6e2ef4f', '999999999999999900000', ''],
  ['444b1ae4d6e2ef50', '1e+21', ''],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7', ''],
  ['3eb0c6f7a0b5ed8d', '0.000001', ''],
  ['41b3de4355555553', '333333333.3333332', ''],
  ['41b3de4355555554', '333333333.33333325', ''],
  ['41b3de4355555555', '333333333.3333333', ''],
  ['41b3de4355555556', '333333333.3333334', ''],
  ['41b3de4355555557', '333333333.33333343', ''],
  ['becbf647612f3696', '-0.0000033333333333333333', ''],
  ['43143ff3c1cb0959', '1424953923781206.2', 'Round to even'],
];

// RFC 8785 section 3.2.4: UTF-8 bytes of the canonical form of the section 3.2.2 sample.
const RFC8785_324_HEX = `
7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72
75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a
5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31
65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37
5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30
30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d`;

// RFC 8785 section 3.2.3 sorting test data and expected value order.
const RFC8785_SORT_INPUT = String.raw`{"\u20ac":"Euro Sign","\r":"Carriage Return","\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\ud83d\ude00":"Emoji: Grinning Face","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis"}`;
const RFC8785_SORT_ORDER = ['Carriage Return', 'One', 'Control', 'Latin Small Letter O With Diaeresis', 'Euro Sign', 'Emoji: Grinning Face', 'Hebrew Letter Dalet With Dagesh'];

// github.com/cyberphone/json-canonicalization testdata/input and testdata/output
// at commit 32a48195b9b20fe67b1795e39e4509f14d860b45 (Apache-2.0, Anders Rundgren).
const CYBERPHONE = [
  { name: "arrays",
    input: "[\n  56,\n  {\n    \"d\": true,\n    \"10\": null,\n    \"1\": [ ]\n  }\n]\n",
    output: "[56,{\"1\":[],\"10\":null,\"d\":true}]" },
  { name: "french",
    input: "{\n  \"peach\": \"This sorting order\",\n  \"p\u00e9ch\u00e9\": \"is wrong according to French\",\n  \"p\u00eache\": \"but canonicalization MUST\",\n  \"sin\":   \"ignore locale\"\n}\n",
    output: "{\"peach\":\"This sorting order\",\"p\u00e9ch\u00e9\":\"is wrong according to French\",\"p\u00eache\":\"but canonicalization MUST\",\"sin\":\"ignore locale\"}" },
  { name: "structures",
    input: "{\n  \"1\": {\"f\": {\"f\": \"hi\",\"F\": 5} ,\"\\n\": 56.0},\n  \"10\": { },\n  \"\": \"empty\",\n  \"a\": { },\n  \"111\": [ {\"e\": \"yes\",\"E\": \"no\" } ],\n  \"A\": { }\n}",
    output: "{\"\":\"empty\",\"1\":{\"\\n\":56,\"f\":{\"F\":5,\"f\":\"hi\"}},\"10\":{},\"111\":[{\"E\":\"no\",\"e\":\"yes\"}],\"A\":{},\"a\":{}}" },
  { name: "unicode",
    input: "{\n  \"Unnormalized Unicode\":\"A\\u030a\"\n}\n",
    output: "{\"Unnormalized Unicode\":\"A\u030a\"}" },
  { name: "values",
    input: "{\n  \"numbers\": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],\n  \"string\": \"\\u20ac$\\u000F\\u000aA'\\u0042\\u0022\\u005c\\\\\\\"\\/\",\n  \"literals\": [null, true, false]\n}",
    output: "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"\u20ac$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}" },
  { name: "weird",
    input: "{\n  \"\\u20ac\": \"Euro Sign\",\n  \"\\r\": \"Carriage Return\",\n  \"\\u000a\": \"Newline\",\n  \"1\": \"One\",\n  \"\\u0080\": \"Control\\u007f\",\n  \"\\ud83d\\ude02\": \"Smiley\",\n  \"\\u00f6\": \"Latin Small Letter O With Diaeresis\",\n  \"\\ufb33\": \"Hebrew Letter Dalet With Dagesh\",\n  \"</script>\": \"Browser Challenge\"\n}\n",
    output: "{\"\\n\":\"Newline\",\"\\r\":\"Carriage Return\",\"1\":\"One\",\"</script>\":\"Browser Challenge\",\"\u0080\":\"Control\u007f\",\"\u00f6\":\"Latin Small Letter O With Diaeresis\",\"\u20ac\":\"Euro Sign\",\"\ud83d\ude02\":\"Smiley\",\"\ufb33\":\"Hebrew Letter Dalet With Dagesh\"}" },
];

// Values with no JSON text representation. A conforming implementation in
// another language builds the closest equivalent its JSON model allows; the
// expectation (accept with output, or reject) is normative.
const JCS_CONSTRUCTS = {
  'negative-zero': () => -0,
  'null-prototype-object': () => Object.assign(Object.create(null), { b: 1, a: [true] }),
  'NaN': () => NaN,
  'Infinity': () => Infinity,
  '-Infinity': () => -Infinity,
  'undefined': () => undefined,
  'object-with-undefined-value': () => ({ a: undefined }),
  'array-with-undefined': () => [1, undefined],
  'sparse-array': () => {
    const a = [1];
    a[2] = 3;
    return a;
  },
  'bigint': () => 1n,
  'function': () => () => 0,
  'symbol': () => Symbol('s'),
  'symbol-key': () => ({ [Symbol('k')]: 1 }),
  'date': () => new Date(0),
  'map': () => new Map([['a', 1]]),
  'set': () => new Set([1]),
  'class-instance': () => new (class Point { constructor() { this.x = 1; } })(),
  'boxed-string': () => new String('a'),
  'cyclic-object': () => {
    const o = {};
    o.self = o;
    return o;
  },
  'lone-surrogate-value': () => ({ a: '\ud800' }),
  'lone-surrogate-key': () => ({ ['\udc00']: 1 }),
};

function f64FromHex(h) {
  const b = Buffer.from(h, 'hex');
  return b.readDoubleBE(0);
}

function jcsRun(c) {
  let value;
  if (c.kind === 'json') value = parseStrict(c.input_json);
  else if (c.kind === 'ieee754') value = f64FromHex(c.ieee754_hex);
  else if (c.kind === 'construct') {
    const make = JCS_CONSTRUCTS[c.construct];
    if (!make) throw new Error(`unknown construct ${c.construct}`);
    value = make();
  } else throw new Error(`unknown kind ${c.kind}`);
  return canonicalize(value);
}

function genJcs() {
  const cases = [];
  const push = (c) => {
    let out;
    let err = null;
    try {
      out = jcsRun(c);
    } catch (e) {
      err = e;
    }
    if (c.expect_error) {
      assert(err !== null, `${c.id} must be rejected`);
    } else {
      assert(err === null, `${c.id} threw ${err?.message}`);
      if (c.expected !== undefined) assert(out === c.expected, `${c.id}: got ${out}, expected ${c.expected}`);
      c.expected = out;
      c.expected_utf8_hex = Buffer.from(out, 'utf8').toString('hex');
    }
    cases.push(c);
  };

  // RFC 8785 section 3.2.2 / 3.2.4
  const values = CYBERPHONE.find((x) => x.name === 'values');
  push({ id: 'rfc8785-3.2.2-sample', source: 'RFC 8785 sections 3.2.2 and 3.2.4', kind: 'json', input_json: values.input });
  assert(cases.at(-1).expected_utf8_hex === hexBytes(RFC8785_324_HEX).toString('hex'), 'RFC 8785 section 3.2.4 bytes');
  // RFC 8785 section 3.2.3 sorting
  push({ id: 'rfc8785-3.2.3-sorting', source: 'RFC 8785 section 3.2.3', kind: 'json', input_json: RFC8785_SORT_INPUT });
  {
    // Object.values() would reorder the integer-like key "1"; check the order in the text itself.
    const text = cases.at(-1).expected;
    const pos = RFC8785_SORT_ORDER.map((v) => text.indexOf(`:${JSON.stringify(v)}`));
    assert(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), 'RFC 8785 section 3.2.3 order');
  }
  // RFC 8785 Appendix B
  for (const [hex, json, comment] of RFC8785_APPENDIX_B) {
    const c = { id: `rfc8785-appendix-b-${hex}`, source: `RFC 8785 Appendix B${comment ? ` (${comment})` : ''}`, kind: 'ieee754', ieee754_hex: hex };
    if (json === null) c.expect_error = true;
    else c.expected = json;
    push(c);
  }
  // cyberphone/json-canonicalization testdata
  for (const t of CYBERPHONE) {
    push({ id: `cyberphone-${t.name}`, source: `github.com/cyberphone/json-canonicalization testdata/{input,output}/${t.name}.json @ 32a48195b9b20fe67b1795e39e4509f14d860b45`, kind: 'json', input_json: t.input, expected: t.output });
  }
  // Profile edge cases (valid)
  const edge = [
    ['empty-object', '{}', '{}'],
    ['empty-array', '[]', '[]'],
    ['nested-sort', '{"b":{"z":1,"y":[{"d":0,"c":0}]},"a":null}', '{"a":null,"b":{"y":[{"c":0,"d":0}],"z":1}}'],
    ['minus-zero-text', '-0', '0'],
    ['integer-above-2^53', '9007199254740993', '9007199254740992'],
    ['exponent-normalised', '[1E2, 1e-7, 0.1e1, 100e-2]', '[100,1e-7,1,1]'],
    ['control-escapes', String.raw`"\u0000\u0008\u0009\u000a\u000c\u000d\u001f"`, String.raw`"\u0000\b\t\n\f\r\u001f"`],
    ['no-escape-del-and-separators', String.raw`"\u007f\u2028\u2029"`, '"\u007f\u2028\u2029"'],
    ['solidus-unescaped', String.raw`"a\/b"`, '"a/b"'],
    ['utf16-order-not-codepoint-order', String.raw`{"\ud83d\ude00":2,"\uffff":1}`, '{"\ud83d\ude00":2,"\uffff":1}'],
    ['proto-key-is-data', '{"__proto__":{"x":1},"a":2}', '{"__proto__":{"x":1},"a":2}'],
  ];
  for (const [id, input, expected] of edge) push({ id: `profile-${id}`, source: 'profile', kind: 'json', input_json: input, expected });
  // Profile edge cases (must be rejected while parsing or canonicalizing)
  const bad = [
    ['duplicate-key', '{"a":1,"a":2}'],
    ['lone-high-surrogate', String.raw`"\ud800"`],
    ['lone-low-surrogate-key', String.raw`{"\udc00":1}`],
    ['number-overflow', '1e400'],
    ['nan-literal', 'NaN'],
    ['trailing-comma', '[1,]'],
  ];
  for (const [id, input] of bad) push({ id: `profile-reject-${id}`, source: 'profile (RFC 8785 sections 3.1, 3.2.2.2, 3.2.2.3; RFC 7493)', kind: 'json', input_json: input, expect_error: true });
  // Constructs
  push({ id: 'construct-negative-zero', source: 'profile', kind: 'construct', construct: 'negative-zero', expected: '0' });
  push({ id: 'construct-null-prototype-object', source: 'profile', kind: 'construct', construct: 'null-prototype-object', expected: '{"a":[true],"b":1}' });
  for (const name of Object.keys(JCS_CONSTRUCTS).filter((n) => !['negative-zero', 'null-prototype-object'].includes(n))) {
    push({ id: `construct-reject-${name}`, source: 'profile (RFC 8785 sections 3.2.2.2, 3.2.2.3)', kind: 'construct', construct: name, expect_error: true });
  }

  return {
    ...header('RFC 8785 JSON Canonicalization Scheme', [
      'https://www.rfc-editor.org/rfc/rfc8785 (sections 3.2.2-3.2.4, Appendix B)',
      'https://github.com/cyberphone/json-canonicalization/tree/32a48195b9b20fe67b1795e39e4509f14d860b45/testdata (Apache-2.0)',
    ]),
    notes: [
      'kind json: parse input_json (rejecting duplicate names, lone surrogates and numbers outside IEEE 754 double range), then canonicalize.',
      'kind ieee754: the input is the IEEE 754 double with the given big-endian hex bits.',
      'kind construct: an in-memory value with no JSON text form, built by the test runner (see JCS_CONSTRUCTS in scripts/conformance.mjs).',
      'expected is the canonical text; expected_utf8_hex its UTF-8 bytes. expect_error: true means the input MUST be rejected.',
    ],
    cases,
  };
}

function checkJcs(file) {
  const failures = [];
  for (const c of file.cases) {
    let out;
    let err = null;
    try {
      out = jcsRun(c);
    } catch (e) {
      err = e;
    }
    if (c.expect_error) {
      if (err === null) failures.push(`${c.id}: expected rejection, got ${out}`);
    } else if (err) failures.push(`${c.id}: ${err.message}`);
    else if (out !== c.expected || Buffer.from(out, 'utf8').toString('hex') !== c.expected_utf8_hex) failures.push(`${c.id}: got ${out}`);
  }
  return { count: file.cases.length, failures };
}

// ---------------------------------------------------------------------------
// Vectors: audit-chain.json (audit chain, Merkle tree, signed checkpoint)
// ---------------------------------------------------------------------------

const TEST_LOG_NAME = 'example.com/agent-harness-test-log';
const TEST_SEED = createHash('sha256').update('agent-harness 0.2 TEST ONLY audit log signing seed').digest();
const OTHER_TEST_SEED = createHash('sha256').update('agent-harness 0.2 TEST ONLY unrelated signing seed').digest();
const TEST_HMAC_INPUT = 'agent-harness 0.2 TEST ONLY HMAC material for record apr-0001';
const TEST_HMAC_KEY = createHash('sha256').update(TEST_HMAC_INPUT, 'utf8').digest();
const TEST_HMAC_MESSAGE = 'Checked the price against the list.';

// transparency-dev/merkle testonly/constants.go @ c39fbf350a405f68571bf4c42a6a518eb0a46a4b (Apache-2.0)
const MERKLE_KAT_LEAVES = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'];
const MERKLE_KAT_ROOTS = [
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

// c2sp.org/signed-note@v1.1.0, section "Verifier keys", Example.
const C2SP_NOTE_VKEY = 'example.com/foo+530d903a+AekyeRrm56hApGFkyQR4ZCbV54Id2LKaANYcrnKv3U2k';
const C2SP_NOTE = 'This is an example message.\n\n\u2014 example.com/foo Uw2QOkn8srV1yJGh2VYRlL1Tnagv1YEq6TfXppzi2ONncAlTgK7Ztg1ERYNZXsYjOBH3mFXmRKuwHjG1Yu72IneyaQM=\n';

function auditInputs() {
  const args = {
    enquiry_id: 'enq-0001',
    subject: 'Re: Price of the annual service plan',
    body: 'Thank you for your enquiry. The annual service plan costs 120.00 USD per year (price list effective 2026-10-01). Kind regards, Example Co. Reception',
  };
  const digest = fingerprint(args);
  const key = 'task-0001:mail_send:1';
  const reasonHmac = createHmac('sha256', TEST_HMAC_KEY).update(TEST_HMAC_MESSAGE, 'utf8').digest('hex');
  const tp = (span) => `00-4bf92f3577b34da6a3ce929d0e0e4736-${span}-01`;
  return {
    arguments: args,
    events: [
      { id: 'evt-0001', type: 'com.orbanplatform.harness.run.started', time: '2026-10-23T01:00:00Z', recordedtime: '2026-10-23T01:00:00.120Z', traceparent: tp('00f067aa0ba902b7'), subject: 'task-0001',
        data: { run_id: 'run-0001', task_id: 'task-0001', agent_id: 'reception', trigger: 'event' } },
      { id: 'evt-0002', type: 'com.orbanplatform.harness.approval.requested', time: '2026-10-23T01:00:05Z', recordedtime: '2026-10-23T01:00:05.080Z', traceparent: tp('53995c3f42cd8ad8'), subject: 'task-0001',
        data: { approval_request_id: 'apr-0001', run_id: 'run-0001', task_id: 'task-0001', tool: 'mail_send', arguments_digest: digest, idempotency_key: key, routing_path: 'named', expires_at: '2026-10-30T01:00:05Z' } },
      { id: 'evt-0003', type: 'com.orbanplatform.harness.approval.decided', time: '2026-10-23T01:12:40Z', recordedtime: '2026-10-23T01:12:40.310Z', traceparent: tp('a2fb4a1d1a96d312'), subject: 'task-0001',
        data: { approval_request_id: 'apr-0001', decision: 'approve', decided_by: 'principal:p-0002', enforced_identity: digest, channel: 'console', decided_by_dispatcher: false,
          reason_hmac: reasonHmac, reason_ref: 'vault:example.com/records/apr-0001/reason' } },
      { id: 'evt-0004', type: 'com.orbanplatform.harness.action.executed', time: '2026-10-23T01:12:41Z', recordedtime: '2026-10-23T01:12:41.500Z', traceparent: tp('0e1f2a3b4c5d6e7f'), subject: 'task-0001',
        data: { tool: 'mail_send', idempotency_key: key, arguments_digest: digest, approval_request_id: 'apr-0001', result_digest: sha256Jcs({ message_id: 'msg-0001' }) } },
      { id: 'evt-0005', type: 'com.orbanplatform.harness.action.replayed', time: '2026-10-23T01:12:59Z', recordedtime: '2026-10-23T01:12:59.010Z', traceparent: tp('1a2b3c4d5e6f7a8b'), subject: 'task-0001',
        data: { tool: 'mail_send', idempotency_key: key, arguments_digest: digest, replayed_event_id: 'evt-0004' } },
      { id: 'evt-0006', type: 'com.orbanplatform.harness.run.completed', time: '2026-10-23T01:13:02Z', recordedtime: '2026-10-23T01:13:02.200Z', traceparent: tp('00f067aa0ba902b7'), subject: 'task-0001',
        data: { run_id: 'run-0001', task_id: 'task-0001', outcome: 'succeeded' } },
      { id: 'evt-0007', type: 'com.orbanplatform.harness.record.redacted', time: '2026-11-20T09:00:00Z', recordedtime: '2026-11-20T09:00:00.050Z', traceparent: tp('9f8e7d6c5b4a3928'), subject: 'task-0001',
        data: { target_event_id: 'evt-0003', target_field: 'data.reason_hmac', destroyed_key_ref: 'vault:example.com/keys/apr-0001', basis: 'erasure_request' } },
    ],
  };
}

function chainCase(id, description, events) {
  const r = verifyChain(events);
  return {
    id,
    description,
    events,
    expect: { valid: r.ok, first_error_index: r.errors.length ? r.errors[0].index : null, errors: r.errors.map(({ index, code }) => ({ index, code })) },
  };
}

function noteErrorCode(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e.code ?? e.message;
  }
}

async function genAudit() {
  const source = 'urn:orban-harness:unit:example';
  const { arguments: args, events: fields } = auditInputs();
  const { events, hashes, head } = buildChain(source, fields);
  for (const e of events) {
    const errs = await schemaErrors('audit-event.schema.json', e);
    assert(errs.length === 0, `audit event ${e.id} fails audit-event.schema.json: ${errs.join('; ')}`);
  }
  const roots = [];
  for (let n = 0; n <= events.length; n++) roots.push({ tree_size: n, root_hex: auditMerkleRoot(events.slice(0, n)).toString('hex') });

  // Merkle known answer (external)
  const katRoots = MERKLE_KAT_LEAVES.map((_, i) => merkleTreeHash(MERKLE_KAT_LEAVES.slice(0, i).map((h) => Buffer.from(h, 'hex'))).toString('hex'));
  katRoots.push(merkleTreeHash(MERKLE_KAT_LEAVES.map((h) => Buffer.from(h, 'hex'))).toString('hex'));
  assert(isDeepStrictEqual(katRoots, MERKLE_KAT_ROOTS), 'Merkle roots differ from transparency-dev/merkle known answers');

  // Signed-note known answer (external)
  const kat = verifyNote(C2SP_NOTE, [parseVkey(C2SP_NOTE_VKEY)]);
  assert(kat.text === 'This is an example message.\n', 'C2SP signed-note example does not verify');

  // Checkpoint
  const kp = keyPairFromSeed(TEST_SEED);
  const vkey = encodeVkey(TEST_LOG_NAME, kp.publicKey);
  const signer = { name: TEST_LOG_NAME, privateKey: kp.privateKey, publicKey: kp.publicKey };
  const root = auditMerkleRoot(events);
  const note = signCheckpoint({ origin: TEST_LOG_NAME, size: events.length, rootHash: root }, [signer]);
  const text = note.slice(0, note.lastIndexOf('\n\n') + 1);
  const vk = parseVkey(vkey);
  const cp = verifyCheckpoint(note, [vk], { origin: TEST_LOG_NAME });
  assert(cp.size === BigInt(events.length) && cp.rootHash.equals(root), 'checkpoint round trip');

  // Negative checkpoints
  const other = keyPairFromSeed(OTHER_TEST_SEED);
  const otherVkey = encodeVkey('example.org/unrelated-test-log', other.publicKey);
  const sameNameOtherKey = encodeVkey(TEST_LOG_NAME, other.publicKey);
  const sigB64 = note.slice(note.lastIndexOf(' ') + 1, -1);
  const lastData = sigB64.at(-2); // last base64 data character before "="
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const nonCanon = alphabet[alphabet.indexOf(lastData) ^ 1];
  const leadingZero = signNote(`${TEST_LOG_NAME}\n0${events.length}\n${b64encode(root)}\n`, [signer]);
  const negatives = [
    { id: 'tampered-tree-size', description: 'tree size line changed after signing', note: note.replace(`\n${events.length}\n`, `\n${events.length + 1}\n`), vkeys: [vkey] },
    { id: 'tampered-root', description: 'root hash line replaced after signing', note: note.replace(b64encode(root), b64encode(Buffer.alloc(32))), vkeys: [vkey] },
    { id: 'unknown-key-only', description: 'verifier only knows an unrelated key', note, vkeys: [otherVkey] },
    { id: 'same-name-other-key', description: 'verifier knows a different key under the same name (key IDs differ, so the signature is from an unknown key)', note, vkeys: [sameNameOtherKey] },
    { id: 'hyphen-instead-of-em-dash', description: 'signature line starts with U+002D instead of U+2014', note: note.replace('\u2014 ', '- '), vkeys: [vkey] },
    { id: 'missing-blank-line', description: 'no empty line between text and signatures', note: note.replace('\n\n', '\n'), vkeys: [vkey] },
    { id: 'non-canonical-base64', description: 'signature base64 has non-zero padding bits', note: note.replace(sigB64, sigB64.slice(0, -2) + nonCanon + '='), vkeys: [vkey] },
    { id: 'origin-mismatch', description: 'valid signature, but the verifier expects another log origin', note, vkeys: [vkey], expect_origin: 'example.com/another-log' },
    { id: 'tree-size-leading-zero', description: 'validly signed, but the tree size has a leading zero', note: leadingZero, vkeys: [vkey] },
  ].map((n) => {
    const code = noteErrorCode(() => verifyCheckpoint(n.note, n.vkeys.map(parseVkey), n.expect_origin ? { origin: n.expect_origin } : {}));
    assert(code !== null, `negative checkpoint ${n.id} verified`);
    return { ...n, expect: { valid: false, error: code } };
  });

  // Negative chains
  const clone = () => structuredClone(events);
  const tampered = clone();
  tampered[3].data.tool = 'mail_delete';
  const removed = clone();
  removed.splice(2, 1);
  const reordered = clone();
  [reordered[4], reordered[5]] = [reordered[5], reordered[4]];
  const badGenesis = clone();
  badGenesis[0].orbanprevhash = 'f'.repeat(64);
  const wrongAlg = clone();
  wrongAlg[0].orbanalg = 'sha256-jcs-v2';
  const mixedSource = clone();
  mixedSource[6].source = 'urn:orban-harness:unit:other';
  const chainNegatives = [
    chainCase('tampered-data', 'data of event index 3 changed after the fact', tampered),
    chainCase('removed-event', 'event index 2 deleted', removed),
    chainCase('reordered-events', 'events index 4 and 5 swapped', reordered),
    chainCase('bad-genesis', 'first event does not link to the genesis hash', badGenesis),
    chainCase('wrong-alg', 'orbanalg of event index 0 is not sha256-jcs-v1', wrongAlg),
    chainCase('mixed-source', 'event index 6 has a different source', mixedSource),
  ];
  for (const c of chainNegatives) assert(c.expect.valid === false, `chain negative ${c.id} verified`);

  return {
    ...header('Audit chain, RFC 9162 Merkle tree hash and C2SP signed checkpoint', [
      'https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md',
      'https://www.rfc-editor.org/rfc/rfc8785',
      'https://www.rfc-editor.org/rfc/rfc9162#section-2.1.1',
      'https://c2sp.org/signed-note@v1.1.0',
      'https://c2sp.org/tlog-checkpoint@v1.1.0',
      'https://github.com/transparency-dev/merkle/blob/c39fbf350a405f68571bf4c42a6a518eb0a46a4b/testonly/constants.go (Apache-2.0)',
    ]),
    test_key: {
      label: 'TEST ONLY. Published seed; anyone can sign with it. Never trust this key outside test vectors.',
      algorithm: 'Ed25519 (RFC 8032), C2SP signed-note signature type 0x01',
      seed_hex: TEST_SEED.toString('hex'),
      seed_derivation: 'SHA-256("agent-harness 0.2 TEST ONLY audit log signing seed")',
      key_name: TEST_LOG_NAME,
      public_key_hex: kp.publicKey.toString('hex'),
      key_id_hex: vk.keyId.toString('hex'),
      vkey,
    },
    hmac_test_material: {
      label: 'TEST ONLY. Per-record HMAC-SHA-256 used for data.reason_hmac in evt-0003. Real per-record HMAC material is kept off-chain and destroyed on erasure; it is derived here only so the vector is reproducible.',
      derivation: 'HMAC-SHA-256 with K = SHA-256(UTF-8 bytes of input_utf8) over UTF-8 bytes of message',
      input_utf8: TEST_HMAC_INPUT,
      message: TEST_HMAC_MESSAGE,
      hmac_sha256_hex: createHmac('sha256', TEST_HMAC_KEY).update(TEST_HMAC_MESSAGE, 'utf8').digest('hex'),
    },
    chain: {
      source,
      genesis_prevhash: '0'.repeat(64),
      notes: [
        'event hash = lowercase hex SHA-256(JCS(event)) over the whole event, including orbanprevhash.',
        'sequence starts at 00000000000000000001 and increases by one per event of the source.',
        'arguments_digest = lowercase hex SHA-256(JCS(arguments)).',
      ],
      arguments: args,
      arguments_digest: fingerprint(args),
      inputs: fields,
      events,
      event_hashes: hashes,
      head_hash: head,
    },
    merkle: {
      notes: ['Leaves are JCS(event_i) in sequence order; leaf hash SHA-256(0x00 || leaf), node hash SHA-256(0x01 || left || right).'],
      roots,
      known_answer: {
        source: 'transparency-dev/merkle testonly/constants.go (RFC 6962 hashing, identical to RFC 9162 section 2.1.1)',
        leaves_hex: MERKLE_KAT_LEAVES,
        roots_hex: MERKLE_KAT_ROOTS,
      },
    },
    checkpoint: {
      origin: TEST_LOG_NAME,
      tree_size: events.length,
      root_hex: root.toString('hex'),
      root_base64: b64encode(root),
      text,
      signed_note: note,
      vkey,
    },
    signed_note_known_answer: {
      source: 'c2sp.org/signed-note@v1.1.0, Verifier keys, Example',
      vkey: C2SP_NOTE_VKEY,
      note: C2SP_NOTE,
      expect_text: 'This is an example message.\n',
    },
    chain_negative: chainNegatives,
    checkpoint_negative: negatives,
  };
}

async function checkAudit(file) {
  const failures = [];
  let count = 0;
  const fail = (m) => failures.push(m);
  // chain
  const { chain } = file;
  const built = buildChain(chain.source, chain.inputs);
  count++;
  if (!isDeepStrictEqual(built.events, chain.events)) fail('chain: events rebuilt from inputs differ');
  if (!isDeepStrictEqual(built.hashes, chain.event_hashes)) fail('chain: event hashes differ');
  if (built.head !== chain.head_hash) fail('chain: head hash differs');
  if (fingerprint(chain.arguments) !== chain.arguments_digest) fail('chain: arguments_digest differs');
  const v = verifyChain(chain.events);
  if (!v.ok) fail(`chain: verifyChain rejected the valid chain: ${JSON.stringify(v.errors)}`);
  for (const e of chain.events) {
    const errs = await schemaErrors('audit-event.schema.json', e);
    if (errs.length) fail(`chain: ${e.id} fails audit-event.schema.json: ${errs.join('; ')}`);
  }
  count++;
  const hm = file.hmac_test_material;
  const hmac = createHmac('sha256', createHash('sha256').update(hm.input_utf8, 'utf8').digest()).update(hm.message, 'utf8').digest('hex');
  if (hmac !== hm.hmac_sha256_hex) fail('hmac_test_material: HMAC differs');
  if (chain.events[2].data.reason_hmac !== hmac) fail('chain: evt-0003 data.reason_hmac is not the published test HMAC');
  // merkle
  for (const r of file.merkle.roots) {
    count++;
    const got = auditMerkleRoot(chain.events.slice(0, r.tree_size)).toString('hex');
    if (got !== r.root_hex) fail(`merkle: tree size ${r.tree_size} root ${got} != ${r.root_hex}`);
  }
  const kat = file.merkle.known_answer;
  kat.roots_hex.forEach((want, n) => {
    count++;
    const got = merkleTreeHash(kat.leaves_hex.slice(0, n).map((h) => Buffer.from(h, 'hex'))).toString('hex');
    if (got !== want) fail(`merkle known answer: size ${n} root ${got} != ${want}`);
  });
  // checkpoint
  count++;
  const cp = file.checkpoint;
  const kp = keyPairFromSeed(Buffer.from(file.test_key.seed_hex, 'hex'));
  if (kp.publicKey.toString('hex') !== file.test_key.public_key_hex) fail('checkpoint: public key does not match seed');
  if (encodeVkey(file.test_key.key_name, kp.publicKey) !== file.test_key.vkey) fail('checkpoint: vkey does not match');
  const resigned = signCheckpoint({ origin: cp.origin, size: cp.tree_size, rootHash: Buffer.from(cp.root_hex, 'hex') }, [{ name: file.test_key.key_name, privateKey: kp.privateKey, publicKey: kp.publicKey }]);
  if (resigned !== cp.signed_note) fail('checkpoint: re-signing (Ed25519 is deterministic) gives a different note');
  try {
    const got = verifyCheckpoint(cp.signed_note, [parseVkey(cp.vkey)], { origin: cp.origin });
    if (got.size !== BigInt(cp.tree_size) || got.rootHash.toString('hex') !== cp.root_hex) fail('checkpoint: parsed fields differ');
    if (cp.root_hex !== auditMerkleRoot(chain.events).toString('hex')) fail('checkpoint: root is not the Merkle root of the chain');
  } catch (e) {
    fail(`checkpoint: valid checkpoint rejected: ${e.message}`);
  }
  // signed-note known answer
  count++;
  try {
    const r = verifyNote(file.signed_note_known_answer.note, [parseVkey(file.signed_note_known_answer.vkey)]);
    if (r.text !== file.signed_note_known_answer.expect_text) fail('signed-note known answer: text differs');
  } catch (e) {
    fail(`signed-note known answer rejected: ${e.message}`);
  }
  // negatives
  for (const c of file.chain_negative) {
    count++;
    const r = verifyChain(c.events);
    const got = { valid: r.ok, first_error_index: r.errors.length ? r.errors[0].index : null, errors: r.errors.map(({ index, code }) => ({ index, code })) };
    if (!isDeepStrictEqual(got, c.expect)) fail(`chain_negative ${c.id}: got ${JSON.stringify(got)}`);
  }
  for (const c of file.checkpoint_negative) {
    count++;
    const code = noteErrorCode(() => verifyCheckpoint(c.note, c.vkeys.map(parseVkey), c.expect_origin ? { origin: c.expect_origin } : {}));
    if (code !== c.expect.error) fail(`checkpoint_negative ${c.id}: got ${code}`);
  }
  return { count, failures };
}

// ---------------------------------------------------------------------------
// Vectors: idempotency.json
// ---------------------------------------------------------------------------

function genIdempotency() {
  const argsA = { enquiry_id: 'enq-0001', subject: 'Re: Opening hours', body: 'We are open Monday to Friday, 09:00 to 17:00.' };
  const argsB = { ...argsA, body: 'We are open Monday to Saturday, 09:00 to 17:00.' };
  const fpA = fingerprint(argsA);
  const fpB = fingerprint(argsB);
  const KEY = 'task-0001:mail_send:1';
  const base = {
    idempotency_key: KEY,
    scope: { tenant: 'tenant-example', principal: 'reception', operation: 'mail_send' },
    fingerprint: fpA,
    task_id: 'task-0001',
    run_id: 'run-0001',
    approval_request_id: 'apr-0001',
    created_at: '2026-10-23T01:00:05Z',
    updated_at: '2026-10-23T01:12:41Z',
    retain_until: '2026-10-24T01:12:41Z',
  };
  const responses = {
    executed: { status: 200, body: { message_id: 'msg-0001', sent_at: '2026-10-23T01:12:41Z' } },
    denied: { type: 'about:blank', title: 'Forbidden', status: 403, detail: 'The approval request was denied.' },
    expired: { type: 'about:blank', title: 'Forbidden', status: 403, detail: 'The approval request expired without a decision.' },
    failed: { type: 'about:blank', title: 'Bad Gateway', status: 502, detail: 'The mail service rejected the message.' },
  };
  const entry = (state, extra = {}) => ({ ...base, state, response: responses[state] ?? null, ...extra });
  const inc = (over = {}) => ({ key: KEY, fingerprint: fpA, task_id: 'task-0001', kind: 'write', ...over });
  const cases = [
    ['write-without-key', 'a write without an idempotency key is rejected', null, inc({ key: null }), { outcome: 'missing_key', status: 400 }],
    ['write-empty-key', 'an empty key counts as missing', null, inc({ key: '' }), { outcome: 'missing_key', status: 400 }],
    ['read-without-key', 'reads without a key bypass the ledger', null, inc({ key: null, kind: 'read' }), { outcome: 'bypass', status: null }],
    ['write-new-key', 'first use of a key creates an intent entry', null, inc(), { outcome: 'new', status: null }],
    ['read-new-key', 'a read that carries a key is ledgered like a write', null, inc({ kind: 'read' }), { outcome: 'new', status: null }],
    ['in-flight-intent', 'same key and payload while the original is recorded but not finished', entry('intent', { approval_request_id: null }), inc(), { outcome: 'in_flight', status: 409 }],
    ['in-flight-approved', 'same key and payload while the approved original has not finished executing', entry('approved'), inc(), { outcome: 'in_flight', status: 409 }],
    ['replay-executed', 'a completed write replays its stored response and is not executed again', entry('executed'), inc(), { outcome: 'replay', status: null, response: responses.executed }],
    ['replay-denied', 'a denied write replays the stored problem details', entry('denied'), inc(), { outcome: 'replay', status: null, response: responses.denied }],
    ['replay-expired', 'an expired write replays the stored problem details', entry('expired'), inc(), { outcome: 'replay', status: null, response: responses.expired }],
    ['replay-failed', 'a failed write replays the stored problem details', entry('failed'), inc(), { outcome: 'replay', status: null, response: responses.failed }],
    ['fingerprint-mismatch-terminal', 'same key, different arguments, original executed', entry('executed'), inc({ fingerprint: fpB }), { outcome: 'fingerprint_mismatch', status: 422 }],
    ['fingerprint-mismatch-in-flight', 'same key, different arguments, original in flight (fingerprint is checked before in-flight)', entry('intent', { approval_request_id: null }), inc({ fingerprint: fpB }), { outcome: 'fingerprint_mismatch', status: 422 }],
    ['task-mismatch', 'same key and arguments from a different task', entry('executed'), inc({ task_id: 'task-0002' }), { outcome: 'task_mismatch', status: 409 }],
    ['task-mismatch-before-fingerprint', 'different task and different arguments: task binding is checked first', entry('executed'), inc({ task_id: 'task-0002', fingerprint: fpB }), { outcome: 'task_mismatch', status: 409 }],
  ].map(([id, description, existing, incoming, expect]) => {
    const got = decide(existing, incoming);
    assert(isDeepStrictEqual(got, expect), `idempotency ${id}: got ${JSON.stringify(got)}`);
    return { id, description, existing, incoming, expect };
  });
  return {
    ...header('Exactly-once write ledger decision function', [
      'https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08',
      'https://www.rfc-editor.org/rfc/rfc8785',
      'https://www.rfc-editor.org/rfc/rfc9457',
    ]),
    notes: [
      'fingerprint = lowercase hex SHA-256(JCS(arguments)).',
      'existing is the ledger entry found for (scope, key), or null. Every non-null existing validates against ledger-entry.schema.json.',
      'Evaluation order: missing key (400 for writes, bypass for reads); no entry (new); task mismatch (409); fingerprint mismatch (422); in flight (409); terminal (replay the stored response).',
    ],
    fingerprints: [
      { id: 'arguments-a', arguments: argsA, fingerprint: fpA },
      { id: 'arguments-b', arguments: argsB, fingerprint: fpB },
      { id: 'key-order-irrelevant', arguments: { subject: argsA.subject, body: argsA.body, enquiry_id: argsA.enquiry_id }, fingerprint: fpA },
      { id: 'empty-arguments', arguments: {}, fingerprint: fingerprint({}) },
    ],
    cases,
  };
}

async function checkIdempotency(file) {
  const failures = [];
  let count = 0;
  for (const f of file.fingerprints) {
    count++;
    if (fingerprint(f.arguments) !== f.fingerprint) failures.push(`fingerprint ${f.id}: got ${fingerprint(f.arguments)}`);
  }
  for (const c of file.cases) {
    count++;
    const got = decide(c.existing, c.incoming);
    if (!isDeepStrictEqual(got, c.expect)) failures.push(`${c.id}: got ${JSON.stringify(got)}`);
    if (c.existing) {
      const errs = await schemaErrors('ledger-entry.schema.json', c.existing);
      if (errs.length) failures.push(`${c.id}: existing fails ledger-entry.schema.json: ${errs.join('; ')}`);
    }
  }
  return { count, failures };
}

// ---------------------------------------------------------------------------
// Vectors: classification.json
// ---------------------------------------------------------------------------

function genClassification() {
  const t = (name, kind, approval, classification) => ({ name, kind, approval, ...(classification ? { classification } : {}) });
  const cases = [
    ['operator-write', 'operator marks write', t('mail_send', 'write', 'always', { source: 'operator' }), { effective_kind: 'write', operator_classified: true, suggestion: null }],
    ['operator-read', 'operator marks read', t('kb_search', 'read', 'never', { source: 'operator' }), { effective_kind: 'read', operator_classified: true, suggestion: null }],
    ['operator-read-wins-over-annotations', 'operator read wins even though annotations say not read-only', t('report_render', 'read', 'never', { source: 'operator', mcp_annotations: { readOnlyHint: false } }), { effective_kind: 'read', operator_classified: true, suggestion: { kind: 'write', approval: 'always' } }],
    ['operator-write-wins-over-annotations', 'operator write wins even though annotations claim read-only', t('crm_update', 'write', 'always', { source: 'operator', mcp_annotations: { readOnlyHint: true } }), { effective_kind: 'write', operator_classified: true, suggestion: { kind: 'read', approval: 'never' } }],
    ['annotations-read-only-not-trusted', 'kind pre-filled from readOnlyHint: true is only a suggestion; effective kind is write', t('files_list', 'read', 'always', { source: 'mcp_annotations', mcp_annotations: { readOnlyHint: true, openWorldHint: false } }), { effective_kind: 'write', operator_classified: false, suggestion: { kind: 'read', approval: 'never' } }],
    ['annotations-write', 'annotations say additive write', t('calendar_book', 'write', 'always', { source: 'mcp_annotations', mcp_annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } }), { effective_kind: 'write', operator_classified: false, suggestion: { kind: 'write', approval: 'always' } }],
    ['annotations-empty-defaults', 'empty annotations: readOnlyHint defaults to false, so the suggestion is write', t('webhook_call', 'write', 'always', { source: 'mcp_annotations', mcp_annotations: {} }), { effective_kind: 'write', operator_classified: false, suggestion: { kind: 'write', approval: 'always' } }],
    ['unclassified-declared-read', 'declared read but unclassified: fail closed to write', t('db_query', 'read', 'always', { source: 'unclassified' }), { effective_kind: 'write', operator_classified: false, suggestion: null }],
    ['no-classification-declared-read', 'no classification object: fail closed to write', t('docs_fetch', 'read', 'always'), { effective_kind: 'write', operator_classified: false, suggestion: null }],
    ['unclassified-with-annotations', 'unclassified with a read-only hint: suggestion read, effective write', t('status_get', 'read', 'always', { source: 'unclassified', mcp_annotations: { title: 'Get status', readOnlyHint: true } }), { effective_kind: 'write', operator_classified: false, suggestion: { kind: 'read', approval: 'never' } }],
  ].map(([id, description, tool, expect]) => {
    const got = classify(tool);
    assert(isDeepStrictEqual(got, expect), `classification ${id}: got ${JSON.stringify(got)}`);
    return { id, description, tool, expect };
  });
  return {
    ...header('Tool classification (fail closed)', [
      'https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts (ToolAnnotations)',
    ]),
    notes: [
      'tool is a harness.json tools[] entry and validates against harness.schema.json#/$defs/tool.',
      'effective_kind is what a runtime enforces. Only classification.source = operator makes the declared kind take effect; otherwise the tool is write.',
      'suggestion is derived from MCP annotations alone (readOnlyHint true -> read/never, else write/always) and is null without annotations. It never changes effective_kind.',
    ],
    cases,
  };
}

async function checkClassification(file) {
  const failures = [];
  for (const c of file.cases) {
    const got = classify(c.tool);
    if (!isDeepStrictEqual(got, c.expect)) failures.push(`${c.id}: got ${JSON.stringify(got)}`);
    const errs = await schemaErrors(`${SCHEMA_BASE}harness.schema.json#/$defs/tool`, c.tool);
    if (errs.length) failures.push(`${c.id}: tool fails harness.schema.json#/$defs/tool: ${errs.join('; ')}`);
  }
  return { count: file.cases.length, failures };
}

// ---------------------------------------------------------------------------
// Vectors: approval-transitions.json (state machine, decisions, Cedar gate)
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS = ['pending>approved', 'pending>denied', 'pending>expired', 'pending>cancelled', 'approved>executed', 'approved>failed', 'approved>expired'];

const VECTOR_POLICY = [
  '// Read tools: permitted for the agent without approval.',
  'permit (',
  '  principal == OrbanHarness::Agent::"reception",',
  '  action in [OrbanHarness::Action::"kb_search"],',
  '  resource',
  ');',
  '',
  '// Write tool with approval = always: permitted only with an approval bound to these exact arguments.',
  'permit (',
  '  principal == OrbanHarness::Agent::"reception",',
  '  action == OrbanHarness::Action::"mail_send",',
  '  resource',
  ')',
  'when { context.approval.granted && context.approval.enforced_identity == context.arguments_digest };',
  '',
  '// Write tool with approval = over_limit: below the limit no approval is needed; above it, an approval bound to these exact arguments.',
  'permit (',
  '  principal == OrbanHarness::Agent::"reception",',
  '  action == OrbanHarness::Action::"refund_issue",',
  '  resource',
  ')',
  'when {',
  '  !context.limit_exceeded ||',
  '  (context.approval.granted && context.approval.enforced_identity == context.arguments_digest)',
  '};',
  '',
  '// boundaries.never (expressible part): never act outside an assigned task.',
  'forbid (principal, action, resource)',
  'when { context.task_id == "" };',
  '',
].join('\n');

async function genApproval() {
  const pairs = [];
  for (const from of APPROVAL_STATES) {
    for (const to of APPROVAL_STATES) {
      const valid = ALLOWED_TRANSITIONS.includes(`${from}>${to}`);
      assert(canTransition(from, to) === valid, `transition ${from} -> ${to}`);
      pairs.push({ from, to, valid });
    }
  }

  const digest = fingerprint({ enquiry_id: 'enq-0001', subject: 'Re: Opening hours', body: 'We are open Monday to Friday, 09:00 to 17:00.' });
  const request = {
    id: 'apr-0001',
    created_at: '2026-10-23T01:00:05Z',
    expires_at: '2026-10-30T01:00:05Z',
    requester: { agent_id: 'reception', run_id: 'run-0001', task_id: 'task-0001' },
    dispatcher: 'principal:p-0001',
    tool: { name: 'mail_send', kind: 'write' },
    arguments_digest: digest,
    idempotency_key: 'task-0001:mail_send:1',
    summary: {
      done: 'A reply to the opening-hours enquiry enq-0001 has been drafted from the published hours.',
      decide: 'Approve sending this exact reply to the sender recorded on the enquiry.',
      after: 'The reply is sent once and the enquiry is marked answered.',
    },
    routing: { path: 'list', approvers: ['principal:p-0001', 'principal:p-0002'] },
    policy_ref: 'reception-enquiry#policy1',
  };
  const ok = {
    request_id: 'apr-0001',
    decision: 'approve',
    decided_by: 'principal:p-0002',
    decided_at: '2026-10-23T01:12:40Z',
    enforced_identity: digest,
    scope: 'once',
    channel: 'console',
    decided_by_dispatcher: false,
  };
  const sodStrict = { requester_may_approve: false, dispatcher_may_approve: false, record_dispatcher_self_approval: true };
  const sodDispatcher = { ...sodStrict, dispatcher_may_approve: true };
  const ctx = (over = {}) => ({ state: 'pending', agent_principals: ['reception', 'scheduler'], separation_of_duties: sodStrict, ...over });
  const other = '0'.repeat(63) + '1';
  const decisions = [
    ['approve-valid', 'routed human approves the exact arguments', ok, ctx(), { valid: true, next_state: 'approved' }],
    ['deny-valid', 'routed human denies', { ...ok, decision: 'deny', reason: 'Wrong opening hours.' }, ctx(), { valid: true, next_state: 'denied' }],
    ['requesting-agent-decides', 'the requesting agent tries to approve its own request', { ...ok, decided_by: 'reception' }, ctx(), { valid: false, reason: 'agent_cannot_decide' }],
    ['other-agent-decides', 'another agent principal tries to approve', { ...ok, decided_by: 'scheduler' }, ctx(), { valid: false, reason: 'agent_cannot_decide' }],
    ['identity-mismatch', 'enforced_identity differs from arguments_digest (arguments changed after the request)', { ...ok, enforced_identity: other }, ctx(), { valid: false, reason: 'identity_mismatch' }],
    ['decided-at-expiry', 'decision exactly at expires_at', { ...ok, decided_at: '2026-10-30T01:00:05Z' }, ctx(), { valid: false, reason: 'expired' }],
    ['decided-after-expiry', 'decision after expires_at', { ...ok, decided_at: '2026-10-31T00:00:00Z' }, ctx(), { valid: false, reason: 'expired' }],
    ['second-decision', 'a request that is already approved accepts no further decision', { ...ok, decision: 'deny' }, ctx({ state: 'approved' }), { valid: false, reason: 'not_pending' }],
    ['wrong-request', 'decision refers to another request', { ...ok, request_id: 'apr-0002' }, ctx(), { valid: false, reason: 'request_mismatch' }],
    ['not-routed', 'a human who is not a routed approver decides', { ...ok, decided_by: 'principal:p-0099' }, ctx(), { valid: false, reason: 'not_an_approver' }],
    ['dispatcher-approves-not-allowed', 'dispatcher approves but separation_of_duties.dispatcher_may_approve is false', { ...ok, decided_by: 'principal:p-0001', decided_by_dispatcher: true }, ctx(), { valid: false, reason: 'dispatcher_may_not_approve' }],
    ['dispatcher-approves-allowed', 'dispatcher approves and dispatcher_may_approve is true; the record marks it', { ...ok, decided_by: 'principal:p-0001', decided_by_dispatcher: true }, ctx({ separation_of_duties: sodDispatcher }), { valid: true, next_state: 'approved' }],
    ['dispatcher-denies', 'dispatcher may always deny', { ...ok, decision: 'deny', decided_by: 'principal:p-0001', decided_by_dispatcher: true }, ctx(), { valid: true, next_state: 'denied' }],
    ['dispatcher-flag-missing', 'dispatcher decides but decided_by_dispatcher is false', { ...ok, decided_by: 'principal:p-0001', decided_by_dispatcher: false }, ctx({ separation_of_duties: sodDispatcher }), { valid: false, reason: 'dispatcher_flag_mismatch' }],
    ['dispatcher-flag-false-positive', 'non-dispatcher decides with decided_by_dispatcher true', { ...ok, decided_by_dispatcher: true }, ctx(), { valid: false, reason: 'dispatcher_flag_mismatch' }],
  ].map(([id, description, decision, context, expect]) => {
    const got = validateDecision(request, decision, context);
    assert(isDeepStrictEqual(got, expect), `decision ${id}: got ${JSON.stringify(got)}`);
    return { id, description, decision, context, expect };
  });
  for (const d of decisions) {
    const errs = await schemaErrors('approval-decision.schema.json', d.decision);
    assert(errs.length === 0, `decision ${d.id} fails approval-decision.schema.json: ${errs.join('; ')}`);
  }
  const reqErrs = await schemaErrors('approval-request.schema.json', request);
  assert(reqErrs.length === 0, `approval request fails approval-request.schema.json: ${reqErrs.join('; ')}`);

  // Cedar gate
  const tools = [
    { name: 'kb_search', kind: 'read', approval: 'never' },
    { name: 'mail_send', kind: 'write', approval: 'always' },
    { name: 'refund_issue', kind: 'write', approval: 'over_limit', limit: { field: 'amount', max: 100, unit: 'USD' } },
  ];
  const D = digest;
  const cedarCases = [
    ['read-tool-no-approval', 'read tool, no approval', 'reception', 'kb_search', toolContext({ granted: false, enforced_identity: '', arguments_digest: D }), 'allow'],
    ['read-tool-other-agent', 'read tool, another agent (default deny)', 'scheduler', 'kb_search', toolContext({ granted: false, enforced_identity: '', arguments_digest: D }), 'deny'],
    ['write-no-approval', 'write tool without approval', 'reception', 'mail_send', toolContext({ granted: false, enforced_identity: '', arguments_digest: D }), 'deny'],
    ['write-approved-matching', 'write tool with an approval for these exact arguments', 'reception', 'mail_send', toolContext({ granted: true, enforced_identity: D, arguments_digest: D, decision_id: 'apr-0001' }), 'allow'],
    ['write-approved-other-arguments', 'write tool, approval was for other arguments', 'reception', 'mail_send', toolContext({ granted: true, enforced_identity: other, arguments_digest: D, decision_id: 'apr-0001' }), 'deny'],
    ['write-identity-without-grant', 'matching identity but granted is false', 'reception', 'mail_send', toolContext({ granted: false, enforced_identity: D, arguments_digest: D, decision_id: 'apr-0001' }), 'deny'],
    ['write-approved-no-task', 'approved, but outside an assigned task (forbid wins)', 'reception', 'mail_send', toolContext({ granted: true, enforced_identity: D, arguments_digest: D, decision_id: 'apr-0001', task_id: '' }), 'deny'],
    ['always-tool-ignores-limit-flag', 'approval = always tool: limit_exceeded false does not remove the approval requirement', 'reception', 'mail_send', toolContext({ granted: false, enforced_identity: '', arguments_digest: D, limit_exceeded: false }), 'deny'],
    ['over-limit-tool-below-limit', 'over_limit tool below the limit, no approval', 'reception', 'refund_issue', toolContext({ granted: false, enforced_identity: '', arguments_digest: D, limit_exceeded: false }), 'allow'],
    ['over-limit-tool-above-limit-no-approval', 'over_limit tool above the limit without approval', 'reception', 'refund_issue', toolContext({ granted: false, enforced_identity: '', arguments_digest: D, limit_exceeded: true }), 'deny'],
    ['over-limit-tool-above-limit-approved', 'over_limit tool above the limit with an approval for these exact arguments', 'reception', 'refund_issue', toolContext({ granted: true, enforced_identity: D, arguments_digest: D, limit_exceeded: true, decision_id: 'apr-0002' }), 'allow'],
    ['over-limit-tool-above-limit-other-arguments', 'over_limit tool above the limit, approval was for other arguments', 'reception', 'refund_issue', toolContext({ granted: true, enforced_identity: other, arguments_digest: D, limit_exceeded: true, decision_id: 'apr-0002' }), 'deny'],
    ['over-limit-tool-other-agent', 'over_limit tool below the limit, another agent (default deny)', 'scheduler', 'refund_issue', toolContext({ granted: false, enforced_identity: '', arguments_digest: D, limit_exceeded: false }), 'deny'],
  ].map(([id, description, principal, tool, context, expect]) => ({ id, description, request: cedarRequest(principal, tool, context), expect }));
  const cedarSection = { tools, policies: VECTOR_POLICY, requests: cedarCases };
  const res = await runCedarSection(cedarSection);
  assert(res.failures.length === 0, `cedar: ${res.failures.join('; ')}`);

  return {
    ...header('Approval state machine, decision validation and Cedar approval gate', [
      'https://github.com/responsibleai/agent-control-spec/tree/098993763ea2b4c5d1fa4e712be80d73c2ec7b57 (ACS package release 0.4.0-beta.1)',
      'https://www.cedarpolicy.com/ (Cedar 4.x; evaluated with @cedar-policy/cedar-wasm 4.13.0)',
    ]),
    notes: [
      'pairs lists every (from, to) over the seven states; valid: false means the transition MUST be rejected.',
      'decision_cases: request is the approval request below; context.state is the request state when the decision arrives; context.agent_principals are agent principal ids known to the runtime. Invalid reasons are those of reference/approval.mjs; a conforming runtime MUST reach the same valid/invalid verdict.',
      'cedar: effective schema = schemas/0.2/harness.cedarschema with one action per tools[] name; policies validate in strict mode; each request is evaluated with validateRequest = true and no entities. context.limit_exceeded is computed by the runtime from tools[].limit and the call arguments (false when the tool has no limit).',
    ],
    states: APPROVAL_STATES,
    terminal_states: APPROVAL_TERMINAL,
    transitions: TRANSITIONS,
    pairs,
    request,
    decision_cases: decisions,
    cedar: cedarSection,
  };
}

async function runCedarSection(section) {
  const cedar = await getCedar();
  const failures = [];
  const schema = effectiveCedarSchema(readFileSync(join(SCHEMA_DIR, 'harness.cedarschema'), 'utf8'), section.tools.map((t) => t.name));
  const v = cedar.validate({ schema, policies: { staticPolicies: section.policies }, validationSettings: { mode: 'strict' } });
  if (v.type !== 'success' || v.validationErrors.length) failures.push(`policies do not validate: ${JSON.stringify(v.type === 'success' ? v.validationErrors : v.errors)}`);
  for (const c of section.requests) {
    const r = cedar.isAuthorized({ ...c.request, schema, validateRequest: true, policies: { staticPolicies: section.policies }, entities: [] });
    if (r.type !== 'success') failures.push(`${c.id}: ${r.errors.map(cedarErrorText).join('; ')}`);
    else if (r.response.decision !== c.expect) failures.push(`${c.id}: got ${r.response.decision}`);
  }
  return { count: section.requests.length, failures };
}

async function checkApproval(file) {
  const failures = [];
  let count = 0;
  for (const p of file.pairs) {
    count++;
    if (canTransition(p.from, p.to) !== p.valid) failures.push(`transition ${p.from} -> ${p.to}: expected ${p.valid}`);
  }
  if (file.pairs.length !== APPROVAL_STATES.length ** 2) failures.push('pairs must cover every (from, to)');
  const reqErrs = await schemaErrors('approval-request.schema.json', file.request);
  if (reqErrs.length) failures.push(`request fails approval-request.schema.json: ${reqErrs.join('; ')}`);
  for (const c of file.decision_cases) {
    count++;
    const got = validateDecision(file.request, c.decision, c.context);
    if (!isDeepStrictEqual(got, c.expect)) failures.push(`${c.id}: got ${JSON.stringify(got)}`);
    const errs = await schemaErrors('approval-decision.schema.json', c.decision);
    if (errs.length) failures.push(`${c.id}: decision fails approval-decision.schema.json: ${errs.join('; ')}`);
  }
  const ced = await runCedarSection(file.cedar);
  count += ced.count;
  failures.push(...ced.failures.map((f) => `cedar ${f}`));
  return { count, failures };
}

// ---------------------------------------------------------------------------
// Vectors: driver
// ---------------------------------------------------------------------------

const VECTORS = [
  { file: 'jcs.json', level: 'L2+L3', gen: genJcs, check: checkJcs },
  { file: 'audit-chain.json', level: 'L3', gen: genAudit, check: checkAudit },
  { file: 'idempotency.json', level: 'L3', gen: genIdempotency, check: checkIdempotency },
  { file: 'classification.json', level: 'L2', gen: genClassification, check: checkClassification },
  { file: 'approval-transitions.json', level: 'L2', gen: genApproval, check: checkApproval },
];

async function runVectors({ write }) {
  let ok = true;
  for (const v of VECTORS) {
    const path = join(VECTOR_DIR, v.file);
    let generated;
    try {
      generated = serializeVectors(await v.gen());
    } catch (e) {
      report('FAIL', `${v.file}`, `generator: ${e.message}`);
      ok = false;
      continue;
    }
    if (write) {
      writeFileSync(path, generated);
      report('INFO', v.file, 'written');
    }
    const onDisk = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (onDisk === null) {
      report('FAIL', v.file, 'missing (run: node scripts/conformance.mjs vectors --write)');
      ok = false;
      continue;
    }
    if (onDisk !== generated) {
      report('FAIL', v.file, 'differs from what the reference implementation generates (run vectors --write and review the diff)');
      ok = false;
    }
    const res = await v.check(parseStrict(onDisk));
    if (res.failures.length === 0) report('PASS', `${v.file}`, `[${v.level}] ${res.count} cases recomputed`);
    else {
      ok = false;
      for (const f of res.failures) report('FAIL', v.file, f);
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// test
// ---------------------------------------------------------------------------

function subdirs(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => join(dir, e.name))
    .sort();
}

async function runTest() {
  let ok = true;
  console.log('== Test vectors (test-vectors/0.2)');
  ok = (await runVectors({ write: false })) && ok;

  console.log('\n== Fixtures that must pass L1 (test-vectors/0.2/templates/valid-*)');
  const valid = subdirs(FIXTURE_DIR, 'valid-');
  if (valid.length === 0) {
    report('FAIL', 'fixtures', 'no valid-* fixture found');
    ok = false;
  }
  for (const d of valid) {
    const r = await runL1(d, { print: false });
    const name = posix(relative(ROOT, d));
    if (r.pass) report('PASS', name, 'passes L1');
    else {
      ok = false;
      report('FAIL', name, `failed ${[...r.failedRules].join(', ')}`);
      await runL1(d);
    }
  }

  console.log('\n== Examples (examples/*)');
  const examples = subdirs(join(ROOT, 'examples'));
  if (examples.length === 0) report('WARN', 'examples', 'no examples/* bundles yet');
  for (const d of examples) {
    const name = posix(relative(ROOT, d));
    if (!existsSync(join(d, 'template.json'))) {
      report('WARN', name, 'no template.json yet; skipped');
      continue;
    }
    const r = await runL1(d);
    ok = r.pass && ok;
    console.log('');
  }

  console.log('== Fixtures that must fail L1 (test-vectors/0.2/templates/invalid-*)');
  const invalid = subdirs(FIXTURE_DIR, 'invalid-');
  if (invalid.length === 0) {
    report('FAIL', 'fixtures', 'no invalid-* fixture found');
    ok = false;
  }
  for (const d of invalid) {
    const name = posix(relative(ROOT, d));
    const readme = existsSync(join(d, 'README.md')) ? readFileSync(join(d, 'README.md'), 'utf8') : '';
    const m = /Expected L1 failure: `([^`]+)`/.exec(readme);
    if (!m) {
      report('FAIL', name, 'README.md must contain: Expected L1 failure: `<rule id>`');
      ok = false;
      continue;
    }
    const r = await runL1(d, { print: false });
    const failed = [...r.failedRules];
    if (failed.length === 1 && failed[0] === m[1]) report('PASS', name, `fails exactly ${m[1]}`);
    else {
      ok = false;
      report('FAIL', name, `expected to fail exactly ${m[1]}, failed [${failed.join(', ')}]`);
    }
  }

  console.log(ok ? '\nALL PASS' : '\nFAILURES (see above)');
  return ok;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `usage:
  node scripts/conformance.mjs vectors [--write]
  node scripts/conformance.mjs l1 <template-dir>
  node scripts/conformance.mjs digests <template-dir> [--write]
  node scripts/conformance.mjs test`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  const write = rest.includes('--write');
  const positional = rest.filter((a) => !a.startsWith('--'));
  switch (cmd) {
    case 'vectors':
      return (await runVectors({ write })) ? 0 : 1;
    case 'l1':
      if (positional.length !== 1) break;
      return (await runL1(positional[0])).pass ? 0 : 1;
    case 'digests':
      if (positional.length !== 1) break;
      return runDigests(positional[0], { write }) ? 0 : 1;
    case 'test':
      return (await runTest()) ? 0 : 1;
    default:
      break;
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err?.stack ?? String(err));
    process.exitCode = 1;
  },
);

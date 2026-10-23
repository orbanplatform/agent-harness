// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// Tool classification (fail closed).
//
//   - If the operator classified the tool (classification.source ==
//     "operator"), the declared kind wins, whatever the MCP annotations say.
//   - Otherwise the effective kind is "write". MCP ToolAnnotations
//     (2026-07-28) are untrusted hints: they only produce a suggestion that an
//     operator may confirm. readOnlyHint defaults to false and destructiveHint
//     defaults to true when absent, as in the MCP schema.

export const KINDS = Object.freeze(['read', 'write']);

/**
 * Suggest a kind and approval mode from MCP annotations alone.
 * @param {object|undefined} ann  MCP ToolAnnotations
 * @returns {{kind: 'read'|'write', approval: 'never'|'always'}}
 */
export function suggestFromAnnotations(ann) {
  const a = ann ?? {};
  const readOnly = a.readOnlyHint === true; // default false
  if (readOnly) return { kind: 'read', approval: 'never' };
  return { kind: 'write', approval: 'always' };
}

/**
 * Effective classification of one harness.json tool entry.
 * @param {{kind?: string, classification?: {source?: string, mcp_annotations?: object}}} tool
 * @returns {{effective_kind: 'read'|'write', operator_classified: boolean, suggestion: {kind: string, approval: string} | null}}
 */
export function classify(tool) {
  const c = tool?.classification ?? {};
  const operator = c.source === 'operator' && KINDS.includes(tool?.kind);
  const suggestion = c.mcp_annotations ? suggestFromAnnotations(c.mcp_annotations) : null;
  return {
    effective_kind: operator ? tool.kind : 'write',
    operator_classified: operator,
    suggestion,
  };
}

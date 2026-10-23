// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// Approval request state machine and decision validation.
//
// Allowed transitions (everything else is invalid):
//   pending  -> approved | denied | expired | cancelled
//   approved -> executed | failed | expired
// Terminal: denied, expired, cancelled, executed, failed.
//
// Invariants enforced by validateDecision():
//   - an agent principal never decides (in particular the requesting agent);
//   - a decision is valid only if enforced_identity equals the request's
//     arguments_digest (hex SHA-256 of JCS(arguments));
//   - a decision at or after expires_at is invalid (the request is expired,
//     and expired is treated as deny);
//   - at most one decision per request (only a pending request accepts one);
//   - the decider must be one of the routed approvers;
//   - the dispatcher may approve only if separation_of_duties allows it, and
//     decided_by_dispatcher must state truthfully whether the decider is the
//     dispatcher.

export const STATES = Object.freeze(['pending', 'approved', 'denied', 'expired', 'cancelled', 'executed', 'failed']);
export const TERMINAL_STATES = Object.freeze(['denied', 'expired', 'cancelled', 'executed', 'failed']);
export const TRANSITIONS = Object.freeze({
  pending: Object.freeze(['approved', 'denied', 'expired', 'cancelled']),
  approved: Object.freeze(['executed', 'failed', 'expired']),
});

/** True iff `from -> to` is listed in the transition table. */
export function canTransition(from, to) {
  if (!STATES.includes(from) || !STATES.includes(to)) return false;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Return `to` if the transition is allowed, otherwise throw. */
export function transition(from, to) {
  if (!canTransition(from, to)) throw new Error(`invalid approval transition ${from} -> ${to}`);
  return to;
}

/** Outcome a runtime must enforce for a state: only "approved" permits execution. */
export function enforcedOutcome(state) {
  return state === 'approved' ? 'allow' : 'deny';
}

/**
 * Validate a decision against its request.
 * @param {object} request    ApprovalRequest
 * @param {object} decision   ApprovalDecision
 * @param {{state: string, agent_principals: string[], separation_of_duties: {requester_may_approve: boolean, dispatcher_may_approve: boolean}}} ctx
 * @returns {{valid: true, next_state: 'approved'|'denied'} | {valid: false, reason: string}}
 */
export function validateDecision(request, decision, ctx) {
  const bad = (reason) => ({ valid: false, reason });
  if (ctx.state !== 'pending') return bad('not_pending');
  if (decision.request_id !== request.id) return bad('request_mismatch');
  if (decision.decision !== 'approve' && decision.decision !== 'deny') return bad('bad_decision');
  if (decision.scope !== 'once') return bad('bad_scope');
  const agents = new Set(ctx.agent_principals ?? []);
  agents.add(request.requester.agent_id);
  if (agents.has(decision.decided_by)) return bad('agent_cannot_decide');
  if (!(Date.parse(decision.decided_at) < Date.parse(request.expires_at))) return bad('expired');
  if (decision.enforced_identity !== request.arguments_digest) return bad('identity_mismatch');
  if (!request.routing.approvers.includes(decision.decided_by)) return bad('not_an_approver');
  const isDispatcher = typeof request.dispatcher === 'string' && decision.decided_by === request.dispatcher;
  if (decision.decided_by_dispatcher !== isDispatcher) return bad('dispatcher_flag_mismatch');
  if (isDispatcher && decision.decision === 'approve' && ctx.separation_of_duties.dispatcher_may_approve !== true) {
    return bad('dispatcher_may_not_approve');
  }
  return { valid: true, next_state: decision.decision === 'approve' ? 'approved' : 'denied' };
}

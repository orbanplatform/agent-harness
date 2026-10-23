// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// Exactly-once write ledger: decision function.
//
// Builds on draft-ietf-httpapi-idempotency-key-header-08 (400 missing key,
// 422 same key with a different payload, 409 original request in flight) and
// adds the profile's rules: the fingerprint is the hex SHA-256 of
// JCS(arguments), a key is bound to the task that first used it, and a
// terminal entry replays its stored response.
//
// Entries are looked up by (scope.tenant, scope.principal, scope.operation,
// idempotency_key). A key in a different scope is a different entry, so the
// caller passes `existing = null` in that case.
//
// Evaluation order (first match wins):
//   1. no key  -> write: 400 missing_key       read: bypass (reads are not ledgered)
//   2. no entry                                 -> new        (create state "intent")
//   3. entry.task_id   != incoming.task_id      -> 409 task_mismatch
//   4. entry.fingerprint != incoming.fingerprint -> 422 fingerprint_mismatch
//   5. entry.state in {intent, approved}         -> 409 in_flight
//   6. entry.state in {executed, denied, expired, failed} -> replay (stored response)
// Task binding is checked before the fingerprint so that a caller from another
// task cannot learn whether its payload matches the stored one.

import { sha256Jcs } from './jcs.mjs';

export const STATES = Object.freeze(['intent', 'approved', 'executed', 'denied', 'expired', 'failed']);
export const IN_FLIGHT_STATES = Object.freeze(['intent', 'approved']);
export const TERMINAL_STATES = Object.freeze(['executed', 'denied', 'expired', 'failed']);

/** Fingerprint of tool arguments: lowercase hex SHA-256 of JCS(arguments). */
export function fingerprint(args) {
  return sha256Jcs(args);
}

/**
 * @param {null | {task_id: string, fingerprint: string, state: string, response: object|null}} existing
 * @param {{key?: string|null, fingerprint: string, task_id: string, kind: 'read'|'write'}} incoming
 * @returns {{outcome: string, status: number|null, response?: object|null}}
 */
export function decide(existing, incoming) {
  if (incoming.kind !== 'read' && incoming.kind !== 'write') {
    throw new TypeError('incoming.kind must be "read" or "write"');
  }
  const hasKey = typeof incoming.key === 'string' && incoming.key.length > 0;
  if (!hasKey) {
    return incoming.kind === 'write' ? { outcome: 'missing_key', status: 400 } : { outcome: 'bypass', status: null };
  }
  if (existing === null || existing === undefined) return { outcome: 'new', status: null };
  if (existing.task_id !== incoming.task_id) return { outcome: 'task_mismatch', status: 409 };
  if (existing.fingerprint !== incoming.fingerprint) return { outcome: 'fingerprint_mismatch', status: 422 };
  if (IN_FLIGHT_STATES.includes(existing.state)) return { outcome: 'in_flight', status: 409 };
  if (TERMINAL_STATES.includes(existing.state)) return { outcome: 'replay', status: null, response: existing.response ?? null };
  throw new TypeError(`unknown ledger state ${existing.state}`);
}

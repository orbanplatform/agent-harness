// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// Audit chain over CloudEvents 1.0.2 JSON events.
//
//   event hash  h_n = lowercase hex SHA-256(JCS(event_n))      (RFC 8785)
//   chain link  event_n.orbanprevhash = h_{n-1}; genesis = 64 x "0"
//   sequence    20-digit zero-padded decimal, starting at 1, gapless per source
//   Merkle      RFC 9162 MTH over leaves JCS(event_i), i = sequence - 1
//
// The whole event, including its own orbanprevhash, is hashed.

import { createHash } from 'node:crypto';
import { canonicalBytes } from './jcs.mjs';
import { merkleTreeHash } from './merkle.mjs';

export const GENESIS_HASH = '0'.repeat(64);
export const ALG = 'sha256-jcs-v1';
export const TYPE_PREFIX = 'com.orbanplatform.harness.';
export const SEQUENCE_DIGITS = 20;

const HEX64 = /^[0-9a-f]{64}$/;
const SEQ_RE = /^[0-9]{20}$/;

/** Lowercase hex SHA-256 of JCS(event). */
export function eventHash(event) {
  return createHash('sha256').update(canonicalBytes(event)).digest('hex');
}

/** Format a positive integer as a 20-digit zero-padded decimal string. */
export function formatSequence(n) {
  const b = BigInt(n);
  if (b < 1n || b > 99999999999999999999n) throw new RangeError('sequence out of range');
  return b.toString().padStart(SEQUENCE_DIGITS, '0');
}

/**
 * Build the next event of a chain.
 * @param {{hash: string, sequence: string} | null} prev  previous link, or null for the first event
 * @param {string} source  CloudEvents source shared by the whole chain
 * @param {object} fields  id, type, time, data and optional recordedtime, traceparent, subject
 * @returns {{event: object, hash: string}}
 */
export function appendEvent(prev, source, fields) {
  const seq = prev ? BigInt(prev.sequence) + 1n : 1n;
  const event = {
    specversion: '1.0',
    id: fields.id,
    source,
    type: fields.type,
    time: fields.time,
    datacontenttype: 'application/json',
    data: fields.data,
    sequence: formatSequence(seq),
    orbanprevhash: prev ? prev.hash : GENESIS_HASH,
    orbanalg: ALG,
  };
  for (const opt of ['subject', 'recordedtime', 'traceparent']) {
    if (fields[opt] !== undefined) event[opt] = fields[opt];
  }
  return { event, hash: eventHash(event) };
}

/** Build a whole chain from a list of field sets. */
export function buildChain(source, fieldList) {
  const events = [];
  const hashes = [];
  let prev = null;
  for (const fields of fieldList) {
    const { event, hash } = appendEvent(prev, source, fields);
    events.push(event);
    hashes.push(hash);
    prev = { hash, sequence: event.sequence };
  }
  return { events, hashes, head: prev ? prev.hash : GENESIS_HASH };
}

/**
 * Verify a chain of events from one source.
 * @param {object[]} events
 * @returns {{ok: boolean, size: number, head: string, hashes: string[], errors: Array<{index:number, code:string, message:string}>}}
 */
export function verifyChain(events) {
  const errors = [];
  const hashes = [];
  const ids = new Set();
  let prevHash = GENESIS_HASH;
  const source = events.length > 0 ? events[0]?.source : undefined;
  events.forEach((ev, i) => {
    const err = (code, message) => errors.push({ index: i, code, message });
    if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) {
      err('not_an_object', 'event is not a JSON object');
      hashes.push(null);
      prevHash = null;
      return;
    }
    if (ev.specversion !== '1.0') err('bad_specversion', 'specversion must be "1.0"');
    if (ev.orbanalg !== ALG) err('bad_alg', `orbanalg must be "${ALG}"`);
    if (ev.source !== source) err('source_mismatch', 'all events of a chain share one source');
    if (typeof ev.type !== 'string' || !ev.type.startsWith(TYPE_PREFIX)) err('bad_type', `type must start with "${TYPE_PREFIX}"`);
    if (typeof ev.sequence !== 'string' || !SEQ_RE.test(ev.sequence) || ev.sequence !== formatSequence(i + 1)) {
      err('bad_sequence', `sequence must be ${formatSequence(i + 1)} (gapless, starting at 1)`);
    }
    if (typeof ev.orbanprevhash !== 'string' || !HEX64.test(ev.orbanprevhash)) {
      err('bad_prevhash', 'orbanprevhash must be 64 lowercase hex characters');
    } else if (prevHash === null || ev.orbanprevhash !== prevHash) {
      err('broken_link', 'orbanprevhash does not equal the hash of the previous event');
    }
    if (typeof ev.id !== 'string' || ev.id.length === 0) err('bad_id', 'id must be a non-empty string');
    else if (ids.has(ev.id)) err('duplicate_id', 'source + id must be unique');
    else ids.add(ev.id);
    let h = null;
    try {
      h = eventHash(ev);
    } catch (e) {
      err('not_canonicalizable', e.message);
    }
    hashes.push(h);
    prevHash = h;
  });
  return {
    ok: errors.length === 0,
    size: events.length,
    head: events.length === 0 ? GENESIS_HASH : hashes[hashes.length - 1],
    hashes,
    errors,
  };
}

/** RFC 9162 Merkle Tree Hash over leaves JCS(event_i). Returns a 32-byte Buffer. */
export function auditMerkleRoot(events) {
  return merkleTreeHash(events.map((e) => canonicalBytes(e)));
}

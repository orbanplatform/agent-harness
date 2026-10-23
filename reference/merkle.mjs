// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// RFC 9162 section 2.1.1 Merkle Tree Hash (MTH), SHA-256.
// https://www.rfc-editor.org/rfc/rfc9162#section-2.1.1
//
//   MTH({})      = SHA-256()
//   MTH({d(0)})  = SHA-256(0x00 || d(0))
//   MTH(D[n])    = SHA-256(0x01 || MTH(D[0:k]) || MTH(D[k:n]))
//                  where k is the largest power of two smaller than n.
//
// The 0x00 / 0x01 prefixes give second-preimage resistance by separating
// leaf hashes from interior node hashes (RFC 9162 section 2.1.1; identical to
// RFC 6962 section 2.1).

import { createHash } from 'node:crypto';

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function sha256(...parts) {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

/** SHA-256(0x00 || leaf) */
export function leafHash(leaf) {
  return sha256(LEAF_PREFIX, toBuf(leaf));
}

/** SHA-256(0x01 || left || right) */
export function nodeHash(left, right) {
  return sha256(NODE_PREFIX, toBuf(left), toBuf(right));
}

/** Largest power of two strictly smaller than n (n >= 2). */
export function splitPoint(n) {
  if (!Number.isSafeInteger(n) || n < 2) throw new RangeError('splitPoint requires an integer n >= 2');
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/**
 * Merkle Tree Hash over an ordered list of leaf inputs (byte strings).
 * @param {Array<Uint8Array>} leaves
 * @returns {Buffer} 32-byte root hash
 */
export function merkleTreeHash(leaves) {
  if (!Array.isArray(leaves)) throw new TypeError('leaves must be an array');
  if (leaves.length === 0) return sha256();
  // Hash leaves once, then fold with the recursive split rule.
  const hashes = leaves.map(leafHash);
  return mthFromLeafHashes(hashes, 0, hashes.length);
}

function mthFromLeafHashes(hashes, start, end) {
  const n = end - start;
  if (n === 1) return hashes[start];
  const k = splitPoint(n);
  return nodeHash(mthFromLeafHashes(hashes, start, start + k), mthFromLeafHashes(hashes, start + k, end));
}

function toBuf(b) {
  if (Buffer.isBuffer(b)) return b;
  if (b instanceof Uint8Array) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  throw new TypeError('expected bytes (Uint8Array)');
}

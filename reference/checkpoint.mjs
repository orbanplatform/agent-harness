// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// C2SP signed-note v1.1.0 and tlog-checkpoint v1.1.0 with Ed25519
// (signature type 0x01, "Ed25519 log signatures").
//   https://c2sp.org/signed-note@v1.1.0
//   https://c2sp.org/tlog-checkpoint@v1.1.0
//
// Signed note:
//   <text ending in "\n">  "\n"  1..n lines of  "— " <key name> " " base64(keyID || sig) "\n"
// Key ID (Ed25519):
//   SHA-256(key name || 0x0A || 0x01 || 32-byte public key)[:4]
// Verifier key (vkey):
//   <key name> "+" hex(keyID) "+" base64(0x01 || public key)
// Checkpoint note text:
//   <origin> "\n" <tree size, ASCII decimal> "\n" base64(root hash) "\n" [extension lines]
//
// Ed25519 (RFC 8032) is provided by node:crypto. Zero dependencies.

import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';

export const SIG_TYPE_ED25519 = 0x01;
const EM_DASH = '—';
const MAX_SIGNATURES = 100; // the spec requires accepting at least 16
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export class NoteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NoteError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Standard base64 with padding (RFC 4648 section 4). */
export function b64encode(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/** Decode canonical standard base64; reject anything non-canonical (RFC 4648 section 3.5). */
export function b64decodeCanonical(s) {
  if (typeof s !== 'string' || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    throw new NoteError('bad_base64', 'not canonical standard base64');
  }
  const buf = Buffer.from(s, 'base64');
  if (buf.toString('base64') !== s) throw new NoteError('bad_base64', 'not canonical standard base64');
  return buf;
}

function asText(note) {
  if (typeof note === 'string') {
    if (!note.isWellFormed()) throw new NoteError('bad_utf8', 'note is not valid UTF-8');
    return note;
  }
  try {
    return UTF8.decode(note);
  } catch {
    throw new NoteError('bad_utf8', 'note is not valid UTF-8');
  }
}

function checkNoControl(s, what) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x0a) throw new NoteError('control_character', `${what} contains an ASCII control character`);
  }
}

/** Key names: non-empty, no Unicode spaces, no "+" (signed-note "Format"). */
export function checkKeyName(name) {
  if (typeof name !== 'string' || name.length === 0 || /[\s+]/u.test(name)) {
    throw new NoteError('bad_key_name', 'key name must be non-empty and contain no spaces or "+"');
  }
  checkNoControl(name, 'key name');
  if (name.includes('\n')) throw new NoteError('bad_key_name', 'key name contains a newline');
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Ed25519 key pair from a 32-byte RFC 8032 seed. */
export function keyPairFromSeed(seed) {
  const s = Buffer.from(seed);
  if (s.length !== 32) throw new RangeError('Ed25519 seed must be 32 bytes');
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, s]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return { privateKey, publicKey: Buffer.from(spki.subarray(spki.length - 32)) };
}

function publicKeyObject(raw) {
  const r = Buffer.from(raw);
  if (r.length !== 32) throw new RangeError('Ed25519 public key must be 32 bytes');
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, r]), format: 'der', type: 'spki' });
}

/** SHA-256(name || 0x0A || 0x01 || publicKey)[:4] */
export function keyId(name, publicKey) {
  checkKeyName(name);
  return createHash('sha256')
    .update(Buffer.from(name, 'utf8'))
    .update(Buffer.from([0x0a, SIG_TYPE_ED25519]))
    .update(Buffer.from(publicKey))
    .digest()
    .subarray(0, 4);
}

/** Encode a verifier key string. */
export function encodeVkey(name, publicKey) {
  const id = keyId(name, publicKey);
  return `${name}+${id.toString('hex')}+${b64encode(Buffer.concat([Buffer.from([SIG_TYPE_ED25519]), Buffer.from(publicKey)]))}`;
}

/**
 * Parse a verifier key string. Only Ed25519 (type 0x01) is accepted.
 * The profile requires the recommended key ID derivation, so a vkey whose
 * key ID does not equal SHA-256(name || 0x0A || 0x01 || key)[:4] is rejected.
 */
export function parseVkey(vkey) {
  const first = vkey.indexOf('+');
  if (first <= 0) throw new NoteError('bad_vkey', 'vkey must be name+hex(keyID)+base64(type||key)');
  const name = vkey.slice(0, first);
  const rest = vkey.slice(first + 1);
  const second = rest.indexOf('+');
  if (second !== 8) throw new NoteError('bad_vkey', 'vkey key ID must be 8 lowercase hex digits');
  const idHex = rest.slice(0, 8);
  if (!/^[0-9a-f]{8}$/.test(idHex)) throw new NoteError('bad_vkey', 'vkey key ID must be 8 lowercase hex digits');
  const material = b64decodeCanonical(rest.slice(9));
  if (material.length !== 33 || material[0] !== SIG_TYPE_ED25519) {
    throw new NoteError('bad_vkey', 'only Ed25519 vkeys (type 0x01, 32-byte key) are supported');
  }
  checkKeyName(name);
  const publicKey = material.subarray(1);
  const id = Buffer.from(idHex, 'hex');
  if (!id.equals(keyId(name, publicKey))) throw new NoteError('bad_vkey', 'vkey key ID does not match the key name and public key');
  return { name, keyId: id, publicKey: Buffer.from(publicKey) };
}

// ---------------------------------------------------------------------------
// Signed notes
// ---------------------------------------------------------------------------

/**
 * Sign note text with one or more Ed25519 keys.
 * @param {string} text  must end with "\n"
 * @param {Array<{name: string, privateKey: import('node:crypto').KeyObject, publicKey: Uint8Array}>} signers
 * @returns {string}
 */
export function signNote(text, signers) {
  if (typeof text !== 'string' || !text.endsWith('\n')) throw new NoteError('bad_text', 'note text must end with a newline');
  asText(text);
  checkNoControl(text, 'note text');
  if (!Array.isArray(signers) || signers.length === 0) throw new NoteError('no_signers', 'at least one signer is required');
  const msg = Buffer.from(text, 'utf8');
  const lines = signers.map((s) => {
    const id = keyId(s.name, s.publicKey);
    const sig = edSign(null, msg, s.privateKey);
    return `${EM_DASH} ${s.name} ${b64encode(Buffer.concat([id, sig]))}\n`;
  });
  return `${text}\n${lines.join('')}`;
}

/**
 * Split a signed note into text and signature lines without verifying.
 * @returns {{text: string, signatures: Array<{name: string, keyId: Buffer, signature: Buffer}>}}
 */
export function parseNote(note) {
  const s = asText(note);
  checkNoControl(s, 'note');
  const sep = s.lastIndexOf('\n\n');
  if (sep < 0) throw new NoteError('malformed', 'no blank line separating text and signatures');
  const text = s.slice(0, sep + 1);
  const sigBlock = s.slice(sep + 2);
  if (sigBlock.length === 0 || !sigBlock.endsWith('\n')) throw new NoteError('malformed', 'signature lines must end with a newline');
  const rawLines = sigBlock.slice(0, -1).split('\n');
  if (rawLines.length > MAX_SIGNATURES) throw new NoteError('too_many_signatures', `more than ${MAX_SIGNATURES} signatures`);
  const signatures = rawLines.map((line) => {
    const m = /^— (\S+) (\S+)$/u.exec(line);
    if (!m) throw new NoteError('malformed', 'signature line must be "— <key name> <base64>"');
    checkKeyName(m[1]);
    const raw = b64decodeCanonical(m[2]);
    if (raw.length < 5) throw new NoteError('malformed', 'signature shorter than key ID plus one byte');
    return { name: m[1], keyId: Buffer.from(raw.subarray(0, 4)), signature: Buffer.from(raw.subarray(4)) };
  });
  return { text, signatures };
}

/**
 * Verify a signed note against known Ed25519 verifier keys.
 * Signatures from unknown (name, key ID) pairs are ignored. A known key whose
 * signature fails rejects the whole note. At least one known key must verify.
 * @param {string|Uint8Array} note
 * @param {Array<{name: string, keyId: Uint8Array, publicKey: Uint8Array}>} verifiers
 * @returns {{text: string, verifiedBy: string[]}}
 */
export function verifyNote(note, verifiers) {
  const { text, signatures } = parseNote(note);
  const msg = Buffer.from(text, 'utf8');
  const verifiedBy = [];
  for (const sig of signatures) {
    const v = verifiers.find((k) => k.name === sig.name && Buffer.from(k.keyId).equals(sig.keyId));
    if (!v) continue; // unknown key: ignore
    const ok = sig.signature.length === 64 && edVerify(null, msg, publicKeyObject(v.publicKey), sig.signature);
    if (!ok) throw new NoteError('bad_signature', `signature by known key ${sig.name} does not verify`);
    verifiedBy.push(sig.name);
  }
  if (verifiedBy.length === 0) throw new NoteError('no_known_signature', 'no signature from a known key');
  return { text, verifiedBy };
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

const MAX_UINT64 = (1n << 64n) - 1n;

/** Log origin: same construction as a cosigner name (c2sp.org/tlog-cosignature@v1.1.0). */
export function checkOrigin(origin) {
  checkKeyName(origin);
  if (Buffer.byteLength(origin, 'utf8') > 255) throw new NoteError('bad_origin', 'origin longer than 255 bytes');
}

/** Build checkpoint note text. rootHash is 32 bytes; size is a non-negative integer. */
export function checkpointText({ origin, size, rootHash, extensions = [] }) {
  checkOrigin(origin);
  const n = BigInt(size);
  if (n < 0n || n > MAX_UINT64) throw new RangeError('tree size out of range');
  const root = Buffer.from(rootHash);
  if (root.length !== 32) throw new RangeError('root hash must be 32 bytes');
  for (const e of extensions) {
    if (typeof e !== 'string' || e.length === 0 || e.includes('\n')) throw new NoteError('bad_extension', 'extension lines must be non-empty single lines');
  }
  return [origin, n.toString(), b64encode(root), ...extensions].join('\n') + '\n';
}

/** Parse checkpoint note text. Returns size as a BigInt. */
export function parseCheckpointText(text) {
  if (typeof text !== 'string' || !text.endsWith('\n')) throw new NoteError('bad_checkpoint', 'checkpoint text must end with a newline');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length < 3) throw new NoteError('bad_checkpoint', 'checkpoint needs origin, tree size and root hash lines');
  if (lines.some((l) => l.length === 0)) throw new NoteError('bad_checkpoint', 'checkpoint lines must be non-empty');
  const [origin, sizeStr, rootB64, ...extensions] = lines;
  checkOrigin(origin);
  if (!/^(0|[1-9][0-9]*)$/.test(sizeStr)) throw new NoteError('bad_checkpoint', 'tree size must be an ASCII decimal without leading zeros');
  const size = BigInt(sizeStr);
  if (size > MAX_UINT64) throw new NoteError('bad_checkpoint', 'tree size exceeds uint64');
  const rootHash = b64decodeCanonical(rootB64);
  if (rootHash.length !== 32) throw new NoteError('bad_checkpoint', 'root hash must be 32 bytes (SHA-256)');
  return { origin, size, rootHash, extensions };
}

/** Sign a checkpoint. The key name SHOULD be the log origin. */
export function signCheckpoint(fields, signers) {
  return signNote(checkpointText(fields), signers);
}

/**
 * Verify a signed checkpoint and return its parsed fields.
 * @param {string} note
 * @param {Array<{name: string, keyId: Uint8Array, publicKey: Uint8Array}>} verifiers
 * @param {{origin?: string}} [expect]  if origin is given it must match
 */
export function verifyCheckpoint(note, verifiers, expect = {}) {
  const { text, verifiedBy } = verifyNote(note, verifiers);
  const cp = parseCheckpointText(text);
  if (expect.origin !== undefined && cp.origin !== expect.origin) {
    throw new NoteError('origin_mismatch', `checkpoint origin ${cp.origin} is not ${expect.origin}`);
  }
  return { ...cp, verifiedBy };
}

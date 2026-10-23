// SPDX-License-Identifier: Apache-2.0
// Copyright Orban Platform Inc.
//
// RFC 8785 JSON Canonicalization Scheme (JCS).
// https://www.rfc-editor.org/rfc/rfc8785
//
// Zero dependencies. Node >= 22.
//
// canonicalize(value) accepts only JSON data: null, booleans, finite numbers,
// well-formed strings, arrays without holes, and plain objects (prototype is
// Object.prototype or null) whose own properties are string-keyed data
// properties. Everything else (NaN, Infinity, undefined, BigInt, functions,
// symbols, Date, Map, class instances, cycles, lone surrogates) throws a
// JcsError, as RFC 8785 sections 3.2.2.2 and 3.2.2.3 require.
//
// parseStrict(text) is an RFC 8259 parser that additionally rejects what
// I-JSON (RFC 7493) and RFC 8785 section 3.1 forbid: duplicate property names,
// lone surrogates, and numbers that overflow IEEE 754 double precision.

import { createHash } from 'node:crypto';

export class JcsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JcsError';
  }
}

/**
 * Canonicalize a JSON value to its RFC 8785 string form.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  return serialize(value, new Set(), '$');
}

/**
 * Canonicalize and encode as UTF-8 (RFC 8785 section 3.2.4).
 * @param {unknown} value
 * @returns {Buffer}
 */
export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}

/**
 * Lowercase hex SHA-256 of the JCS bytes of a value.
 * @param {unknown} value
 * @returns {string}
 */
export function sha256Jcs(value) {
  return createHash('sha256').update(canonicalBytes(value)).digest('hex');
}

function serialize(value, stack, path) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new JcsError(`${path}: NaN and Infinity are not JSON numbers (RFC 8785 section 3.2.2.3)`);
      }
      // ECMAScript Number::toString, which JSON.stringify uses for finite
      // numbers, is exactly the serialization RFC 8785 section 3.2.2.3 requires.
      // -0 serializes as "0".
      return JSON.stringify(value);
    case 'string':
      return serializeString(value, path);
    case 'undefined':
      throw new JcsError(`${path}: undefined is not JSON data`);
    case 'bigint':
      throw new JcsError(`${path}: BigInt is not JSON data`);
    case 'function':
      throw new JcsError(`${path}: functions are not JSON data`);
    case 'symbol':
      throw new JcsError(`${path}: symbols are not JSON data`);
    case 'object':
      break;
    default:
      throw new JcsError(`${path}: unsupported type ${typeof value}`);
  }

  if (stack.has(value)) throw new JcsError(`${path}: cyclic structure`);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new JcsError(`${path}: array subclasses are not JSON data`);
      }
      const parts = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) {
          throw new JcsError(`${path}[${i}]: sparse array hole is not JSON data`);
        }
        parts.push(serialize(value[i], stack, `${path}[${i}]`));
      }
      return `[${parts.join(',')}]`;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = value?.constructor?.name ?? 'unknown';
      throw new JcsError(`${path}: only plain objects are JSON data (got ${name})`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new JcsError(`${path}: symbol-keyed properties are not JSON data`);
    }
    // RFC 8785 section 3.2.3: sort by UTF-16 code units. JavaScript string
    // comparison with < and > compares UTF-16 code units, independent of locale.
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = [];
    for (const key of keys) {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!('value' in desc)) {
        throw new JcsError(`${path}.${key}: accessor properties are not JSON data`);
      }
      parts.push(`${serializeString(key, `${path} key`)}:${serialize(desc.value, stack, `${path}.${key}`)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    stack.delete(value);
  }
}

function serializeString(s, path) {
  if (!s.isWellFormed()) {
    throw new JcsError(`${path}: string contains a lone surrogate (RFC 8785 section 3.2.2.2)`);
  }
  // For well-formed strings JSON.stringify implements ECMA-262
  // QuoteJSONString: \b \t \n \f \r, \" and \\, other code points below
  // U+0020 as lowercase \u00hh, everything else as is.
  return JSON.stringify(s);
}

// ---------------------------------------------------------------------------
// Strict parser
// ---------------------------------------------------------------------------

/**
 * Parse JSON text, rejecting duplicate names, lone surrogates and
 * out-of-range numbers. Returns plain JavaScript values.
 * @param {string} text
 * @returns {unknown}
 */
export function parseStrict(text) {
  if (typeof text !== 'string') throw new JcsError('parseStrict expects a string');
  const p = { s: text, i: 0 };
  ws(p);
  const v = parseValue(p, '$');
  ws(p);
  if (p.i !== p.s.length) fail(p, 'unexpected trailing characters');
  return v;
}

function fail(p, msg) {
  throw new JcsError(`JSON parse error at offset ${p.i}: ${msg}`);
}

function ws(p) {
  while (p.i < p.s.length) {
    const c = p.s.charCodeAt(p.i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) p.i++;
    else break;
  }
}

function parseValue(p, path) {
  const c = p.s[p.i];
  if (c === '{') return parseObject(p, path);
  if (c === '[') return parseArray(p, path);
  if (c === '"') return parseString(p);
  if (c === 't') return literal(p, 'true', true);
  if (c === 'f') return literal(p, 'false', false);
  if (c === 'n') return literal(p, 'null', null);
  if (c === '-' || (c >= '0' && c <= '9')) return parseNumber(p);
  fail(p, `unexpected ${c === undefined ? 'end of input' : JSON.stringify(c)}`);
}

function literal(p, word, value) {
  if (p.s.startsWith(word, p.i)) {
    p.i += word.length;
    return value;
  }
  fail(p, `invalid literal`);
}

const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function parseNumber(p) {
  NUMBER_RE.lastIndex = p.i;
  const m = NUMBER_RE.exec(p.s);
  if (!m) fail(p, 'invalid number');
  p.i += m[0].length;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) fail(p, 'number out of IEEE 754 double range (I-JSON, RFC 7493 section 2.2)');
  return n;
}

function parseString(p) {
  p.i++; // opening quote
  let out = '';
  for (;;) {
    if (p.i >= p.s.length) fail(p, 'unterminated string');
    const c = p.s.charCodeAt(p.i);
    if (c === 0x22) {
      p.i++;
      break;
    }
    if (c < 0x20) fail(p, 'unescaped control character in string');
    if (c === 0x5c) {
      const e = p.s[p.i + 1];
      p.i += 2;
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          const hex = p.s.slice(p.i, p.i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(p, 'invalid \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          p.i += 4;
          break;
        }
        default:
          fail(p, 'invalid escape');
      }
      continue;
    }
    out += p.s[p.i];
    p.i++;
  }
  if (!out.isWellFormed()) fail(p, 'string contains a lone surrogate');
  return out;
}

function parseArray(p, path) {
  p.i++;
  const arr = [];
  ws(p);
  if (p.s[p.i] === ']') {
    p.i++;
    return arr;
  }
  for (;;) {
    ws(p);
    arr.push(parseValue(p, `${path}[${arr.length}]`));
    ws(p);
    const c = p.s[p.i];
    if (c === ',') { p.i++; continue; }
    if (c === ']') { p.i++; return arr; }
    fail(p, 'expected , or ]');
  }
}

function parseObject(p, path) {
  p.i++;
  const obj = {};
  const seen = new Set();
  ws(p);
  if (p.s[p.i] === '}') {
    p.i++;
    return obj;
  }
  for (;;) {
    ws(p);
    if (p.s[p.i] !== '"') fail(p, 'expected property name');
    const key = parseString(p);
    if (seen.has(key)) fail(p, `duplicate property name ${JSON.stringify(key)} (I-JSON, RFC 7493 section 2.3)`);
    seen.add(key);
    ws(p);
    if (p.s[p.i] !== ':') fail(p, 'expected :');
    p.i++;
    ws(p);
    const v = parseValue(p, `${path}.${key}`);
    // defineProperty so that a "__proto__" name becomes an own data property.
    Object.defineProperty(obj, key, { value: v, enumerable: true, writable: true, configurable: true });
    ws(p);
    const c = p.s[p.i];
    if (c === ',') { p.i++; continue; }
    if (c === '}') { p.i++; return obj; }
    fail(p, 'expected , or }');
  }
}

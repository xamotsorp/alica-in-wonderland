'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// ---------- Пароли: scrypt (N=2^15, r=8, p=1), соль 16 байт ----------

const SCRYPT = { log2N: 15, r: 8, p: 1, keyLen: 64 };

function scryptOptions(log2N, r, p) {
  const N = 2 ** log2N;
  return { N, r, p, maxmem: 128 * N * r * 2 };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keyLen, scryptOptions(SCRYPT.log2N, SCRYPT.r, SCRYPT.p));
  return ['scrypt', SCRYPT.log2N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, log2N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    scryptOptions(Number(log2N), Number(r), Number(p)),
  );
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Хеш-заглушка: проверяем пароль даже для несуществующего логина, чтобы время ответа не выдавало,
// есть такой пользователь или нет.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

function passwordProblems(password) {
  const problems = [];
  if (typeof password !== 'string' || password.length < 12) problems.push('не короче 12 символов');
  if (typeof password === 'string' && password.length > 200) problems.push('не длиннее 200 символов');
  if (typeof password === 'string' && new Set(password).size < 6) problems.push('слишком однообразный');
  return problems;
}

// ---------- Токены ----------

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- TOTP (RFC 6238): коды из Google Authenticator, Яндекс Ключа и т. п. ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

// Возвращает шаг времени, на котором код совпал (±30 секунд), или null.
// Шаг нужен, чтобы один и тот же код нельзя было использовать дважды.
function verifyTotp(secret, code, lastUsedStep) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && lastUsedStep !== undefined && step <= Number(lastUsedStep)) continue;
    if (safeEqual(totpAt(secret, step), code)) return step;
  }
  return null;
}

function totpUri(secret, username, issuer = 'Портфолио Алисы') {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- Ограничение частоты (в памяти процесса; основной лимит — в nginx) ----------

class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
    this.timer = setInterval(() => this.cleanup(), windowMs).unref();
  }

  // true — запрос разрешён
  hit(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  reset(key) {
    this.hits.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  dummyHash,
  passwordProblems,
  randomToken,
  sha256,
  safeEqual,
  generateTotpSecret,
  verifyTotp,
  totpAt,
  totpUri,
  RateLimiter,
};

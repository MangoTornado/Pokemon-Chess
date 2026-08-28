/**
 * Password hashing and session tokens — zero native dependencies, built on `node:crypto`.
 *
 * Passwords are hashed with **scrypt**, a memory-hard KDF in the Node standard library, with a random
 * per-password salt and a version tag so the parameters can be raised later without invalidating old
 * hashes. Verification is constant-time. Session tokens are 256 bits of CSPRNG randomness, stored only
 * as a hash server-side so a database leak does not hand an attacker live sessions.
 *
 * No password, plaintext or reversible, is ever stored or logged.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

// scrypt cost parameters. N=2^15 is a common interactive-login setting: strong, ~50-100ms per hash.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Hashes a password into a self-describing string: `scrypt$N$r$p$salt$hash` (salt and hash base64).
 *
 * Self-describing so verification reads the parameters from the stored value; raising the cost later
 * only affects newly-set passwords, and old ones still verify.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Verifies a password against a stored hash in constant time. Returns false on any malformed input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password, salt, expected.length,
      { N: Number(nStr), r: Number(rStr), p: Number(pStr), maxmem: 128 * 1024 * 1024 },
      (err, k) => (err ? reject(err) : resolve(k)),
    );
  }).catch(() => null);
  if (!key || key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

/** A fresh session token: the raw value goes to the client, only its hash is stored. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Hashes a session token for storage/lookup. SHA-256 is right here: tokens are already high-entropy. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64');
}

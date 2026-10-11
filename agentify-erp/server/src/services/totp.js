// Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30 s) for authenticator apps, plus single-use recovery codes.
import crypto from 'node:crypto';
import QRCode from 'qrcode';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newSecret = () => {
  const b = crypto.randomBytes(20);
  let bits = '', out = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
};
const fromB32 = (s) => {
  let bits = '';
  for (const c of String(s).toUpperCase().replace(/=+$/, '')) { const i = B32.indexOf(c); if (i < 0) throw new Error('bad secret'); bits += i.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
const STEP = 30;
const codeAt = (secret, counter) => {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', fromB32(secret)).update(buf).digest();
  const o = h[19] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
};
export const codeNow = (secret, at = Date.now()) => codeAt(secret, Math.floor(at / 1000 / STEP));

/**
 * Check a code, allowing one step of clock drift either way. Returns the matched step (so the caller can refuse to accept the
 * same step twice) or null. `lastStep` is the newest step already used.
 */
export function verifyCode(secret, code, lastStep = 0, at = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = Math.floor(at / 1000 / STEP);
  for (const d of [0, -1, 1]) {
    const step = now + d;
    if (step <= (lastStep || 0)) continue;
    const a = Buffer.from(codeAt(secret, step)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return step;
  }
  return null;
}

export const otpauthUrl = (secret, account, issuer) => `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
export const qrDataUrl = (url) => QRCode.toDataURL(url, { margin: 1, width: 220 });

const sha = (s) => crypto.createHash('sha256').update(String(s).toLowerCase().replace(/[\s-]/g, '')).digest('hex');
export function newRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
  return { codes, hashes: codes.map(sha) };
}
/** Returns the remaining hashes if `code` was one of them (it is then used up), else null. */
export function useRecoveryCode(hashes, code) {
  const h = sha(code);
  return hashes.includes(h) ? hashes.filter((x) => x !== h) : null;
}

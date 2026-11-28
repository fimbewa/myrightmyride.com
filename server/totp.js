// Two-step login with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy...):
// standard 6-digit time codes (TOTP, RFC 6238, SHA-1, 30 seconds), plus one-time backup codes. Free, no packages.
const crypto = require("crypto");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ""), out = [];
  let bits = 0, val = 0;
  for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const newSecret = () => b32encode(crypto.randomBytes(20));
function codeAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(msg).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const stepNow = (t = Date.now()) => Math.floor(t / 30_000);
// Returns the time step that matched (allowing one step either side for a slow phone clock), or 0.
// `last` is the step used last time, so the same code cannot be used twice.
function check(secret, typed, last = 0, t = Date.now()) {
  const c = String(typed || "").replace(/\D/g, "");
  if (c.length !== 6 || !secret) return 0;
  for (const d of [0, -1, 1]) {
    const s = stepNow(t) + d, x = Buffer.from(codeAt(secret, s)), y = Buffer.from(c);
    if (s > last && crypto.timingSafeEqual(x, y)) return s;
  }
  return 0;
}
const otpauth = (secret, account) =>
  `otpauth://totp/${encodeURIComponent("Qindiaglobal:" + account)}?secret=${secret}&issuer=Qindiaglobal&algorithm=SHA1&digits=6&period=30`;

// Backup codes: 10 codes like 4f7k-9m2p, each works once. Only their scrambled form is stored.
const normBackup = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hashBackup = s => crypto.createHash("sha256").update("qi-backup:" + normBackup(s)).digest("hex");
function newBackupCodes(n = 10) {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: n }, () => { const r = Array.from(crypto.randomBytes(8), b => abc[b % abc.length]).join(""); return r.slice(0, 4) + "-" + r.slice(4); });
  return { codes, hashes: codes.map(hashBackup) };
}
// Returns the list without the used code, or null when the code is not one of them.
function useBackup(hashes, typed) {
  if (normBackup(typed).length !== 8) return null;
  const h = hashBackup(typed), i = (hashes || []).indexOf(h);
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}

module.exports = { newSecret, codeAt, stepNow, check, otpauth, newBackupCodes, useBackup, b32encode, b32decode };

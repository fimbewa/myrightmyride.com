// The owner password, used by both owner pages (myrightmyride.com/admin and qindiaglobal.com/admin).
//
// Order: a password the owner set through the GitHub reset (stored hashed in the database) wins;
// otherwise ADMIN_PASSWORD from the server settings (spaces and quote marks around it are ignored,
// because web panels such as Hostinger's Docker Manager sometimes keep the quotes people type).
const crypto = require("crypto");

function ownerPassword() {
  return String(process.env.ADMIN_PASSWORD || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

let db = null;
function useDb(database) {
  db = database;
  db.exec("CREATE TABLE IF NOT EXISTS owner_password (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, hash TEXT NOT NULL, set_at INTEGER NOT NULL)");
}
const scrypt = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString("hex");
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Returns "ok", "wrong", or "unset" (no password anywhere yet).
function checkOwner(given) {
  const row = db && db.prepare("SELECT salt, hash FROM owner_password WHERE id = 1").get();
  if (row) return same(scrypt(given, row.salt), row.hash) ? "ok" : "wrong";
  const pw = ownerPassword();
  if (!pw || pw.length < 8) return "unset";
  const h = s => crypto.createHash("sha256").update(String(s)).digest("hex");
  return same(h(given), h(pw)) ? "ok" : "wrong";
}
function setOwnerPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO owner_password(id, salt, hash, set_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, set_at = excluded.set_at")
    .run(salt, scrypt(pw, salt), Date.now());
  db.prepare("DELETE FROM admin_sessions").run(); // log out everywhere
}

module.exports = ownerPassword;
Object.assign(module.exports, { useDb, checkOwner, setOwnerPassword });

// qindiaglobal.com referral rewards. A community member who brings 1,000 qualifying sign-ups through their invite link
// (qindiaglobal.com/community?ref=<username>, stored as s_users.ref_by) earns a monthly share of the site's ad income.
// Each month the owner types that month's ad income; a set percentage of it (the "pool", 10% unless changed) is split
// between all qualified members in proportion to their qualifying sign-ups. The owner pays by UPI/bank and marks it paid.
// Rewards never depend on ad views or clicks.
const crypto = require("crypto");
const express = require("express");

const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI_RX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const IFSC_RX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

module.exports = function referral(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS q_ref_payee (user_id INTEGER PRIMARY KEY, legal_name TEXT NOT NULL, pan TEXT NOT NULL, upi TEXT, bank_account TEXT, ifsc TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS q_ref_months (month TEXT PRIMARY KEY, income REAL NOT NULL, share REAL NOT NULL, pool REAL NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS q_ref_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, user_id INTEGER NOT NULL, username TEXT NOT NULL,
  signups INTEGER NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'due', paid_ref TEXT, paid_at INTEGER,
  UNIQUE(month, user_id));
CREATE TABLE IF NOT EXISTS q_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
  const getKv = k => (db.prepare("SELECT v FROM q_kv WHERE k = ?").get(k) || {}).v;
  const setKv = (k, v) => db.prepare("INSERT INTO q_kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, String(v));
  const settings = () => ({
    on: getKv("ref_on") !== "0",
    share: Number(getKv("ref_share") || 10),     // % of the month's ad income
    target: Number(getKv("ref_target") || 1000), // qualifying sign-ups needed
  });
  const hasUsers = () => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 's_users'").get();

  const r = express.Router();
  const now = () => Date.now();
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const clean = (s, n = 80) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const rupees = n => Math.round(n * 100) / 100;
  const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");

  // Qualifying sign-ups: accounts that joined through the link and are still active (deleted accounts are gone from s_users).
  const qualifying = id => db.prepare("SELECT COUNT(*) AS n FROM s_users WHERE ref_by = ? AND status = 'ok'").get(id).n;
  // Sign-ups from the same internet connection as the inviter: shown to the owner as a warning sign of self-made accounts.
  const sameNet = (id, ipHash) => (ipHash ? db.prepare("SELECT COUNT(*) AS n FROM s_users WHERE ref_by = ? AND status = 'ok' AND ip_hash = ?").get(id, ipHash).n : 0);
  const leaders = () => (hasUsers() ? db.prepare(`SELECT u.id, u.username, u.name, u.city, u.status, u.ip_hash, COUNT(r.id) AS n FROM s_users r JOIN s_users u ON u.id = r.ref_by
    WHERE r.status = 'ok' GROUP BY u.id ORDER BY n DESC LIMIT 200`).all() : []);

  r.get("/api/referral/rules", (req, res) => res.set("Cache-Control", "no-store").json(settings()));
  // ---------- member ----------
  function member(req, res, next) {
    if (!hasUsers()) return bad(res, "Please log in again.", 401);
    const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const u = t && db.prepare("SELECT u.* FROM s_sessions s JOIN s_users u ON u.id = s.user_id WHERE s.token_hash = ?").get(sha(t));
    if (!u || u.status !== "ok") return bad(res, "Please log in again.", 401);
    req.me = u; res.set("Cache-Control", "no-store"); next();
  }
  const mask = (s, keep = 4) => (s ? "•".repeat(Math.max(0, s.length - keep)) + s.slice(-keep) : "");
  r.get("/api/referral/me", member, (req, res) => {
    const s = settings(), me = req.me, p = db.prepare("SELECT * FROM q_ref_payee WHERE user_id = ?").get(me.id);
    res.json({
      ...s, username: me.username, link: "https://qindiaglobal.com/community?ref=" + me.username,
      signups: qualifying(me.id),
      payee: p ? { legal_name: p.legal_name, pan: mask(p.pan), upi: p.upi || "", bank_account: mask(p.bank_account || ""), ifsc: p.ifsc || "" } : null,
      payouts: db.prepare("SELECT month, signups, amount, status, paid_at FROM q_ref_payouts WHERE user_id = ? ORDER BY month DESC").all(me.id),
    });
  });
  r.post("/api/referral/payee", member, (req, res) => {
    const b = req.body || {};
    const legal = clean(b.legal_name, 100), pan = String(b.pan || "").toUpperCase().replace(/\s/g, "");
    const upi = String(b.upi || "").trim(), acct = String(b.bank_account || "").replace(/\s/g, ""), ifsc = String(b.ifsc || "").toUpperCase().trim();
    if (!legal) return bad(res, "Please write your full name as on your PAN card.");
    if (!PAN_RX.test(pan)) return bad(res, "Please give a valid PAN, like ABCDE1234F.");
    if (upi && !UPI_RX.test(upi)) return bad(res, "Please give a valid UPI ID, like name@okbank.");
    if (acct && (!/^\d{9,18}$/.test(acct) || !IFSC_RX.test(ifsc))) return bad(res, "Please give a valid bank account number and IFSC code.");
    if (!upi && !acct) return bad(res, "Please give a UPI ID or a bank account.");
    db.prepare(`INSERT INTO q_ref_payee(user_id, legal_name, pan, upi, bank_account, ifsc, updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET legal_name=excluded.legal_name, pan=excluded.pan, upi=excluded.upi, bank_account=excluded.bank_account, ifsc=excluded.ifsc, updated_at=excluded.updated_at`)
      .run(req.me.id, legal, pan, upi || null, acct || null, acct ? ifsc : null, now());
    res.json({ ok: true });
  });

  // ---------- owner ----------
  function owner(req, res, next) {
    const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const row = t && db.prepare("SELECT created_at FROM admin_sessions WHERE token = ?").get(t);
    if (!row || now() - row.created_at > 7 * 24 * 3600_000) return bad(res, "Please log in again.", 401);
    res.set("Cache-Control", "no-store"); next();
  }
  r.get("/api/admin/referral", owner, (req, res) => {
    const s = settings();
    const top = leaders().map(u => {
      const p = db.prepare("SELECT legal_name, pan, upi, bank_account, ifsc FROM q_ref_payee WHERE user_id = ?").get(u.id);
      return { id: u.id, username: u.username, name: u.name, city: u.city, status: u.status, signups: u.n, sameNet: sameNet(u.id, u.ip_hash), qualified: u.status === "ok" && u.n >= s.target, payee: p || null };
    });
    res.json({
      settings: s, top,
      months: db.prepare("SELECT * FROM q_ref_months ORDER BY month DESC LIMIT 36").all(),
      payouts: db.prepare("SELECT * FROM q_ref_payouts ORDER BY month DESC, amount DESC LIMIT 2000").all(),
      totalReferred: hasUsers() ? db.prepare("SELECT COUNT(*) AS n FROM s_users WHERE ref_by IS NOT NULL AND status = 'ok'").get().n : 0,
    });
  });
  r.post("/api/admin/referral/settings", owner, (req, res) => {
    const b = req.body || {}, share = Number(b.share), target = Math.round(Number(b.target));
    if (!(share >= 0 && share <= 100)) return bad(res, "The share must be between 0 and 100 per cent.");
    if (!(target >= 1 && target <= 1e7)) return bad(res, "The number of sign-ups must be at least 1.");
    setKv("ref_share", share); setKv("ref_target", target); setKv("ref_on", b.on === false ? "0" : "1");
    res.json({ ok: true, settings: settings() });
  });
  // Work out one month: pool = income × share; split by qualifying sign-ups among members who reached the target.
  // Running it again for the same month replaces the amounts not yet paid.
  r.post("/api/admin/referral/month", owner, (req, res) => {
    const b = req.body || {}, month = String(b.month || ""), income = rupees(Number(b.income));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return bad(res, "Please choose the month.");
    if (!(income >= 0)) return bad(res, "Please type the month's ad income in rupees.");
    const s = settings(), pool = rupees(income * s.share / 100);
    const winners = leaders().filter(u => u.status === "ok" && u.n >= s.target);
    const total = winners.reduce((a, u) => a + u.n, 0);
    db.transaction(() => {
      db.prepare("INSERT INTO q_ref_months(month, income, share, pool, created_at) VALUES(?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET income=excluded.income, share=excluded.share, pool=excluded.pool")
        .run(month, income, s.share, pool, now());
      db.prepare("DELETE FROM q_ref_payouts WHERE month = ? AND status = 'due'").run(month);
      const paidAlready = new Set(db.prepare("SELECT user_id FROM q_ref_payouts WHERE month = ?").all(month).map(x => x.user_id));
      for (const u of winners) if (!paidAlready.has(u.id))
        db.prepare("INSERT INTO q_ref_payouts(month, user_id, username, signups, amount) VALUES(?,?,?,?,?)").run(month, u.id, u.username, u.n, total ? rupees(pool * u.n / total) : 0);
    })();
    res.json({ ok: true, pool, people: winners.length });
  });
  r.post("/api/admin/referral/payout/:id", owner, (req, res) => {
    const id = Number(req.params.id), b = req.body || {};
    if (!db.prepare("SELECT 1 FROM q_ref_payouts WHERE id = ?").get(id)) return bad(res, "Not found.", 404);
    if (b.paid === false) db.prepare("UPDATE q_ref_payouts SET status = 'due', paid_ref = NULL, paid_at = NULL WHERE id = ?").run(id);
    else db.prepare("UPDATE q_ref_payouts SET status = 'paid', paid_ref = ?, paid_at = ? WHERE id = ?").run(clean(b.ref, 80) || null, now(), id);
    res.json({ ok: true });
  });
  return r;
};

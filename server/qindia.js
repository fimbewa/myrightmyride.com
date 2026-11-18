// qindiaglobal.com: the citizens' queue initiative. Serves its own website (sites/qindiaglobal) plus a small API
// for the pledge counter, the volunteer/contact form and the owner page (/admin.html on qindiaglobal.com).
// Only used for requests whose Host is the qindiaglobal domain, so myrightmyride.com is not affected.
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const DIR = path.join(__dirname, "..", "sites", "qindiaglobal");
const KINDS = new Set(["volunteer", "idea", "partner", "other"]);

module.exports = function qindia(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS q_pledges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, city TEXT NOT NULL, country TEXT, lang TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS q_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, name TEXT, contact TEXT, city TEXT, message TEXT NOT NULL, lang TEXT,
  created_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_sessions (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
`);

  const r = express.Router();
  const now = () => Date.now();
  const clean = (s, n = 80) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");

  // Simple per-visitor limit so the counter cannot be pumped up by one person.
  const hits = new Map();
  function limited(req, key, max, windowMs) {
    const k = key + ":" + (req.ip || "");
    const t = now(), list = (hits.get(k) || []).filter(x => t - x < windowMs);
    list.push(t); hits.set(k, list);
    return list.length > max;
  }
  setInterval(() => { const t = now(); for (const [k, v] of hits) if (!v.some(x => t - x < 24 * 3600_000)) hits.delete(k); }, 3600_000).unref();

  const pledgeCount = () => db.prepare("SELECT COUNT(*) AS n FROM q_pledges").get().n;
  const recent = () => db.prepare("SELECT city, country FROM q_pledges ORDER BY id DESC LIMIT 8").all();

  r.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  r.get("/api/pledge", (req, res) => res.json({ count: pledgeCount(), recent: recent() }));

  r.post("/api/pledge", (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ count: pledgeCount(), recent: recent() }); // spam bot filled the hidden field
    const city = clean(b.city, 60);
    if (!city) return bad(res, "city");
    if (limited(req, "pledge", 5, 3600_000)) return bad(res, "Too many pledges from this connection. Please try later.", 429);
    db.prepare("INSERT INTO q_pledges(name, city, country, lang, created_at) VALUES(?,?,?,?,?)")
      .run(clean(b.name, 60) || null, city, clean(b.country, 60) || null, clean(b.lang, 5) || null, now());
    res.json({ count: pledgeCount(), recent: recent() });
  });

  r.post("/api/contact", (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    const message = clean(b.message, 2000);
    if (!message) return bad(res, "message");
    if (limited(req, "contact", 5, 3600_000)) return bad(res, "Too many messages from this connection. Please try later.", 429);
    db.prepare("INSERT INTO q_messages(kind, name, contact, city, message, lang, created_at) VALUES(?,?,?,?,?,?,?)")
      .run(KINDS.has(b.kind) ? b.kind : "other", clean(b.name, 80) || null, clean(b.contact, 120) || null, clean(b.city, 60) || null, message, clean(b.lang, 5) || null, now());
    res.json({ ok: true });
  });

  // ---------- owner page (same owner password as the myrightmyride owner panel) ----------
  r.post("/api/admin/login", (req, res) => {
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw || pw.length < 8) return bad(res, "The owner password is not set on the server.", 503);
    if (limited(req, "login", 10, 15 * 60_000)) return bad(res, "Too many tries. Wait 15 minutes.", 429);
    const given = Buffer.from(sha(String((req.body || {}).password || ""))), want = Buffer.from(sha(pw));
    if (!crypto.timingSafeEqual(given, want)) return bad(res, "Wrong password.", 401);
    const t = crypto.randomBytes(24).toString("hex");
    db.prepare("INSERT INTO admin_sessions(token, created_at) VALUES(?,?)").run(t, now());
    res.json({ token: t });
  });
  function owner(req, res, next) {
    const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const row = t && db.prepare("SELECT created_at FROM admin_sessions WHERE token = ?").get(t);
    if (!row || now() - row.created_at > 7 * 24 * 3600_000) return bad(res, "Please log in again.", 401);
    next();
  }
  r.get("/api/admin/summary", owner, (req, res) => {
    const day = now() - 24 * 3600_000;
    res.json({
      pledges: pledgeCount(),
      pledgesToday: db.prepare("SELECT COUNT(*) AS n FROM q_pledges WHERE created_at > ?").get(day).n,
      openMessages: db.prepare("SELECT COUNT(*) AS n FROM q_messages WHERE done = 0").get().n,
      topCities: db.prepare("SELECT city, country, COUNT(*) AS n FROM q_pledges GROUP BY lower(city), lower(ifnull(country,'')) ORDER BY n DESC LIMIT 15").all(),
      latestPledges: db.prepare("SELECT * FROM q_pledges ORDER BY id DESC LIMIT 100").all(),
      messages: db.prepare("SELECT * FROM q_messages ORDER BY done, id DESC LIMIT 200").all(),
    });
  });
  r.post("/api/admin/messages/:id/done", owner, (req, res) => {
    db.prepare("UPDATE q_messages SET done = ? WHERE id = ?").run((req.body || {}).done === false ? 0 : 1, Number(req.params.id));
    res.json({ ok: true });
  });
  r.get("/api/admin/export/:what", owner, (req, res) => {
    const table = req.params.what === "messages" ? "q_messages" : "q_pledges";
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    const cols = rows[0] ? Object.keys(rows[0]) : ["id"];
    const cell = v => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = [cols.join(","), ...rows.map(row => cols.map(c => c === "created_at" ? cell(new Date(row[c]).toISOString()) : cell(row[c])).join(","))].join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="qindiaglobal-${req.params.what === "messages" ? "messages" : "pledges"}.csv"`).send("﻿" + csv);
  });
  r.use("/api", (req, res) => bad(res, "Not found.", 404));

  // ---------- the website ----------
  r.use((req, res, next) => {
    if (/\.(png|svg|ico|webp|jpg)$/.test(req.path)) res.set("Cache-Control", "public, max-age=86400");
    else res.set("Cache-Control", "no-cache");
    next();
  });
  r.use(express.static(DIR, { index: "index.html", extensions: ["html"] }));
  r.use((req, res) => res.sendFile(path.join(DIR, "index.html")));
  return r;
};

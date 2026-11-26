// qindiaglobal.com Careers: people apply to help the initiative (volunteer, Q India Reporter, …) at /careers.
// All roles are unpaid and voluntary. Applications are listed for the owner on /admin-team, with Excel (CSV) download.
const crypto = require("crypto");
const express = require("express");

const ROLES = {
  volunteer: "Queue Volunteer",
  reporter: "Q India Reporter",
  campus: "Campus Ambassador",
  translator: "Language Volunteer (translator)",
  poster: "Poster Champion",
  social: "Social Media Volunteer",
};
const STATUSES = new Set(["new", "contacted", "accepted", "declined"]);

module.exports = function team(db, { human, isBad }) {
  db.exec(`CREATE TABLE IF NOT EXISTS q_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
  city TEXT, country TEXT, languages TEXT, about TEXT, hours TEXT, status TEXT NOT NULL DEFAULT 'new', note TEXT,
  ip_hash TEXT, created_at INTEGER NOT NULL)`);
  const secret = (db.prepare("SELECT v FROM q_kv WHERE k = 'secret'").get() || {}).v || "";
  const r = express.Router();
  const now = () => Date.now();
  const clean = (s, n = 80) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const ipHash = req => crypto.createHmac("sha256", secret).update(String(req.ip || "")).digest("hex").slice(0, 24);
  const hits = new Map();
  setInterval(() => hits.clear(), 3600_000).unref();

  r.post("/api/careers/apply", (req, res) => {
    res.set("Cache-Control", "no-store");
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    const role = ROLES[b.role] ? b.role : null;
    const name = clean(b.name, 80), contact = clean(b.contact, 120), city = clean(b.city, 60);
    if (!role) return bad(res, "Please choose a role.");
    if (!name || !contact || !city) return bad(res, "Please give your name, city and email or phone.");
    if (!(b.adult === true || b.adult === "on")) return bad(res, "You must be 18 or older to apply. Younger supporters can take the pledge and share it.");
    if (!(b.agree === true || b.agree === "on")) return bad(res, "Please tick the box to agree.");
    const about = clean(b.about, 1500);
    if ([name, city, about, b.languages].some(x => isBad(x, false))) return bad(res, "Please remove rude or unsuitable words.");
    if (human.verify(b.human, b.n)) return bad(res, "Please wait a few seconds and try again.", 403);
    const h = ipHash(req);
    if (db.prepare("SELECT 1 FROM q_bans WHERE ip_hash = ?").get(h)) return bad(res, "Not allowed.", 403);
    const n = (hits.get(h) || 0) + 1; hits.set(h, n);
    if (n > 5) return bad(res, "Too many applications from this connection. Please try later.", 429);
    db.prepare("INSERT INTO q_applications(role, name, contact, city, country, languages, about, hours, ip_hash, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(role, name, contact, city, clean(b.country, 60) || null, clean(b.languages, 120) || null, about || null, clean(b.hours, 40) || null, h, now());
    res.json({ ok: true });
  });

  function owner(req, res, next) {
    const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const row = t && db.prepare("SELECT created_at FROM admin_sessions WHERE token = ?").get(t);
    if (!row || now() - row.created_at > 7 * 24 * 3600_000) return bad(res, "Please log in again.", 401);
    res.set("Cache-Control", "no-store");
    next();
  }
  r.get("/api/admin/team", owner, (req, res) => {
    res.json({
      roles: ROLES,
      items: db.prepare("SELECT id, role, name, contact, city, country, languages, about, hours, status, note, created_at FROM q_applications ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, id DESC LIMIT 3000").all(),
      byRole: db.prepare("SELECT role, COUNT(*) AS n FROM q_applications GROUP BY role").all(),
    });
  });
  r.post("/api/admin/team/:id", owner, (req, res) => {
    const id = Number(req.params.id), b = req.body || {};
    if (!db.prepare("SELECT 1 FROM q_applications WHERE id = ?").get(id)) return bad(res, "Not found.", 404);
    if (b.action === "delete") { db.prepare("DELETE FROM q_applications WHERE id = ?").run(id); return res.json({ ok: true }); }
    if (b.status != null && !STATUSES.has(b.status)) return bad(res, "Unknown status.");
    if (b.status != null) db.prepare("UPDATE q_applications SET status = ? WHERE id = ?").run(b.status, id);
    if (b.note != null) db.prepare("UPDATE q_applications SET note = ? WHERE id = ?").run(clean(b.note, 1000) || null, id);
    res.json({ ok: true });
  });
  r.get("/api/admin/team.csv", owner, (req, res) => {
    const rows = db.prepare("SELECT id, created_at, role, status, name, contact, city, country, languages, hours, about, note FROM q_applications ORDER BY id").all();
    const cols = ["id", "created_at", "role", "status", "name", "contact", "city", "country", "languages", "hours", "about", "note"];
    const cell = v => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = [cols.join(","), ...rows.map(x => cols.map(c => cell(c === "created_at" ? new Date(x[c]).toISOString() : c === "role" ? ROLES[x.role] || x.role : x[c])).join(","))].join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="qindiaglobal-applications.csv"').send("﻿" + csv);
  });
  return r;
};
module.exports.ROLES = ROLES;

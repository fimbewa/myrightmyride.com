// Legal compliance helpers for qindiaglobal.com (see sites/qindiaglobal/legal/):
// - the Grievance Officer / privacy contact details that the owner fills in on /admin and the policy pages show
//   (IT Intermediary Rules 2021, rule 3(2); DPDP Rules 2025, rule 9);
// - the complaint form on /legal/grievance, which gives every complaint a number at once (acknowledgement);
// - a 180-day "legal hold": registration details of deleted accounts and content the owner removes are kept,
//   out of public view, for 180 days and then erased (IT Intermediary Rules 2021, rule 3(1)(g) and 3(1)(h)).
const fs = require("fs");
const path = require("path");
const express = require("express");
const { isBad } = require("./qindia-safety");

const HOLD_DAYS = 180;
const CONTACT_FIELDS = ["officer", "designation", "email", "phone", "address", "hours", "dpo", "city"];
// Given by the owner on 26 Nov 2026; the owner can change them on /admin (saved values win).
const DEFAULT_CONTACT = { officer: "Adv. Vijay Gulab Badgujar", designation: "Grievance Officer", email: "vijaybadgujar999@gmail.com", address: "Ambernath, Thane District, Maharashtra, India", city: "Mumbai" };
const COMPLAINT_KINDS = { grievance: "Complaint about content or a member", privacy: "Personal data request", copyright: "Copyright or trade mark", appeal: "Appeal against removal or suspension", nci: "Intimate image or impersonation (urgent)" };

const clean = (s, n = 80) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);

// Shared by the Community code: keep removed things for 180 days, then erase them.
function legalHold(db, mediaDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS q_legal_hold (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref_id INTEGER, data TEXT NOT NULL, photo TEXT,
  reason TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
  const HOLD = mediaDir ? path.join(mediaDir, "legal-hold") : null; // not served by /media/:name
  if (HOLD) fs.mkdirSync(HOLD, { recursive: true });
  function keep(kind, refId, data, { photo = null, reason = null } = {}) {
    let kept = null;
    if (photo && HOLD && /^[a-f0-9]{32}\.jpg$/.test(photo)) {
      try { fs.renameSync(path.join(mediaDir, photo), path.join(HOLD, photo)); kept = photo; } catch {}
    }
    const t = Date.now();
    db.prepare("INSERT INTO q_legal_hold(kind, ref_id, data, photo, reason, created_at, expires_at) VALUES(?,?,?,?,?,?,?)")
      .run(kind, refId ?? null, JSON.stringify(data || {}), kept, reason, t, t + HOLD_DAYS * 24 * 3600_000);
    return kept; // the caller must not delete a photo that was moved into the hold
  }
  function purge() {
    for (const h of db.prepare("SELECT id, photo FROM q_legal_hold WHERE expires_at < ?").all(Date.now())) {
      if (h.photo && HOLD) fs.rm(path.join(HOLD, h.photo), () => {});
      db.prepare("DELETE FROM q_legal_hold WHERE id = ?").run(h.id);
    }
  }
  purge();
  setInterval(purge, 6 * 3600_000).unref();
  return { keep, purge };
}

function router(db, { owner, human, ipHash, banned, limited }) {
  const r = express.Router();
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const saved = () => { try { return JSON.parse((db.prepare("SELECT v FROM q_kv WHERE k = 'legal_contact'").get() || {}).v || "{}"); } catch { return {}; } };
  const getContact = () => ({ ...DEFAULT_CONTACT, ...saved() });

  r.get("/api/legal-contact", (req, res) => res.json(getContact()));
  r.get("/api/admin/legal", owner, (req, res) => res.json({
    contact: getContact(),
    hold: db.prepare("SELECT kind, COUNT(*) AS n FROM q_legal_hold GROUP BY kind").all(),
  }));
  r.post("/api/admin/legal", owner, (req, res) => {
    const b = req.body || {}, c = {};
    for (const f of CONTACT_FIELDS) { const v = clean(b[f], f === "address" ? 300 : 120); if (v && v !== DEFAULT_CONTACT[f]) c[f] = v; }
    if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return bad(res, "Please check the email address.");
    db.prepare("INSERT INTO q_kv(k, v) VALUES('legal_contact', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(c));
    res.json({ ok: true, contact: getContact() });
  });

  // Complaint form: saved with the owner's messages; the number shown at once is the acknowledgement.
  r.post("/api/grievance", (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true, number: "Q-0" });
    const kind = Object.hasOwn(COMPLAINT_KINDS, b.kind) ? b.kind : "grievance";
    const name = clean(b.name, 80), contact = clean(b.contact, 120), link = clean(b.link, 300), details = clean(b.details, 4000);
    if (!name) return bad(res, "Please write your name.");
    if (!contact) return bad(res, "Please give an email or phone number so that we can reply.");
    if (details.length < 10) return bad(res, "Please describe the problem.");
    if (b.agree !== true && b.agree !== "on") return bad(res, "Please tick the box to confirm that the details are true.");
    if (isBad(details, false)) return bad(res, "Please remove rude words; quote them as \"[abuse]\" and give the link instead.");
    if (human.verify(b.human, b.n)) return bad(res, "Please try again (human check).", 403);
    const h = ipHash(req);
    if (banned(h)) return bad(res, "Sending is blocked from this connection.", 403);
    if (limited(req, "grievance", 5, 3600_000)) return bad(res, "Too many complaints from this connection. Please try later.", 429);
    const message = [COMPLAINT_KINDS[kind], link && "Link: " + link, details].filter(Boolean).join("\n");
    const id = db.prepare("INSERT INTO q_messages(kind, name, contact, city, message, lang, ip_hash, created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(kind, name, contact, clean(b.city, 60) || null, message, "en", h, Date.now()).lastInsertRowid;
    res.json({ ok: true, number: "Q-" + id, kind });
  });

  // Old single page of terms -> the new policy pages (the browser keeps #privacy etc.; /legal/terms forwards it).
  r.get(["/terms", "/terms.html", "/privacy", "/privacy.html"], (req, res) => res.redirect(301, req.path.startsWith("/privacy") ? "/legal/privacy" : "/legal/terms"));
  r.get(["/legal", "/legal/"], (req, res) => res.sendFile(path.join(__dirname, "..", "sites", "qindiaglobal", "legal", "index.html")));
  return r;
}

module.exports = { legalHold, router, COMPLAINT_KINDS, HOLD_DAYS };

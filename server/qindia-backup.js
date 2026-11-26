// Owner's "Download full backup" (qindiaglobal.com/admin): one .zip file with all the website's data, so the owner
// can keep a copy of their own, besides the daily backups on the server and Hostinger's weekly backup.
//
// The zip holds:
//   qindiaglobal-database.db  the whole database (a copy made safely while the site runs). Used to restore everything.
//   tables/<name>.csv         every table as a spreadsheet that opens in Excel (passwords and secret codes left out).
//   media/...                 the Community photos (optional: the owner can leave them out to keep the file small).
//   READ-ME.txt               what is inside, and how to restore it.
// Login sessions and one-time codes are emptied in the copy, so a lost backup cannot be used to log in as anyone.
// Passwords are only ever stored as one-way scrambled codes (hashes), and stay that way in the backup.
//
// Owner only. A download needs the owner to be logged in, uses a one-time link that works for 2 minutes,
// is limited to 6 per hour, and every download is written in a log the owner sees on the owner page.
//
// No "restore" button on purpose: replacing the live database from an uploaded file would erase everything
// people added since the backup, and a wrong or damaged file would take the whole site down.
// READ-ME.txt explains how a technical helper can restore it on the server if it is ever needed.
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const express = require("express");
const Database = require("better-sqlite3");

const TICKET_MS = 2 * 60_000;
const ZIP_LIMIT = 0xfffffff0; // plain zip files hold up to 4 GB
// Tables that only hold logins and one-time codes: copied empty.
const SECRET_TABLES = /^(sessions|admin_sessions|s_sessions|otps|owner_resets)$|_sessions$|_tokens$/;
// Left out of the spreadsheets (still in the database copy, as hashes, so a restore keeps everyone's login working).
const HIDDEN_COLS = /pass|salt|recover|secret|token/i;
const HIDDEN_CSV_TABLES = new Set(["owner_password", "q_kv", "q_backup_log", "sqlite_sequence"]);

// ---------- a small zip writer (no extra packages) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
// Writes entries one after another to a stream, waiting when the connection is slow.
function zipWriter(out) {
  const entries = [];
  let offset = 0;
  const write = buf => new Promise((resolve, reject) => {
    if (out.destroyed) return reject(new Error("closed"));
    offset += buf.length;
    if (out.write(buf)) resolve();
    else { const done = () => { out.off("close", fail); resolve(); }; const fail = () => { out.off("drain", done); reject(new Error("closed")); }; out.once("drain", done); out.once("close", fail); }
  });
  return {
    get size() { return offset; },
    async add(name, data, { compress = true, mtime = new Date() } = {}) {
      const nameBuf = Buffer.from(name, "utf8");
      const crc = crc32(data);
      let body = data, method = 0;
      if (compress && data.length > 64) { const z = zlib.deflateRawSync(data, { level: 6 }); if (z.length < data.length) { body = z; method = 8; } }
      if (offset + body.length + 200 > ZIP_LIMIT) throw new Error("too big");
      const { time, date } = dosTime(mtime);
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
      h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14);
      h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
      entries.push({ nameBuf, crc, method, time, date, csize: body.length, size: data.length, offset });
      await write(Buffer.concat([h, nameBuf]));
      await write(body);
    },
    async finish() {
      const start = offset, parts = [];
      for (const e of entries) {
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(e.method, 10);
        c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.size, 24);
        c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE(e.offset, 42);
        parts.push(c, e.nameBuf);
      }
      const dir = Buffer.concat(parts);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(start, 16);
      await write(dir); await write(end);
      return entries.length;
    },
  };
}

// All photo files under the media folder (including photos kept on legal hold), as paths relative to it.
function listMedia(dir) {
  const out = [];
  const walk = rel => {
    let items = [];
    try { items = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const r = rel ? rel + "/" + it.name : it.name;
      if (it.isDirectory()) walk(r);
      else if (it.isFile()) { try { const st = fs.statSync(path.join(dir, r)); out.push({ rel: r, bytes: st.size, mtime: st.mtime }); } catch {} }
    }
  };
  walk("");
  return out;
}

function toCsv(rows) {
  const cols = rows[0] ? Object.keys(rows[0]).filter(c => !HIDDEN_COLS.test(c)) : [];
  const cell = (c, v) => {
    if (v == null) return '""';
    if (Buffer.isBuffer(v)) v = "(binary " + v.length + " bytes)";
    else if (/(_at|_until)$/.test(c) && typeof v === "number" && v > 1e11) v = new Date(v).toISOString();
    let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; // stop Excel from running formulas
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return "﻿" + [cols.join(","), ...rows.map(r => cols.map(c => cell(c, r[c])).join(","))].join("\r\n");
}

const README = (when, photos, counts) => `QINDIAGLOBAL.COM - FULL BACKUP
Made: ${when} (Indian time)
Photos included: ${photos ? "yes" : "no"}

KEEP THIS FILE SAFE AND PRIVATE.
It holds personal data of the people who use qindiaglobal.com (names, email/phone given with consent, messages,
Community accounts, posts, private messages and photos). Under the Digital Personal Data Protection Act, 2023 you
must protect it. Keep it on your own computer, a pen drive or your own cloud storage with a strong password.
Do not email it, share it, or upload it anywhere public.
Delete backup files older than 30 days (the Privacy Policy promises that deleted items leave our backups
within 30 days). Keep only your newest few.

WHAT IS INSIDE
- qindiaglobal-database.db : the complete database. This is what is used to restore the website.
- tables/*.csv             : each table as a spreadsheet; open in Excel or Google Sheets to read it.
                             Passwords and secret codes are left out of these spreadsheets.
- media/                   : Community photos${photos ? "" : " (not included in this backup)"}.

Passwords are stored only as one-way scrambled codes (hashes); nobody can read them, not even you.
Login sessions and one-time codes are emptied in this copy, so it cannot be used to log in as anyone.

Number of records:
${counts.map(([t, n]) => "  " + t.padEnd(22) + n).join("\n")}

HOW TO RESTORE (only if the website's data is lost; ask a technical helper)
1. Stop the "app" container of the "qindiaglobal" project in Hostinger Docker Manager.
2. In the app's data folder (/data inside the container), rename myrightmyride.db to myrightmyride-old.db
   and delete myrightmyride.db-wal and myrightmyride.db-shm if they are there.
3. Copy qindiaglobal-database.db there and name it myrightmyride.db.
4. Copy the files in media/ into /data/media/ (keep the legal-hold folder as it is).
5. Start the app container again. Everyone will need to log in again; nothing else changes.
`;

module.exports = function backup(db, { owner, ipHash, limited }) {
  const MEDIA = process.env.MEDIA_DIR || path.join(path.dirname(db.name), "media");
  db.exec(`CREATE TABLE IF NOT EXISTS q_backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, photos INTEGER NOT NULL,
  bytes INTEGER, files INTEGER, ok INTEGER NOT NULL DEFAULT 0, ip_hash TEXT, note TEXT)`);
  const tickets = new Map(); // one-time download links: code -> { photos, until }
  let busy = false;
  const r = express.Router();
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

  r.get("/api/admin/backup", owner, (req, res) => {
    const media = listMedia(MEDIA);
    let dbBytes = 0; try { dbBytes = fs.statSync(db.name).size; } catch {}
    res.json({
      photos: media.length, photoMB: Math.round(media.reduce((s, m) => s + m.bytes, 0) / 1048576), dbMB: Math.round(dbBytes / 1048576),
      log: db.prepare("SELECT id, created_at, photos, bytes, files, ok, note FROM q_backup_log ORDER BY id DESC LIMIT 10").all(),
    });
  });

  // Step 1: the owner page asks for a one-time link (needs the owner login). Step 2: the browser opens it and
  // downloads the file itself, so even a big file goes straight to the phone or computer's Downloads.
  r.post("/api/admin/backup/start", owner, (req, res) => {
    if (limited(req, "backup", 6, 3600_000)) return bad(res, "Too many backups in one hour. Please try again later.", 429);
    const code = crypto.randomBytes(24).toString("hex");
    tickets.set(code, { photos: (req.body || {}).photos !== false, until: Date.now() + TICKET_MS });
    for (const [k, v] of tickets) if (v.until < Date.now()) tickets.delete(k);
    res.json({ url: "/api/admin/backup/download?t=" + code });
  });

  r.get("/api/admin/backup/download", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const code = String(req.query.t || ""), ticket = tickets.get(code);
    tickets.delete(code);
    if (!ticket || ticket.until < Date.now()) return res.status(410).type("text").send("This download link has expired. Go back to the owner page and press the button again.");
    if (busy) return res.status(429).type("text").send("A backup is already being made. Please wait a minute and try again.");
    busy = true;
    const logId = db.prepare("INSERT INTO q_backup_log(created_at, photos, ip_hash) VALUES(?,?,?)").run(Date.now(), ticket.photos ? 1 : 0, ipHash(req)).lastInsertRowid;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qi-backup-"));
    let started = false;
    try {
      // 1. A consistent copy of the live database, with logins and one-time codes emptied.
      const copyFile = path.join(tmp, "copy.db");
      await db.backup(copyFile);
      const copy = new Database(copyFile);
      const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
      for (const t of tables) if (SECRET_TABLES.test(t)) copy.prepare(`DELETE FROM "${t}"`).run();
      copy.exec("VACUUM");
      const csvs = [], counts = [];
      for (const t of tables) {
        const n = copy.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
        if (SECRET_TABLES.test(t) || HIDDEN_CSV_TABLES.has(t)) continue;
        counts.push([t, n]);
        csvs.push([t, Buffer.from(toCsv(copy.prepare(`SELECT * FROM "${t}"`).all()), "utf8")]);
      }
      copy.close();
      const dbBuf = fs.readFileSync(copyFile);
      const media = ticket.photos ? listMedia(MEDIA) : [];
      const estimate = dbBuf.length + csvs.reduce((s, [, b]) => s + b.length, 0) + media.reduce((s, m) => s + m.bytes + 120, 0);
      if (estimate > ZIP_LIMIT) {
        db.prepare("UPDATE q_backup_log SET note = ? WHERE id = ?").run("too big with photos", logId);
        return res.status(413).type("text").send("With photos the backup would be bigger than 4 GB. Go back and choose \"Download backup without photos\".");
      }
      // 2. Send the zip.
      const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
      res.set("Content-Type", "application/zip").set("Content-Disposition", `attachment; filename="qindiaglobal-backup-${stamp}${ticket.photos ? "" : "-no-photos"}.zip"`);
      started = true;
      const zip = zipWriter(res);
      const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" });
      await zip.add("READ-ME.txt", Buffer.from(README(when, ticket.photos, counts).replace(/\n/g, "\r\n"), "utf8"));
      await zip.add("qindiaglobal-database.db", dbBuf);
      for (const [t, buf] of csvs) await zip.add("tables/" + t + ".csv", buf);
      for (const m of media) {
        let data; try { data = fs.readFileSync(path.join(MEDIA, m.rel)); } catch { continue; } // a photo deleted a moment ago
        await zip.add("media/" + m.rel, data, { compress: false, mtime: m.mtime });
      }
      const files = await zip.finish();
      res.end();
      db.prepare("UPDATE q_backup_log SET ok = 1, bytes = ?, files = ? WHERE id = ?").run(zip.size, files, logId);
      console.log(`Owner downloaded a full backup: ${files} files, ${Math.round(zip.size / 1048576)} MB${ticket.photos ? "" : " (no photos)"}.`);
    } catch (err) {
      db.prepare("UPDATE q_backup_log SET note = ? WHERE id = ?").run(err.message === "closed" ? "download stopped" : "failed: " + String(err.message).slice(0, 100), logId);
      if (err.message !== "closed") console.error("Backup failed:", err);
      if (!started) res.status(500).type("text").send("The backup could not be made. Please try again.");
      else res.destroy();
    } finally {
      busy = false;
      fs.rm(tmp, { recursive: true, force: true }, () => {});
    }
  });
  return r;
};
module.exports.crc32 = crc32;

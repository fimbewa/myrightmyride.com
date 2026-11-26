// qindiaglobal.com: the citizens' queue initiative. Serves its own website (sites/qindiaglobal) plus a small API
// for the pledge counter, the volunteer/contact form and the owner page (/admin.html on qindiaglobal.com).
// Only used for requests whose Host is the qindiaglobal domain, so myrightmyride.com is not affected.
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const ownerPassword = require("./owner-password");
const { humanCheck, isBad, isDoubtful } = require("./qindia-safety");

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
  // Added later: optional email/phone on pledges, kept only when the person ticks the consent box.
  const pledgeCols = db.prepare("PRAGMA table_info(q_pledges)").all().map(c => c.name);
  if (!pledgeCols.includes("contact")) db.exec("ALTER TABLE q_pledges ADD COLUMN contact TEXT");
  if (!pledgeCols.includes("consent")) db.exec("ALTER TABLE q_pledges ADD COLUMN consent INTEGER NOT NULL DEFAULT 0");
  // Added later: personal pledge page (slug), Pledge wall line (wall + wall_status: pending/ok/hidden), reports,
  // and a one-way hash of the internet address (ip_hash) so the owner can block an abuser without storing the address.
  for (const [c, type] of [["slug", "TEXT"], ["wall", "TEXT"], ["wall_status", "TEXT"], ["reports", "INTEGER NOT NULL DEFAULT 0"], ["ip_hash", "TEXT"]])
    if (!pledgeCols.includes(c)) db.exec(`ALTER TABLE q_pledges ADD COLUMN ${c} ${type}`);
  const msgCols = db.prepare("PRAGMA table_info(q_messages)").all().map(c => c.name);
  if (!msgCols.includes("ip_hash")) db.exec("ALTER TABLE q_messages ADD COLUMN ip_hash TEXT");
  db.exec(`
CREATE TABLE IF NOT EXISTS q_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS q_bans (ip_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
`);
  const newSlug = () => Array.from(crypto.randomBytes(8), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  for (const row of db.prepare("SELECT id FROM q_pledges WHERE slug IS NULL").all()) db.prepare("UPDATE q_pledges SET slug = ? WHERE id = ?").run(newSlug(), row.id);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS q_pledges_slug ON q_pledges(slug)");
  let secret = (db.prepare("SELECT v FROM q_kv WHERE k = 'secret'").get() || {}).v;
  if (!secret) { secret = crypto.randomBytes(32).toString("hex"); db.prepare("INSERT INTO q_kv(k, v) VALUES('secret', ?)").run(secret); }
  const human = humanCheck(secret);

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

  const ipHash = req => crypto.createHmac("sha256", secret).update(String(req.ip || "")).digest("hex").slice(0, 24);
  const banned = h => !!db.prepare("SELECT 1 FROM q_bans WHERE ip_hash = ?").get(h);
  const agreed = v => v === true || v === "on" || v === "1";
  // Public name: first word only, and none at all when it has a rude word.
  const publicName = n => (n && !isBad(n) ? String(n).split(" ")[0] : null);

  const pledgeCount = () => db.prepare("SELECT COUNT(*) AS n FROM q_pledges").get().n;
  const recent = () => db.prepare("SELECT city, country FROM q_pledges ORDER BY id DESC LIMIT 8").all();

  r.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  r.get("/api/pledge", (req, res) => res.json({ count: pledgeCount(), recent: recent() }));

  // A fresh "only humans" token for the next form the page sends.
  r.get("/api/human", (req, res) => res.json(human.issue()));

  r.post("/api/pledge", (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ count: pledgeCount(), recent: recent() }); // spam bot filled the hidden field
    const city = clean(b.city, 60);
    if (!city) return bad(res, "city");
    if (!agreed(b.agree)) return bad(res, "agree");
    const wall = clean(b.wall, 140);
    if (isBad(city) || isBad(b.country) || isBad(wall)) return bad(res, "bad");
    if (human.verify(b.human, b.n)) return bad(res, "human", 403);
    const h = ipHash(req);
    if (banned(h)) return bad(res, "banned", 403);
    if (limited(req, "pledge", 5, 3600_000)) return bad(res, "Too many pledges from this connection. Please try later.", 429);
    const consent = agreed(b.consent);
    const contact = consent ? clean(b.contact, 120) || null : null;
    const slug = newSlug();
    // Owner's rule: lines that pass the filters go on the wall at once; only doubtful ones wait for approval.
    // A sender who had a line hidden before, or reported, also waits.
    const flagged = !!db.prepare("SELECT 1 FROM q_pledges WHERE ip_hash = ? AND (wall_status = 'hidden' OR reports > 0) LIMIT 1").get(h);
    const wallStatus = !wall ? null : flagged || isDoubtful(wall) || isDoubtful(b.name) ? "pending" : "ok";
    db.prepare("INSERT INTO q_pledges(name, city, country, lang, contact, consent, slug, wall, wall_status, ip_hash, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(clean(b.name, 60) || null, city, clean(b.country, 60) || null, clean(b.lang, 5) || null, contact, contact ? 1 : 0, slug, wall || null, wallStatus, h, now());
    res.json({ count: pledgeCount(), recent: recent(), slug, wall: wallStatus });
  });

  r.post("/api/contact", (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    const message = clean(b.message, 2000);
    if (!message) return bad(res, "message");
    if (!agreed(b.agree)) return bad(res, "agree");
    if (isBad(message, false)) return bad(res, "bad");
    if (human.verify(b.human, b.n)) return bad(res, "human", 403);
    const h = ipHash(req);
    if (banned(h)) return bad(res, "banned", 403);
    if (limited(req, "contact", 5, 3600_000)) return bad(res, "Too many messages from this connection. Please try later.", 429);
    db.prepare("INSERT INTO q_messages(kind, name, contact, city, message, lang, ip_hash, created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(KINDS.has(b.kind) ? b.kind : "other", clean(b.name, 80) || null, clean(b.contact, 120) || null, clean(b.city, 60) || null, message, clean(b.lang, 5) || null, h, now());
    res.json({ ok: true });
  });

  // ---------- Pledge wall: only lines the owner approved ----------
  r.get("/api/wall", (req, res) => {
    const rows = db.prepare("SELECT id, name, city, country, wall, created_at FROM q_pledges WHERE wall_status = 'ok' ORDER BY id DESC LIMIT 60").all();
    res.json({ items: rows.map(x => ({ id: x.id, name: publicName(x.name), city: [x.city, x.country].filter(Boolean).join(", "), text: x.wall })) });
  });
  // Anyone can report a line. Three reports take it off the wall until the owner looks again.
  r.post("/api/wall/:id/report", (req, res) => {
    if (limited(req, "report", 20, 3600_000)) return bad(res, "Too many reports.", 429);
    const id = Number(req.params.id);
    db.prepare("UPDATE q_pledges SET reports = reports + 1 WHERE id = ? AND wall IS NOT NULL").run(id);
    db.prepare("UPDATE q_pledges SET wall_status = 'pending' WHERE id = ? AND wall_status = 'ok' AND reports >= 3").run(id);
    res.json({ ok: true });
  });

  // ---------- owner page (same owner password as the myrightmyride owner panel) ----------
  r.post("/api/admin/login", (req, res) => {
    if (limited(req, "login", 10, 15 * 60_000)) return bad(res, "Too many tries. Wait 15 minutes.", 429);
    const result = ownerPassword.checkOwner(String((req.body || {}).password || ""));
    if (result === "unset") return bad(res, "No owner password is set yet. Use \"Set a new password\" below.", 503);
    if (result !== "ok") return bad(res, "Wrong password.", 401);
    const t = crypto.randomBytes(24).toString("hex");
    db.prepare("INSERT INTO admin_sessions(token, created_at) VALUES(?,?)").run(t, now());
    res.json({ token: t });
  });

  // Password reset proven through GitHub: the page shows a one-time code; the owner creates a file named after it
  // in the GitHub repository (only people who can change the website can do that). The app downloads new code
  // from GitHub every few minutes, sees the file, and then lets that code set a new owner password.
  db.exec("CREATE TABLE IF NOT EXISTS owner_resets (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)");
  const REPO_WEB = String(process.env.REPO || "https://github.com/fimbewa/myrightmyride.com.git").replace(/\.git$/, "");
  const RESET_DIR = path.join(__dirname, "..", "owner-reset");
  const CODE_RX = /^QI-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
  r.post("/api/admin/reset/start", (req, res) => {
    if (limited(req, "reset", 6, 3600_000)) return bad(res, "Too many tries. Wait an hour.", 429);
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", pick = () => Array.from(crypto.randomBytes(4), b => abc[b % abc.length]).join("");
    const code = `QI-${pick()}-${pick()}-${pick()}`;
    db.prepare("INSERT INTO owner_resets(code, created_at) VALUES(?,?)").run(code, now());
    const branch = process.env.REPO_BRANCH || "main";
    res.json({ code, github: `${REPO_WEB}/new/${branch}?filename=${encodeURIComponent("owner-reset/" + code)}&value=${encodeURIComponent("Owner password reset for qindiaglobal.com")}` });
  });
  r.post("/api/admin/reset/finish", (req, res) => {
    const b = req.body || {}, code = String(b.code || "").toUpperCase().trim(), pw = String(b.password || "");
    if (!CODE_RX.test(code)) return bad(res, "That code is not valid.");
    const row = db.prepare("SELECT * FROM owner_resets WHERE code = ?").get(code);
    if (!row || row.used || now() - row.created_at > 24 * 3600_000) return bad(res, "This code has expired. Start again.", 410);
    if (!require("fs").existsSync(path.join(RESET_DIR, code))) return res.status(409).json({ error: "waiting", waiting: true });
    if (pw.length < 8) return bad(res, "The new password must be at least 8 characters.");
    ownerPassword.setOwnerPassword(pw);
    db.prepare("UPDATE owner_resets SET used = 1 WHERE code = ?").run(code);
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
      pledgesWeek: db.prepare("SELECT COUNT(*) AS n FROM q_pledges WHERE created_at > ?").get(now() - 7 * 24 * 3600_000).n,
      pledgesWithContact: db.prepare("SELECT COUNT(*) AS n FROM q_pledges WHERE contact IS NOT NULL").get().n,
      messagesTotal: db.prepare("SELECT COUNT(*) AS n FROM q_messages").get().n,
      byKind: db.prepare("SELECT kind, COUNT(*) AS n FROM q_messages GROUP BY kind").all(),
      cities: db.prepare("SELECT COUNT(DISTINCT lower(city)) AS n FROM q_pledges").get().n,
      countries: db.prepare("SELECT COUNT(DISTINCT lower(country)) AS n FROM q_pledges WHERE country IS NOT NULL").get().n,
      byLang: db.prepare("SELECT ifnull(lang,'') AS lang, COUNT(*) AS n FROM q_pledges GROUP BY lang ORDER BY n DESC").all(),
      topCities: db.prepare("SELECT city, country, COUNT(*) AS n FROM q_pledges GROUP BY lower(city), lower(ifnull(country,'')) ORDER BY n DESC LIMIT 15").all(),
      latestPledges: db.prepare("SELECT * FROM q_pledges ORDER BY id DESC LIMIT 2000").all(),
      messages: db.prepare("SELECT * FROM q_messages ORDER BY done, id DESC LIMIT 1000").all(),
      wallPending: db.prepare("SELECT COUNT(*) AS n FROM q_pledges WHERE wall_status = 'pending'").get().n,
      wall: db.prepare(`SELECT id, name, city, country, wall, wall_status, reports, ip_hash, created_at FROM q_pledges WHERE wall IS NOT NULL
        ORDER BY CASE wall_status WHEN 'pending' THEN 0 WHEN 'ok' THEN 1 ELSE 2 END, reports DESC, id DESC LIMIT 500`).all(),
      bans: db.prepare("SELECT COUNT(*) AS n FROM q_bans").get().n,
    });
  });
  r.post("/api/admin/messages/:id/done", owner, (req, res) => {
    db.prepare("UPDATE q_messages SET done = ? WHERE id = ?").run((req.body || {}).done === false ? 0 : 1, Number(req.params.id));
    res.json({ ok: true });
  });
  // Pledge wall: approve (ok, for doubtful lines), hide, delete the line, or block the sender from posting again.
  r.post("/api/admin/wall/:id", owner, (req, res) => {
    const id = Number(req.params.id), act = String((req.body || {}).action || "");
    const row = db.prepare("SELECT ip_hash FROM q_pledges WHERE id = ?").get(id);
    if (!row) return bad(res, "Not found.", 404);
    if (act === "ok") db.prepare("UPDATE q_pledges SET wall_status = 'ok', reports = 0 WHERE id = ?").run(id);
    else if (act === "hide") db.prepare("UPDATE q_pledges SET wall_status = 'hidden' WHERE id = ?").run(id);
    else if (act === "delete") db.prepare("UPDATE q_pledges SET wall = NULL, wall_status = NULL WHERE id = ?").run(id);
    else if (act === "ban") {
      if (row.ip_hash) {
        db.prepare("INSERT OR IGNORE INTO q_bans(ip_hash, created_at) VALUES(?,?)").run(row.ip_hash, now());
        db.prepare("UPDATE q_pledges SET wall_status = 'hidden' WHERE ip_hash = ? AND wall IS NOT NULL").run(row.ip_hash);
      } else db.prepare("UPDATE q_pledges SET wall_status = 'hidden' WHERE id = ?").run(id);
    } else return bad(res, "Unknown action.");
    res.json({ ok: true });
  });
  r.post("/api/admin/unban-all", owner, (req, res) => { db.exec("DELETE FROM q_bans"); res.json({ ok: true }); });
  r.get("/api/admin/export/:what", owner, (req, res) => {
    const table = req.params.what === "messages" ? "q_messages" : "q_pledges";
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    const cols = rows[0] ? Object.keys(rows[0]) : ["id"];
    const cell = v => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = [cols.join(","), ...rows.map(row => cols.map(c => c === "created_at" ? cell(new Date(row[c]).toISOString()) : cell(row[c])).join(","))].join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="qindiaglobal-${req.params.what === "messages" ? "messages" : "pledges"}.csv"`).send("﻿" + csv);
  });
  // ---------- owner blog posts (written on the owner page, shown at /blog/) ----------
  // The owner can write long posts: up to 250,000 characters of text. Visitors' forms keep their small limits.
  const POST_MAX = 250000, TITLE_MAX = 200;
  db.exec(`CREATE TABLE IF NOT EXISTS q_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, body TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  const chars = s => [...String(s ?? "")].length; // counts each letter/emoji once, like a person would
  const postText = s => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim();
  const postSlug = title => {
    let base = String(title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
    if (base.length < 3) base = "post";
    let slug = base, i = 2;
    const taken = x => !!db.prepare("SELECT 1 FROM q_posts WHERE slug = ?").get(x) || fs.existsSync(path.join(DIR, "blog", x + ".html")) || ["index", "img", "blog"].includes(x);
    while (taken(slug)) slug = base + "-" + i++;
    return slug;
  };
  function readPost(req, res) {
    const b = req.body || {}, title = clean(b.title, TITLE_MAX * 2), body = postText(b.body);
    if (!title) { bad(res, "Please write a title."); return null; }
    if (chars(title) > TITLE_MAX) { bad(res, `The title can be at most ${TITLE_MAX} characters.`); return null; }
    if (!body) { bad(res, "Please write the post."); return null; }
    if (chars(body) > POST_MAX) { bad(res, `The post is ${chars(body).toLocaleString("en-IN")} characters. The most allowed is 2,50,000.`, 413); return null; }
    return { title, body };
  }
  r.get("/api/admin/posts", owner, (req, res) => {
    res.json({ max: POST_MAX, posts: db.prepare("SELECT id, slug, title, body, created_at, updated_at FROM q_posts ORDER BY id DESC").all() });
  });
  r.post("/api/admin/posts", owner, (req, res) => {
    const p = readPost(req, res); if (!p) return;
    const slug = postSlug(p.title), t = now();
    db.prepare("INSERT INTO q_posts(slug, title, body, created_at, updated_at) VALUES(?,?,?,?,?)").run(slug, p.title, p.body, t, t);
    res.json({ ok: true, slug, url: "/blog/" + slug, chars: chars(p.body) });
  });
  r.post("/api/admin/posts/:id", owner, (req, res) => {
    const id = Number(req.params.id), row = db.prepare("SELECT slug FROM q_posts WHERE id = ?").get(id);
    if (!row) return bad(res, "Not found.", 404);
    if ((req.body || {}).action === "delete") { db.prepare("DELETE FROM q_posts WHERE id = ?").run(id); return res.json({ ok: true }); }
    const p = readPost(req, res); if (!p) return;
    db.prepare("UPDATE q_posts SET title = ?, body = ?, updated_at = ? WHERE id = ?").run(p.title, p.body, now(), id);
    res.json({ ok: true, slug: row.slug, url: "/blog/" + row.slug, chars: chars(p.body) });
  });
  // Q India Community: accounts, posts, feed, follow, private messages (server/qindia-social.js)
  r.use(require("./qindia-social")(db, { human, ipHash, banned, limited, owner }));
  r.get(["/community", "/community/"], (req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(DIR, "community.html")));
  r.use(require("./qindia-ads")(db, { human, isBad })); // advertising: own ads + optional Google AdSense
  r.use("/api", (req, res) => bad(res, "Not found.", 404));

  // ---------- the website ----------
  r.use((req, res, next) => {
    if (/\.(png|svg|ico|webp|jpg)$/.test(req.path)) res.set("Cache-Control", "public, max-age=86400");
    else res.set("Cache-Control", "no-cache");
    next();
  });
  // Personal pledge page: qindiaglobal.com/p/<code>. Not listed for search engines; only people given the link see it.
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let pageTpl = null;
  r.get("/p/:slug", (req, res, next) => {
    const row = /^[a-z0-9]{6,16}$/.test(req.params.slug) && db.prepare("SELECT * FROM q_pledges WHERE slug = ?").get(req.params.slug);
    if (!row) return next();
    if (!pageTpl) pageTpl = fs.readFileSync(path.join(DIR, "pledge-page.html"), "utf8");
    const name = row.name && !isBad(row.name) ? row.name : "";
    const vals = {
      SLUG: row.slug, NAME: name, NUM: String(row.id), LANG: row.lang || "en",
      PLACE: [row.city, row.country].filter(s => s && !isBad(s)).join(", "),
      DATE: new Date(row.created_at).toISOString().slice(0, 10),
      WALL: row.wall_status === "ok" ? row.wall : "",
      OGTITLE: (name ? name + " took" : "I took") + " the Qindiaglobal pledge: Queue up. Board with dignity.",
    };
    res.set("Cache-Control", "no-cache").type("html").send(pageTpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vals ? esc(vals[k]) : m)));
  });

  // Owner-written blog posts: the text is escaped, then simple marks become HTML:
  // a blank line starts a new paragraph, "# " / "## " start a heading, "- " starts a list item, web links become links.
  const linkify = t => t.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"&]/g, u => `<a href="${u}" target="_blank" rel="noopener nofollow ugc">${u}</a>`);
  function renderPost(body) {
    return esc(body).split(/\n{2,}/).map(block => {
      const lines = block.split("\n");
      if (lines.every(l => /^\s*[-*•] /.test(l))) return "<ul>" + lines.map(l => "<li>" + linkify(l.replace(/^\s*[-*•] /, "")) + "</li>").join("") + "</ul>";
      const out = []; let para = [];
      const flush = () => { if (para.length) out.push("<p>" + linkify(para.join("<br>")) + "</p>"); para = []; };
      for (const l of lines) {
        const h = /^(#{1,3}) +(.+)$/.exec(l);
        if (h) { flush(); out.push(h[1].length === 1 ? `<h2>${linkify(h[2])}</h2>` : `<h3>${linkify(h[2])}</h3>`); } else para.push(l);
      }
      flush(); return out.join("\n");
    }).join("\n");
  }
  const longDate = ms => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const summary = body => { const t = body.replace(/^(#+|\s*[-*•]) +/gm, "").replace(/\s+/g, " ").trim(); const c = [...t]; return c.length > 160 ? c.slice(0, 157).join("") + "…" : t; };
  let postTpl = null, blogIndex = null;
  r.get(["/blog", "/blog/", "/blog/index", "/blog/index.html"], (req, res, next) => {
    if (req.path === "/blog") return res.redirect(301, "/blog/");
    if (!blogIndex) blogIndex = fs.readFileSync(path.join(DIR, "blog", "index.html"), "utf8");
    const cards = db.prepare("SELECT slug, title, body, created_at FROM q_posts ORDER BY id DESC").all().map(p =>
      `<a class="pcard-link" href="/blog/${esc(p.slug)}"><div><h2>${esc(p.title)}</h2><p>${esc(summary(p.body))} ${esc(longDate(p.created_at))}.</p><span>Read the post →</span></div></a>`).join("\n    ");
    res.set("Cache-Control", "no-cache").type("html").send(blogIndex.replace("<!--OWNER_POSTS-->", cards));
  });
  r.get("/blog/:slug", (req, res, next) => {
    const row = /^[a-z0-9-]{3,80}$/.test(req.params.slug) && db.prepare("SELECT * FROM q_posts WHERE slug = ?").get(req.params.slug);
    if (!row) return next();
    if (!postTpl) postTpl = fs.readFileSync(path.join(DIR, "blog", "post-page.html"), "utf8");
    const words = String(row.body).split(/\s+/).filter(Boolean).length;
    const vals = { SLUG: row.slug, TITLE: row.title, DESC: summary(row.body), DATE: longDate(row.created_at), ISODATE: new Date(row.created_at).toISOString().slice(0, 10), MINUTES: String(Math.max(1, Math.round(words / 200))) };
    res.set("Cache-Control", "no-cache").type("html").send(postTpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k === "BODY" ? renderPost(row.body) : k in vals ? esc(vals[k]) : m)));
  });
  r.get(["/blog/post-page", "/blog/post-page.html"], (req, res) => res.redirect("/blog/")); // the template itself is not a page

  r.get(["/pledge-page", "/pledge-page.html"], (req, res) => res.redirect("/")); // the template itself is not a page
  r.use(express.static(DIR, { index: "index.html", extensions: ["html"] }));
  r.use((req, res) => res.sendFile(path.join(DIR, "index.html")));
  return r;
};

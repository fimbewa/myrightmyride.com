// Q India Community on qindiaglobal.com: user accounts, profiles, posts with photos, feed, likes, comments, follow,
// notifications and private 1-to-1 messages. Everything is free for everyone; there are no paid features.
// The owner moderates from /admin (reports, waiting posts, ban). All data is in the same SQLite database;
// photos are files in the data volume (MEDIA_DIR, default <database folder>/media), backed up with the volume.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { isBad, isDoubtful } = require("./qindia-safety");

const PAGE = 20;
const PHOTO_MAX = 3 * 1024 * 1024;        // 3 MB per photo after the phone shrinks it (usually 200-500 KB)
const MIN_FREE_DISK = 2 * 1024 ** 3;       // stop taking photos when less than 2 GB is free on the server
const TEXT_MAX = 5000, COMMENT_MAX = 1000, MESSAGE_MAX = 2000, BIO_MAX = 300;
const USERNAME_RX = /^[a-z0-9_.]{3,20}$/;
const RESERVED = new Set(["admin", "owner", "qindia", "qindiaglobal", "support", "help", "official", "moderator", "root", "system", "api", "media", "me", "login", "signup", "community", "blog", "terms", "privacy", "everyone", "null", "undefined"]);

module.exports = function social(db, { human, ipHash, banned, limited, owner }) {
  db.exec(`
CREATE TABLE IF NOT EXISTS s_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, bio TEXT, city TEXT, avatar TEXT,
  pass_salt TEXT NOT NULL, pass_hash TEXT NOT NULL, rec_salt TEXT NOT NULL, rec_hash TEXT NOT NULL,
  dm TEXT NOT NULL DEFAULT 'everyone',          -- who can message me: everyone | following
  status TEXT NOT NULL DEFAULT 'ok',            -- ok | banned
  ip_hash TEXT, reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS s_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS s_media (name TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, bytes INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS s_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  text TEXT, photo TEXT, status TEXT NOT NULL DEFAULT 'ok',   -- ok | pending (waits for owner) | hidden
  likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS s_posts_user ON s_posts(user_id, id);
CREATE INDEX IF NOT EXISTS s_posts_status ON s_posts(status, id);
CREATE TABLE IF NOT EXISTS s_likes (post_id INTEGER NOT NULL REFERENCES s_posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS s_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES s_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok', reports INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS s_comments_post ON s_comments(post_id, id);
CREATE TABLE IF NOT EXISTS s_follows (follower_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, followee_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (follower_id, followee_id));
CREATE INDEX IF NOT EXISTS s_follows_followee ON s_follows(followee_id);
CREATE TABLE IF NOT EXISTS s_blocks (blocker_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, blocked_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE IF NOT EXISTS s_notifs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, post_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS s_notifs_user ON s_notifs(user_id, id);
CREATE TABLE IF NOT EXISTS s_convos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, a_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, b_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  last_at INTEGER NOT NULL, a_read INTEGER NOT NULL DEFAULT 0, b_read INTEGER NOT NULL DEFAULT 0, UNIQUE (a_id, b_id)
);
CREATE TABLE IF NOT EXISTS s_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, convo_id INTEGER NOT NULL REFERENCES s_convos(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, text TEXT, photo TEXT,
  reported INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS s_messages_convo ON s_messages(convo_id, id);
CREATE TABLE IF NOT EXISTS s_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, target_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  reason TEXT, done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE (kind, target_id, reporter_id)
);
CREATE TABLE IF NOT EXISTS s_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
  // Added later: who invited this member (referral link qindiaglobal.com/community?ref=<username>).
  if (!db.prepare("PRAGMA table_info(s_users)").all().some(c => c.name === "ref_by")) db.exec("ALTER TABLE s_users ADD COLUMN ref_by INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS s_users_ref ON s_users(ref_by)");
  const MEDIA = process.env.MEDIA_DIR || path.join(path.dirname(db.name), "media");
  fs.mkdirSync(MEDIA, { recursive: true });
  // IT Intermediary Rules 2021, rule 3(1)(g)/(h): what the owner removes, and the sign-up details of closed
  // accounts, are kept out of sight for 180 days (for complaints and lawful requests), then erased.
  const hold = require("./qindia-legal").legalHold(db, MEDIA);
  // IT Intermediary Rules 2021, rule 3(1)(c): remind every member of the rules at least once every three months
  // and whenever the rules change. RULES_DATE is the "last updated" date of /legal/terms.
  if (!db.prepare("PRAGMA table_info(s_users)").all().some(c => c.name === "rules_seen")) db.exec("ALTER TABLE s_users ADD COLUMN rules_seen INTEGER");
  const RULES_DATE = Date.UTC(2026, 10, 26), REMIND_MS = 90 * 24 * 3600_000;
  const rulesDue = u => !u.rules_seen || u.rules_seen < RULES_DATE || Date.now() - u.rules_seen > REMIND_MS;

  const r = express.Router();
  const now = () => Date.now();
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
  const scrypt = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString("hex");
  const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const line = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const para = (s, n) => [...String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{4,}/g, "\n\n\n").trim()].slice(0, n).join("");
  const setting = (k, dflt) => { const row = db.prepare("SELECT v FROM s_settings WHERE k = ?").get(k); return row ? JSON.parse(row.v) : dflt; };
  const photoApproval = () => setting("photoApproval", true);

  // ---------- accounts ----------
  const recoveryCode = () => { const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: 4 }, () => Array.from(crypto.randomBytes(4), b => abc[b % abc.length]).join("")).join("-"); };
  const normRec = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function newSession(userId) {
    const t = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO s_sessions(token_hash, user_id, created_at, used_at) VALUES(?,?,?,?)").run(sha(t), userId, now(), now());
    return t;
  }
  function who(req) {
    const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!/^[a-f0-9]{64}$/.test(t)) return null;
    const row = db.prepare("SELECT s.used_at, u.* FROM s_sessions s JOIN s_users u ON u.id = s.user_id WHERE s.token_hash = ?").get(sha(t));
    if (!row || now() - row.used_at > 180 * 24 * 3600_000) return null;
    if (now() - row.used_at > 600_000) { db.prepare("UPDATE s_sessions SET used_at = ? WHERE token_hash = ?").run(now(), sha(t)); db.prepare("UPDATE s_users SET last_seen = ? WHERE id = ?").run(now(), row.id); }
    row.tokenHash = sha(t);
    return row;
  }
  const optional = (req, res, next) => { req.me = who(req); next(); };
  function login(req, res, next) {
    const me = who(req);
    if (!me) return bad(res, "Please log in.", 401);
    if (me.status === "banned") return bad(res, "This account has been stopped by the site owner for breaking the rules.", 403);
    req.me = me; next();
  }
  const avatarUrl = a => (a ? "/media/" + a : null);
  const pubUser = u => ({ username: u.username, name: u.name, avatar: avatarUrl(u.avatar) });
  const blockedEither = (a, b) => !!db.prepare("SELECT 1 FROM s_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)").get(a, b, b, a);
  const follows = (a, b) => !!db.prepare("SELECT 1 FROM s_follows WHERE follower_id = ? AND followee_id = ?").get(a, b);
  const notify = (userId, kind, actorId, postId = null) => {
    if (userId === actorId) return;
    db.prepare("INSERT INTO s_notifs(user_id, kind, actor_id, post_id, created_at) VALUES(?,?,?,?,?)").run(userId, kind, actorId, postId, now());
  };

  r.post("/api/s/signup", (req, res) => {
    const b = req.body || {};
    if (b.website) return bad(res, "human", 403);
    const username = String(b.username || "").trim().toLowerCase().replace(/^@/, "");
    const name = line(b.name, 50), pw = String(b.password || "");
    if (!USERNAME_RX.test(username)) return bad(res, "Username: 3 to 20 small English letters, numbers, _ or . (for example ravi_patil).");
    if (RESERVED.has(username) || isBad(username, false)) return bad(res, "Please choose another username.");
    if (!name || isBad(name)) return bad(res, "Please write your name (no rude words, links or phone numbers).");
    if (pw.length < 8) return bad(res, "The password must be at least 8 characters.");
    if (!(b.agree === true || b.agree === "on")) return bad(res, "Please tick that you are 18 or older and agree to the Terms.");
    if (human.verify(b.human, b.n)) return bad(res, "human", 403);
    const h = ipHash(req);
    if (banned(h)) return bad(res, "Sign-up is not possible from this connection.", 403);
    if (limited(req, "signup", 5, 24 * 3600_000)) return bad(res, "Too many new accounts from this connection today. Please try tomorrow.", 429);
    if (db.prepare("SELECT 1 FROM s_users WHERE username = ?").get(username)) return bad(res, "This username is taken. Please choose another.", 409);
    const salt = crypto.randomBytes(16).toString("hex"), rsalt = crypto.randomBytes(16).toString("hex"), rec = recoveryCode();
    const refBy = (db.prepare("SELECT id FROM s_users WHERE username = ? AND status = 'ok'").get(String(b.ref || "").toLowerCase().replace(/^@/, "")) || {}).id || null;
    const id = db.prepare("INSERT INTO s_users(username, name, city, pass_salt, pass_hash, rec_salt, rec_hash, ip_hash, created_at, last_seen, ref_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(username, name, line(b.city, 60) && !isBad(b.city) ? line(b.city, 60) : null, salt, scrypt(pw, salt), rsalt, scrypt(normRec(rec), rsalt), h, now(), now(), refBy).lastInsertRowid;
    db.prepare("UPDATE s_users SET rules_seen = ? WHERE id = ?").run(now(), id); // agreed to the rules just now
    res.json({ token: newSession(id), recovery: rec, user: { username, name } });
  });

  r.post("/api/s/login", (req, res) => {
    const b = req.body || {};
    if (limited(req, "slogin", 20, 15 * 60_000)) return bad(res, "Too many tries. Please wait 15 minutes.", 429);
    const u = db.prepare("SELECT * FROM s_users WHERE username = ?").get(String(b.username || "").trim().toLowerCase().replace(/^@/, ""));
    if (!u || !same(scrypt(String(b.password || ""), u.pass_salt), u.pass_hash)) return bad(res, "Wrong username or password.", 401);
    if (u.status === "banned") return bad(res, "This account has been stopped by the site owner for breaking the rules.", 403);
    res.json({ token: newSession(u.id), user: { username: u.username, name: u.name } });
  });

  // Forgotten password: username + the recovery code given at sign-up. A new recovery code is given each time.
  r.post("/api/s/recover", (req, res) => {
    const b = req.body || {};
    if (limited(req, "recover", 10, 3600_000)) return bad(res, "Too many tries. Please wait an hour.", 429);
    const u = db.prepare("SELECT * FROM s_users WHERE username = ?").get(String(b.username || "").trim().toLowerCase().replace(/^@/, ""));
    if (!u || !same(scrypt(normRec(b.code), u.rec_salt), u.rec_hash)) return bad(res, "Wrong username or recovery code.", 401);
    if (String(b.password || "").length < 8) return bad(res, "The new password must be at least 8 characters.");
    if (u.status === "banned") return bad(res, "This account has been stopped by the site owner.", 403);
    const salt = crypto.randomBytes(16).toString("hex"), rsalt = crypto.randomBytes(16).toString("hex"), rec = recoveryCode();
    db.prepare("UPDATE s_users SET pass_salt = ?, pass_hash = ?, rec_salt = ?, rec_hash = ? WHERE id = ?").run(salt, scrypt(b.password, salt), rsalt, scrypt(normRec(rec), rsalt), u.id);
    db.prepare("DELETE FROM s_sessions WHERE user_id = ?").run(u.id);
    res.json({ token: newSession(u.id), recovery: rec, user: { username: u.username, name: u.name } });
  });

  r.post("/api/s/logout", login, (req, res) => { db.prepare("DELETE FROM s_sessions WHERE token_hash = ?").run(req.me.tokenHash); res.json({ ok: true }); });

  r.get("/api/s/me", login, (req, res) => {
    const me = req.me;
    res.json({
      ...pubUser(me), bio: me.bio || "", city: me.city || "", dm: me.dm,
      notifs: db.prepare("SELECT COUNT(*) AS n FROM s_notifs WHERE user_id = ? AND read = 0").get(me.id).n,
      messages: unreadChats(me.id),
      rulesDue: rulesDue(me),
    });
  });
  r.post("/api/s/rules-seen", login, (req, res) => { db.prepare("UPDATE s_users SET rules_seen = ? WHERE id = ?").run(now(), req.me.id); res.json({ ok: true }); });

  r.post("/api/s/me", login, (req, res) => {
    const b = req.body || {}, me = req.me;
    const name = b.name === undefined ? me.name : line(b.name, 50);
    const bio = b.bio === undefined ? me.bio : para(b.bio, BIO_MAX);
    const city = b.city === undefined ? me.city : line(b.city, 60);
    if (!name || isBad(name)) return bad(res, "Please write your name (no rude words, links or phone numbers).");
    if (isBad(bio, false) || isBad(city)) return bad(res, "Please remove rude words.");
    let avatar = me.avatar;
    if (b.avatar === null) avatar = null;
    else if (b.avatar) { avatar = takeMedia(b.avatar, me.id); if (!avatar) return bad(res, "The photo was not found. Please choose it again."); }
    const dm = b.dm === "following" ? "following" : b.dm === "everyone" ? "everyone" : me.dm;
    db.prepare("UPDATE s_users SET name = ?, bio = ?, city = ?, avatar = ?, dm = ? WHERE id = ?").run(name, bio || null, city || null, avatar, dm, me.id);
    res.json({ ok: true });
  });

  r.post("/api/s/password", login, (req, res) => {
    const b = req.body || {}, me = req.me;
    if (!same(scrypt(String(b.old || ""), me.pass_salt), me.pass_hash)) return bad(res, "The current password is wrong.", 401);
    if (String(b.password || "").length < 8) return bad(res, "The new password must be at least 8 characters.");
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("UPDATE s_users SET pass_salt = ?, pass_hash = ? WHERE id = ?").run(salt, scrypt(b.password, salt), me.id);
    db.prepare("DELETE FROM s_sessions WHERE user_id = ? AND token_hash != ?").run(me.id, me.tokenHash);
    res.json({ ok: true });
  });

  // Delete my account: removes the profile, posts, comments, likes, follows, messages I sent and my photos.
  r.post("/api/s/delete-account", login, (req, res) => {
    const me = req.me;
    if (!same(scrypt(String((req.body || {}).password || ""), me.pass_salt), me.pass_hash)) return bad(res, "The password is wrong.", 401);
    deleteUser(me.id);
    res.json({ ok: true });
  });
  function deleteUser(id, reason = "account deleted by the member") {
    const u = db.prepare("SELECT id, username, name, city, status, ip_hash, created_at, last_seen FROM s_users WHERE id = ?").get(id);
    if (u) hold.keep("account", u.id, u, { reason });
    const files = db.prepare("SELECT name FROM s_media WHERE user_id = ?").all(id).map(x => x.name);
    db.transaction(() => {
      for (const c of db.prepare("SELECT DISTINCT post_id FROM s_comments WHERE user_id = ?").all(id)) db.prepare("UPDATE s_posts SET comments = MAX(0, comments - (SELECT COUNT(*) FROM s_comments WHERE post_id = ? AND user_id = ?)) WHERE id = ?").run(c.post_id, id, c.post_id);
      for (const l of db.prepare("SELECT post_id FROM s_likes WHERE user_id = ?").all(id)) db.prepare("UPDATE s_posts SET likes = MAX(0, likes - 1) WHERE id = ?").run(l.post_id);
      db.prepare("DELETE FROM s_users WHERE id = ?").run(id); // everything else goes with it (ON DELETE CASCADE)
    })();
    for (const f of files) fs.rm(path.join(MEDIA, f), () => {});
  }

  // ---------- photos ----------
  // The phone shrinks the photo and sends a JPEG. We keep only JPEGs and remove hidden data (EXIF: camera, GPS place).
  function stripJpeg(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    const out = [buf.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // image data starts: keep the rest
      const len = buf.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > buf.length) return null;
      const keep = !(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe; // drop APP1-APP15 (EXIF/XMP) and comments
      if (keep) out.push(buf.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    return null;
  }
  function diskFree() { try { const s = fs.statfsSync(MEDIA); return s.bavail * s.bsize; } catch { return Infinity; } }
  r.post("/api/s/upload", login, express.raw({ type: () => true, limit: PHOTO_MAX }), (req, res) => {
    const me = req.me;
    if (limited(req, "upload:" + me.id, 60, 24 * 3600_000)) return bad(res, "You have added many photos today. Please try tomorrow.", 429);
    if (diskFree() < MIN_FREE_DISK) return bad(res, "Photo space on the server is full for now. Please post text only; the owner has been told.", 507);
    const jpg = Buffer.isBuffer(req.body) ? stripJpeg(req.body) : null;
    if (!jpg) return bad(res, "Please choose a photo (JPEG, PNG or similar).");
    const name = crypto.randomBytes(16).toString("hex") + ".jpg"; // long random name: nobody can guess the address
    fs.writeFileSync(path.join(MEDIA, name), jpg);
    db.prepare("INSERT INTO s_media(name, user_id, bytes, created_at) VALUES(?,?,?,?)").run(name, me.id, jpg.length, now());
    res.json({ id: name });
  });
  function takeMedia(name, userId) {
    if (!/^[a-f0-9]{32}\.jpg$/.test(String(name))) return null;
    const row = db.prepare("SELECT name FROM s_media WHERE name = ? AND user_id = ?").get(name, userId);
    if (!row) return null;
    db.prepare("UPDATE s_media SET used = 1 WHERE name = ?").run(name);
    return row.name;
  }
  function dropMedia(name) {
    if (!name) return;
    db.prepare("DELETE FROM s_media WHERE name = ?").run(name);
    fs.rm(path.join(MEDIA, name), () => {});
  }
  // Photos nobody used within a day (chosen but never posted) are removed.
  setInterval(() => { for (const m of db.prepare("SELECT name FROM s_media WHERE used = 0 AND created_at < ?").all(now() - 24 * 3600_000)) dropMedia(m.name); }, 3600_000).unref();
  r.get("/media/:name", (req, res, next) => {
    if (!/^[a-f0-9]{32}\.jpg$/.test(req.params.name)) return next();
    res.set("Cache-Control", "public, max-age=31536000, immutable").set("X-Robots-Tag", "noindex");
    res.sendFile(path.join(MEDIA, req.params.name), err => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ---------- posts ----------
  const postOut = (p, meId) => ({
    id: p.id, text: p.text || "", photo: p.photo ? "/media/" + p.photo : null, status: p.status,
    likes: p.likes, comments: p.comments, created_at: p.created_at,
    liked: meId ? !!db.prepare("SELECT 1 FROM s_likes WHERE post_id = ? AND user_id = ?").get(p.id, meId) : false,
    mine: meId === p.user_id,
    user: { username: p.username, name: p.name, avatar: avatarUrl(p.avatar) },
  });
  const POST_SQL = "SELECT p.*, u.username, u.name, u.avatar FROM s_posts p JOIN s_users u ON u.id = p.user_id";
  // A post is visible to everyone when it is "ok"; its author also sees it while it waits for the owner.
  const visible = meId => `(p.status = 'ok' OR (p.user_id = ${Number(meId) || 0} AND p.status = 'pending')) AND u.status = 'ok'`;
  const notBlocked = meId => (meId ? ` AND p.user_id NOT IN (SELECT blocked_id FROM s_blocks WHERE blocker_id = ${Number(meId)}) AND p.user_id NOT IN (SELECT blocker_id FROM s_blocks WHERE blocked_id = ${Number(meId)})` : "");
  const before = req => { const n = Number(req.query.before); return Number.isFinite(n) && n > 0 ? n : 2 ** 53; };

  r.post("/api/s/posts", login, (req, res) => {
    const b = req.body || {}, me = req.me;
    const text = para(b.text, TEXT_MAX);
    if (!text && !b.photo) return bad(res, "Write something or add a photo.");
    if (isBad(text, false)) return bad(res, "Please remove rude, sexual or abusive words. Qindia is a family place.");
    if (limited(req, "post:" + me.id, 30, 3600_000)) return bad(res, "You have posted a lot in the last hour. Please wait a little.", 429);
    let photo = null;
    if (b.photo) { photo = takeMedia(b.photo, me.id); if (!photo) return bad(res, "The photo was not found. Please choose it again."); }
    const status = isDoubtful(text) || me.reports >= 3 || (photo && photoApproval()) ? "pending" : "ok";
    const id = db.prepare("INSERT INTO s_posts(user_id, text, photo, status, created_at) VALUES(?,?,?,?,?)").run(me.id, text || null, photo, status, now()).lastInsertRowid;
    res.json({ post: postOut(db.prepare(POST_SQL + " WHERE p.id = ?").get(id), me.id) });
  });

  // Feed. tab=following: people I follow and me. tab=all: everyone (newest first).
  r.get("/api/s/feed", optional, (req, res) => {
    const meId = req.me && req.me.status === "ok" ? req.me.id : 0;
    const tab = meId && req.query.tab === "following" ? "following" : "all";
    const who = tab === "following" ? ` AND (p.user_id = ${meId} OR p.user_id IN (SELECT followee_id FROM s_follows WHERE follower_id = ${meId}))` : "";
    const rows = db.prepare(`${POST_SQL} WHERE ${visible(meId)}${notBlocked(meId)}${who} AND p.id < ? ORDER BY p.id DESC LIMIT ${PAGE}`).all(before(req));
    res.json({ posts: rows.map(p => postOut(p, meId)), more: rows.length === PAGE });
  });

  r.get("/api/s/posts/:id", optional, (req, res) => {
    const meId = req.me ? req.me.id : 0;
    const p = db.prepare(`${POST_SQL} WHERE p.id = ? AND ${visible(meId)}${notBlocked(meId)}`).get(Number(req.params.id));
    if (!p) return bad(res, "This post is not available.", 404);
    const comments = db.prepare(`SELECT c.*, u.username, u.name, u.avatar FROM s_comments c JOIN s_users u ON u.id = c.user_id
      WHERE c.post_id = ? AND (c.status = 'ok' OR c.user_id = ?) AND u.status = 'ok' ORDER BY c.id LIMIT 500`).all(p.id, meId);
    res.json({
      post: postOut(p, meId),
      comments: comments.map(c => ({ id: c.id, text: c.text, created_at: c.created_at, status: c.status, mine: c.user_id === meId, canDelete: c.user_id === meId || p.user_id === meId, user: { username: c.username, name: c.name, avatar: avatarUrl(c.avatar) } })),
    });
  });

  r.post("/api/s/posts/:id/delete", login, (req, res) => {
    const p = db.prepare("SELECT * FROM s_posts WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.me.id);
    if (!p) return bad(res, "Not found.", 404);
    db.prepare("DELETE FROM s_posts WHERE id = ?").run(p.id); dropMedia(p.photo);
    res.json({ ok: true });
  });

  const okPost = (id, meId) => db.prepare(`SELECT p.* FROM s_posts p JOIN s_users u ON u.id = p.user_id WHERE p.id = ? AND p.status = 'ok' AND u.status = 'ok'`).get(id) || null;

  r.post("/api/s/posts/:id/like", login, (req, res) => {
    const p = okPost(Number(req.params.id)), me = req.me;
    if (!p || blockedEither(p.user_id, me.id)) return bad(res, "Not found.", 404);
    const on = (req.body || {}).like !== false;
    db.transaction(() => {
      if (on) {
        if (db.prepare("INSERT OR IGNORE INTO s_likes(post_id, user_id, created_at) VALUES(?,?,?)").run(p.id, me.id, now()).changes) {
          db.prepare("UPDATE s_posts SET likes = likes + 1 WHERE id = ?").run(p.id);
          if (!db.prepare("SELECT 1 FROM s_notifs WHERE user_id = ? AND kind = 'like' AND actor_id = ? AND post_id = ?").get(p.user_id, me.id, p.id)) notify(p.user_id, "like", me.id, p.id);
        }
      } else if (db.prepare("DELETE FROM s_likes WHERE post_id = ? AND user_id = ?").run(p.id, me.id).changes) db.prepare("UPDATE s_posts SET likes = MAX(0, likes - 1) WHERE id = ?").run(p.id);
    })();
    res.json({ likes: db.prepare("SELECT likes FROM s_posts WHERE id = ?").get(p.id).likes, liked: on });
  });

  r.post("/api/s/posts/:id/comments", login, (req, res) => {
    const p = okPost(Number(req.params.id)), me = req.me;
    if (!p || blockedEither(p.user_id, me.id)) return bad(res, "Not found.", 404);
    const text = para((req.body || {}).text, COMMENT_MAX);
    if (!text) return bad(res, "Write a comment.");
    if (isBad(text, false)) return bad(res, "Please remove rude, sexual or abusive words.");
    if (limited(req, "comment:" + me.id, 60, 3600_000)) return bad(res, "Too many comments in the last hour. Please wait a little.", 429);
    const status = isDoubtful(text) || me.reports >= 3 ? "pending" : "ok";
    const id = db.prepare("INSERT INTO s_comments(post_id, user_id, text, status, created_at) VALUES(?,?,?,?,?)").run(p.id, me.id, text, status, now()).lastInsertRowid;
    if (status === "ok") { db.prepare("UPDATE s_posts SET comments = comments + 1 WHERE id = ?").run(p.id); notify(p.user_id, "comment", me.id, p.id); }
    res.json({ id, status });
  });

  // The comment's writer or the post's owner can delete a comment.
  r.post("/api/s/comments/:id/delete", login, (req, res) => {
    const c = db.prepare("SELECT c.*, p.user_id AS post_owner FROM s_comments c JOIN s_posts p ON p.id = c.post_id WHERE c.id = ?").get(Number(req.params.id));
    if (!c || (c.user_id !== req.me.id && c.post_owner !== req.me.id)) return bad(res, "Not found.", 404);
    db.prepare("DELETE FROM s_comments WHERE id = ?").run(c.id);
    if (c.status === "ok") db.prepare("UPDATE s_posts SET comments = MAX(0, comments - 1) WHERE id = ?").run(c.post_id);
    res.json({ ok: true });
  });

  // ---------- people ----------
  r.get("/api/s/users/:username", optional, (req, res) => {
    const u = db.prepare("SELECT * FROM s_users WHERE username = ? AND status = 'ok'").get(String(req.params.username).toLowerCase());
    const meId = req.me ? req.me.id : 0;
    if (!u || (meId && blockedEither(u.id, meId) && !db.prepare("SELECT 1 FROM s_blocks WHERE blocker_id = ? AND blocked_id = ?").get(meId, u.id))) return bad(res, "This person was not found.", 404);
    const posts = db.prepare(`${POST_SQL} WHERE p.user_id = ? AND ${visible(meId)} AND p.id < ? ORDER BY p.id DESC LIMIT ${PAGE}`).all(u.id, before(req));
    res.json({
      user: {
        ...pubUser(u), bio: u.bio || "", city: u.city || "", joined: u.created_at,
        posts: db.prepare("SELECT COUNT(*) AS n FROM s_posts WHERE user_id = ? AND status = 'ok'").get(u.id).n,
        followers: db.prepare("SELECT COUNT(*) AS n FROM s_follows WHERE followee_id = ?").get(u.id).n,
        following: db.prepare("SELECT COUNT(*) AS n FROM s_follows WHERE follower_id = ?").get(u.id).n,
        me: meId === u.id, iFollow: meId ? follows(meId, u.id) : false, followsMe: meId ? follows(u.id, meId) : false,
        iBlocked: meId ? !!db.prepare("SELECT 1 FROM s_blocks WHERE blocker_id = ? AND blocked_id = ?").get(meId, u.id) : false,
      },
      posts: posts.map(p => postOut(p, meId)), more: posts.length === PAGE,
    });
  });

  r.get(["/api/s/users/:username/followers", "/api/s/users/:username/following"], optional, (req, res) => {
    const list = req.path.endsWith("/followers") ? "followers" : "following";
    const u = db.prepare("SELECT id FROM s_users WHERE username = ? AND status = 'ok'").get(String(req.params.username).toLowerCase());
    if (!u) return bad(res, "Not found.", 404);
    const sql = list === "followers"
      ? "SELECT x.* FROM s_follows f JOIN s_users x ON x.id = f.follower_id WHERE f.followee_id = ? AND x.status = 'ok' ORDER BY f.created_at DESC LIMIT 500"
      : "SELECT x.* FROM s_follows f JOIN s_users x ON x.id = f.followee_id WHERE f.follower_id = ? AND x.status = 'ok' ORDER BY f.created_at DESC LIMIT 500";
    res.json({ users: db.prepare(sql).all(u.id).map(pubUser) });
  });

  r.get("/api/s/search", optional, (req, res) => {
    const q = line(req.query.q, 40).toLowerCase().replace(/^@/, "").replace(/[%_\\]/g, c => "\\" + c);
    if (q.length < 2) {
      // No search words: show the newest people, so newcomers can find someone to follow.
      return res.json({ users: db.prepare("SELECT * FROM s_users WHERE status = 'ok' ORDER BY id DESC LIMIT 30").all().map(pubUser) });
    }
    const rows = db.prepare("SELECT * FROM s_users WHERE status = 'ok' AND (username LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' OR lower(city) LIKE ? ESCAPE '\\') ORDER BY (username = ?) DESC, id DESC LIMIT 30")
      .all(q + "%", "%" + q + "%", q + "%", q);
    res.json({ users: rows.map(pubUser) });
  });

  const target = req => db.prepare("SELECT * FROM s_users WHERE username = ? AND status = 'ok'").get(String(req.params.username).toLowerCase());
  r.post("/api/s/users/:username/follow", login, (req, res) => {
    const u = target(req), me = req.me;
    if (!u || u.id === me.id || blockedEither(u.id, me.id)) return bad(res, "Not possible.", 404);
    const on = (req.body || {}).follow !== false;
    if (on) {
      if (limited(req, "follow:" + me.id, 200, 3600_000)) return bad(res, "Too many follows in the last hour.", 429);
      if (db.prepare("INSERT OR IGNORE INTO s_follows(follower_id, followee_id, created_at) VALUES(?,?,?)").run(me.id, u.id, now()).changes
        && !db.prepare("SELECT 1 FROM s_notifs WHERE user_id = ? AND kind = 'follow' AND actor_id = ?").get(u.id, me.id)) notify(u.id, "follow", me.id);
    } else db.prepare("DELETE FROM s_follows WHERE follower_id = ? AND followee_id = ?").run(me.id, u.id);
    res.json({ following: on });
  });

  // Block: they cannot see my posts, message me or follow me, and I do not see theirs. Unblock with block:false.
  r.post("/api/s/users/:username/block", login, (req, res) => {
    const u = db.prepare("SELECT * FROM s_users WHERE username = ?").get(String(req.params.username).toLowerCase()), me = req.me;
    if (!u || u.id === me.id) return bad(res, "Not possible.", 404);
    if ((req.body || {}).block === false) db.prepare("DELETE FROM s_blocks WHERE blocker_id = ? AND blocked_id = ?").run(me.id, u.id);
    else {
      db.prepare("INSERT OR IGNORE INTO s_blocks(blocker_id, blocked_id) VALUES(?,?)").run(me.id, u.id);
      db.prepare("DELETE FROM s_follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)").run(me.id, u.id, u.id, me.id);
    }
    res.json({ ok: true });
  });

  // ---------- reports (anyone logged in can report a post, comment, person or message; the owner decides) ----------
  r.post("/api/s/report", login, (req, res) => {
    const b = req.body || {}, me = req.me, kind = String(b.kind || ""), reason = line(b.reason, 300);
    if (limited(req, "sreport:" + me.id, 30, 3600_000)) return bad(res, "Too many reports.", 429);
    let id = Number(b.id);
    if (kind === "user") { const u = db.prepare("SELECT id FROM s_users WHERE username = ?").get(String(b.id || "").toLowerCase()); id = u ? u.id : 0; }
    const tbl = { post: "s_posts", comment: "s_comments", user: "s_users" }[kind];
    if (kind === "message") {
      const m = db.prepare("SELECT m.* FROM s_messages m JOIN s_convos c ON c.id = m.convo_id WHERE m.id = ? AND (c.a_id = ? OR c.b_id = ?) AND m.sender_id != ?").get(id, me.id, me.id, me.id);
      if (!m) return bad(res, "Not found.", 404);
      db.prepare("UPDATE s_messages SET reported = 1 WHERE id = ?").run(id); // only reported messages are shown to the owner
    } else if (!tbl || !db.prepare(`SELECT 1 FROM ${tbl} WHERE id = ?`).get(id)) return bad(res, "Not found.", 404);
    const fresh = db.prepare("INSERT OR IGNORE INTO s_reports(kind, target_id, reporter_id, reason, created_at) VALUES(?,?,?,?,?)").run(kind, id, me.id, reason || null, now()).changes;
    if (fresh && tbl) {
      db.prepare(`UPDATE ${tbl} SET reports = reports + 1 WHERE id = ?`).run(id);
      // Three different people reporting a post or comment hides it until the owner looks.
      if (kind !== "user") db.prepare(`UPDATE ${tbl} SET status = 'pending' WHERE id = ? AND status = 'ok' AND reports >= 3`).run(id);
      if (kind === "comment" && db.prepare("SELECT status FROM s_comments WHERE id = ?").get(id).status === "pending")
        db.prepare("UPDATE s_posts SET comments = (SELECT COUNT(*) FROM s_comments WHERE post_id = s_posts.id AND status = 'ok') WHERE id = (SELECT post_id FROM s_comments WHERE id = ?)").run(id);
    }
    res.json({ ok: true });
  });

  // ---------- notifications ----------
  r.get("/api/s/notifs", login, (req, res) => {
    const me = req.me;
    const rows = db.prepare(`SELECT n.*, u.username, u.name, u.avatar FROM s_notifs n JOIN s_users u ON u.id = n.actor_id WHERE n.user_id = ? AND u.status = 'ok' ORDER BY n.id DESC LIMIT 100`).all(me.id);
    db.prepare("UPDATE s_notifs SET read = 1 WHERE user_id = ? AND read = 0").run(me.id);
    db.prepare("DELETE FROM s_notifs WHERE user_id = ? AND id < (SELECT MIN(id) FROM (SELECT id FROM s_notifs WHERE user_id = ? ORDER BY id DESC LIMIT 300))").run(me.id, me.id);
    res.json({ items: rows.map(n => ({ kind: n.kind, post_id: n.post_id, created_at: n.created_at, read: !!n.read, user: pubUser(n) })) });
  });

  // ---------- private messages (1-to-1) ----------
  // Stored on the Qindia server (not end-to-end encrypted). The owner sees a message only if the receiver reports it.
  // Someone who does not follow you can send you one message request; you see it under Requests and can reply, or block.
  const pair = (x, y) => (x < y ? [x, y] : [y, x]);
  const side = (c, meId) => (c.a_id === meId ? "a" : "b");
  function unreadChats(meId) {
    return db.prepare(`SELECT COUNT(*) AS n FROM s_convos c WHERE (c.a_id = ? AND c.last_at > c.a_read AND EXISTS (SELECT 1 FROM s_messages m WHERE m.convo_id = c.id AND m.sender_id != ? AND m.created_at > c.a_read))
      OR (c.b_id = ? AND c.last_at > c.b_read AND EXISTS (SELECT 1 FROM s_messages m WHERE m.convo_id = c.id AND m.sender_id != ? AND m.created_at > c.b_read))`).get(meId, meId, meId, meId).n;
  }
  r.get("/api/s/chats", login, (req, res) => {
    const me = req.me;
    const rows = db.prepare(`SELECT c.*, u.id AS uid, u.username, u.name, u.avatar, u.status AS ustatus,
        (SELECT text FROM s_messages WHERE convo_id = c.id ORDER BY id DESC LIMIT 1) AS last_text,
        (SELECT photo FROM s_messages WHERE convo_id = c.id ORDER BY id DESC LIMIT 1) AS last_photo,
        (SELECT sender_id FROM s_messages WHERE convo_id = c.id ORDER BY id DESC LIMIT 1) AS last_sender,
        (SELECT COUNT(*) FROM s_messages WHERE convo_id = c.id AND sender_id = ?) AS mine
      FROM s_convos c JOIN s_users u ON u.id = CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END
      WHERE (c.a_id = ? OR c.b_id = ?) AND EXISTS (SELECT 1 FROM s_messages WHERE convo_id = c.id)
      ORDER BY c.last_at DESC LIMIT 200`).all(me.id, me.id, me.id, me.id);
    res.json({
      chats: rows.filter(c => c.ustatus === "ok").map(c => {
        const read = side(c, me.id) === "a" ? c.a_read : c.b_read;
        return {
          user: pubUser(c), last: c.last_photo && !c.last_text ? "📷 Photo" : c.last_text || "", lastMine: c.last_sender === me.id, at: c.last_at,
          unread: c.last_sender !== me.id && c.last_at > read,
          request: c.mine === 0 && !follows(me.id, c.uid),
        };
      }),
    });
  });

  function convoWith(meId, otherId, create) {
    const [a, b] = pair(meId, otherId);
    let c = db.prepare("SELECT * FROM s_convos WHERE a_id = ? AND b_id = ?").get(a, b);
    if (!c && create) { db.prepare("INSERT INTO s_convos(a_id, b_id, last_at) VALUES(?,?,?)").run(a, b, now()); c = db.prepare("SELECT * FROM s_convos WHERE a_id = ? AND b_id = ?").get(a, b); }
    return c || null;
  }
  // Can I send to them? Returns "" when yes, else the reason shown to me.
  function canSend(me, u, c) {
    if (blockedEither(me.id, u.id)) return "You cannot message this person.";
    const theyReplied = c && db.prepare("SELECT 1 FROM s_messages WHERE convo_id = ? AND sender_id = ? LIMIT 1").get(c.id, u.id);
    if (theyReplied || follows(u.id, me.id)) return "";
    if (u.dm === "following") return "This person only takes messages from people they follow.";
    const sent = c ? db.prepare("SELECT COUNT(*) AS n FROM s_messages WHERE convo_id = ? AND sender_id = ?").get(c.id, me.id).n : 0;
    return sent >= 1 ? "Your message request was sent. You can write again after they reply." : "";
  }
  r.get("/api/s/chats/:username", login, (req, res) => {
    const u = target(req), me = req.me;
    if (!u || u.id === me.id) return bad(res, "This person was not found.", 404);
    const c = convoWith(me.id, u.id, false);
    const after = Number(req.query.after) || 0;
    const msgs = c ? (after
      ? db.prepare("SELECT * FROM s_messages WHERE convo_id = ? AND id > ? ORDER BY id LIMIT 200").all(c.id, after)
      : db.prepare("SELECT * FROM (SELECT * FROM s_messages WHERE convo_id = ? AND id < ? ORDER BY id DESC LIMIT 100) ORDER BY id").all(c.id, before(req))) : [];
    if (c) db.prepare(`UPDATE s_convos SET ${side(c, me.id)}_read = ? WHERE id = ?`).run(now(), c.id);
    const otherRead = c ? (side(c, me.id) === "a" ? c.b_read : c.a_read) : 0;
    res.json({
      user: { ...pubUser(u), last_seen: u.last_seen }, blocked: blockedEither(me.id, u.id), cannot: canSend(me, u, c), otherRead,
      messages: msgs.map(m => ({ id: m.id, mine: m.sender_id === me.id, text: m.text || "", photo: m.photo ? "/media/" + m.photo : null, at: m.created_at })),
    });
  });
  r.post("/api/s/chats/:username", login, (req, res) => {
    const u = target(req), me = req.me, b = req.body || {};
    if (!u || u.id === me.id) return bad(res, "This person was not found.", 404);
    const text = para(b.text, MESSAGE_MAX);
    if (!text && !b.photo) return bad(res, "Write a message.");
    let c = convoWith(me.id, u.id, false);
    if (limited(req, "msg:" + me.id, 300, 3600_000) || (!c && limited(req, "newchat:" + me.id, 40, 24 * 3600_000)))
      return bad(res, "You are sending too many messages. Please wait a little.", 429);
    const why = canSend(me, u, c);
    if (why) return bad(res, why, 403);
    // Photos in private chats only between people who follow each other (so strangers cannot send pictures).
    let photo = null;
    if (b.photo) {
      if (!(follows(me.id, u.id) && follows(u.id, me.id))) return bad(res, "You can send photos only when you both follow each other.", 403);
      photo = takeMedia(b.photo, me.id); if (!photo) return bad(res, "The photo was not found. Please choose it again.");
    }
    c = c || convoWith(me.id, u.id, true);
    const t = now();
    const id = db.prepare("INSERT INTO s_messages(convo_id, sender_id, text, photo, created_at) VALUES(?,?,?,?,?)").run(c.id, me.id, text || null, photo, t).lastInsertRowid;
    db.prepare(`UPDATE s_convos SET last_at = ?, ${side(c, me.id)}_read = ? WHERE id = ?`).run(t, t, c.id);
    res.json({ id, at: t });
  });
  // Delete a message I sent (it disappears for both people).
  r.post("/api/s/messages/:id/delete", login, (req, res) => {
    const m = db.prepare("SELECT * FROM s_messages WHERE id = ? AND sender_id = ?").get(Number(req.params.id), req.me.id);
    if (!m) return bad(res, "Not found.", 404);
    db.prepare("DELETE FROM s_messages WHERE id = ?").run(m.id); dropMedia(m.photo);
    res.json({ ok: true });
  });

  // ---------- owner: community moderation on /admin ----------
  r.get("/api/admin/community", owner, (req, res) => {
    const day = now() - 24 * 3600_000;
    const n = sql => db.prepare(sql).get().n;
    const post = id => db.prepare("SELECT p.*, u.username FROM s_posts p JOIN s_users u ON u.id = p.user_id WHERE p.id = ?").get(id);
    const q = line(req.query.q, 40).toLowerCase();
    res.json({
      users: n("SELECT COUNT(*) AS n FROM s_users"), usersToday: n(`SELECT COUNT(*) AS n FROM s_users WHERE created_at > ${day}`),
      posts: n("SELECT COUNT(*) AS n FROM s_posts"), postsToday: n(`SELECT COUNT(*) AS n FROM s_posts WHERE created_at > ${day}`),
      messagesToday: n(`SELECT COUNT(*) AS n FROM s_messages WHERE created_at > ${day}`),
      photoMB: Math.round(n("SELECT IFNULL(SUM(bytes),0) AS n FROM s_media") / 1048576),
      freeGB: Math.round(diskFree() / 1024 ** 3), photoApproval: photoApproval(),
      pendingPosts: db.prepare("SELECT p.*, u.username FROM s_posts p JOIN s_users u ON u.id = p.user_id WHERE p.status = 'pending' ORDER BY p.id LIMIT 200").all()
        .map(p => ({ id: p.id, username: p.username, text: p.text, photo: p.photo && "/media/" + p.photo, reports: p.reports, at: p.created_at })),
      pendingComments: db.prepare("SELECT c.*, u.username FROM s_comments c JOIN s_users u ON u.id = c.user_id WHERE c.status = 'pending' ORDER BY c.id LIMIT 200").all()
        .map(c => ({ id: c.id, post_id: c.post_id, username: c.username, text: c.text, reports: c.reports, at: c.created_at })),
      reports: db.prepare("SELECT kind, target_id, COUNT(*) AS n, MAX(created_at) AS at, GROUP_CONCAT(reason, ' | ') AS reasons FROM s_reports WHERE done = 0 GROUP BY kind, target_id ORDER BY n DESC, at DESC LIMIT 200").all().map(x => {
        let item = null;
        if (x.kind === "post") { const p = post(x.target_id); item = p && { username: p.username, text: p.text, photo: p.photo && "/media/" + p.photo, status: p.status }; }
        if (x.kind === "comment") { const c = db.prepare("SELECT c.*, u.username FROM s_comments c JOIN s_users u ON u.id = c.user_id WHERE c.id = ?").get(x.target_id); item = c && { username: c.username, text: c.text, status: c.status }; }
        if (x.kind === "user") { const u = db.prepare("SELECT username, name, bio, status FROM s_users WHERE id = ?").get(x.target_id); item = u && { username: u.username, text: [u.name, u.bio].filter(Boolean).join(" · "), status: u.status }; }
        if (x.kind === "message") { const m = db.prepare("SELECT m.*, u.username FROM s_messages m JOIN s_users u ON u.id = m.sender_id WHERE m.id = ? AND m.reported = 1").get(x.target_id); item = m && { username: m.username, text: m.text, photo: m.photo && "/media/" + m.photo }; }
        return { kind: x.kind, id: x.target_id, count: x.n, at: x.at, reasons: x.reasons, item };
      }),
      people: db.prepare(`SELECT id, username, name, city, status, reports, created_at, last_seen,
          (SELECT COUNT(*) FROM s_posts WHERE user_id = s_users.id) AS posts FROM s_users
          WHERE (? = '' OR username LIKE ? OR lower(name) LIKE ?) ORDER BY ${q ? "id DESC" : "reports DESC, id DESC"} LIMIT 300`).all(q, q + "%", "%" + q + "%"),
    });
  });
  r.post("/api/admin/community", owner, (req, res) => {
    const b = req.body || {}, id = Number(b.id), act = String(b.action || "");
    const finish = (kind, tid) => db.prepare("UPDATE s_reports SET done = 1 WHERE kind = ? AND target_id = ?").run(kind, tid);
    const recount = postId => db.prepare("UPDATE s_posts SET comments = (SELECT COUNT(*) FROM s_comments WHERE post_id = s_posts.id AND status = 'ok') WHERE id = ?").run(postId);
    switch (act) {
      case "post-ok": db.prepare("UPDATE s_posts SET status = 'ok', reports = 0 WHERE id = ?").run(id); finish("post", id); break;
      case "post-hide": db.prepare("UPDATE s_posts SET status = 'hidden' WHERE id = ?").run(id); finish("post", id); break;
      case "post-delete": {
        const p = db.prepare("SELECT p.id, p.text, p.photo, p.created_at, u.username FROM s_posts p JOIN s_users u ON u.id = p.user_id WHERE p.id = ?").get(id);
        db.prepare("DELETE FROM s_posts WHERE id = ?").run(id);
        if (p) { const kept = hold.keep("post", p.id, p, { photo: p.photo, reason: "removed by owner" }); if (kept) db.prepare("DELETE FROM s_media WHERE name = ?").run(kept); else dropMedia(p.photo); }
        finish("post", id); break;
      }
      case "comment-ok": { db.prepare("UPDATE s_comments SET status = 'ok', reports = 0 WHERE id = ?").run(id); const c = db.prepare("SELECT post_id FROM s_comments WHERE id = ?").get(id); if (c) recount(c.post_id); finish("comment", id); break; }
      case "comment-delete": { const c = db.prepare("SELECT c.id, c.post_id, c.text, c.created_at, u.username FROM s_comments c JOIN s_users u ON u.id = c.user_id WHERE c.id = ?").get(id); if (c) hold.keep("comment", c.id, c, { reason: "removed by owner" }); db.prepare("DELETE FROM s_comments WHERE id = ?").run(id); if (c) recount(c.post_id); finish("comment", id); break; }
      case "message-delete": {
        const m = db.prepare("SELECT m.id, m.text, m.photo, m.created_at, u.username FROM s_messages m JOIN s_users u ON u.id = m.sender_id WHERE m.id = ? AND m.reported = 1").get(id);
        if (m) {
          db.prepare("DELETE FROM s_messages WHERE id = ?").run(id);
          const kept = hold.keep("message", m.id, m, { photo: m.photo, reason: "reported message removed by owner" });
          if (kept) db.prepare("DELETE FROM s_media WHERE name = ?").run(kept); else dropMedia(m.photo);
        }
        finish("message", id); break;
      }
      case "dismiss": finish(String(b.kind || ""), id); break;
      case "ban": case "unban": {
        const u = db.prepare("SELECT * FROM s_users WHERE id = ?").get(id);
        if (!u) return bad(res, "Not found.", 404);
        db.prepare("UPDATE s_users SET status = ? WHERE id = ?").run(act === "ban" ? "banned" : "ok", id);
        if (act === "ban") { db.prepare("DELETE FROM s_sessions WHERE user_id = ?").run(id); finish("user", id); }
        break;
      }
      case "user-delete": deleteUser(id, "account closed by owner"); finish("user", id); break;
      case "photo-approval": db.prepare("INSERT INTO s_settings(k, v) VALUES('photoApproval', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(!!b.on)); break;
      default: return bad(res, "Unknown action.");
    }
    res.json({ ok: true });
  });

  return r;
};

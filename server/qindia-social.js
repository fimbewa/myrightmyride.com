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
const VIDEO_MAX = 40 * 1024 * 1024;       // 40 MB per short video (about 1 minute at 720p); the phone checks the length
const LONG_VIDEO_MAX = 100 * 1024 * 1024; // 100 MB per longer video for Watch (up to 10 minutes at 480p-720p)
const AUDIO_MAX = 3 * 1024 * 1024;        // 3 MB per voice message (2 minutes is about 1 MB)
// Media files: <32 hex>.<ext>. The extension tells the kind: jpg = photo, mp4/webm = video, m4a/weba/ogg = voice.
const MEDIA_RX = /^[a-f0-9]{32}\.(jpg|mp4|webm|m4a|weba|ogg)$/;
// Members' photos, videos and voice messages are OFF: the Community is text only, so the server never fills up
// (the site owner's decision, 28 Nov 2026). Files already uploaded still show. QI_MEMBER_MEDIA=1 turns uploads back on.
// A YouTube link in a post plays in the post and lists the post on Watch (the video stays on YouTube).
const YT_RX = /(?:youtube\.com\/(?:watch\?(?:\S*?&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;
const ytOf = text => { const m = String(text || "").match(YT_RX); return m ? m[1] : null; };
const memberMedia = () => process.env.QI_MEMBER_MEDIA === "1";
const TEXT_ONLY = "Qindia Community is text only: photos, videos and voice messages cannot be added.";
const KIND_OF = { jpg: "photo", mp4: "video", webm: "video", m4a: "audio", weba: "audio", ogg: "audio" };
const mediaKind = name => (name ? KIND_OF[String(name).split(".").pop()] || null : null);
// { photo } or { video } or { audio } with the address, for one stored media name.
const mediaOut = name => { const k = mediaKind(name); return k ? { [k]: "/media/" + name } : {}; };
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
  // Added later: sign in with Google / Facebook. pass_set = 0 for members who joined that way and never chose a password.
  if (!db.prepare("PRAGMA table_info(s_users)").all().some(c => c.name === "pass_set")) db.exec("ALTER TABLE s_users ADD COLUMN pass_set INTEGER NOT NULL DEFAULT 1");
  db.exec(`CREATE TABLE IF NOT EXISTS s_identities (
  provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, PRIMARY KEY (provider, subject))`);
  // Added later: posts made as a Page (page_id) and shares of another post (share_of).
  // Added later for Watch (YouTube-style videos): cover picture, length in seconds, and views.
  for (const col of ["poster TEXT", "duration INTEGER", "views INTEGER NOT NULL DEFAULT 0"]) if (!db.prepare("PRAGMA table_info(s_posts)").all().some(c => c.name === col.split(" ")[0])) db.exec(`ALTER TABLE s_posts ADD COLUMN ${col}`);
  db.exec("CREATE TABLE IF NOT EXISTS s_views (post_id INTEGER NOT NULL REFERENCES s_posts(id) ON DELETE CASCADE, viewer TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (post_id, viewer))");
  for (const col of ["page_id", "share_of"]) if (!db.prepare("PRAGMA table_info(s_posts)").all().some(c => c.name === col)) db.exec(`ALTER TABLE s_posts ADD COLUMN ${col} INTEGER`);
  db.exec("CREATE INDEX IF NOT EXISTS s_posts_page ON s_posts(page_id, id)");
  // Added later: an optional email (checked with a code) for resetting a forgotten password by email.
  if (!db.prepare("PRAGMA table_info(s_users)").all().some(c => c.name === "email")) db.exec("ALTER TABLE s_users ADD COLUMN email TEXT");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS s_users_email ON s_users(email) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS s_codes (
  user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, purpose TEXT NOT NULL, -- reset | verify
  email TEXT NOT NULL, salt TEXT NOT NULL, code_hash TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, purpose))`);
  const MEDIA = process.env.MEDIA_DIR || path.join(path.dirname(db.name), "media");
  fs.mkdirSync(MEDIA, { recursive: true });
  // IT Intermediary Rules 2021, rule 3(1)(g)/(h): what the owner removes, and the sign-up details of closed
  // accounts, are kept out of sight for 180 days (for complaints and lawful requests), then erased.
  const hold = require("./qindia-legal").legalHold(db, MEDIA);
  // IT Intermediary Rules 2021, rule 3(1)(c): remind every member of the rules at least once every three months
  // and whenever the rules change. RULES_DATE is the "last updated" date of /legal/terms.
  if (!db.prepare("PRAGMA table_info(s_users)").all().some(c => c.name === "rules_seen")) db.exec("ALTER TABLE s_users ADD COLUMN rules_seen INTEGER");
  const RULES_DATE = Date.UTC(2026, 10, 28, 9, 0), // text and links only (version 1.2)
    REMIND_MS = 90 * 24 * 3600_000;
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
    const u = findAccount(b.username).user;
    if (!u || !same(scrypt(String(b.password || ""), u.pass_salt), u.pass_hash)) return bad(res, "Wrong username or password.", 401);
    if (u.status === "banned") return bad(res, "This account has been stopped by the site owner for breaking the rules.", 403);
    res.json({ token: newSession(u.id), user: { username: u.username, name: u.name } });
  });

  // Find an account by username (with or without @) or by its saved email. Spaces and capitals do not matter.
  const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const normEmail = e => String(e || "").trim().toLowerCase();
  function findAccount(input) {
    const v = String(input || "").trim().toLowerCase();
    if (EMAIL_RX.test(v)) return { byEmail: true, value: v, user: db.prepare("SELECT * FROM s_users WHERE email = ?").get(v) };
    const name = v.replace(/^@/, "").replace(/\s+/g, "");
    return { byEmail: false, value: name, user: db.prepare("SELECT * FROM s_users WHERE username = ?").get(name) };
  }
  const notFound = (res, f) => bad(res, f.byEmail
    ? "No account has this email saved. Please type your username instead (it is on your profile, after the @ sign)."
    : `No account has the username "${f.value.slice(0, 40)}". Please check the spelling (your username is on your profile, after the @ sign).`, 404);
  // A new password: also gives a new recovery code and logs out every phone.
  function setNewPassword(u, pw) {
    const salt = crypto.randomBytes(16).toString("hex"), rsalt = crypto.randomBytes(16).toString("hex"), rec = recoveryCode();
    db.prepare("UPDATE s_users SET pass_salt = ?, pass_hash = ?, pass_set = 1, rec_salt = ?, rec_hash = ? WHERE id = ?").run(salt, scrypt(pw, salt), rsalt, scrypt(normRec(rec), rsalt), u.id);
    db.prepare("DELETE FROM s_sessions WHERE user_id = ?").run(u.id);
    db.prepare("DELETE FROM s_codes WHERE user_id = ? AND purpose = 'reset'").run(u.id);
    return rec;
  }

  // Forgotten password: username (or saved email) + the recovery code given at sign-up. A new recovery code is given each time.
  r.post("/api/s/recover", (req, res) => {
    const b = req.body || {};
    if (limited(req, "recover", 10, 3600_000)) return bad(res, "Too many tries. Please wait an hour.", 429);
    const f = findAccount(b.username), u = f.user;
    if (!u) return notFound(res, f);
    if (!normRec(b.code)) return bad(res, "Please type your recovery code.");
    if (!same(scrypt(normRec(b.code), u.rec_salt), u.rec_hash)) return bad(res, `This recovery code does not match @${u.username}. Please check it letter by letter${mailReady(mailCfg()) && u.email ? ", or get a code by email instead" : ""}.`, 401);
    if (String(b.password || "").length < 8) return bad(res, "The new password must be at least 8 characters.");
    if (u.status === "banned") return bad(res, "This account has been stopped by the site owner.", 403);
    const rec = setNewPassword(u, String(b.password));
    res.json({ token: newSession(u.id), recovery: rec, user: { username: u.username, name: u.name } });
  });

  // ---------- email codes (password reset by email, and checking a new email) ----------
  const { sendMail, mailReady } = require("./mailer");
  const mailCfg = () => setting("mail", null);
  const CODE_MS = 10 * 60_000, CODE_TRIES = 5;
  const mask = e => { const [a, d] = String(e).split("@"); return a.slice(0, Math.min(2, a.length - 1)) + "***@" + d; };
  const sent = new Map(); // "user id:purpose" -> times of codes sent (at most 1 a minute and 5 a day for each account)
  function tooMany(userId, purpose) {
    const k = userId + ":" + purpose, t = now(), list = (sent.get(k) || []).filter(x => t - x < 24 * 3600_000);
    sent.set(k, list);
    if (list.length && t - list[list.length - 1] < 60_000) return "Please wait one minute before asking for another code.";
    if (list.length >= 5) return "Too many codes for this account today. Please try again tomorrow.";
    list.push(t); return null;
  }
  async function sendCode(u, purpose, email) {
    db.prepare("DELETE FROM s_codes WHERE expires_at < ?").run(now()); // old codes are not kept
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"), salt = crypto.randomBytes(16).toString("hex");
    db.prepare("INSERT OR REPLACE INTO s_codes(user_id, purpose, email, salt, code_hash, tries, expires_at, created_at) VALUES(?,?,?,?,?,0,?,?)")
      .run(u.id, purpose, email, salt, sha(salt + code), now() + CODE_MS, now());
    const what = purpose === "reset" ? "set a new password for" : "save this email on";
    await sendMail(mailCfg(), {
      to: email, subject: `Your Qindiaglobal code: ${code}`,
      text: `Namaste ${u.name},\n\nYour code is: ${code}\n\nType it on qindiaglobal.com to ${what} your Q India Community account @${u.username}. It works for 10 minutes.\n\nIf you did not ask for this, ignore this email. Nothing changes and nobody can use the code without your email.\n\nQindiaglobal (a citizens' initiative, not connected with any government)`,
    }).catch(e => { db.prepare("DELETE FROM s_codes WHERE user_id = ? AND purpose = ?").run(u.id, purpose); console.log("[email] " + e.message); throw new Error("The email could not be sent just now. Please try again later, or use your recovery code."); });
  }
  // Checks a typed code. Returns the stored row when right, or an error text.
  function checkCode(u, purpose, typed) {
    const row = db.prepare("SELECT * FROM s_codes WHERE user_id = ? AND purpose = ?").get(u.id, purpose);
    if (!row || row.expires_at < now() || row.tries >= CODE_TRIES) return { error: "This code has expired. Please ask for a new code." };
    const c = String(typed || "").replace(/\D/g, "");
    if (c.length !== 6 || !same(sha(row.salt + c), row.code_hash)) {
      db.prepare("UPDATE s_codes SET tries = tries + 1 WHERE user_id = ? AND purpose = ?").run(u.id, purpose);
      const left = CODE_TRIES - row.tries - 1;
      return { error: left > 0 ? `Wrong code. Please check the 6 numbers in the email (${left} ${left === 1 ? "try" : "tries"} left).` : "Wrong code too many times. Please ask for a new code." };
    }
    return { row };
  }

  r.get("/api/s/reset/info", (req, res) => res.json({ email: mailReady(mailCfg()) }));
  r.post("/api/s/reset/start", async (req, res) => {
    const b = req.body || {};
    if (!mailReady(mailCfg())) return bad(res, "Codes by email are not switched on yet. Please use your recovery code.", 503);
    if (limited(req, "reset-start", 8, 3600_000)) return bad(res, "Too many tries. Please wait an hour.", 429);
    const f = findAccount(b.username), u = f.user;
    if (!u) return notFound(res, f);
    if (u.status === "banned") return bad(res, "This account has been stopped by the site owner.", 403);
    if (!u.email) return bad(res, `@${u.username} has no email saved, so we cannot send a code. Please use your recovery code. After you log in, add your email in Settings so that this works next time.`, 409);
    const wait = tooMany(u.id, "reset"); if (wait) return bad(res, wait, 429);
    try { await sendCode(u, "reset", u.email); } catch (e) { return bad(res, e.message, 502); }
    res.json({ ok: true, to: mask(u.email), username: u.username });
  });
  r.post("/api/s/reset/finish", (req, res) => {
    const b = req.body || {};
    if (limited(req, "reset-finish", 20, 3600_000)) return bad(res, "Too many tries. Please wait an hour.", 429);
    const f = findAccount(b.username), u = f.user;
    if (!u) return notFound(res, f);
    const c = checkCode(u, "reset", b.code); if (c.error) return bad(res, c.error, 401);
    if (String(b.password || "").length < 8) return bad(res, "The new password must be at least 8 characters.");
    if (u.status === "banned") return bad(res, "This account has been stopped by the site owner.", 403);
    const rec = setNewPassword(u, String(b.password));
    res.json({ token: newSession(u.id), recovery: rec, user: { username: u.username, name: u.name } });
  });

  // A logged-in member adds (or changes) their email: we send a code to it first, so only a working email of theirs is saved.
  r.post("/api/s/email/start", login, async (req, res) => {
    const me = req.me, email = normEmail(req.body && req.body.email);
    if (!mailReady(mailCfg())) return bad(res, "Email is not switched on yet by the site owner. Please try again later.", 503);
    if (!EMAIL_RX.test(email) || email.length > 120) return bad(res, "Please check the email address.");
    if (db.prepare("SELECT 1 FROM s_users WHERE email = ? AND id != ?").get(email, me.id)) return bad(res, "This email is already saved on another account.", 409);
    if (limited(req, "email-start", 10, 3600_000)) return bad(res, "Too many tries. Please wait an hour.", 429);
    const wait = tooMany(me.id, "verify"); if (wait) return bad(res, wait, 429);
    try { await sendCode(me, "verify", email); } catch (e) { return bad(res, e.message, 502); }
    res.json({ ok: true, to: email });
  });
  r.post("/api/s/email/confirm", login, (req, res) => {
    const me = req.me, c = checkCode(me, "verify", req.body && req.body.code);
    if (c.error) return bad(res, c.error, 401);
    if (db.prepare("SELECT 1 FROM s_users WHERE email = ? AND id != ?").get(c.row.email, me.id)) return bad(res, "This email is already saved on another account.", 409);
    db.prepare("UPDATE s_users SET email = ? WHERE id = ?").run(c.row.email, me.id);
    db.prepare("DELETE FROM s_codes WHERE user_id = ? AND purpose = 'verify'").run(me.id);
    res.json({ ok: true, email: c.row.email });
  });
  r.post("/api/s/email/remove", login, (req, res) => { db.prepare("UPDATE s_users SET email = NULL WHERE id = ?").run(req.me.id); res.json({ ok: true }); });
  // A fresh recovery code (the old one stops working), for example when the old one was seen by someone else.
  r.post("/api/s/recovery/new", login, (req, res) => {
    const me = req.me, b = req.body || {};
    if (me.pass_set && !same(scrypt(String(b.password || ""), me.pass_salt), me.pass_hash)) return bad(res, "The password is wrong.", 401);
    const rsalt = crypto.randomBytes(16).toString("hex"), rec = recoveryCode();
    db.prepare("UPDATE s_users SET rec_salt = ?, rec_hash = ? WHERE id = ?").run(rsalt, scrypt(normRec(rec), rsalt), me.id);
    res.json({ recovery: rec });
  });

  // Owner: email settings for the codes (free Gmail app password or free Brevo key).
  r.get("/api/admin/mail", owner, (req, res) => {
    const c = mailCfg() || {};
    res.json({ on: mailReady(c), kind: c.kind || "", user: c.user || "", from: c.from || "", name: c.name || "", saved: !!(c.pass || c.key),
      members: db.prepare("SELECT COUNT(*) AS n FROM s_users WHERE email IS NOT NULL").get().n });
  });
  r.post("/api/admin/mail", owner, (req, res) => {
    const b = req.body || {}, old = mailCfg() || {}, kind = String(b.kind || "");
    let cfg = null;
    if (kind === "gmail") {
      const user = normEmail(b.user), pass = String(b.pass || "").replace(/\s+/g, "") || (old.kind === "gmail" ? old.pass : "");
      if (!EMAIL_RX.test(user)) return bad(res, "Please type your Gmail address.");
      if (!/^[A-Za-z]{16}$/.test(pass)) return bad(res, "The app password is the 16 letters Google showed you (spaces do not matter).");
      cfg = { kind, user, pass, name: line(b.name, 40) || "Qindiaglobal" };
    } else if (kind === "brevo") {
      const key = String(b.key || "").trim() || (old.kind === "brevo" ? old.key : ""), from = normEmail(b.from);
      if (!key) return bad(res, "Please paste the Brevo API key.");
      if (!EMAIL_RX.test(from)) return bad(res, "Please type the sender email that you checked on Brevo.");
      cfg = { kind, key, from, name: line(b.name, 40) || "Qindiaglobal" };
    } else if (kind !== "") return bad(res, "Unknown choice.");
    if (cfg) db.prepare("INSERT INTO s_settings(k, v) VALUES('mail', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(cfg));
    else db.prepare("DELETE FROM s_settings WHERE k = 'mail'").run();
    res.json({ ok: true, on: !!cfg });
  });
  r.post("/api/admin/mail/test", owner, async (req, res) => {
    const c = mailCfg(); if (!mailReady(c)) return bad(res, "Please save the email settings first.");
    const to = normEmail((req.body && req.body.to) || c.user || c.from);
    if (!EMAIL_RX.test(to)) return bad(res, "Please check the email address.");
    try { await sendMail(c, { to, subject: "Qindiaglobal test email", text: "It works. Members can now get password codes by email from qindiaglobal.com." }); }
    catch (e) { return bad(res, e.message, 502); }
    res.json({ ok: true, to });
  });
  // Owner: give a member a new temporary password (after checking who they are, for example by phone).
  r.post("/api/admin/community/reset-password", owner, (req, res) => {
    const u = db.prepare("SELECT * FROM s_users WHERE id = ?").get(Number((req.body || {}).id));
    if (!u) return bad(res, "Not found.", 404);
    const abc = "abcdefghjkmnpqrstuvwxyz23456789", pw = Array.from(crypto.randomBytes(10), x => abc[x % abc.length]).join("");
    const rec = setNewPassword(u, pw);
    res.json({ username: u.username, password: pw, recovery: rec });
  });

  r.post("/api/s/logout", login, (req, res) => { db.prepare("DELETE FROM s_sessions WHERE token_hash = ?").run(req.me.tokenHash); res.json({ ok: true }); });

  r.get("/api/s/me", login, (req, res) => {
    const me = req.me;
    res.json({
      ...pubUser(me), bio: me.bio || "", city: me.city || "", dm: me.dm,
      notifs: db.prepare("SELECT COUNT(*) AS n FROM s_notifs WHERE user_id = ? AND read = 0").get(me.id).n,
      messages: unreadChats(me.id) + ext.unreadGroups(me.id),
      rulesDue: rulesDue(me), hasPassword: !!me.pass_set, email: me.email || "", emailOn: mailReady(mailCfg()), media: memberMedia(),
      linked: db.prepare("SELECT provider FROM s_identities WHERE user_id = ?").all(me.id).map(x => x.provider),
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
    if (me.pass_set && !same(scrypt(String(b.old || ""), me.pass_salt), me.pass_hash)) return bad(res, "The current password is wrong.", 401);
    if (String(b.password || "").length < 8) return bad(res, "The new password must be at least 8 characters.");
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("UPDATE s_users SET pass_salt = ?, pass_hash = ?, pass_set = 1 WHERE id = ?").run(salt, scrypt(b.password, salt), me.id);
    db.prepare("DELETE FROM s_sessions WHERE user_id = ? AND token_hash != ?").run(me.id, me.tokenHash);
    res.json({ ok: true });
  });

  // Delete my account: removes the profile, posts, comments, likes, follows, messages I sent and my photos.
  r.post("/api/s/delete-account", login, (req, res) => {
    const me = req.me;
    const b = req.body || {};
    // Members who joined with Google/Facebook and have no password confirm by typing their username.
    if (me.pass_set ? !same(scrypt(String(b.password || ""), me.pass_salt), me.pass_hash) : String(b.confirm || "").trim().toLowerCase().replace(/^@/, "") !== me.username)
      return bad(res, me.pass_set ? "The password is wrong." : "Please type your username to confirm.", 401);
    deleteUser(me.id);
    res.json({ ok: true });
  });
  function deleteUser(id, reason = "account deleted by the member") {
    const u = db.prepare("SELECT id, username, name, city, status, ip_hash, created_at, last_seen FROM s_users WHERE id = ?").get(id);
    if (u) hold.keep("account", u.id, u, { reason });
    const files = db.prepare("SELECT name FROM s_media WHERE user_id = ?").all(id).map(x => x.name);
    let tidy = () => {};
    db.transaction(() => {
      tidy = ext.beforeUserDelete(id);
      for (const c of db.prepare("SELECT DISTINCT post_id FROM s_comments WHERE user_id = ?").all(id)) db.prepare("UPDATE s_posts SET comments = MAX(0, comments - (SELECT COUNT(*) FROM s_comments WHERE post_id = ? AND user_id = ?)) WHERE id = ?").run(c.post_id, id, c.post_id);
      for (const l of db.prepare("SELECT post_id FROM s_likes WHERE user_id = ?").all(id)) db.prepare("UPDATE s_posts SET likes = MAX(0, likes - 1) WHERE id = ?").run(l.post_id);
      db.prepare("DELETE FROM s_users WHERE id = ?").run(id); // everything else goes with it (ON DELETE CASCADE)
    })();
    tidy();
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
    if (!memberMedia()) return bad(res, TEXT_ONLY, 403);
    if (limited(req, "upload:" + me.id, 60, 24 * 3600_000)) return bad(res, "You have added many photos today. Please try tomorrow.", 429);
    if (diskFree() < MIN_FREE_DISK) return bad(res, "Photo space on the server is full for now. Please post text only; the owner has been told.", 507);
    const jpg = Buffer.isBuffer(req.body) ? stripJpeg(req.body) : null;
    if (!jpg) return bad(res, "Please choose a photo (JPEG, PNG or similar).");
    const name = crypto.randomBytes(16).toString("hex") + ".jpg"; // long random name: nobody can guess the address
    fs.writeFileSync(path.join(MEDIA, name), jpg);
    db.prepare("INSERT INTO s_media(name, user_id, bytes, created_at) VALUES(?,?,?,?)").run(name, me.id, jpg.length, now());
    res.json({ id: name });
  });
  // Short videos and voice messages: kept as the phone recorded them (MP4, WebM, M4A or Ogg); only the file type is checked.
  function sniff(buf, kind) {
    if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
    const ftyp = buf.toString("latin1", 4, 8) === "ftyp", webm = buf.readUInt32BE(0) === 0x1a45dfa3, ogg = buf.toString("latin1", 0, 4) === "OggS";
    if (kind === "video") return ftyp ? "mp4" : webm ? "webm" : null;
    if (kind === "audio") return ftyp ? "m4a" : webm ? "weba" : ogg ? "ogg" : null;
    return null;
  }
  r.post("/api/s/upload-av", login, express.raw({ type: () => true, limit: LONG_VIDEO_MAX }), (req, res) => {
    const me = req.me, kind = req.query.kind === "audio" ? "audio" : "video";
    if (!memberMedia()) return bad(res, TEXT_ONLY, 403);
    if (kind === "video" && req.query.long !== "1" && Buffer.isBuffer(req.body) && req.body.length > VIDEO_MAX) return bad(res, "This video is too big for a short video.", 413);
    if (kind === "video" ? limited(req, "video:" + me.id, 15, 24 * 3600_000) : limited(req, "voice:" + me.id, 300, 24 * 3600_000))
      return bad(res, kind === "video" ? "You have added many videos today. Please try tomorrow." : "You have sent many voice messages today. Please try tomorrow.", 429);
    if (kind === "audio" && Buffer.isBuffer(req.body) && req.body.length > AUDIO_MAX) return bad(res, "This voice message is too long. Please keep it under 2 minutes.", 413);
    if (diskFree() < MIN_FREE_DISK + (req.body ? req.body.length : 0)) return bad(res, "Space on the server is full for now. Please post text only; the owner has been told.", 507);
    const ext = sniff(req.body, kind);
    if (!ext) return bad(res, kind === "video" ? "Please choose a video (MP4 or WebM, as recorded by your phone)." : "This voice message could not be read. Please try again.");
    const name = crypto.randomBytes(16).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(MEDIA, name), req.body);
    db.prepare("INSERT INTO s_media(name, user_id, bytes, created_at) VALUES(?,?,?,?)").run(name, me.id, req.body.length, now());
    res.json({ id: name });
  });
  function takeMedia(name, userId, kind = "photo") {
    if (!MEDIA_RX.test(String(name)) || mediaKind(name) !== kind) return null;
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
    if (!MEDIA_RX.test(req.params.name)) return next();
    res.set("Cache-Control", "public, max-age=31536000, immutable").set("X-Robots-Tag", "noindex");
    res.sendFile(path.join(MEDIA, req.params.name), err => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ---------- posts ----------
  const postOut = (p, meId, inner = false) => {
    const out = {
      id: p.id, text: p.text || "", photo: null, ...mediaOut(p.photo), status: p.status,
      ...(mediaKind(p.photo) === "video" ? { poster: p.poster ? "/media/" + p.poster : null, duration: p.duration || 0, views: p.views || 0 } : {}),
      ...(!p.photo && ytOf(p.text) ? { yt: ytOf(p.text), views: p.views || 0 } : {}),
      likes: p.likes, comments: p.comments, created_at: p.created_at,
      liked: meId ? !!db.prepare("SELECT 1 FROM s_likes WHERE post_id = ? AND user_id = ?").get(p.id, meId) : false,
      mine: meId === p.user_id,
      // A post made as a Page shows the Page (like Facebook), not the person who wrote it.
      user: p.page_id ? { username: p.pg_handle, name: p.pg_name, avatar: avatarUrl(p.pg_avatar), page: true } : { username: p.username, name: p.name, avatar: avatarUrl(p.avatar) },
    };
    // A share shows the original post inside it (or a note when the original is gone).
    if (p.share_of && !inner) {
      const o = db.prepare(`${POST_SQL} WHERE p.id = ? AND ${visible(0)}${notBlocked(meId)}`).get(p.share_of);
      out.shared = o ? postOut(o, meId, true) : { gone: true };
    }
    return out;
  };
  const POST_SQL = "SELECT p.*, u.username, u.name, u.avatar, pg.handle AS pg_handle, pg.name AS pg_name, pg.avatar AS pg_avatar FROM s_posts p JOIN s_users u ON u.id = p.user_id LEFT JOIN s_pages pg ON pg.id = p.page_id";
  // A post is visible to everyone when it is "ok"; its author also sees it while it waits for the owner.
  // Posts of a Page that the site owner closed are not shown.
  const visible = meId => `(p.status = 'ok' OR (p.user_id = ${Number(meId) || 0} AND p.status = 'pending')) AND u.status = 'ok' AND (p.page_id IS NULL OR pg.status = 'ok')`;
  const notBlocked = meId => (meId ? ` AND p.user_id NOT IN (SELECT blocked_id FROM s_blocks WHERE blocker_id = ${Number(meId)}) AND p.user_id NOT IN (SELECT blocker_id FROM s_blocks WHERE blocked_id = ${Number(meId)})` : "");
  const before = req => { const n = Number(req.query.before); return Number.isFinite(n) && n > 0 ? n : 2 ** 53; };

  r.post("/api/s/posts", login, (req, res) => {
    const b = req.body || {}, me = req.me;
    const text = para(b.text, TEXT_MAX);
    // Share another post (with optional words of my own). Sharing a share shares the original.
    let shareOf = null;
    if (b.share) {
      const o = db.prepare(`${POST_SQL} WHERE p.id = ? AND p.status = 'ok' AND u.status = 'ok' AND (p.page_id IS NULL OR pg.status = 'ok')`).get(Number(b.share));
      if (!o || blockedEither(o.user_id, me.id)) return bad(res, "This post cannot be shared.", 404);
      shareOf = o.share_of || o.id;
      if (b.photo || b.video) return bad(res, "A share cannot have its own photo or video.");
    }
    // Post as a Page I manage.
    let pageId = null;
    if (b.page) { pageId = ext.myPage(me.id, b.page); if (!pageId) return bad(res, "You can post only on your own Page.", 403); }
    if (!text && !b.photo && !b.video && !shareOf) return bad(res, "Write something or add a photo or video.");
    if (isBad(text, false)) return bad(res, "Please remove rude, sexual or abusive words. Qindia is a family place.");
    if (limited(req, "post:" + me.id, 30, 3600_000)) return bad(res, "You have posted a lot in the last hour. Please wait a little.", 429);
    let photo = null; // the photo or the video (s_posts.photo holds either; the file name says which)
    let poster = null, duration = null;
    if (b.video) {
      photo = takeMedia(b.video, me.id, "video"); if (!photo) return bad(res, "The video was not found. Please choose it again.");
      if (b.poster) poster = takeMedia(b.poster, me.id); // cover picture made by the phone from the video
      duration = Math.max(0, Math.min(36000, Math.round(Number(b.duration) || 0))) || null;
    }
    else if (b.photo) { photo = takeMedia(b.photo, me.id); if (!photo) return bad(res, "The photo was not found. Please choose it again."); }
    const status = isDoubtful(text) || me.reports >= 3 || (photo && photoApproval()) ? "pending" : "ok";
    const id = db.prepare("INSERT INTO s_posts(user_id, text, photo, status, created_at, page_id, share_of, poster, duration) VALUES(?,?,?,?,?,?,?,?,?)").run(me.id, text || null, photo, status, now(), pageId, shareOf, poster, duration).lastInsertRowid;
    if (shareOf && status === "ok") { const o = db.prepare("SELECT user_id FROM s_posts WHERE id = ?").get(shareOf); if (o) notify(o.user_id, "share", me.id, id); }
    res.json({ post: postOut(db.prepare(POST_SQL + " WHERE p.id = ?").get(id), me.id) });
  });

  // Feed. tab=following: people I follow and me. tab=all: everyone (newest first).
  r.get("/api/s/feed", optional, (req, res) => {
    const meId = req.me && req.me.status === "ok" ? req.me.id : 0;
    const tab = meId && req.query.tab === "following" ? "following" : "all";
    const who = tab === "following" ? ` AND (p.user_id = ${meId} OR (p.page_id IS NULL AND p.user_id IN (SELECT followee_id FROM s_follows WHERE follower_id = ${meId})) OR p.page_id IN (SELECT page_id FROM s_page_follows WHERE user_id = ${meId}))` : "";
    const rows = db.prepare(`${POST_SQL} WHERE ${visible(meId)}${notBlocked(meId)}${who} AND p.id < ? ORDER BY p.id DESC LIMIT ${PAGE}`).all(before(req));
    res.json({ posts: rows.map(p => postOut(p, meId)), more: rows.length === PAGE });
  });

  // Reels: short videos from everyone, newest first.
  r.get("/api/s/reels", optional, (req, res) => {
    const meId = req.me && req.me.status === "ok" ? req.me.id : 0;
    const rows = db.prepare(`${POST_SQL} WHERE ${visible(meId)}${notBlocked(meId)} AND (p.photo LIKE '%.mp4' OR p.photo LIKE '%.webm') AND IFNULL(p.duration, 0) <= 95 AND p.id < ? ORDER BY p.id DESC LIMIT 10`).all(before(req));
    res.json({ posts: rows.map(p => postOut(p, meId)), more: rows.length === 10 });
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
    db.prepare("DELETE FROM s_posts WHERE id = ?").run(p.id); dropMedia(p.photo); dropMedia(p.poster);
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
    const posts = db.prepare(`${POST_SQL} WHERE p.user_id = ? AND p.page_id IS NULL AND ${visible(meId)} AND p.id < ? ORDER BY p.id DESC LIMIT ${PAGE}`).all(u.id, before(req));
    res.json({
      user: {
        ...pubUser(u), bio: u.bio || "", city: u.city || "", joined: u.created_at,
        posts: db.prepare("SELECT COUNT(*) AS n FROM s_posts WHERE user_id = ? AND page_id IS NULL AND status = 'ok'").get(u.id).n,
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
    const tbl = { post: "s_posts", comment: "s_comments", user: "s_users" }[kind], more = ext.reportKinds[kind];
    if (more) { if (!more.ok(me, id)) return bad(res, "Not found.", 404); }
    else if (kind === "message") {
      const m = db.prepare("SELECT m.* FROM s_messages m JOIN s_convos c ON c.id = m.convo_id WHERE m.id = ? AND (c.a_id = ? OR c.b_id = ?) AND m.sender_id != ?").get(id, me.id, me.id, me.id);
      if (!m) return bad(res, "Not found.", 404);
      db.prepare("UPDATE s_messages SET reported = 1 WHERE id = ?").run(id); // only reported messages are shown to the owner
    } else if (!tbl || !db.prepare(`SELECT 1 FROM ${tbl} WHERE id = ?`).get(id)) return bad(res, "Not found.", 404);
    const fresh = db.prepare("INSERT OR IGNORE INTO s_reports(kind, target_id, reporter_id, reason, created_at) VALUES(?,?,?,?,?)").run(kind, id, me.id, reason || null, now()).changes;
    if (fresh && more) more.bump(id);
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
          user: pubUser(c), last: c.last_photo && !c.last_text ? (mediaKind(c.last_photo) === "audio" ? "🎤 Voice message" : "📷 Photo") : c.last_text || "", lastMine: c.last_sender === me.id, at: c.last_at,
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
      messages: msgs.map(m => ({ id: m.id, mine: m.sender_id === me.id, text: m.text || "", photo: null, ...mediaOut(m.photo), at: m.created_at })),
    });
  });
  r.post("/api/s/chats/:username", login, (req, res) => {
    const u = target(req), me = req.me, b = req.body || {};
    if (!u || u.id === me.id) return bad(res, "This person was not found.", 404);
    const text = para(b.text, MESSAGE_MAX);
    if (!text && !b.photo && !b.audio) return bad(res, "Write a message.");
    let c = convoWith(me.id, u.id, false);
    if (limited(req, "msg:" + me.id, 300, 3600_000) || (!c && limited(req, "newchat:" + me.id, 40, 24 * 3600_000)))
      return bad(res, "You are sending too many messages. Please wait a little.", 429);
    const why = canSend(me, u, c);
    if (why) return bad(res, why, 403);
    // Photos in private chats only between people who follow each other (so strangers cannot send pictures).
    // Photos and voice messages in private chats only between people who follow each other (so strangers cannot send them).
    let photo = null; // the photo or the voice message (s_messages.photo holds either; the file name says which)
    if (b.photo || b.audio) {
      if (!(follows(me.id, u.id) && follows(u.id, me.id))) return bad(res, b.audio ? "You can send voice messages only when you both follow each other." : "You can send photos only when you both follow each other.", 403);
      photo = b.audio ? takeMedia(b.audio, me.id, "audio") : takeMedia(b.photo, me.id); if (!photo) return bad(res, "The file was not found. Please try again.");
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

  // ---------- group chats and Status / Stories (server/qindia-groups.js, server/qindia-stories.js) ----------
  const ext = { ytOf, db, r, login, bad, now, line, para, takeMedia, mediaKind, mediaOut, dropMedia, pubUser, blockedEither, follows, limited, isBad, isDoubtful, photoApproval, hold,
    reportKinds: {}, reportItem: {}, ownerActions: {}, ownerCounts: {}, ownerPending: {} };
  require("./qindia-groups")(ext);
  require("./qindia-stories")(ext);
  Object.assign(ext, { POST_SQL, visible, notBlocked, postOut, before, PAGE, ipHash, who });
  require("./qindia-pages")(ext);
  require("./qindia-watch")(ext);
  Object.assign(ext, { owner, setting });
  require("./qindia-calls")(ext);

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
      ...Object.fromEntries(Object.entries(ext.ownerCounts).map(([k, f]) => [k, f()])),
      ...Object.fromEntries(Object.entries(ext.ownerPending).map(([k, f]) => ["pending" + k[0].toUpperCase() + k.slice(1), f()])),
      photoMB: Math.round(n("SELECT IFNULL(SUM(bytes),0) AS n FROM s_media") / 1048576), mediaFiles: n("SELECT COUNT(*) AS n FROM s_media"), memberMedia: memberMedia(),
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
        if (ext.reportItem[x.kind]) item = ext.reportItem[x.kind](x.target_id);
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
        const p = db.prepare("SELECT p.id, p.text, p.photo, p.poster, p.created_at, u.username FROM s_posts p JOIN s_users u ON u.id = p.user_id WHERE p.id = ?").get(id);
        db.prepare("DELETE FROM s_posts WHERE id = ?").run(id);
        if (p) dropMedia(p.poster);
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
      default:
        if (!ext.ownerActions[act]) return bad(res, "Unknown action.");
        ext.ownerActions[act](id); finish(act.split("-")[0], id); // groupmsg-delete, group-close, story-ok, ...
    }
    res.json({ ok: true });
  });

  // ---------- sign in with Google / Facebook (OAuth 2.0) ----------
  // The owner pastes each provider's App/Client ID and secret on /admin (stored in s_settings). We ask only for the
  // public profile (a stable account number and the name): no email, no friends, no posting on the person's behalf.
  const PROVIDERS = {
    google: {
      label: "Google", scope: "openid profile",
      auth: "https://accounts.google.com/o/oauth2/v2/auth",
      async profile(code, cfg, redirect) {
        const t = await postForm("https://oauth2.googleapis.com/token", { code, client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirect, grant_type: "authorization_code" });
        const u = await getJson("https://openidconnect.googleapis.com/v1/userinfo", { authorization: "Bearer " + t.access_token });
        return { subject: String(u.sub || ""), name: u.name || u.given_name || "" };
      },
    },
    facebook: {
      label: "Facebook", scope: "public_profile",
      auth: "https://www.facebook.com/v21.0/dialog/oauth",
      async profile(code, cfg, redirect) {
        const t = await getJson("https://graph.facebook.com/v21.0/oauth/access_token?" + new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirect, code }));
        const proof = crypto.createHmac("sha256", cfg.secret).update(t.access_token).digest("hex");
        const u = await getJson("https://graph.facebook.com/v21.0/me?" + new URLSearchParams({ fields: "id,name", access_token: t.access_token, appsecret_proof: proof }));
        return { subject: String(u.id || ""), name: u.name || "" };
      },
    },
  };
  async function getJson(url, headers = {}) {
    const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(10000) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error("provider said " + res.status + " " + JSON.stringify(d.error || "").slice(0, 200));
    return d;
  }
  async function postForm(url, form) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(10000) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error || !d.access_token) throw new Error("provider said " + res.status + " " + String(d.error || "").slice(0, 100));
    return d;
  }
  const oauthCfg = p => { const c = setting("oauth_" + p, null); return c && c.id && c.secret ? c : null; };
  // One fixed web address per provider (without "www."), which the owner also gives to Google/Facebook.
  const siteBase = req => process.env.QI_PUBLIC_URL || `${req.protocol}://${String(req.get("host") || "").replace(/^www\./i, "")}`;
  const callbackUrl = (req, p) => `${siteBase(req)}/auth/${p}/callback`;
  const states = new Map(), handoffs = new Map(); // short-lived, kept in memory (a restart only means "try again")
  setInterval(() => { const t = now(); for (const m of [states, handoffs]) for (const [k, v] of m) if (v.until < t) m.delete(k); }, 60_000).unref();
  const cookie = (req, name) => (new RegExp("(?:^|;\\s*)" + name + "=([a-f0-9]{32,64})").exec(req.get("cookie") || "") || [])[1] || "";
  const toCommunity = (res, frag) => res.redirect(302, "/community#/" + frag);

  r.get("/api/s/oauth", (req, res) => res.json(Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, !!oauthCfg(p)]))));

  r.get("/auth/:p/start", (req, res, next) => {
    const P = PROVIDERS[req.params.p]; if (!P) return next();
    const cfg = oauthCfg(req.params.p);
    if (!cfg) return toCommunity(res, "oauth-error/off");
    if (/^www\./i.test(req.get("host") || "") && !process.env.QI_PUBLIC_URL) return res.redirect(302, siteBase(req) + req.originalUrl);
    if (limited(req, "oauth", 30, 3600_000)) return toCommunity(res, "oauth-error/busy");
    const state = crypto.randomBytes(16).toString("hex");
    const ref = /^[a-z0-9_.]{3,20}$/i.test(String(req.query.ref || "")) ? String(req.query.ref).toLowerCase() : "";
    states.set(state, { p: req.params.p, ref, until: now() + 10 * 60_000 });
    // The cookie ties the answer to this browser, so nobody can log someone else into their account.
    res.set("Set-Cookie", `qi_oauth=${state}; Path=/auth; Max-Age=600; HttpOnly; SameSite=Lax${req.secure ? "; Secure" : ""}`);
    res.redirect(302, P.auth + "?" + new URLSearchParams({ client_id: cfg.id, redirect_uri: callbackUrl(req, req.params.p), response_type: "code", scope: P.scope, state }));
  });

  r.get("/auth/:p/callback", async (req, res, next) => {
    const p = req.params.p, P = PROVIDERS[p]; if (!P) return next();
    res.set("Set-Cookie", `qi_oauth=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax${req.secure ? "; Secure" : ""}`);
    const state = String(req.query.state || ""), st = states.get(state);
    states.delete(state);
    if (req.query.error) return toCommunity(res, "oauth-error/cancel");
    if (!st || st.p !== p || cookie(req, "qi_oauth") !== state) return toCommunity(res, "oauth-error/expired");
    const cfg = oauthCfg(p); if (!cfg) return toCommunity(res, "oauth-error/off");
    let prof;
    try { prof = await P.profile(String(req.query.code || ""), cfg, callbackUrl(req, p)); }
    catch (e) { console.log(`[sign-in ${p}] ${e.message}`); return toCommunity(res, "oauth-error/failed"); }
    if (!prof.subject) return toCommunity(res, "oauth-error/failed");
    const code = crypto.randomBytes(24).toString("hex");
    const known = db.prepare("SELECT u.* FROM s_identities i JOIN s_users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?").get(p, prof.subject);
    if (known) {
      if (known.status === "banned") return toCommunity(res, "oauth-error/banned");
      handoffs.set(code, { token: newSession(known.id), until: now() + 5 * 60_000 });
    } else {
      if (banned(ipHash(req))) return toCommunity(res, "oauth-error/banned");
      handoffs.set(code, { pending: { p, subject: prof.subject, name: line(prof.name, 50), ref: st.ref }, ip: ipHash(req), until: now() + 30 * 60_000 });
    }
    toCommunity(res, "oauth/" + code);
  });

  // The page swaps the one-time code for a login, or (first time) for the details to finish joining.
  const suggest = name => {
    let base = String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 16);
    if (base.length < 3 || RESERVED.has(base) || isBad(base, false)) base = "member";
    for (let i = 0; i < 50; i++) { const u = i ? base + "_" + crypto.randomInt(10, 9999) : base; if (!db.prepare("SELECT 1 FROM s_users WHERE username = ?").get(u)) return u; }
    return "member_" + crypto.randomBytes(3).toString("hex");
  };
  r.post("/api/s/oauth/claim", (req, res) => {
    const code = String((req.body || {}).code || ""), h = handoffs.get(code);
    if (!h || h.until < now()) return bad(res, "This sign-in link has expired. Please try again.", 410);
    if (h.token) { handoffs.delete(code); return res.json({ token: h.token }); }
    const n = h.pending.name && !isBad(h.pending.name) ? h.pending.name : "";
    res.json({ pending: { provider: PROVIDERS[h.pending.p].label, name: n, username: suggest(n) } });
  });
  r.post("/api/s/oauth/finish", (req, res) => {
    const b = req.body || {}, code = String(b.code || ""), h = handoffs.get(code);
    if (!h || !h.pending || h.until < now()) return bad(res, "This sign-in link has expired. Please try again.", 410);
    const username = String(b.username || "").trim().toLowerCase().replace(/^@/, ""), name = line(b.name, 50);
    if (!USERNAME_RX.test(username)) return bad(res, "Username: 3 to 20 small English letters, numbers, _ or . (for example ravi_patil).");
    if (RESERVED.has(username) || isBad(username, false)) return bad(res, "Please choose another username.");
    if (!name || isBad(name)) return bad(res, "Please write your name (no rude words, links or phone numbers).");
    if (!(b.agree === true || b.agree === "on")) return bad(res, "Please tick that you are 18 or older and agree to the Terms.");
    if (limited(req, "signup", 5, 24 * 3600_000)) return bad(res, "Too many new accounts from this connection today. Please try tomorrow.", 429);
    if (db.prepare("SELECT 1 FROM s_users WHERE username = ?").get(username)) return bad(res, "This username is taken. Please choose another.", 409);
    const { p, subject } = h.pending;
    if (db.prepare("SELECT 1 FROM s_identities WHERE provider = ? AND subject = ?").get(p, subject)) return bad(res, "This account is already joined. Please sign in again.", 409);
    const salt = crypto.randomBytes(16).toString("hex"), rsalt = crypto.randomBytes(16).toString("hex");
    const ref = String(b.ref || h.pending.ref || "").toLowerCase().replace(/^@/, "");
    const refBy = (db.prepare("SELECT id FROM s_users WHERE username = ? AND status = 'ok'").get(ref) || {}).id || null;
    const id = db.transaction(() => {
      const uid = db.prepare("INSERT INTO s_users(username, name, city, pass_salt, pass_hash, rec_salt, rec_hash, ip_hash, created_at, last_seen, ref_by, pass_set, rules_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?)")
        .run(username, name, line(b.city, 60) && !isBad(b.city) ? line(b.city, 60) : null, salt, crypto.randomBytes(32).toString("hex"), rsalt, crypto.randomBytes(32).toString("hex"), h.ip || ipHash(req), now(), now(), refBy, now()).lastInsertRowid;
      db.prepare("INSERT INTO s_identities(provider, subject, user_id, created_at) VALUES(?,?,?,?)").run(p, subject, uid, now());
      return uid;
    })();
    handoffs.delete(code);
    res.json({ token: newSession(id), user: { username, name } });
  });
  // A logged-in member can remove a linked Google/Facebook sign-in (only if a password is set, so they can still log in).
  r.post("/api/s/oauth/unlink", login, (req, res) => {
    const me = req.me, p = String((req.body || {}).provider || "");
    const others = db.prepare("SELECT COUNT(*) AS n FROM s_identities WHERE user_id = ? AND provider != ?").get(me.id, p).n;
    if (!me.pass_set && !others) return bad(res, "Please set a password first, so that you can still log in.");
    db.prepare("DELETE FROM s_identities WHERE user_id = ? AND provider = ?").run(me.id, p);
    res.json({ ok: true });
  });

  // Owner: paste the keys from Google Cloud / Meta for Developers. The secret is never sent back to the page.
  r.get("/api/admin/oauth", owner, (req, res) => {
    res.json(Object.fromEntries(Object.keys(PROVIDERS).map(p => { const c = setting("oauth_" + p, null); return [p, { on: !!oauthCfg(p), id: c ? c.id : "", redirect: callbackUrl(req, p), members: db.prepare("SELECT COUNT(*) AS n FROM s_identities WHERE provider = ?").get(p).n }]; })));
  });
  r.post("/api/admin/oauth", owner, (req, res) => {
    const b = req.body || {}, p = String(b.provider || "");
    if (!PROVIDERS[p]) return bad(res, "Unknown provider.");
    const id = String(b.id || "").trim(), secret = String(b.secret || "").trim();
    if (!id && !secret) { db.prepare("DELETE FROM s_settings WHERE k = ?").run("oauth_" + p); return res.json({ ok: true, on: false }); }
    const old = setting("oauth_" + p, null);
    const sec = secret || (old && old.id === id ? old.secret : "");
    if (!/^[\w.\-]{5,200}$/.test(id)) return bad(res, "The ID does not look right. Copy it again.");
    if (!/^[\w.\-]{8,200}$/.test(sec)) return bad(res, "The secret does not look right. Copy it again.");
    db.prepare("INSERT INTO s_settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run("oauth_" + p, JSON.stringify({ id, secret: sec }));
    res.json({ ok: true, on: true });
  });

  return r;
};

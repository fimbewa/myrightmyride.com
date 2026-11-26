// qindiaglobal.com advertising: the site's own ad manager plus optional Google AdSense.
// - Owner (and advertisers through /advertise) add banner/text ads: picture, title, short text, link, pages, dates.
// - Advertiser ads wait for the owner's approval. Ads show in the "qi-ad" boxes on the pages (sites/qindiaglobal/ads.js),
//   always marked "Ad". Views and clicks are counted per day; clicks go through /ads/go/<id> and then to the advertiser.
// - When no own ad is running, a box can show Google AdSense instead (owner pastes the publisher ID on the ads page).
// Only mounted for the qindiaglobal domain (server/qindia.js).
const crypto = require("crypto");
const express = require("express");

const SLOTS = ["home", "blog", "post", "feed"]; // home page, blog list, blog posts, social feed
const STATUSES = new Set(["pending", "active", "paused", "rejected"]);
const IMG_MAX = 700 * 1024;
const IMG_TYPES = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46], "image/gif": [0x47, 0x49, 0x46] };
const PUB_RX = /^(?:ca-)?pub-(\d{10,20})$/;
const UNIT_RX = /^\d{6,14}$/;

module.exports = function ads(db, { human, isBad }) {
  db.exec(`
CREATE TABLE IF NOT EXISTS q_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL, source TEXT NOT NULL,
  advertiser TEXT, contact TEXT, title TEXT NOT NULL, text TEXT, link TEXT NOT NULL,
  image BLOB, image_type TEXT, slots TEXT NOT NULL, starts TEXT, ends TEXT,
  weight INTEGER NOT NULL DEFAULT 1, price TEXT, paid REAL NOT NULL DEFAULT 0, note TEXT,
  views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS q_ad_days (ad_id INTEGER NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ad_id, day));
CREATE TABLE IF NOT EXISTS q_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
  const getKv = k => (db.prepare("SELECT v FROM q_kv WHERE k = ?").get(k) || {}).v;
  const setKv = (k, v) => db.prepare("INSERT INTO q_kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, String(v));
  let secret = getKv("secret");
  if (!secret) { secret = crypto.randomBytes(32).toString("hex"); setKv("secret", secret); }

  // Settings kept in q_kv: ads on/off, AdSense publisher ID, AdSense ad unit ID, AdSense mode, public rates text.
  const settings = () => ({
    enabled: getKv("ads_enabled") !== "0",
    adsenseClient: getKv("ads_adsense_client") || "",
    adsenseSlot: getKv("ads_adsense_slot") || "",
    adsenseMode: getKv("ads_adsense_mode") || "off", // off | fill (only empty boxes) | auto (Google places ads too)
    rates: getKv("ads_rates") || "",
  });

  const r = express.Router();
  const now = () => Date.now();
  const clean = (s, n = 80) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const ipHash = req => crypto.createHmac("sha256", secret).update(String(req.ip || "")).digest("hex").slice(0, 24);
  // Today's date in India, as YYYY-MM-DD (the start/end dates the owner types are Indian dates).
  const today = () => new Date(now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const dateOrNull = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);
  const goodLink = s => { try { const u = new URL(String(s || "").trim()); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.href.slice(0, 500) : null; } catch { return null; } };
  const slotList = v => { const a = (Array.isArray(v) ? v : String(v || "").split(",")).map(s => String(s).trim()).filter(s => SLOTS.includes(s)); return a.length ? [...new Set(a)].join(",") : null; };

  const hits = new Map();
  function limited(key, max, windowMs) {
    const t = now(), list = (hits.get(key) || []).filter(x => t - x < windowMs);
    list.push(t); hits.set(key, list);
    return list.length > max;
  }
  setInterval(() => { const t = now(); for (const [k, v] of hits) if (!v.some(x => t - x < 24 * 3600_000)) hits.delete(k); }, 3600_000).unref();

  // Picture sent as a data: link. Only real JPEG/PNG/WebP/GIF files up to 700 KB.
  function readImage(dataUrl) {
    if (!dataUrl) return { none: true };
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) return { error: "The picture must be a JPG, PNG, WebP or GIF file." };
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > IMG_MAX) return { error: "The picture is too big. Please use one under 700 KB." };
    if (!IMG_TYPES[m[1]].every((b, i) => buf[i] === b)) return { error: "The picture file is damaged or not a picture." };
    return { buf, type: m[1] };
  }

  // Which ads may show now: active, inside their dates, for this box.
  const running = slot => db.prepare(`SELECT id, advertiser, title, text, slots, weight, image_type FROM q_ads WHERE status = 'active'
    AND (starts IS NULL OR starts <= @d) AND (ends IS NULL OR ends >= @d) AND (',' || slots || ',') LIKE @s`).all({ d: today(), s: "%," + slot + ",%" });
  function pick(list) {
    const total = list.reduce((s, a) => s + Math.max(1, a.weight), 0);
    let x = Math.random() * total;
    for (const a of list) if ((x -= Math.max(1, a.weight)) < 0) return a;
    return list[0];
  }
  const bump = db.prepare(`INSERT INTO q_ad_days(ad_id, day, views, clicks) VALUES(@id, @d, @v, @c)
    ON CONFLICT(ad_id, day) DO UPDATE SET views = views + @v, clicks = clicks + @c`);
  const count = (id, what) => {
    const v = what === "views" ? 1 : 0, c = what === "clicks" ? 1 : 0;
    db.prepare(`UPDATE q_ads SET views = views + ?, clicks = clicks + ? WHERE id = ?`).run(v, c, id);
    bump.run({ id, d: today(), v, c });
  };
  // One view and one click per visitor per ad per 30 minutes, so reloading a page does not pump the numbers.
  const seen = new Map();
  const firstTime = key => { const t = now(), last = seen.get(key); seen.set(key, t); return !last || t - last > 30 * 60_000; };
  setInterval(() => { const t = now(); for (const [k, v] of seen) if (t - v > 30 * 60_000) seen.delete(k); }, 600_000).unref();

  // ---------- public ----------
  r.get("/api/ads", (req, res) => {
    res.set("Cache-Control", "no-store");
    const s = settings();
    const out = { ads: {}, adsense: null, label: "Ad" };
    if (!s.enabled) return res.json(out);
    const pubOk = PUB_RX.test(s.adsenseClient) && s.adsenseMode !== "off";
    if (pubOk) out.adsense = { client: "ca-pub-" + PUB_RX.exec(s.adsenseClient)[1], slot: UNIT_RX.test(s.adsenseSlot) ? s.adsenseSlot : "", auto: s.adsenseMode === "auto" };
    for (const slot of String(req.query.slots || "").split(",").filter(x => SLOTS.includes(x)).slice(0, 6)) {
      const list = running(slot);
      if (!list.length) continue;
      const a = pick(list);
      out.ads[slot] = { id: a.id, title: a.title, text: a.text || "", by: a.advertiser || "", img: a.image_type ? "/ads/img/" + a.id : "", go: "/ads/go/" + a.id };
    }
    res.json(out);
  });
  r.post("/api/ads/:id/view", (req, res) => {
    const id = Number(req.params.id);
    const row = Number.isInteger(id) && db.prepare("SELECT id FROM q_ads WHERE id = ? AND status = 'active'").get(id);
    if (row && firstTime("v" + id + ":" + ipHash(req))) count(id, "views");
    res.set("Cache-Control", "no-store").json({ ok: true });
  });
  r.get("/ads/go/:id", (req, res, next) => {
    const id = Number(req.params.id);
    const row = Number.isInteger(id) && db.prepare("SELECT id, link FROM q_ads WHERE id = ? AND status IN ('active', 'paused')").get(id);
    if (!row) return res.redirect(302, "/");
    if (firstTime("c" + id + ":" + ipHash(req))) count(id, "clicks");
    res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex").redirect(302, row.link);
  });
  r.get("/ads/img/:id", (req, res, next) => {
    const row = db.prepare("SELECT image, image_type FROM q_ads WHERE id = ? AND status = 'active' AND image IS NOT NULL").get(Number(req.params.id));
    if (!row) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=3600").type(row.image_type).send(row.image);
  });
  // ads.txt: tells advertisers (and Google) who may sell ads on this site. Exists only once a publisher ID is saved.
  r.get("/ads.txt", (req, res, next) => {
    const m = PUB_RX.exec(settings().adsenseClient);
    if (!m) return res.status(404).type("text").send("");
    res.set("Cache-Control", "no-cache").type("text").send(`google.com, pub-${m[1]}, DIRECT, f08c47fec0942fa0\n`);
  });
  // Rates the owner wrote, shown on /advertise.
  r.get("/api/ads/rates", (req, res) => res.set("Cache-Control", "no-store").json({ rates: settings().rates }));

  // Advertisers ask for an ad. It waits for the owner, who agrees the price with them and approves it.
  r.post("/api/advertise", (req, res) => {
    res.set("Cache-Control", "no-store");
    const b = req.body || {};
    if (b.website) return res.json({ ok: true });
    const advertiser = clean(b.advertiser, 80), contact = clean(b.contact, 120), title = clean(b.title, 60), text = clean(b.text, 140), link = goodLink(b.link);
    if (!advertiser || !contact) return bad(res, "Please give your business name and your email or phone.");
    if (!title) return bad(res, "Please write the ad title.");
    if (!link) return bad(res, "Please give the full web link of your business, starting with https://");
    if (!(b.agree === true || b.agree === "on" || b.agree === "1")) return bad(res, "Please tick the box to agree to the ad rules.");
    if ([advertiser, title, text, b.note].some(x => isBad(x, false))) return bad(res, "Please remove rude or unsuitable words.");
    if (human.verify(b.human, b.n)) return bad(res, "Please wait a few seconds and try again.", 403);
    const h = ipHash(req);
    if (db.prepare("SELECT 1 FROM q_bans WHERE ip_hash = ?").get(h)) return bad(res, "Not allowed.", 403);
    if (limited("adv:" + h, 3, 3600_000)) return bad(res, "Too many requests from this connection. Please try later.", 429);
    const img = readImage(b.image);
    if (img.error) return bad(res, img.error);
    const t = now();
    db.prepare(`INSERT INTO q_ads(status, source, advertiser, contact, title, text, link, image, image_type, slots, starts, ends, note, ip_hash, created_at, updated_at)
      VALUES('pending', 'advertiser', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(advertiser, contact, title, text || null, link, img.buf || null, img.type || null, slotList(b.slots) || SLOTS.join(","), dateOrNull(b.starts), dateOrNull(b.ends), clean(b.note, 1000) || null, h, t, t);
    res.json({ ok: true });
  });

  // ---------- owner ----------
  function owner(req, res, next) {
    const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const row = t && db.prepare("SELECT created_at FROM admin_sessions WHERE token = ?").get(t);
    if (!row || now() - row.created_at > 7 * 24 * 3600_000) return bad(res, "Please log in again.", 401);
    res.set("Cache-Control", "no-store");
    next();
  }
  const COLS = "id, status, source, advertiser, contact, title, text, link, image_type, slots, starts, ends, weight, price, paid, note, views, clicks, created_at, updated_at";
  r.get("/api/admin/ads", owner, (req, res) => {
    const since = new Date(now() + 5.5 * 3600_000 - 29 * 86400_000).toISOString().slice(0, 10);
    res.json({
      today: today(), slots: SLOTS, settings: settings(),
      ads: db.prepare(`SELECT ${COLS} FROM q_ads ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, id DESC`).all(),
      days: db.prepare("SELECT day, SUM(views) AS views, SUM(clicks) AS clicks FROM q_ad_days WHERE day >= ? GROUP BY day ORDER BY day DESC").all(since),
      totals: db.prepare("SELECT IFNULL(SUM(views),0) AS views, IFNULL(SUM(clicks),0) AS clicks, IFNULL(SUM(paid),0) AS paid FROM q_ads").get(),
    });
  });
  r.get("/api/admin/ads/:id/img", owner, (req, res) => {
    const row = db.prepare("SELECT image, image_type FROM q_ads WHERE id = ? AND image IS NOT NULL").get(Number(req.params.id));
    if (!row) return res.status(404).end();
    res.type(row.image_type).send(row.image);
  });
  function readAd(b, res) {
    const title = clean(b.title, 60), link = goodLink(b.link), slots = slotList(b.slots);
    if (!title) { bad(res, "Please write the ad title."); return null; }
    if (!link) { bad(res, "Please give the full web link, starting with https://"); return null; }
    if (!slots) { bad(res, "Please choose at least one place for the ad."); return null; }
    const starts = dateOrNull(b.starts), ends = dateOrNull(b.ends);
    if (starts && ends && ends < starts) { bad(res, "The end date is before the start date."); return null; }
    return {
      advertiser: clean(b.advertiser, 80) || null, contact: clean(b.contact, 120) || null, title, text: clean(b.text, 140) || null, link, slots, starts, ends,
      weight: Math.min(10, Math.max(1, Math.round(Number(b.weight) || 1))), price: clean(b.price, 80) || null,
      paid: Math.max(0, Math.round((Number(b.paid) || 0) * 100) / 100), note: clean(b.note, 1000) || null,
    };
  }
  r.post("/api/admin/ads", owner, (req, res) => {
    const b = req.body || {}, a = readAd(b, res); if (!a) return;
    const img = readImage(b.image); if (img.error) return bad(res, img.error);
    const t = now();
    const info = db.prepare(`INSERT INTO q_ads(status, source, advertiser, contact, title, text, link, image, image_type, slots, starts, ends, weight, price, paid, note, created_at, updated_at)
      VALUES(@status, 'owner', @advertiser, @contact, @title, @text, @link, @image, @image_type, @slots, @starts, @ends, @weight, @price, @paid, @note, @t, @t)`)
      .run({ ...a, status: STATUSES.has(b.status) ? b.status : "active", image: img.buf || null, image_type: img.type || null, t });
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  r.post("/api/admin/ads/:id", owner, (req, res) => {
    const id = Number(req.params.id), b = req.body || {};
    if (!db.prepare("SELECT 1 FROM q_ads WHERE id = ?").get(id)) return bad(res, "Not found.", 404);
    const act = String(b.action || "");
    if (act === "delete") { db.prepare("DELETE FROM q_ads WHERE id = ?").run(id); db.prepare("DELETE FROM q_ad_days WHERE ad_id = ?").run(id); return res.json({ ok: true }); }
    const to = { approve: "active", resume: "active", pause: "paused", reject: "rejected" }[act];
    if (to) { db.prepare("UPDATE q_ads SET status = ?, updated_at = ? WHERE id = ?").run(to, now(), id); return res.json({ ok: true }); }
    if (act !== "save") return bad(res, "Unknown action.");
    const a = readAd(b, res); if (!a) return;
    db.prepare(`UPDATE q_ads SET advertiser=@advertiser, contact=@contact, title=@title, text=@text, link=@link, slots=@slots, starts=@starts, ends=@ends,
      weight=@weight, price=@price, paid=@paid, note=@note, updated_at=@t WHERE id=@id`).run({ ...a, t: now(), id });
    if (b.image === "remove") db.prepare("UPDATE q_ads SET image = NULL, image_type = NULL WHERE id = ?").run(id);
    else if (b.image) {
      const img = readImage(b.image); if (img.error) return bad(res, img.error);
      db.prepare("UPDATE q_ads SET image = ?, image_type = ? WHERE id = ?").run(img.buf, img.type, id);
    }
    res.json({ ok: true });
  });
  r.post("/api/admin/ads-settings", owner, (req, res) => {
    const b = req.body || {};
    const client = String(b.adsenseClient || "").trim().replace(/\s+/g, "");
    if (client && !PUB_RX.test(client)) return bad(res, "The publisher ID looks like pub-1234567890123456 (from your AdSense account).");
    const slot = String(b.adsenseSlot || "").trim();
    if (slot && !UNIT_RX.test(slot)) return bad(res, "The ad unit ID is a number like 1234567890.");
    setKv("ads_enabled", b.enabled === false ? "0" : "1");
    setKv("ads_adsense_client", client);
    setKv("ads_adsense_slot", slot);
    setKv("ads_adsense_mode", ["off", "fill", "auto"].includes(b.adsenseMode) ? b.adsenseMode : "off");
    setKv("ads_rates", String(b.rates || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").trim().slice(0, 2000));
    res.json({ ok: true, settings: settings() });
  });
  return r;
};

// Q India Community: Pages (like Facebook Pages) for a station, a cause, a group of volunteers or an organisation.
// A member makes a Page with its own name, address (qindiaglobal.com/community#/pg/<handle>), photo and cover,
// posts as the Page, and people follow the Page to see its posts in their Following feed. Free for everyone.
// Part of server/qindia-social.js, which passes its helpers in.
const HANDLE_RX = /^[a-z0-9_.]{3,30}$/;
const CATEGORIES = ["Community", "Station or route", "Cause or campaign", "Volunteers", "School or college", "Organisation", "Business", "Public figure", "Other"];

module.exports = function pages(x) {
  const { db, r, login, bad, now, line, para, takeMedia, dropMedia, limited, isBad, POST_SQL, visible, notBlocked, postOut, before, PAGE } = x;
  db.exec(`
CREATE TABLE IF NOT EXISTS s_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL, about TEXT, category TEXT,
  avatar TEXT, cover TEXT, owner_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ok',            -- ok | closed (by the site owner)
  reports INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS s_page_follows (page_id INTEGER NOT NULL REFERENCES s_pages(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (page_id, user_id));
CREATE INDEX IF NOT EXISTS s_page_follows_user ON s_page_follows(user_id);
`);
  const avatarUrl = a => (a ? "/media/" + a : null);
  const followers = id => db.prepare("SELECT COUNT(*) AS n FROM s_page_follows WHERE page_id = ?").get(id).n;
  const byHandle = h => db.prepare("SELECT * FROM s_pages WHERE handle = ?").get(String(h || "").toLowerCase().replace(/^@/, ""));
  const card = (pg, meId) => ({ id: pg.id, handle: pg.handle, name: pg.name, about: pg.about || "", category: pg.category || "", avatar: avatarUrl(pg.avatar), cover: avatarUrl(pg.cover),
    followers: followers(pg.id), mine: pg.owner_id === meId, following: meId ? !!db.prepare("SELECT 1 FROM s_page_follows WHERE page_id = ? AND user_id = ?").get(pg.id, meId) : false, closed: pg.status !== "ok" });
  // The id of my Page with this handle (for posting as the Page), or null.
  x.myPage = (userId, handle) => { const pg = byHandle(handle); return pg && pg.owner_id === userId && pg.status === "ok" ? pg.id : null; };

  // My Pages, Pages I follow, and Pages to discover (most followed).
  r.get("/api/s/pages", login, (req, res) => {
    const me = req.me, q = line(req.query.q, 40).toLowerCase().replace(/[%_\\]/g, c => "\\" + c);
    res.json({
      mine: db.prepare("SELECT * FROM s_pages WHERE owner_id = ? ORDER BY id").all(me.id).map(p => card(p, me.id)),
      following: db.prepare("SELECT pg.* FROM s_page_follows f JOIN s_pages pg ON pg.id = f.page_id WHERE f.user_id = ? AND pg.status = 'ok' ORDER BY f.created_at DESC LIMIT 200").all(me.id).map(p => card(p, me.id)),
      discover: db.prepare(`SELECT pg.*, (SELECT COUNT(*) FROM s_page_follows WHERE page_id = pg.id) AS n FROM s_pages pg WHERE pg.status = 'ok' AND pg.owner_id != ?
          AND pg.id NOT IN (SELECT page_id FROM s_page_follows WHERE user_id = ?) ${q ? "AND (pg.handle LIKE ? ESCAPE '\\' OR lower(pg.name) LIKE ? ESCAPE '\\')" : ""} ORDER BY n DESC, pg.id DESC LIMIT 30`)
        .all(...[me.id, me.id, ...(q ? [q + "%", "%" + q + "%"] : [])]).map(p => card(p, me.id)),
      categories: CATEGORIES,
    });
  });

  function readForm(b, me, old) {
    const name = b.name === undefined && old ? old.name : line(b.name, 60), about = b.about === undefined && old ? old.about : para(b.about, 1000);
    const category = CATEGORIES.includes(b.category) ? b.category : old ? old.category : "Community";
    if (!name) return { error: "Please give the Page a name." };
    if (isBad(name) || isBad(about, false)) return { error: "Please remove rude words, phone numbers or links from the name." };
    const pic = (k, cur) => { if (b[k] === null) return null; if (!b[k]) return cur; const m = takeMedia(b[k], me.id); if (!m) throw new Error("The photo was not found. Please choose it again."); return m; };
    try { return { name, about: about || null, category, avatar: pic("avatar", old && old.avatar), cover: pic("cover", old && old.cover) }; } catch (e) { return { error: e.message }; }
  }

  r.post("/api/s/pages", login, (req, res) => {
    const me = req.me, b = req.body || {};
    const handle = String(b.handle || "").trim().toLowerCase().replace(/^@/, "");
    if (!HANDLE_RX.test(handle)) return bad(res, "Page address: 3 to 30 small English letters, numbers, _ or . (for example dadar_queue).");
    if (isBad(handle, false) || /^(qindia|admin|official|govt|government|railway|indianrail|mumbai_police)/.test(handle)) return bad(res, "Please choose another Page address.");
    if (byHandle(handle)) return bad(res, "This Page address is taken. Please choose another.", 409);
    if (db.prepare("SELECT COUNT(*) AS n FROM s_pages WHERE owner_id = ?").get(me.id).n >= 10) return bad(res, "You can have up to 10 Pages.");
    if (limited(req, "newpage:" + me.id, 5, 24 * 3600_000)) return bad(res, "You have made many Pages today. Please try tomorrow.", 429);
    const f = readForm(b, me, null);
    if (f.error) return bad(res, f.error);
    db.prepare("INSERT INTO s_pages(handle, name, about, category, avatar, cover, owner_id, created_at) VALUES(?,?,?,?,?,?,?,?)").run(handle, f.name, f.about, f.category, f.avatar, f.cover, me.id, now());
    res.json({ handle });
  });

  r.get("/api/s/pages/:handle", login, (req, res) => {
    const me = req.me, pg = byHandle(req.params.handle);
    if (!pg || (pg.status !== "ok" && pg.owner_id !== me.id)) return bad(res, "This Page was not found.", 404);
    const rows = db.prepare(`${POST_SQL} WHERE p.page_id = ? AND ${visible(me.id)}${notBlocked(me.id)} AND p.id < ? ORDER BY p.id DESC LIMIT ${PAGE}`).all(pg.id, before(req));
    res.json({ page: card(pg, me.id), posts: rows.map(p => postOut(p, me.id)), more: rows.length === PAGE });
  });

  r.post("/api/s/pages/:handle", login, (req, res) => {
    const me = req.me, pg = byHandle(req.params.handle), b = req.body || {};
    if (!pg || pg.owner_id !== me.id) return bad(res, "Only the Page's owner can change it.", 403);
    if (b.delete) {
      // Deleting the Page removes its posts too.
      const files = db.prepare("SELECT photo FROM s_posts WHERE page_id = ? AND photo IS NOT NULL").all(pg.id).map(p => p.photo).concat([pg.avatar, pg.cover].filter(Boolean));
      db.transaction(() => { db.prepare("DELETE FROM s_posts WHERE page_id = ?").run(pg.id); db.prepare("DELETE FROM s_pages WHERE id = ?").run(pg.id); })();
      files.forEach(dropMedia);
      return res.json({ ok: true });
    }
    const f = readForm(b, me, pg);
    if (f.error) return bad(res, f.error);
    db.prepare("UPDATE s_pages SET name = ?, about = ?, category = ?, avatar = ?, cover = ? WHERE id = ?").run(f.name, f.about, f.category, f.avatar, f.cover, pg.id);
    if (pg.avatar && f.avatar !== pg.avatar) dropMedia(pg.avatar);
    if (pg.cover && f.cover !== pg.cover) dropMedia(pg.cover);
    res.json({ ok: true });
  });

  r.post("/api/s/pages/:handle/follow", login, (req, res) => {
    const me = req.me, pg = byHandle(req.params.handle);
    if (!pg || pg.status !== "ok") return bad(res, "This Page was not found.", 404);
    if ((req.body || {}).follow === false) db.prepare("DELETE FROM s_page_follows WHERE page_id = ? AND user_id = ?").run(pg.id, me.id);
    else {
      if (limited(req, "follow:" + me.id, 200, 3600_000)) return bad(res, "Too many follows in the last hour.", 429);
      db.prepare("INSERT OR IGNORE INTO s_page_follows(page_id, user_id, created_at) VALUES(?,?,?)").run(pg.id, me.id, now());
    }
    res.json({ following: (req.body || {}).follow !== false, followers: followers(pg.id) });
  });

  // ---------- reports and the site owner ----------
  x.reportKinds.page = {
    ok: (me, id) => !!db.prepare("SELECT 1 FROM s_pages WHERE id = ? AND owner_id != ?").get(id, me.id),
    bump: id => db.prepare("UPDATE s_pages SET reports = reports + 1 WHERE id = ?").run(id),
  };
  x.reportItem.page = id => {
    const pg = db.prepare("SELECT pg.*, u.username FROM s_pages pg JOIN s_users u ON u.id = pg.owner_id WHERE pg.id = ?").get(id);
    return pg && { username: pg.username, text: "Page “" + pg.name + "” (@" + pg.handle + ") · " + followers(pg.id) + " followers" + (pg.about ? " · " + pg.about : ""), photo: pg.avatar && "/media/" + pg.avatar, status: pg.status };
  };
  x.ownerActions["page-close"] = id => db.prepare("UPDATE s_pages SET status = 'closed' WHERE id = ?").run(id);
  x.ownerActions["page-open"] = id => db.prepare("UPDATE s_pages SET status = 'ok', reports = 0 WHERE id = ?").run(id);
  x.ownerCounts.pages = () => db.prepare("SELECT COUNT(*) AS n FROM s_pages").get().n;
};

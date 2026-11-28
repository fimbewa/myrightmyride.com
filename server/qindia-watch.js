// Q India Community: Watch (like YouTube). Every video post is also a video on Watch, with a cover picture, its
// length and a view count. Each member and each Page is a channel: its videos are listed together, and
// "Subscribe" is the same as following that member or Page. Part of server/qindia-social.js.
module.exports = function watch(x) {
  const { db, r, bad, now, POST_SQL, visible, notBlocked, postOut, ipHash } = x;
  const IS_VIDEO = "(p.photo LIKE '%.mp4' OR p.photo LIKE '%.webm')";
  // Optional login: the list works for visitors too.
  const who = (req, res, next) => { req.me = x.who(req); next(); };

  // ?sort=latest|popular|subs  ·  ?user=<username> or ?page=<handle> for one channel  ·  ?skip=<n> for the next page
  r.get("/api/s/watch", who, (req, res) => {
    const meId = req.me && req.me.status === "ok" ? req.me.id : 0;
    const sort = ["popular", "subs"].includes(req.query.sort) ? req.query.sort : "latest";
    const skip = Math.max(0, Math.min(5000, Number(req.query.skip) | 0));
    let where = `${visible(meId)}${notBlocked(meId)} AND ${IS_VIDEO}`;
    const args = [];
    if (req.query.page) { where += " AND pg.handle = ?"; args.push(String(req.query.page).toLowerCase()); }
    else if (req.query.user) { where += " AND p.page_id IS NULL AND u.username = ?"; args.push(String(req.query.user).toLowerCase()); }
    else if (sort === "subs") {
      if (!meId) return bad(res, "Please log in to see your subscriptions.", 401);
      where += ` AND ((p.page_id IS NULL AND p.user_id IN (SELECT followee_id FROM s_follows WHERE follower_id = ${meId})) OR p.page_id IN (SELECT page_id FROM s_page_follows WHERE user_id = ${meId}))`;
    }
    // Popular: most viewed in the last 30 days.
    if (sort === "popular" && !req.query.user && !req.query.page) where += ` AND p.created_at > ${now() - 30 * 24 * 3600_000}`;
    const order = sort === "popular" ? "p.views DESC, p.id DESC" : "p.id DESC";
    const rows = db.prepare(`${POST_SQL} WHERE ${where} ORDER BY ${order} LIMIT 20 OFFSET ${skip}`).all(...args);
    res.json({ videos: rows.map(p => postOut(p, meId)), more: rows.length === 20, next: skip + rows.length });
  });

  // One video for its watch page, with the channel and "Up next".
  r.get("/api/s/watch/:id", who, (req, res) => {
    const meId = req.me && req.me.status === "ok" ? req.me.id : 0;
    const p = db.prepare(`${POST_SQL} WHERE p.id = ? AND ${visible(meId)}${notBlocked(meId)} AND ${IS_VIDEO}`).get(Number(req.params.id));
    if (!p) return bad(res, "This video is not available.", 404);
    const channel = p.page_id
      ? { page: true, username: p.pg_handle, name: p.pg_name, avatar: p.pg_avatar ? "/media/" + p.pg_avatar : null,
          subscribers: db.prepare("SELECT COUNT(*) AS n FROM s_page_follows WHERE page_id = ?").get(p.page_id).n,
          subscribed: meId ? !!db.prepare("SELECT 1 FROM s_page_follows WHERE page_id = ? AND user_id = ?").get(p.page_id, meId) : false }
      : { page: false, username: p.username, name: p.name, avatar: p.avatar ? "/media/" + p.avatar : null,
          subscribers: db.prepare("SELECT COUNT(*) AS n FROM s_follows WHERE followee_id = ?").get(p.user_id).n,
          subscribed: meId ? !!db.prepare("SELECT 1 FROM s_follows WHERE follower_id = ? AND followee_id = ?").get(meId, p.user_id) : false };
    channel.mine = meId === p.user_id;
    // Up next: more from the same channel, then popular videos.
    const same = p.page_id ? "p.page_id = ?" : "p.page_id IS NULL AND p.user_id = ?";
    const nextRows = db.prepare(`${POST_SQL} WHERE ${visible(meId)}${notBlocked(meId)} AND ${IS_VIDEO} AND p.id != ? AND ${same} ORDER BY p.id DESC LIMIT 6`).all(p.id, p.page_id || p.user_id);
    const more = db.prepare(`${POST_SQL} WHERE ${visible(meId)}${notBlocked(meId)} AND ${IS_VIDEO} AND p.id != ? ORDER BY p.views DESC, p.id DESC LIMIT 12`).all(p.id)
      .filter(v => !nextRows.some(n => n.id === v.id)).slice(0, 12 - nextRows.length);
    res.json({ video: postOut(p, meId), channel, next: nextRows.concat(more).map(v => postOut(v, meId)) });
  });

  // A view: counted once per member (or per connection for visitors).
  r.post("/api/s/watch/:id/view", who, (req, res) => {
    const p = db.prepare(`SELECT id FROM s_posts p WHERE p.id = ? AND p.status = 'ok' AND ${IS_VIDEO}`).get(Number(req.params.id));
    if (!p) return bad(res, "Not found.", 404);
    const viewer = req.me ? "u" + req.me.id : "ip" + ipHash(req);
    if (db.prepare("INSERT OR IGNORE INTO s_views(post_id, viewer, at) VALUES(?,?,?)").run(p.id, viewer, now()).changes)
      db.prepare("UPDATE s_posts SET views = views + 1 WHERE id = ?").run(p.id);
    res.json({ ok: true });
  });
};

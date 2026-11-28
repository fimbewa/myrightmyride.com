// Q India Community: Live. A member (or a Page) goes live on YouTube or Facebook with their own phone app, pastes the
// link here, and the Community shows "🔴 Live now": the stream plays inside the site (through YouTube's or
// Facebook's own player), with a live chat beside it, and followers get an alert. No video passes through or is
// stored on our server (text and links only). A live post is an ordinary post with live_until set; after the stream
// it stays as a normal video post on Watch. Part of server/qindia-social.js.
const LIVE_FOR = 12 * 3600_000, ALERT_MAX = 5000, CHAT_MAX = 100;

module.exports = function live(x) {
  const { db, r, login, bad, now, line, POST_SQL, visible, notBlocked, postOut, ytOf, fbOf, notify, limited, isBad, isDoubtful, avatarUrl, blockedEither } = x;
  const optional = (req, res, next) => { req.me = x.who(req); next(); };
  const meIdOf = req => (req.me && req.me.status === "ok" ? req.me.id : 0);

  // Who is live now (newest first).
  r.get("/api/s/live", optional, (req, res) => {
    const meId = meIdOf(req);
    const rows = db.prepare(`${POST_SQL} WHERE ${visible(meId)}${notBlocked(meId)} AND p.live_until > ? ORDER BY p.id DESC LIMIT 50`).all(now());
    res.json({ live: rows.map(p => postOut(p, meId)) });
  });

  // Go live: a title and the YouTube or Facebook link of a stream I started there.
  r.post("/api/s/live", login, (req, res) => {
    const me = req.me, b = req.body || {};
    const link = String(b.link || "").trim().slice(0, 500), title = line(b.title, 120);
    if (!ytOf(link) && !fbOf(link)) return bad(res, "Please paste the link of your live stream on YouTube or Facebook.");
    if (!title) return bad(res, "Please give your live stream a title.");
    if (isBad(title, false)) return bad(res, "Please remove rude, sexual or abusive words. Qindia is a family place.");
    let pageId = null;
    if (b.page) { pageId = x.myPage(me.id, b.page); if (!pageId) return bad(res, "You can go live only on your own Page.", 403); }
    if (limited(req, "live:" + me.id, 6, 24 * 3600_000)) return bad(res, "You have gone live many times today. Please try tomorrow.", 429);
    const t = now(), status = isDoubtful(title) || me.reports >= 3 ? "pending" : "ok";
    // One live at a time: an earlier live of mine ends now.
    db.prepare("UPDATE s_posts SET live_until = ? WHERE user_id = ? AND live_until > ?").run(t, me.id, t);
    const id = db.prepare("INSERT INTO s_posts(user_id, text, photo, status, created_at, page_id, live_until) VALUES(?,?,NULL,?,?,?,?)")
      .run(me.id, "🔴 LIVE: " + title + "\n" + link, status, t, pageId, t + LIVE_FOR).lastInsertRowid;
    // Alert my followers (or the Page's followers), once per live.
    if (status === "ok") {
      const fans = pageId
        ? db.prepare("SELECT user_id AS id FROM s_page_follows WHERE page_id = ? LIMIT ?").all(pageId, ALERT_MAX)
        : db.prepare("SELECT follower_id AS id FROM s_follows WHERE followee_id = ? LIMIT ?").all(me.id, ALERT_MAX);
      db.transaction(() => fans.forEach(f => { if (!blockedEither(f.id, me.id)) notify(f.id, "live", me.id, id); }))();
    }
    res.json({ post: postOut(db.prepare(POST_SQL + " WHERE p.id = ?").get(id), me.id) });
  });

  // End my live (it stays as a normal video post).
  r.post("/api/s/live/:id/end", login, (req, res) => {
    const ch = db.prepare("UPDATE s_posts SET live_until = ? WHERE id = ? AND user_id = ? AND live_until > ?").run(now(), Number(req.params.id), req.me.id, now()).changes;
    if (!ch) return bad(res, "This live has already ended.", 404);
    res.json({ ok: true });
  });

  // Live chat: comments newer than ?after=<comment id> (the page asks every few seconds), and whether it is still live.
  r.get("/api/s/live/:id/chat", optional, (req, res) => {
    const meId = meIdOf(req);
    const p = db.prepare(`${POST_SQL} WHERE p.id = ? AND ${visible(meId)}${notBlocked(meId)}`).get(Number(req.params.id));
    if (!p) return bad(res, "This live stream is not available.", 404);
    const after = Math.max(0, Number(req.query.after) | 0);
    const rows = db.prepare(`SELECT c.*, u.username, u.name, u.avatar FROM s_comments c JOIN s_users u ON u.id = c.user_id
      WHERE c.post_id = ? AND c.id > ? AND (c.status = 'ok' OR c.user_id = ?) AND u.status = 'ok'
        AND c.user_id NOT IN (SELECT blocked_id FROM s_blocks WHERE blocker_id = ?) ORDER BY c.id DESC LIMIT ${CHAT_MAX}`).all(p.id, after, meId, meId).reverse();
    res.json({
      live: p.live_until > now(), comments: p.comments,
      chat: rows.map(c => ({ id: c.id, text: c.text, at: c.created_at, mine: c.user_id === meId, canDelete: c.user_id === meId || p.user_id === meId, user: { username: c.username, name: c.name, avatar: avatarUrl(c.avatar) } })),
    });
  });

  x.ownerCounts.liveNow = () => db.prepare("SELECT COUNT(*) AS n FROM s_posts WHERE live_until > ?").get(now()).n;
};

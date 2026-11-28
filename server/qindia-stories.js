// Q India Community: Status / Stories (like WhatsApp Status and Instagram Stories). Part of server/qindia-social.js.
// A story is a photo (with an optional caption) or a short text on a coloured background. It disappears after
// 24 hours. Your followers see it at the top of their feed; you see who viewed it. Photo stories wait for the site
// owner's check when "check photos before they appear" is on, exactly like photo posts.
const LIFE = 24 * 3600_000, TEXT_MAX = 700, BGS = 6;

module.exports = function stories(x) {
  const { db, r, login, bad, now, para, takeMedia, dropMedia, pubUser, limited, isBad, isDoubtful, photoApproval, hold } = x;
  db.exec(`
CREATE TABLE IF NOT EXISTS s_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  text TEXT, photo TEXT, bg INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',            -- ok | pending (waits for owner) | hidden
  reports INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS s_stories_user ON s_stories(user_id, expires_at);
CREATE TABLE IF NOT EXISTS s_story_views (story_id INTEGER NOT NULL REFERENCES s_stories(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, at INTEGER NOT NULL, PRIMARY KEY (story_id, user_id));
`);
  // Remove stories older than 24 hours, with their photos.
  function sweep() {
    for (const s of db.prepare("SELECT id, photo FROM s_stories WHERE expires_at < ?").all(now())) {
      db.prepare("DELETE FROM s_stories WHERE id = ?").run(s.id);
      db.prepare("UPDATE s_reports SET done = 1 WHERE kind = 'story' AND target_id = ?").run(s.id);
      dropMedia(s.photo);
    }
  }
  sweep();
  setInterval(sweep, 15 * 60_000).unref();

  const out = (s, meId) => ({ id: s.id, text: s.text || "", photo: s.photo ? "/media/" + s.photo : null, bg: s.bg, status: s.status, at: s.created_at,
    seen: meId === s.user_id || !!db.prepare("SELECT 1 FROM s_story_views WHERE story_id = ? AND user_id = ?").get(s.id, meId),
    views: meId === s.user_id ? s.views : undefined });
  const LIVE = "s.expires_at > ? AND u.status = 'ok'";

  // Stories bar on the feed: mine first, then people I follow (not blocked), unseen ones before seen ones.
  r.get("/api/s/stories", login, (req, res) => {
    const me = req.me, t = now();
    const rows = db.prepare(`SELECT s.*, u.username, u.name, u.avatar FROM s_stories s JOIN s_users u ON u.id = s.user_id
      WHERE ${LIVE} AND ((s.user_id = ? AND s.status != 'hidden') OR (s.status = 'ok' AND s.user_id IN (SELECT followee_id FROM s_follows WHERE follower_id = ?)
        AND s.user_id NOT IN (SELECT blocked_id FROM s_blocks WHERE blocker_id = ?) AND s.user_id NOT IN (SELECT blocker_id FROM s_blocks WHERE blocked_id = ?)))
      ORDER BY s.id LIMIT 2000`).all(t, me.id, me.id, me.id, me.id);
    const people = new Map();
    for (const s of rows) {
      if (!people.has(s.user_id)) people.set(s.user_id, { user: pubUser(s), me: s.user_id === me.id, stories: [] });
      people.get(s.user_id).stories.push(out(s, me.id));
    }
    const list = [...people.values()].map(p => ({ ...p, unseen: p.stories.some(s => !s.seen), last: p.stories[p.stories.length - 1].at }));
    list.sort((a, b) => b.me - a.me || b.unseen - a.unseen || b.last - a.last);
    res.json({ people: list });
  });

  r.post("/api/s/stories", login, (req, res) => {
    const me = req.me, b = req.body || {};
    const text = para(b.text, TEXT_MAX);
    if (!text && !b.photo) return bad(res, "Write something or add a photo.");
    if (isBad(text, false)) return bad(res, "Please remove rude, sexual or abusive words. Qindia is a family place.");
    if (limited(req, "story:" + me.id, 30, 24 * 3600_000)) return bad(res, "You have added many status updates today. Please try tomorrow.", 429);
    let photo = null;
    if (b.photo) { photo = takeMedia(b.photo, me.id); if (!photo) return bad(res, "The photo was not found. Please choose it again."); }
    const status = isDoubtful(text) || me.reports >= 3 || (photo && photoApproval()) ? "pending" : "ok";
    const bg = Math.max(0, Math.min(BGS - 1, Number(b.bg) | 0)), t = now();
    const id = db.prepare("INSERT INTO s_stories(user_id, text, photo, bg, status, created_at, expires_at) VALUES(?,?,?,?,?,?,?)").run(me.id, text || null, photo, bg, status, t, t + LIFE).lastInsertRowid;
    res.json({ id, status });
  });

  // Viewed: counted once per person (not for my own story).
  r.post("/api/s/stories/:id/view", login, (req, res) => {
    const me = req.me, s = db.prepare("SELECT * FROM s_stories WHERE id = ? AND status = 'ok' AND expires_at > ?").get(Number(req.params.id), now());
    if (!s) return bad(res, "This status is no longer available.", 404);
    if (s.user_id !== me.id && db.prepare("INSERT OR IGNORE INTO s_story_views(story_id, user_id, at) VALUES(?,?,?)").run(s.id, me.id, now()).changes)
      db.prepare("UPDATE s_stories SET views = views + 1 WHERE id = ?").run(s.id);
    res.json({ ok: true });
  });

  // Who viewed my story (only I can see this).
  r.get("/api/s/stories/:id/viewers", login, (req, res) => {
    const s = db.prepare("SELECT * FROM s_stories WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.me.id);
    if (!s) return bad(res, "Not found.", 404);
    res.json({ viewers: db.prepare("SELECT u.*, v.at FROM s_story_views v JOIN s_users u ON u.id = v.user_id WHERE v.story_id = ? AND u.status = 'ok' ORDER BY v.at DESC LIMIT 1000").all(s.id).map(u => ({ ...pubUser(u), at: u.at })) });
  });

  r.post("/api/s/stories/:id/delete", login, (req, res) => {
    const s = db.prepare("SELECT * FROM s_stories WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.me.id);
    if (!s) return bad(res, "Not found.", 404);
    db.prepare("DELETE FROM s_stories WHERE id = ?").run(s.id); dropMedia(s.photo);
    res.json({ ok: true });
  });

  // ---------- reports and the site owner ----------
  x.reportKinds.story = {
    ok: (me, id) => !!db.prepare("SELECT 1 FROM s_stories WHERE id = ? AND user_id != ?").get(id, me.id),
    // Three different people reporting a story hides it until the owner looks.
    bump: id => db.prepare("UPDATE s_stories SET reports = reports + 1, status = CASE WHEN status = 'ok' AND reports + 1 >= 3 THEN 'pending' ELSE status END WHERE id = ?").run(id),
  };
  x.reportItem.story = id => {
    const s = db.prepare("SELECT s.*, u.username FROM s_stories s JOIN s_users u ON u.id = s.user_id WHERE s.id = ?").get(id);
    return s && { username: s.username, text: "Status: " + (s.text || ""), photo: s.photo && "/media/" + s.photo, status: s.status };
  };
  x.ownerPending.stories = () => db.prepare("SELECT s.*, u.username FROM s_stories s JOIN s_users u ON u.id = s.user_id WHERE s.status = 'pending' AND s.expires_at > ? ORDER BY s.id LIMIT 200").all(now())
    .map(s => ({ id: s.id, username: s.username, text: s.text, photo: s.photo && "/media/" + s.photo, reports: s.reports, at: s.created_at }));
  x.ownerActions["story-ok"] = id => db.prepare("UPDATE s_stories SET status = 'ok', reports = 0 WHERE id = ?").run(id);
  x.ownerActions["story-delete"] = id => {
    const s = db.prepare("SELECT s.id, s.text, s.photo, s.created_at, u.username FROM s_stories s JOIN s_users u ON u.id = s.user_id WHERE s.id = ?").get(id);
    if (!s) return;
    db.prepare("DELETE FROM s_stories WHERE id = ?").run(id);
    const kept = hold.keep("story", s.id, s, { photo: s.photo, reason: "removed by owner" });
    if (kept) db.prepare("DELETE FROM s_media WHERE name = ?").run(kept); else dropMedia(s.photo);
  };
  x.ownerCounts.storiesLive = () => db.prepare("SELECT COUNT(*) AS n FROM s_stories WHERE expires_at > ?").get(now()).n;
};

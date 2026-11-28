// Q India Community: voice and video calls between two people (like WhatsApp calls), in the browser with WebRTC.
// The sound and picture go directly between the two phones (peer to peer); this server only passes the short
// "connection details" between them, and keeps who called whom and when (not the call itself).
// Calls are possible only between two members who follow each other, and never when either has blocked the other.
// The phones find each other with a free public STUN server. On some mobile networks a direct connection is not
// possible; for those, the site owner can add a TURN relay server on /admin (it costs money to run one).
const RING_MS = 45_000, SDP_MAX = 20_000;

module.exports = function calls(x) {
  const { db, r, login, owner, bad, now, limited, blockedEither, follows, pubUser, setting } = x;
  db.exec(`CREATE TABLE IF NOT EXISTS s_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, caller_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  callee_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE, kind TEXT NOT NULL,   -- audio | video
  status TEXT NOT NULL DEFAULT 'ringing',      -- ringing | accepted | ended | declined | missed | busy
  offer TEXT, answer TEXT, created_at INTEGER NOT NULL, answered_at INTEGER, ended_at INTEGER)`);
  db.exec("CREATE INDEX IF NOT EXISTS s_calls_callee ON s_calls(callee_id, status)");
  const sdp = s => (typeof s === "string" && s.length < SDP_MAX && /^v=0\r?\n/.test(s) ? s : null);
  const mine = (id, meId) => db.prepare("SELECT * FROM s_calls WHERE id = ? AND (caller_id = ? OR callee_id = ?)").get(Number(id), meId, meId);
  // Ringing for too long: missed.
  const expire = () => db.prepare("UPDATE s_calls SET status = 'missed', ended_at = ? WHERE status = 'ringing' AND created_at < ?").run(now(), now() - RING_MS);
  const busy = uid => db.prepare("SELECT 1 FROM s_calls WHERE (caller_id = ? OR callee_id = ?) AND (status = 'accepted' AND ended_at IS NULL AND answered_at > ? OR status = 'ringing')").get(uid, uid, now() - 4 * 3600_000);
  // A line in the private chat: "📞 Voice call · 2:31" or "📞 Missed video call".
  function log(c) {
    const [a, b] = c.caller_id < c.callee_id ? [c.caller_id, c.callee_id] : [c.callee_id, c.caller_id];
    let convo = db.prepare("SELECT * FROM s_convos WHERE a_id = ? AND b_id = ?").get(a, b);
    if (!convo) { db.prepare("INSERT INTO s_convos(a_id, b_id, last_at) VALUES(?,?,?)").run(a, b, now()); convo = db.prepare("SELECT * FROM s_convos WHERE a_id = ? AND b_id = ?").get(a, b); }
    const what = c.kind === "video" ? "video call" : "voice call";
    const secs = c.answered_at ? Math.round(((c.ended_at || now()) - c.answered_at) / 1000) : 0;
    const text = c.answered_at ? "📞 " + what[0].toUpperCase() + what.slice(1) + " · " + Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") : "📞 Missed " + what;
    const t = now();
    db.prepare("INSERT INTO s_messages(convo_id, sender_id, text, created_at) VALUES(?,?,?,?)").run(convo.id, c.caller_id, text, t);
    db.prepare(`UPDATE s_convos SET last_at = ?, ${convo.a_id === c.caller_id ? "a" : "b"}_read = ? WHERE id = ?`).run(t, t, convo.id);
  }

  // Connection settings for the phones (STUN, and TURN if the owner added one).
  r.get("/api/s/calls/config", login, (req, res) => {
    const turn = setting("turn", null);
    const ice = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
    if (turn && turn.url) ice.push({ urls: turn.url.split(",").map(s => s.trim()), username: turn.username, credential: turn.credential });
    res.json({ iceServers: ice, ringSeconds: RING_MS / 1000 });
  });

  r.post("/api/s/calls", login, (req, res) => {
    const me = req.me, b = req.body || {};
    const u = db.prepare("SELECT * FROM s_users WHERE username = ? AND status = 'ok'").get(String(b.to || "").toLowerCase().replace(/^@/, ""));
    if (!u || u.id === me.id) return bad(res, "This person was not found.", 404);
    if (blockedEither(me.id, u.id) || !(follows(me.id, u.id) && follows(u.id, me.id))) return bad(res, "You can call only people who follow you and whom you follow.", 403);
    if (limited(req, "call:" + me.id, 60, 3600_000)) return bad(res, "Too many calls. Please wait a little.", 429);
    const offer = sdp(b.offer);
    if (!offer) return bad(res, "The call could not start. Please try again.");
    expire();
    if (busy(u.id)) return bad(res, u.name + " is on another call. Please try later.", 409);
    db.prepare("UPDATE s_calls SET status = 'ended', ended_at = ? WHERE caller_id = ? AND status = 'ringing'").run(now(), me.id);
    const id = db.prepare("INSERT INTO s_calls(caller_id, callee_id, kind, offer, created_at) VALUES(?,?,?,?,?)").run(me.id, u.id, b.kind === "video" ? "video" : "audio", offer, now()).lastInsertRowid;
    res.json({ id });
  });

  // Someone calling me now? (the Community page asks every few seconds)
  r.get("/api/s/calls/incoming", login, (req, res) => {
    expire();
    const c = db.prepare("SELECT c.*, u.username, u.name, u.avatar FROM s_calls c JOIN s_users u ON u.id = c.caller_id WHERE c.callee_id = ? AND c.status = 'ringing' ORDER BY c.id DESC LIMIT 1").get(req.me.id);
    res.json({ call: c && !blockedEither(c.caller_id, req.me.id) ? { id: c.id, kind: c.kind, offer: c.offer, user: pubUser(c) } : null });
  });

  r.get("/api/s/calls/:id", login, (req, res) => {
    expire();
    const c = mine(req.params.id, req.me.id);
    if (!c) return bad(res, "Not found.", 404);
    const other = db.prepare("SELECT * FROM s_users WHERE id = ?").get(c.caller_id === req.me.id ? c.callee_id : c.caller_id);
    res.json({ id: c.id, kind: c.kind, status: c.status, answer: c.caller_id === req.me.id ? c.answer : null, user: other ? pubUser(other) : null, answered_at: c.answered_at });
  });

  r.post("/api/s/calls/:id/answer", login, (req, res) => {
    const c = mine(req.params.id, req.me.id);
    if (!c || c.callee_id !== req.me.id) return bad(res, "Not found.", 404);
    if (c.status !== "ringing") return bad(res, "This call has ended.", 410);
    const answer = sdp((req.body || {}).answer);
    if (!answer) return bad(res, "The call could not connect. Please try again.");
    db.prepare("UPDATE s_calls SET status = 'accepted', answer = ?, answered_at = ? WHERE id = ?").run(answer, now(), c.id);
    res.json({ ok: true });
  });

  // Hang up, decline or cancel.
  r.post("/api/s/calls/:id/end", login, (req, res) => {
    const c = mine(req.params.id, req.me.id);
    if (!c) return bad(res, "Not found.", 404);
    if (c.status === "ringing" || (c.status === "accepted" && !c.ended_at)) {
      const status = c.status === "accepted" ? "ended" : c.callee_id === req.me.id ? "declined" : "missed";
      db.prepare("UPDATE s_calls SET status = ?, ended_at = ? WHERE id = ?").run(status, now(), c.id);
      log({ ...c, ended_at: now() });
    }
    res.json({ ok: true });
  });

  // Owner: optional TURN relay (url like turn:turn.example.com:3478, username, password).
  r.get("/api/admin/turn", owner, (req, res) => { const t = setting("turn", null); res.json({ url: t ? t.url : "", username: t ? t.username : "", set: !!t }); });
  r.post("/api/admin/turn", owner, (req, res) => {
    const b = req.body || {}, url = String(b.url || "").trim();
    if (!url) { db.prepare("DELETE FROM s_settings WHERE k = 'turn'").run(); return res.json({ ok: true, set: false }); }
    if (!/^turns?:[\w.\-]+(:\d+)?(\?transport=(udp|tcp))?(\s*,\s*turns?:[\w.\-]+(:\d+)?(\?transport=(udp|tcp))?)*$/.test(url)) return bad(res, "The TURN address should look like turn:turn.example.com:3478");
    const old = setting("turn", null);
    const val = { url, username: String(b.username || "").trim().slice(0, 200), credential: String(b.credential || "") || (old ? old.credential : "") };
    db.prepare("INSERT INTO s_settings(k, v) VALUES('turn', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify(val));
    res.json({ ok: true, set: true });
  });
  x.ownerCounts.callsToday = () => db.prepare("SELECT COUNT(*) AS n FROM s_calls WHERE created_at > ?").get(now() - 24 * 3600_000).n;
};

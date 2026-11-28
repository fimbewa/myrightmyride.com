// Q India Community: group chats (like WhatsApp groups). Part of server/qindia-social.js, which passes its helpers in.
// A group has admins and members. Admins add or remove people, make other admins, change the name and photo,
// choose "only admins can send", and share an invite link. Messages are kept on the Qindia server (not end-to-end
// encrypted); the site owner sees a group message only when a member reports it. Everything is free.
const crypto = require("crypto");

const GROUP_MAX = 500;            // members in one group
const NAME_MAX = 60, ABOUT_MAX = 500, MESSAGE_MAX = 2000;

module.exports = function groups(x) {
  const { db, r, login, bad, now, line, para, takeMedia, dropMedia, pubUser, blockedEither, follows, limited, isBad, hold } = x;
  db.exec(`
CREATE TABLE IF NOT EXISTS s_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, about TEXT, avatar TEXT,
  owner_id INTEGER REFERENCES s_users(id) ON DELETE SET NULL,
  only_admins INTEGER NOT NULL DEFAULT 0,       -- 1: only admins can send messages
  invite TEXT UNIQUE,                           -- invite link code, NULL when the link is switched off
  status TEXT NOT NULL DEFAULT 'ok',            -- ok | closed (by the site owner)
  reports INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS s_group_members (
  group_id INTEGER NOT NULL REFERENCES s_groups(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES s_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',          -- admin | member
  read_at INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS s_group_members_user ON s_group_members(user_id);
CREATE TABLE IF NOT EXISTS s_group_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES s_groups(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES s_users(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'msg',   -- msg | info ("Asha added Bala")
  text TEXT, photo TEXT, reported INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS s_group_msgs_group ON s_group_msgs(group_id, id);
`);

  const inviteCode = () => { const abc = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from(crypto.randomBytes(10), b => abc[b % abc.length]).join(""); };
  const member = (gid, uid) => db.prepare("SELECT * FROM s_group_members WHERE group_id = ? AND user_id = ?").get(gid, uid);
  const count = gid => db.prepare("SELECT COUNT(*) AS n FROM s_group_members WHERE group_id = ?").get(gid).n;
  const info = (gid, text) => {
    const t = now();
    db.prepare("INSERT INTO s_group_msgs(group_id, kind, text, created_at) VALUES(?,?,?,?)").run(gid, "info", text, t);
    db.prepare("UPDATE s_groups SET last_at = ? WHERE id = ?").run(t, gid);
  };
  const avatarUrl = a => (a ? "/media/" + a : null);
  // The group from the address, only for its members (and only while the site owner has not closed it).
  function mine(req, res) {
    const g = db.prepare("SELECT * FROM s_groups WHERE id = ?").get(Number(req.params.id));
    const m = g && member(g.id, req.me.id);
    if (!g || !m) { bad(res, "This group was not found, or you are not in it.", 404); return null; }
    if (g.status !== "ok") { bad(res, "This group was closed by the site owner for breaking the rules.", 403); return null; }
    return { g, m };
  }
  // When the last admin leaves, the longest member becomes admin; an empty group is deleted.
  function afterLeave(gid) {
    if (!count(gid)) {
      const files = db.prepare("SELECT photo FROM s_group_msgs WHERE group_id = ? AND photo IS NOT NULL").all(gid).map(m => m.photo);
      const g = db.prepare("SELECT avatar FROM s_groups WHERE id = ?").get(gid);
      db.prepare("DELETE FROM s_groups WHERE id = ?").run(gid);
      files.concat(g && g.avatar ? [g.avatar] : []).forEach(dropMedia);
      return;
    }
    if (!db.prepare("SELECT 1 FROM s_group_members WHERE group_id = ? AND role = 'admin'").get(gid)) {
      const next = db.prepare("SELECT user_id FROM s_group_members WHERE group_id = ? ORDER BY joined_at, user_id LIMIT 1").get(gid);
      db.prepare("UPDATE s_group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(gid, next.user_id);
    }
  }
  const nameOf = id => (db.prepare("SELECT name FROM s_users WHERE id = ?").get(id) || {}).name || "Someone";
  // Can I add this person? They must follow me (so strangers cannot be pulled into groups), and no block either way.
  function canAdd(me, u) {
    if (!u || u.status !== "ok" || u.id === me.id) return "This person was not found.";
    if (blockedEither(me.id, u.id)) return "You cannot add @" + u.username + ".";
    if (!follows(u.id, me.id)) return "@" + u.username + " does not follow you yet, so you cannot add them. Send them the group's invite link instead.";
    return "";
  }

  // Count of groups with messages I have not read (for the Chats badge).
  x.unreadGroups = meId => db.prepare(`SELECT COUNT(*) AS n FROM s_group_members gm JOIN s_groups g ON g.id = gm.group_id
    WHERE gm.user_id = ? AND g.status = 'ok' AND g.last_at > gm.read_at
      AND EXISTS (SELECT 1 FROM s_group_msgs m WHERE m.group_id = g.id AND m.kind = 'msg' AND (m.sender_id IS NULL OR m.sender_id != ?) AND m.created_at > gm.read_at)`).get(meId, meId).n;

  r.get("/api/s/groups", login, (req, res) => {
    const me = req.me;
    const rows = db.prepare(`SELECT g.*, gm.read_at, gm.role,
        (SELECT COUNT(*) FROM s_group_members WHERE group_id = g.id) AS members,
        (SELECT id FROM s_group_msgs WHERE group_id = g.id ORDER BY id DESC LIMIT 1) AS last_id
      FROM s_group_members gm JOIN s_groups g ON g.id = gm.group_id WHERE gm.user_id = ? ORDER BY g.last_at DESC LIMIT 300`).all(me.id);
    res.json({
      groups: rows.map(g => {
        const m = g.last_id && db.prepare("SELECT m.*, u.name AS uname FROM s_group_msgs m LEFT JOIN s_users u ON u.id = m.sender_id WHERE m.id = ?").get(g.last_id);
        const last = !m ? "" : m.kind === "info" ? m.text : (m.sender_id === me.id ? "You" : m.uname || "Someone") + ": " + (m.photo && !m.text ? "📷 Photo" : m.text || "");
        return { id: g.id, name: g.name, avatar: avatarUrl(g.avatar), members: g.members, admin: g.role === "admin", closed: g.status !== "ok", last, at: g.last_at,
          unread: g.status === "ok" && !!m && m.kind === "msg" && m.sender_id !== me.id && m.created_at > g.read_at };
      }),
    });
  });

  r.post("/api/s/groups", login, (req, res) => {
    const me = req.me, b = req.body || {};
    const name = line(b.name, NAME_MAX), about = para(b.about, ABOUT_MAX);
    if (!name) return bad(res, "Please give the group a name.");
    if (isBad(name) || isBad(about, false)) return bad(res, "Please remove rude words, phone numbers or links from the name.");
    if (limited(req, "newgroup:" + me.id, 10, 24 * 3600_000)) return bad(res, "You have made many groups today. Please try tomorrow.", 429);
    const people = [...new Set((Array.isArray(b.members) ? b.members : []).map(s => String(s).trim().toLowerCase().replace(/^@/, "")))].slice(0, GROUP_MAX - 1);
    const users = people.map(un => db.prepare("SELECT * FROM s_users WHERE username = ?").get(un));
    for (let i = 0; i < users.length; i++) { const why = canAdd(me, users[i]); if (why) return bad(res, users[i] ? why : "@" + people[i] + " was not found."); }
    let avatar = null;
    if (b.avatar) { avatar = takeMedia(b.avatar, me.id); if (!avatar) return bad(res, "The photo was not found. Please choose it again."); }
    const t = now();
    const id = db.transaction(() => {
      const gid = db.prepare("INSERT INTO s_groups(name, about, avatar, owner_id, invite, created_at, last_at) VALUES(?,?,?,?,?,?,?)").run(name, about || null, avatar, me.id, inviteCode(), t, t).lastInsertRowid;
      db.prepare("INSERT INTO s_group_members(group_id, user_id, role, read_at, joined_at) VALUES(?,?,?,?,?)").run(gid, me.id, "admin", t, t);
      for (const u of users) db.prepare("INSERT OR IGNORE INTO s_group_members(group_id, user_id, joined_at) VALUES(?,?,?)").run(gid, u.id, t);
      info(gid, me.name + " created the group “" + name + "”");
      return gid;
    })();
    res.json({ id });
  });

  // Open a group: details, members and messages (newest 100, or only the new ones with ?after=<last id>).
  r.get("/api/s/groups/:id", login, (req, res) => {
    const me = req.me, x = mine(req, res); if (!x) return;
    const { g, m } = x, after = Number(req.query.after) || 0;
    const MSG = "SELECT gm.*, u.username, u.name, u.avatar FROM s_group_msgs gm LEFT JOIN s_users u ON u.id = gm.sender_id WHERE gm.group_id = ?";
    const msgs = after ? db.prepare(`${MSG} AND gm.id > ? ORDER BY gm.id LIMIT 200`).all(g.id, after)
      : db.prepare(`SELECT * FROM (${MSG} AND gm.id < ? ORDER BY gm.id DESC LIMIT 100) ORDER BY id`).all(g.id, Number(req.query.before) > 0 ? Number(req.query.before) : 2 ** 53);
    db.prepare("UPDATE s_group_members SET read_at = ? WHERE group_id = ? AND user_id = ?").run(now(), g.id, me.id);
    const out = {
      group: { id: g.id, name: g.name, about: g.about || "", avatar: avatarUrl(g.avatar), onlyAdmins: !!g.only_admins, members: count(g.id), admin: m.role === "admin", created_at: g.created_at,
        invite: m.role === "admin" || !g.only_admins ? g.invite : null },
      cannot: g.only_admins && m.role !== "admin" ? "Only admins can send messages in this group." : "",
      messages: msgs.map(x => ({ id: x.id, info: x.kind === "info", mine: x.sender_id === me.id, text: x.text || "", photo: x.photo ? "/media/" + x.photo : null, at: x.created_at,
        user: x.sender_id ? pubUser(x) : null })),
    };
    if (!after) out.people = db.prepare("SELECT u.*, gm.role FROM s_group_members gm JOIN s_users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.role = 'admin' DESC, u.name LIMIT ?").all(g.id, GROUP_MAX)
      .map(u => ({ ...pubUser(u), admin: u.role === "admin", me: u.id === me.id }));
    res.json(out);
  });

  r.post("/api/s/groups/:id/messages", login, (req, res) => {
    const me = req.me, b = req.body || {}, x = mine(req, res); if (!x) return;
    const { g, m } = x;
    if (g.only_admins && m.role !== "admin") return bad(res, "Only admins can send messages in this group.", 403);
    const text = para(b.text, MESSAGE_MAX);
    if (!text && !b.photo) return bad(res, "Write a message.");
    if (limited(req, "msg:" + me.id, 300, 3600_000)) return bad(res, "You are sending too many messages. Please wait a little.", 429);
    let photo = null;
    if (b.photo) { photo = takeMedia(b.photo, me.id); if (!photo) return bad(res, "The photo was not found. Please choose it again."); }
    const t = now();
    const id = db.prepare("INSERT INTO s_group_msgs(group_id, sender_id, text, photo, created_at) VALUES(?,?,?,?,?)").run(g.id, me.id, text || null, photo, t).lastInsertRowid;
    db.prepare("UPDATE s_groups SET last_at = ? WHERE id = ?").run(t, g.id);
    db.prepare("UPDATE s_group_members SET read_at = ? WHERE group_id = ? AND user_id = ?").run(t, g.id, me.id);
    res.json({ id, at: t });
  });

  // Delete a message: the sender, or any admin of the group. It disappears for everyone.
  r.post("/api/s/group-messages/:id/delete", login, (req, res) => {
    const me = req.me, msg = db.prepare("SELECT * FROM s_group_msgs WHERE id = ? AND kind = 'msg'").get(Number(req.params.id));
    const m = msg && member(msg.group_id, me.id);
    if (!msg || !m || (msg.sender_id !== me.id && m.role !== "admin")) return bad(res, "Not found.", 404);
    db.prepare("DELETE FROM s_group_msgs WHERE id = ?").run(msg.id); dropMedia(msg.photo);
    res.json({ ok: true });
  });

  // Admins: change name, about, photo, "only admins can send", and the invite link.
  r.post("/api/s/groups/:id", login, (req, res) => {
    const me = req.me, b = req.body || {}, x = mine(req, res); if (!x) return;
    const { g, m } = x;
    if (m.role !== "admin") return bad(res, "Only group admins can change this.", 403);
    const name = b.name === undefined ? g.name : line(b.name, NAME_MAX), about = b.about === undefined ? g.about : para(b.about, ABOUT_MAX);
    if (!name) return bad(res, "Please give the group a name.");
    if (isBad(name) || isBad(about, false)) return bad(res, "Please remove rude words, phone numbers or links from the name.");
    let avatar = g.avatar;
    if (b.avatar === null) avatar = null;
    else if (b.avatar) { avatar = takeMedia(b.avatar, me.id); if (!avatar) return bad(res, "The photo was not found. Please choose it again."); }
    const onlyAdmins = b.onlyAdmins === undefined ? g.only_admins : b.onlyAdmins ? 1 : 0;
    const invite = b.invite === "reset" ? inviteCode() : b.invite === "off" ? null : g.invite;
    db.prepare("UPDATE s_groups SET name = ?, about = ?, avatar = ?, only_admins = ?, invite = ? WHERE id = ?").run(name, about || null, avatar, onlyAdmins, invite, g.id);
    if (avatar !== g.avatar && g.avatar) dropMedia(g.avatar);
    if (name !== g.name) info(g.id, me.name + " changed the group name to “" + name + "”");
    if (onlyAdmins !== g.only_admins) info(g.id, me.name + (onlyAdmins ? " allowed only admins to send messages" : " allowed all members to send messages"));
    res.json({ ok: true, invite });
  });

  // Admins add people (who follow them).
  r.post("/api/s/groups/:id/members", login, (req, res) => {
    const me = req.me, b = req.body || {}, x = mine(req, res); if (!x) return;
    const { g, m } = x;
    if (m.role !== "admin") return bad(res, "Only group admins can add people.", 403);
    const names = [...new Set((Array.isArray(b.add) ? b.add : []).map(s => String(s).trim().toLowerCase().replace(/^@/, "")))];
    if (!names.length) return bad(res, "Choose who to add.");
    if (count(g.id) + names.length > GROUP_MAX) return bad(res, "A group can have up to " + GROUP_MAX + " members.");
    const users = names.map(un => db.prepare("SELECT * FROM s_users WHERE username = ?").get(un));
    for (let i = 0; i < users.length; i++) { const why = canAdd(me, users[i]); if (why) return bad(res, users[i] ? why : "@" + names[i] + " was not found."); }
    const t = now();
    for (const u of users) if (db.prepare("INSERT OR IGNORE INTO s_group_members(group_id, user_id, joined_at) VALUES(?,?,?)").run(g.id, u.id, t).changes) info(g.id, me.name + " added " + u.name);
    res.json({ ok: true });
  });

  // Admins: remove a member, make admin, or remove as admin.
  r.post("/api/s/groups/:id/members/:username", login, (req, res) => {
    const me = req.me, act = String((req.body || {}).action || ""), x = mine(req, res); if (!x) return;
    const { g, m } = x;
    if (m.role !== "admin") return bad(res, "Only group admins can do this.", 403);
    const u = db.prepare("SELECT * FROM s_users WHERE username = ?").get(String(req.params.username).toLowerCase());
    const um = u && member(g.id, u.id);
    if (!um || u.id === me.id) return bad(res, "This person is not in the group.", 404);
    if (act === "remove") { db.prepare("DELETE FROM s_group_members WHERE group_id = ? AND user_id = ?").run(g.id, u.id); info(g.id, me.name + " removed " + u.name); }
    else if (act === "admin" || act === "member") db.prepare("UPDATE s_group_members SET role = ? WHERE group_id = ? AND user_id = ?").run(act, g.id, u.id);
    else return bad(res, "Unknown action.");
    res.json({ ok: true });
  });

  r.post("/api/s/groups/:id/leave", login, (req, res) => {
    const me = req.me, g = db.prepare("SELECT * FROM s_groups WHERE id = ?").get(Number(req.params.id));
    if (!g || !member(g.id, me.id)) return bad(res, "You are not in this group.", 404);
    db.prepare("DELETE FROM s_group_members WHERE group_id = ? AND user_id = ?").run(g.id, me.id);
    if (count(g.id)) info(g.id, me.name + " left");
    afterLeave(g.id);
    res.json({ ok: true });
  });

  // Invite link: qindiaglobal.com/community#/join/<code>. Anyone logged in can see the group's name and join.
  const byCode = code => /^[a-z0-9]{10}$/.test(String(code)) ? db.prepare("SELECT * FROM s_groups WHERE invite = ? AND status = 'ok'").get(String(code)) : null;
  r.get("/api/s/join/:code", login, (req, res) => {
    const g = byCode(req.params.code);
    if (!g) return bad(res, "This invite link does not work any more. Ask the group admin for a new one.", 404);
    res.json({ group: { id: g.id, name: g.name, about: g.about || "", avatar: avatarUrl(g.avatar), members: count(g.id), member: !!member(g.id, req.me.id) } });
  });
  r.post("/api/s/join/:code", login, (req, res) => {
    const me = req.me, g = byCode(req.params.code);
    if (!g) return bad(res, "This invite link does not work any more. Ask the group admin for a new one.", 404);
    if (!member(g.id, me.id)) {
      if (limited(req, "joingroup:" + me.id, 30, 24 * 3600_000)) return bad(res, "You have joined many groups today. Please try tomorrow.", 429);
      if (count(g.id) >= GROUP_MAX) return bad(res, "This group is full.");
      // Someone an admin blocked cannot come back through the link.
      if (db.prepare("SELECT 1 FROM s_blocks b JOIN s_group_members gm ON gm.user_id = b.blocker_id WHERE gm.group_id = ? AND gm.role = 'admin' AND b.blocked_id = ?").get(g.id, me.id))
        return bad(res, "You cannot join this group.", 403);
      db.prepare("INSERT INTO s_group_members(group_id, user_id, joined_at) VALUES(?,?,?)").run(g.id, me.id, now());
      info(g.id, me.name + " joined using the invite link");
    }
    res.json({ id: g.id });
  });

  // A member left the site: tidy up the groups they were in (called before their account is deleted).
  x.beforeUserDelete = uid => {
    const gids = db.prepare("SELECT group_id FROM s_group_members WHERE user_id = ?").all(uid).map(g => g.group_id);
    db.prepare("UPDATE s_groups SET avatar = NULL WHERE avatar IN (SELECT name FROM s_media WHERE user_id = ?)").run(uid); // their photos are deleted
    db.prepare("DELETE FROM s_group_members WHERE user_id = ?").run(uid);
    return () => gids.forEach(afterLeave);
  };

  // ---------- reports and the site owner ----------
  // Report a group message (any member) or a whole group (its name or photo).
  x.reportKinds.groupmsg = {
    ok: (me, id) => { const msg = db.prepare("SELECT * FROM s_group_msgs WHERE id = ? AND kind = 'msg' AND sender_id != ?").get(id, me.id); return !!msg && !!member(msg.group_id, me.id); },
    bump: id => db.prepare("UPDATE s_group_msgs SET reported = 1 WHERE id = ?").run(id), // only reported messages are shown to the owner
  };
  x.reportKinds.group = {
    ok: (me, id) => !!member(id, me.id),
    bump: id => db.prepare("UPDATE s_groups SET reports = reports + 1 WHERE id = ?").run(id),
  };
  x.reportItem.groupmsg = id => {
    const m = db.prepare("SELECT m.*, u.username, g.name AS gname FROM s_group_msgs m JOIN s_users u ON u.id = m.sender_id JOIN s_groups g ON g.id = m.group_id WHERE m.id = ? AND m.reported = 1").get(id);
    return m && { username: m.username, text: "In group “" + m.gname + "”: " + (m.text || ""), photo: m.photo && "/media/" + m.photo };
  };
  x.reportItem.group = id => {
    const g = db.prepare("SELECT g.*, u.username FROM s_groups g LEFT JOIN s_users u ON u.id = g.owner_id WHERE g.id = ?").get(id);
    return g && { username: g.username || "", text: "Group “" + g.name + "” · " + count(g.id) + " members" + (g.about ? " · " + g.about : ""), photo: g.avatar && "/media/" + g.avatar, status: g.status };
  };
  x.ownerActions["groupmsg-delete"] = id => {
    const m = db.prepare("SELECT m.id, m.text, m.photo, m.created_at, m.group_id, u.username FROM s_group_msgs m JOIN s_users u ON u.id = m.sender_id WHERE m.id = ? AND m.reported = 1").get(id);
    if (!m) return;
    db.prepare("DELETE FROM s_group_msgs WHERE id = ?").run(id);
    const kept = hold.keep("groupmsg", m.id, m, { photo: m.photo, reason: "reported group message removed by owner" });
    if (kept) db.prepare("DELETE FROM s_media WHERE name = ?").run(kept); else dropMedia(m.photo);
  };
  x.ownerActions["group-close"] = id => db.prepare("UPDATE s_groups SET status = 'closed' WHERE id = ?").run(id);
  x.ownerActions["group-open"] = id => db.prepare("UPDATE s_groups SET status = 'ok', reports = 0 WHERE id = ?").run(id);
  x.ownerCounts.groups = () => db.prepare("SELECT COUNT(*) AS n FROM s_groups").get().n;
  x.ownerCounts.groupMessagesToday = () => db.prepare("SELECT COUNT(*) AS n FROM s_group_msgs WHERE kind = 'msg' AND created_at > ?").get(now() - 24 * 3600_000).n;
};

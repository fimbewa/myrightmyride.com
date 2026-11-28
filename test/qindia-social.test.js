// Q India Community on qindiaglobal.com: accounts, posts, photos, follow, messages and owner moderation.
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qis-"));
process.env.QI_MEMBER_MEDIA = "1"; // these tests check uploads; the live site is text only
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { solve } = require("../server/qindia-safety");
const { server } = require("../server/index.js");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let ipN = 1;
function call(method, p, body, { token, raw, ip } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw || (body ? JSON.stringify(body) : null);
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": raw ? "application/octet-stream" : "application/json", "x-forwarded-for": ip || "10.0.0.1", ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => { const buf = Buffer.concat(chunks), s = buf.toString("utf8"); let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, text: s, buf, data: json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
async function signup(username, extra = {}) {
  const { token } = (await call("GET", "/api/human")).data;
  return call("POST", "/api/s/signup", { username, name: username.toUpperCase(), password: "password1", agree: true, human: token, n: solve(token), ...extra }, { ip: "10.0.1." + ipN++ });
}
// A tiny JPEG with an EXIF (APP1) block that must be removed.
const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x0b]), Buffer.from("Exif\0\0GPS")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), exif, Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9])]);

let A, B, C;
test("sign up needs the human check, a good username and 18+ consent", async () => {
  assert.equal((await call("GET", "/community")).status, 200);
  for (const f of ["/community.js", "/community.css"]) assert.equal((await call("GET", f)).status, 200, f);
  assert.match((await call("GET", "/community")).text, /data-t="disc"/); // keeps the "not government approved" disclaimer
  assert.equal((await call("POST", "/api/s/signup", { username: "robot1", name: "R", password: "password1", agree: true })).status, 403);
  assert.equal((await signup("ab")).status, 400);
  assert.equal((await signup("admin")).status, 400);
  assert.equal((await signup("noagree", { agree: false })).status, 400);
  const a = await signup("asha");
  assert.equal(a.status, 200); assert.match(a.data.recovery, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal((await signup("asha")).status, 409);
  A = a.data.token; B = (await signup("bala", { ref: "asha" })).data.token; C = (await signup("chetan")).data.token;
  assert.equal((await call("GET", "/api/s/me", null, { token: A })).data.username, "asha");
  const db = require("../server/db");
  assert.equal(db.prepare("SELECT r.username FROM s_users u JOIN s_users r ON r.id = u.ref_by WHERE u.username = 'bala'").get().username, "asha", "referrer saved");
  assert.equal((await call("POST", "/api/s/login", { username: "asha", password: "nope" })).status, 401);
  assert.ok((await call("POST", "/api/s/login", { username: "Asha", password: "password1" })).data.token);
  // forgotten password with the recovery code
  const r = await call("POST", "/api/s/recover", { username: "asha", code: a.data.recovery.toLowerCase(), password: "newpass99" });
  assert.equal(r.status, 200); A = r.data.token;
  assert.equal((await call("POST", "/api/s/recover", { username: "asha", code: a.data.recovery, password: "x2345678" })).status, 401, "old code no longer works");
  assert.equal((await call("POST", "/api/s/login", { username: "asha", password: "newpass99" })).status, 200);
});

let postId, photoPostId;
test("posts, feed, likes, comments, follow and alerts", async () => {
  assert.equal((await call("POST", "/api/s/posts", { text: "hello" })).status, 401);
  assert.equal((await call("POST", "/api/s/posts", { text: "you are a chutiya" }, { token: A })).status, 400);
  const p = await call("POST", "/api/s/posts", { text: "Saw a perfect queue at Dadar today https://example.com" }, { token: A });
  assert.equal(p.data.post.status, "ok"); postId = p.data.post.id;
  // photo: EXIF removed, photo posts wait for the owner (default)
  const up = await call("POST", "/api/s/upload", null, { token: A, raw: JPG });
  assert.equal(up.status, 200);
  const file = await call("GET", "/media/" + up.data.id);
  assert.equal(file.status, 200); assert.ok(!file.buf.includes(Buffer.from("GPS")), "EXIF removed");
  assert.equal((await call("POST", "/api/s/upload", null, { token: A, raw: Buffer.from("not a photo") })).status, 400);
  const pp = await call("POST", "/api/s/posts", { text: "", photo: up.data.id }, { token: A });
  assert.equal(pp.data.post.status, "pending"); photoPostId = pp.data.post.id;
  assert.equal((await call("POST", "/api/s/posts", { photo: up.data.id }, { token: B })).status, 400, "cannot use someone else's photo");
  // the public feed (no login) shows the text post only
  const feed = (await call("GET", "/api/s/feed")).data.posts.map(x => x.id);
  assert.deepEqual(feed, [postId]);
  assert.ok((await call("GET", "/api/s/feed", null, { token: A })).data.posts.some(x => x.id === photoPostId), "author sees own waiting post");
  // like + comment + follow -> alerts for asha
  assert.equal((await call("POST", `/api/s/posts/${postId}/like`, {}, { token: B })).data.likes, 1);
  assert.equal((await call("POST", `/api/s/posts/${postId}/like`, {}, { token: B })).data.likes, 1, "liking twice counts once");
  assert.equal((await call("POST", `/api/s/posts/${postId}/comments`, { text: "Well done!" }, { token: B })).data.status, "ok");
  assert.equal((await call("POST", "/api/s/users/asha/follow", {}, { token: B })).data.following, true);
  const me = (await call("GET", "/api/s/me", null, { token: A })).data;
  assert.equal(me.notifs, 3);
  const n = (await call("GET", "/api/s/notifs", null, { token: A })).data.items.map(x => x.kind).sort();
  assert.deepEqual(n, ["comment", "follow", "like"]);
  const post = (await call("GET", "/api/s/posts/" + postId, null, { token: B })).data;
  assert.equal(post.post.likes, 1); assert.equal(post.post.liked, true); assert.equal(post.comments[0].text, "Well done!");
  const prof = (await call("GET", "/api/s/users/asha", null, { token: B })).data.user;
  assert.equal(prof.followers, 1); assert.equal(prof.iFollow, true);
  assert.deepEqual((await call("GET", "/api/s/feed?tab=following", null, { token: B })).data.posts.map(x => x.id), [postId]);
  assert.deepEqual((await call("GET", "/api/s/feed?tab=following", null, { token: C })).data.posts, []);
  assert.equal((await call("GET", "/api/s/users/asha/followers")).data.users[0].username, "bala");
  assert.ok((await call("GET", "/api/s/search?q=bal")).data.users.some(u => u.username === "bala"));
  // profile edit with a photo
  const av = await call("POST", "/api/s/upload", null, { token: B, raw: JPG });
  assert.equal((await call("POST", "/api/s/me", { bio: "I queue up", city: "Pune", avatar: av.data.id }, { token: B })).status, 200);
  assert.match((await call("GET", "/api/s/users/bala")).data.user.avatar, /^\/media\//);
});

test("private messages: requests, replies, photos only between mutual followers, block, report", async () => {
  // chetan does not follow asha and asha doesn't follow chetan: one request only
  assert.equal((await call("POST", "/api/s/chats/asha", { text: "Hi Asha, can I join your queue group?" }, { token: C })).status, 200);
  assert.equal((await call("POST", "/api/s/chats/asha", { text: "hello??" }, { token: C })).status, 403);
  const list = (await call("GET", "/api/s/chats", null, { token: A })).data.chats;
  assert.equal(list[0].user.username, "chetan"); assert.equal(list[0].request, true); assert.equal(list[0].unread, true);
  assert.equal((await call("GET", "/api/s/me", null, { token: A })).data.messages, 1);
  const chat = (await call("GET", "/api/s/chats/chetan", null, { token: A })).data;
  assert.equal(chat.messages.length, 1); assert.equal(chat.messages[0].mine, false);
  assert.equal((await call("GET", "/api/s/me", null, { token: A })).data.messages, 0, "opening the chat marks it read");
  assert.equal((await call("POST", "/api/s/chats/chetan", { text: "Yes, welcome!" }, { token: A })).status, 200);
  assert.equal((await call("POST", "/api/s/chats/asha", { text: "Thanks!" }, { token: C })).status, 200, "after a reply they can talk freely");
  const after = chat.messages[0].id;
  assert.equal((await call("GET", "/api/s/chats/chetan?after=" + after, null, { token: A })).data.messages.length, 2);
  // photos need mutual follow
  const up = await call("POST", "/api/s/upload", null, { token: C, raw: JPG });
  assert.equal((await call("POST", "/api/s/chats/asha", { photo: up.data.id }, { token: C })).status, 403);
  await call("POST", "/api/s/users/asha/follow", {}, { token: C }); await call("POST", "/api/s/users/chetan/follow", {}, { token: A });
  assert.equal((await call("POST", "/api/s/chats/asha", { photo: up.data.id }, { token: C })).status, 200);
  // a third person cannot read the chat
  const bc = (await call("GET", "/api/s/chats/chetan", null, { token: B })).data;
  assert.equal(bc.messages.length, 0);
  // report a message: the owner sees only that one
  const msgs = (await call("GET", "/api/s/chats/chetan", null, { token: A })).data.messages;
  const theirs = msgs.find(m => !m.mine);
  assert.equal((await call("POST", "/api/s/report", { kind: "message", id: theirs.id, reason: "spam" }, { token: A })).status, 200);
  assert.equal((await call("POST", "/api/s/report", { kind: "message", id: msgs.find(m => m.mine).id }, { token: A })).status, 404, "cannot report own message");
  // block: no more messages either way
  assert.equal((await call("POST", "/api/s/users/chetan/block", {}, { token: A })).status, 200);
  assert.equal((await call("POST", "/api/s/chats/asha", { text: "hey" }, { token: C })).status, 403);
  assert.equal((await call("GET", "/api/s/users/asha", null, { token: C })).status, 404);
  assert.ok(!(await call("GET", "/api/s/feed", null, { token: C })).data.posts.some(p => p.user.username === "asha"));
  await call("POST", "/api/s/users/chetan/block", { block: false }, { token: A });
  // delete my own message
  const mine = msgs.find(m => m.mine);
  assert.equal((await call("POST", `/api/s/messages/${mine.id}/delete`, {}, { token: A })).status, 200);
  assert.ok(!(await call("GET", "/api/s/chats/asha", null, { token: C })).data.messages.some(m => m.id === mine.id));
});

test("owner moderation: waiting photos, reports, 3 reports hide, ban, delete account", async () => {
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  assert.equal((await call("GET", "/api/admin/community")).status, 401);
  let d = (await call("GET", "/api/admin/community", null, { token: own })).data;
  assert.equal(d.users, 3); assert.ok(d.pendingPosts.some(p => p.id === photoPostId));
  assert.ok(d.reports.some(r => r.kind === "message" && r.item && r.item.username === "chetan"));
  await call("POST", "/api/admin/community", { action: "post-ok", id: photoPostId }, { token: own });
  assert.ok((await call("GET", "/api/s/feed")).data.posts.some(p => p.id === photoPostId), "approved photo is public");
  // three different members report the text post -> hidden until the owner looks
  const D = (await signup("deepa")).data.token;
  for (const t of [B, C, D]) await call("POST", "/api/s/report", { kind: "post", id: postId, reason: "test" }, { token: t });
  assert.ok(!(await call("GET", "/api/s/feed")).data.posts.some(p => p.id === postId));
  d = (await call("GET", "/api/admin/community", null, { token: own })).data;
  assert.ok(d.pendingPosts.some(p => p.id === postId));
  await call("POST", "/api/admin/community", { action: "post-ok", id: postId }, { token: own });
  assert.ok((await call("GET", "/api/s/feed")).data.posts.some(p => p.id === postId));
  // ban chetan: logged out, cannot log in, posts hidden
  const cid = d.people.find(u => u.username === "chetan").id;
  await call("POST", "/api/admin/community", { action: "ban", id: cid }, { token: own });
  assert.equal((await call("GET", "/api/s/me", null, { token: C })).status, 401);
  assert.equal((await call("POST", "/api/s/login", { username: "chetan", password: "password1" })).status, 403);
  assert.equal((await call("GET", "/api/s/users/chetan")).status, 404);
  // photo approval switch off: photo posts go live at once
  await call("POST", "/api/admin/community", { action: "photo-approval", on: false }, { token: own });
  const up = await call("POST", "/api/s/upload", null, { token: B, raw: JPG });
  assert.equal((await call("POST", "/api/s/posts", { photo: up.data.id, text: "Queue at the bus stop" }, { token: B })).data.post.status, "ok");
  // a member deletes their own account
  assert.equal((await call("POST", "/api/s/delete-account", { password: "wrong" }, { token: B })).status, 401);
  assert.equal((await call("POST", "/api/s/delete-account", { password: "password1" }, { token: B })).status, 200);
  assert.equal((await call("GET", "/api/s/users/bala")).status, 404);
  const p = (await call("GET", "/api/s/posts/" + postId)).data.post;
  assert.equal(p.likes, 0); assert.equal(p.comments, 0);
  assert.equal((await call("GET", "/media/" + up.data.id)).status, 404, "their photos are removed");
});

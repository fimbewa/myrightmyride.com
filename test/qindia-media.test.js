// Q India Community: short videos (Reels) and voice messages. Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qim-"));
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
function call(method, p, body, { token, raw, ip, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw || (body ? JSON.stringify(body) : null);
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": raw ? "application/octet-stream" : "application/json", "x-forwarded-for": ip || "10.0.0.1", ...(token ? { authorization: "Bearer " + token } : {}), ...headers } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => { const buf = Buffer.concat(chunks), s = buf.toString("utf8"); let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, data: json, buf, headers: res.headers }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
async function signup(username) {
  const { token } = (await call("GET", "/api/human")).data;
  return (await call("POST", "/api/s/signup", { username, name: username.toUpperCase(), password: "password1", agree: true, human: token, n: solve(token) }, { ip: "10.0.3." + ipN++ })).data.token;
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(200, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 1)]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);

let A, B, own;
test("video posts: upload, waits for the owner, then in Reels; plays with byte ranges", async () => {
  A = await signup("kavya"); B = await signup("lalit");
  assert.equal((await call("POST", "/api/s/upload-av?kind=video", null, { token: A, raw: JPG })).status, 400, "a photo is not a video");
  const up = await call("POST", "/api/s/upload-av?kind=video", null, { token: A, raw: MP4 });
  assert.equal(up.status, 200); assert.match(up.data.id, /^[a-f0-9]{32}\.mp4$/);
  // a video id cannot be used as a photo, and the other way round
  assert.equal((await call("POST", "/api/s/posts", { photo: up.data.id }, { token: A })).status, 400);
  assert.equal((await call("POST", "/api/s/posts", { video: up.data.id }, { token: B })).status, 400, "not B's file");
  const p = await call("POST", "/api/s/posts", { text: "Queue at Andheri", video: up.data.id }, { token: A });
  assert.equal(p.status, 200); assert.equal(p.data.post.status, "pending"); assert.equal(p.data.post.video, "/media/" + up.data.id); assert.equal(p.data.post.photo, null);
  assert.equal((await call("GET", "/api/s/reels", null, { token: B })).data.posts.length, 0, "waits for the owner");
  own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  assert.equal((await call("POST", "/api/admin/community", { action: "post-ok", id: p.data.post.id }, { token: own })).status, 200);
  const reels = (await call("GET", "/api/s/reels")).data.posts;
  assert.equal(reels.length, 1); assert.equal(reels[0].video, "/media/" + up.data.id);
  const part = await call("GET", "/media/" + up.data.id, null, { headers: { range: "bytes=0-9" } });
  assert.equal(part.status, 206); assert.equal(part.buf.length, 10); assert.match(part.headers["content-type"], /video\/mp4/);
  // photo posts are not in Reels
  const ph = (await call("POST", "/api/s/upload", null, { token: A, raw: JPG })).data.id;
  const pp = (await call("POST", "/api/s/posts", { photo: ph }, { token: A })).data.post.id;
  await call("POST", "/api/admin/community", { action: "post-ok", id: pp }, { token: own });
  assert.equal((await call("GET", "/api/s/reels")).data.posts.length, 1);
  // deleting the post removes the video file
  await call("POST", `/api/s/posts/${p.data.post.id}/delete`, {}, { token: A });
  await new Promise(r => setTimeout(r, 50));
  assert.equal((await call("GET", "/media/" + up.data.id)).status, 404);
});

test("voice messages: private chats between mutual followers, and groups", async () => {
  const v = (await call("POST", "/api/s/upload-av?kind=audio", null, { token: A, raw: WEBM })).data.id;
  assert.match(v, /^[a-f0-9]{32}\.weba$/);
  assert.equal((await call("POST", "/api/s/upload-av?kind=audio", null, { token: A, raw: Buffer.concat([WEBM, Buffer.alloc(3.5 * 1024 * 1024)]) })).status, 413, "too long");
  assert.equal((await call("POST", "/api/s/chats/lalit", { audio: v }, { token: A })).status, 403, "not mutual followers");
  await call("POST", "/api/s/users/lalit/follow", {}, { token: A }); await call("POST", "/api/s/users/kavya/follow", {}, { token: B });
  assert.equal((await call("POST", "/api/s/chats/lalit", { photo: v }, { token: A })).status, 400, "audio is not a photo");
  assert.equal((await call("POST", "/api/s/chats/lalit", { audio: v }, { token: A })).status, 200);
  const chat = (await call("GET", "/api/s/chats/kavya", null, { token: B })).data.messages;
  assert.equal(chat[0].audio, "/media/" + v); assert.equal(chat[0].photo, null);
  assert.equal((await call("GET", "/api/s/chats", null, { token: B })).data.chats[0].last, "🎤 Voice message");
  // group voice message (Ogg)
  const g = (await call("POST", "/api/s/groups", { name: "Voice test", members: ["lalit"] }, { token: A })).data.id;
  const o = (await call("POST", "/api/s/upload-av?kind=audio", null, { token: B, raw: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(50)]) })).data.id;
  assert.match(o, /\.ogg$/);
  assert.equal((await call("POST", `/api/s/groups/${g}/messages`, { audio: o }, { token: B })).status, 200);
  const gm = (await call("GET", "/api/s/groups/" + g, null, { token: A })).data.messages.at(-1);
  assert.equal(gm.audio, "/media/" + o);
  assert.equal((await call("GET", "/api/s/groups", null, { token: A })).data.groups[0].last, "LALIT: 🎤 Voice message");
  // the owner sees a reported voice message and can remove it (kept in the legal hold)
  await call("POST", "/api/s/report", { kind: "groupmsg", id: gm.id, reason: "abuse" }, { token: A });
  const rep = (await call("GET", "/api/admin/community", null, { token: own })).data.reports.find(r => r.kind === "groupmsg");
  assert.equal(rep.item.photo, "/media/" + o);
  await call("POST", "/api/admin/community", { action: "groupmsg-delete", id: gm.id }, { token: own });
  assert.equal((await call("GET", "/media/" + o)).status, 404);
  assert.equal(require("../server/db").prepare("SELECT photo FROM q_legal_hold WHERE kind = 'groupmsg'").get().photo, o);
});

test("text only (the live setting): no photo, video or voice uploads; text posts still work", async () => {
  delete process.env.QI_MEMBER_MEDIA;
  try {
    const T = await signup("textonly");
    for (const p of ["/api/s/upload", "/api/s/upload-av?kind=video", "/api/s/upload-av?kind=audio"]) {
      const r = await call("POST", p, null, { token: T, raw: p.includes("audio") || p.includes("video") ? MP4 : JPG });
      assert.equal(r.status, 403, p); assert.match(r.data.error, /text only/);
    }
    assert.equal((await call("GET", "/api/s/me", null, { token: T })).data.media, false);
    assert.equal((await call("POST", "/api/s/posts", { text: "Stand in the queue, please." }, { token: T })).status, 200);
  } finally { process.env.QI_MEMBER_MEDIA = "1"; }
});

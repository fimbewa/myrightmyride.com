// Q India Community: Watch (videos, channels, views). Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qiw-"));
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
  return (await call("POST", "/api/s/signup", { username, name: username.toUpperCase(), password: "password1", agree: true, human: token, n: solve(token) }, { ip: "10.0.5." + ipN++ })).data.token;
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(200, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 1)]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);

test("watch: long videos, cover picture, views once per person, channels, subscriptions, popular", async () => {
  const A = await signup("pooja"), B = await signup("qasim");
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  await call("POST", "/api/admin/community", { action: "photo-approval", on: false }, { token: own });
  // a 45 MB video needs long=1
  const big = Buffer.concat([MP4, Buffer.alloc(45 * 1024 * 1024)]);
  assert.equal((await call("POST", "/api/s/upload-av?kind=video", null, { token: A, raw: big })).status, 413);
  const vid = (await call("POST", "/api/s/upload-av?kind=video&long=1", null, { token: A, raw: big })).data.id;
  const cover = (await call("POST", "/api/s/upload", null, { token: A, raw: JPG })).data.id;
  const long = (await call("POST", "/api/s/posts", { text: "How to queue at Dadar\nA 5 minute guide.", video: vid, poster: cover, duration: 300 }, { token: A })).data.post;
  assert.equal(long.poster, "/media/" + cover); assert.equal(long.duration, 300); assert.equal(long.views, 0);
  const shortV = (await call("POST", "/api/s/upload-av?kind=video", null, { token: A, raw: MP4 })).data.id;
  const short = (await call("POST", "/api/s/posts", { text: "Quick one", video: shortV, duration: 20 }, { token: A })).data.post;
  // Reels shows only the short one; Watch shows both
  assert.deepEqual((await call("GET", "/api/s/reels")).data.posts.map(p => p.id), [short.id]);
  assert.equal((await call("GET", "/api/s/watch")).data.videos.length, 2);
  // views: once per member, once per visitor connection
  await call("POST", `/api/s/watch/${long.id}/view`, {}, { token: B });
  await call("POST", `/api/s/watch/${long.id}/view`, {}, { token: B });
  await call("POST", `/api/s/watch/${long.id}/view`, {}, { ip: "10.7.7.7" });
  const w = (await call("GET", "/api/s/watch/" + long.id, null, { token: B })).data;
  assert.equal(w.video.views, 2); assert.equal(w.channel.username, "pooja"); assert.equal(w.channel.subscribed, false);
  assert.equal(w.next[0].id, short.id);
  assert.equal((await call("GET", "/api/s/watch?sort=popular")).data.videos[0].id, long.id);
  // subscribe = follow
  assert.equal((await call("GET", "/api/s/watch?sort=subs", null, { token: B })).data.videos.length, 0);
  await call("POST", "/api/s/users/pooja/follow", {}, { token: B });
  assert.equal((await call("GET", "/api/s/watch?sort=subs", null, { token: B })).data.videos.length, 2);
  assert.equal((await call("GET", "/api/s/watch?user=pooja")).data.videos.length, 2);
  assert.equal((await call("GET", "/api/s/watch?user=qasim")).data.videos.length, 0);
  // a Page channel
  await call("POST", "/api/s/pages", { handle: "queue_tv", name: "Queue TV" }, { token: B });
  const pv = (await call("POST", "/api/s/upload-av?kind=video", null, { token: B, raw: MP4 })).data.id;
  await call("POST", "/api/s/posts", { text: "Page video", video: pv, page: "queue_tv" }, { token: B });
  const pw = (await call("GET", "/api/s/watch?page=queue_tv")).data.videos;
  assert.equal(pw.length, 1); assert.equal(pw[0].user.page, true);
  // deleting the post removes the video and its cover picture
  await call("POST", `/api/s/posts/${long.id}/delete`, {}, { token: A });
  await new Promise(r => setTimeout(r, 50));
  assert.equal((await call("GET", "/media/" + cover)).status, 404);
  assert.equal((await call("GET", "/api/s/watch/" + long.id)).status, 404);
});

test("watch: a text post with a YouTube link is a video on Watch; other links are plain posts", async () => {
  const Y = await signup("ytposter");
  const yt = (await call("POST", "/api/s/posts", { text: "Good queue at Dadar station\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5" }, { token: Y })).data.post;
  assert.equal(yt.yt, "dQw4w9WgXcQ"); assert.equal(yt.status, "ok", "a link alone does not make a post wait");
  const short = (await call("POST", "/api/s/posts", { text: "https://youtube.com/shorts/abcdefghijk" }, { token: Y })).data.post;
  assert.equal(short.yt, "abcdefghijk");
  const plain = (await call("POST", "/api/s/posts", { text: "News: https://example.org/queue-story" }, { token: Y })).data.post;
  assert.equal(plain.yt, undefined);
  const list = (await call("GET", "/api/s/watch?user=ytposter")).data.videos.map(v => v.id);
  assert.deepEqual(list.sort(), [yt.id, short.id].sort());
  const one = (await call("GET", "/api/s/watch/" + yt.id)).data;
  assert.equal(one.video.yt, "dQw4w9WgXcQ"); assert.equal(one.channel.username, "ytposter");
  assert.equal((await call("GET", "/api/s/watch/" + plain.id)).status, 404);
  await call("POST", `/api/s/watch/${yt.id}/view`, {}, { token: Y });
  assert.equal((await call("GET", "/api/s/watch/" + yt.id)).data.video.views, 1);
});

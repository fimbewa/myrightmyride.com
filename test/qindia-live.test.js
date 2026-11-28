// Q India Community: Live (a YouTube or Facebook live stream shared here, with live chat). Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qil-"));
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


test("live: go live with a YouTube or Facebook link, followers are told, live chat, end", async () => {
  const A = await signup("liveana"), B = await signup("livebob"), C = await signup("livecat");
  await call("POST", "/api/s/users/liveana/follow", {}, { token: B });
  assert.equal((await call("POST", "/api/s/live", { title: "Queue at Dadar", link: "https://example.org/x" }, { token: A })).status, 400, "only YouTube or Facebook");
  assert.equal((await call("POST", "/api/s/live", { link: "https://youtube.com/live/abcdefghijk" }, { token: A })).status, 400, "needs a title");
  const p = (await call("POST", "/api/s/live", { title: "Queue at Dadar", link: "https://youtube.com/live/abcdefghijk?feature=share" }, { token: A })).data.post;
  assert.equal(p.live, true); assert.equal(p.yt, "abcdefghijk");
  assert.deepEqual((await call("GET", "/api/s/live")).data.live.map(x => x.id), [p.id], "visitors see who is live");
  assert.ok((await call("GET", "/api/s/notifs", null, { token: B })).data.items.some(n => n.kind === "live" && n.post_id === p.id), "follower alerted");
  assert.ok(!(await call("GET", "/api/s/notifs", null, { token: C })).data.items.some(n => n.kind === "live"), "others not alerted");
  // live chat
  await call("POST", `/api/s/posts/${p.id}/comments`, { text: "Hello from Thane" }, { token: B });
  const c1 = (await call("GET", `/api/s/live/${p.id}/chat`)).data;
  assert.equal(c1.live, true); assert.equal(c1.chat.length, 1); assert.equal(c1.chat[0].text, "Hello from Thane");
  assert.equal((await call("GET", `/api/s/live/${p.id}/chat?after=${c1.chat[0].id}`)).data.chat.length, 0);
  assert.ok(!(await call("GET", "/api/s/notifs", null, { token: A })).data.items.some(n => n.kind === "comment"), "no alert per chat line");
  // Facebook link; going live again ends the first one
  const f = (await call("POST", "/api/s/live", { title: "Second", link: "https://www.facebook.com/qindia/videos/123456789/" }, { token: A })).data.post;
  assert.ok(f.fb && f.live);
  assert.deepEqual((await call("GET", "/api/s/live")).data.live.map(x => x.id), [f.id]);
  assert.equal((await call("POST", `/api/s/live/${f.id}/end`, {}, { token: B })).status, 404, "only the owner ends it");
  assert.equal((await call("POST", `/api/s/live/${f.id}/end`, {}, { token: A })).status, 200);
  assert.deepEqual((await call("GET", "/api/s/live")).data.live, []);
  const after = (await call("GET", "/api/s/watch/" + f.id)).data.video;
  assert.equal(after.wasLive, true, "stays on Watch after the live");
});

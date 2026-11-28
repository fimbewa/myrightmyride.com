// Q India Community: voice and video calls. Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qic-"));
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
  return (await call("POST", "/api/s/signup", { username, name: username.toUpperCase(), password: "password1", agree: true, human: token, n: solve(token) }, { ip: "10.0.6." + ipN++ })).data.token;
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(200, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 1)]);
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n", ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";

test("calls: only mutual followers, ring, answer, hang up, missed, logged in the chat; owner TURN", async () => {
  const A = await signup("rekha"), B = await signup("sameer"), C = await signup("tara");
  assert.equal((await call("POST", "/api/s/calls", { to: "sameer", kind: "video", offer: OFFER }, { token: A })).status, 403, "not following each other");
  await call("POST", "/api/s/users/sameer/follow", {}, { token: A }); await call("POST", "/api/s/users/rekha/follow", {}, { token: B });
  assert.equal((await call("POST", "/api/s/calls", { to: "sameer", kind: "video", offer: "hello" }, { token: A })).status, 400);
  const id = (await call("POST", "/api/s/calls", { to: "sameer", kind: "video", offer: OFFER }, { token: A })).data.id;
  const inc = (await call("GET", "/api/s/calls/incoming", null, { token: B })).data.call;
  assert.equal(inc.id, id); assert.equal(inc.kind, "video"); assert.equal(inc.offer, OFFER); assert.equal(inc.user.username, "rekha");
  assert.equal((await call("GET", "/api/s/calls/incoming", null, { token: C })).data.call, null);
  assert.equal((await call("GET", "/api/s/calls/" + id, null, { token: C })).status, 404, "strangers cannot see it");
  assert.equal((await call("POST", `/api/s/calls/${id}/answer`, { answer: ANSWER }, { token: A })).status, 404, "caller cannot answer");
  assert.equal((await call("POST", `/api/s/calls/${id}/answer`, { answer: ANSWER }, { token: B })).status, 200);
  const st = (await call("GET", "/api/s/calls/" + id, null, { token: A })).data;
  assert.equal(st.status, "accepted"); assert.equal(st.answer, ANSWER);
  // busy: tara cannot ring sameer now
  await call("POST", "/api/s/users/sameer/follow", {}, { token: C }); await call("POST", "/api/s/users/tara/follow", {}, { token: B });
  assert.equal((await call("POST", "/api/s/calls", { to: "sameer", kind: "audio", offer: OFFER }, { token: C })).status, 409);
  assert.equal((await call("POST", `/api/s/calls/${id}/end`, {}, { token: B })).status, 200);
  assert.equal((await call("GET", "/api/s/calls/" + id, null, { token: A })).data.status, "ended");
  assert.match((await call("GET", "/api/s/chats/sameer", null, { token: A })).data.messages.at(-1).text, /^📞 Video call · 0:0\d$/);
  // a call nobody answers is missed after 45 seconds
  const id2 = (await call("POST", "/api/s/calls", { to: "sameer", kind: "audio", offer: OFFER }, { token: C })).data.id;
  require("../server/db").prepare("UPDATE s_calls SET created_at = ? WHERE id = ?").run(Date.now() - 60_000, id2);
  assert.equal((await call("GET", "/api/s/calls/incoming", null, { token: B })).data.call, null);
  assert.equal((await call("GET", "/api/s/calls/" + id2, null, { token: C })).data.status, "missed");
  // declined
  const id3 = (await call("POST", "/api/s/calls", { to: "sameer", kind: "audio", offer: OFFER }, { token: C })).data.id;
  await call("POST", `/api/s/calls/${id3}/end`, {}, { token: B });
  assert.equal((await call("GET", "/api/s/calls/" + id3, null, { token: C })).data.status, "declined");
  assert.equal((await call("GET", "/api/s/chats/tara", null, { token: B })).data.messages.at(-1).text, "📞 Missed voice call");
  // config and the owner's TURN relay
  assert.equal((await call("GET", "/api/s/calls/config", null, { token: A })).data.iceServers.length, 1);
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  assert.equal((await call("POST", "/api/admin/turn", { url: "http://bad" }, { token: own })).status, 400);
  assert.equal((await call("POST", "/api/admin/turn", { url: "turn:turn.example.com:3478", username: "u", credential: "p" }, { token: own })).status, 200);
  const ice = (await call("GET", "/api/s/calls/config", null, { token: A })).data.iceServers;
  assert.equal(ice[1].urls[0], "turn:turn.example.com:3478"); assert.equal(ice[1].credential, "p");
  assert.equal((await call("GET", "/api/admin/turn", null, { token: own })).data.credential, undefined, "password never shown back");
});

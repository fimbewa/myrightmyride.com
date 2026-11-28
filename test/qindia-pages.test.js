// Q India Community: Pages and sharing posts. Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qip-"));
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
  return (await call("POST", "/api/s/signup", { username, name: username.toUpperCase(), password: "password1", agree: true, human: token, n: solve(token) }, { ip: "10.0.4." + ipN++ })).data.token;
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(200, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 1)]);

let A, B, C, own;
test("pages: create, follow, post as the Page, Following feed, owner closes", async () => {
  A = await signup("meera"); B = await signup("nikhil"); C = await signup("omkar");
  assert.equal((await call("POST", "/api/s/pages", { handle: "ab", name: "X" }, { token: A })).status, 400);
  assert.equal((await call("POST", "/api/s/pages", { handle: "qindia_official", name: "X" }, { token: A })).status, 400, "cannot pretend to be official");
  const pg = await call("POST", "/api/s/pages", { handle: "thane_queue", name: "Thane Queue Volunteers", category: "Volunteers", about: "We help at platform 2." }, { token: A });
  assert.equal(pg.status, 200);
  assert.equal((await call("POST", "/api/s/pages", { handle: "thane_queue", name: "Again" }, { token: B })).status, 409);
  // only the owner posts as the Page
  assert.equal((await call("POST", "/api/s/posts", { text: "hi", page: "thane_queue" }, { token: B })).status, 403);
  const post = await call("POST", "/api/s/posts", { text: "Queue drive on Sunday at 8 AM", page: "thane_queue" }, { token: A });
  assert.equal(post.status, 200); assert.equal(post.data.post.user.page, true); assert.equal(post.data.post.user.username, "thane_queue");
  // not on meera's own profile
  assert.equal((await call("GET", "/api/s/users/meera", null, { token: B })).data.posts.length, 0);
  // nikhil follows the Page: it appears in his Following feed
  assert.equal((await call("GET", "/api/s/feed?tab=following", null, { token: B })).data.posts.length, 0);
  assert.equal((await call("POST", "/api/s/pages/thane_queue/follow", {}, { token: B })).data.followers, 1);
  assert.equal((await call("GET", "/api/s/feed?tab=following", null, { token: B })).data.posts[0].text, "Queue drive on Sunday at 8 AM");
  const view = (await call("GET", "/api/s/pages/thane_queue", null, { token: B })).data;
  assert.equal(view.page.following, true); assert.equal(view.posts.length, 1);
  const list = (await call("GET", "/api/s/pages", null, { token: C })).data;
  assert.equal(list.discover[0].handle, "thane_queue");
  // edit: only the owner
  assert.equal((await call("POST", "/api/s/pages/thane_queue", { name: "Hacked" }, { token: B })).status, 403);
  assert.equal((await call("POST", "/api/s/pages/thane_queue", { name: "Thane Queue Team" }, { token: A })).status, 200);
  // report; the site owner closes it: posts disappear for others
  assert.equal((await call("POST", "/api/s/report", { kind: "page", id: view.page.id, reason: "fake" }, { token: C })).status, 200);
  own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  const rep = (await call("GET", "/api/admin/community", null, { token: own })).data;
  assert.match(rep.reports.find(r => r.kind === "page").item.text, /Thane Queue Team/); assert.equal(rep.pages, 1);
  await call("POST", "/api/admin/community", { action: "page-close", id: view.page.id }, { token: own });
  assert.equal((await call("GET", "/api/s/pages/thane_queue", null, { token: B })).status, 404);
  assert.equal((await call("GET", "/api/s/feed?tab=all", null, { token: B })).data.posts.length, 0);
  assert.equal((await call("POST", "/api/s/posts", { text: "x", page: "thane_queue" }, { token: A })).status, 403);
  await call("POST", "/api/admin/community", { action: "page-open", id: view.page.id }, { token: own });
  assert.equal((await call("GET", "/api/s/feed?tab=all", null, { token: B })).data.posts.length, 1);
});

test("sharing a post: shows the original inside, notifies, sharing a share shares the original", async () => {
  const orig = (await call("POST", "/api/s/posts", { text: "Line up, don't push!" }, { token: B })).data.post;
  const s1 = await call("POST", "/api/s/posts", { text: "So true", share: orig.id }, { token: C });
  assert.equal(s1.status, 200); assert.equal(s1.data.post.shared.id, orig.id); assert.equal(s1.data.post.shared.user.username, "nikhil");
  assert.ok((await call("GET", "/api/s/notifs", null, { token: B })).data.items.some(n => n.kind === "share"));
  const s2 = await call("POST", "/api/s/posts", { share: s1.data.post.id }, { token: A });
  assert.equal(s2.data.post.shared.id, orig.id, "points to the original");
  assert.equal((await call("POST", "/api/s/posts", { share: 999999 }, { token: A })).status, 404);
  // the original is deleted: the share says it is gone
  await call("POST", `/api/s/posts/${orig.id}/delete`, {}, { token: B });
  assert.equal((await call("GET", "/api/s/posts/" + s1.data.post.id, null, { token: A })).data.post.shared.gone, true);
  // deleting the Page removes its posts
  assert.equal((await call("POST", "/api/s/pages/thane_queue", { delete: true }, { token: A })).status, 200);
  assert.equal((await call("GET", "/api/s/pages", null, { token: A })).data.mine.length, 0);
});

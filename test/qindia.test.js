// qindiaglobal.com: pages, pledge counter, contact form and owner page, reached by the qindiaglobal Host header.
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qi-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
const { server } = require("../server/index.js");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function call(method, p, body, { host = "qindiaglobal.com", token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: p, method, headers: { host, "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      let s = ""; res.setEncoding("utf8"); res.on("data", c => (s += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, text: s, data: json, type: res.headers["content-type"] || "" }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

test("qindiaglobal pages are served for its domain only", async () => {
  const home = await call("GET", "/");
  assert.equal(home.status, 200);
  assert.match(home.text, /Qindiaglobal/);
  for (const p of ["/i18n.js", "/site.js", "/site.css", "/poster.html", "/admin", "/sitemap.xml", "/robots.txt", "/og.png"]) assert.equal((await call("GET", p)).status, 200, p);
  const www = await call("GET", "/", null, { host: "www.qindiaglobal.com" });
  assert.match(www.text, /Qindiaglobal/);
  const other = await call("GET", "/", null, { host: "myrightmyride.com" });
  assert.doesNotMatch(other.text, /Qindiaglobal ·/);
});

test("every language has every line, including the disclaimer", () => {
  global.window = {};
  require("../sites/qindiaglobal/i18n.js");
  const T = window.QI_T, keys = Object.keys(T.en);
  assert.equal(window.QI_LANGS.length, Object.keys(T).length);
  for (const [l] of window.QI_LANGS) {
    for (const k of keys) assert.ok(T[l][k], `${l} is missing ${k}`);
    assert.match(T[l].disc, /qindiaglobal\.com/, l);
  }
});

test("pledge counter and contact form", async () => {
  assert.equal((await call("GET", "/api/pledge")).data.count, 0);
  assert.equal((await call("POST", "/api/pledge", { name: "Asha" })).status, 400, "city is needed");
  const p = await call("POST", "/api/pledge", { name: "Asha", city: "Pune", country: "India", lang: "mr" });
  assert.equal(p.status, 200);
  assert.equal(p.data.count, 1);
  assert.deepEqual(p.data.recent[0], { city: "Pune", country: "India" });
  assert.equal((await call("GET", "/api/pledge")).data.recent[0].name, undefined, "names are never shown publicly");
  assert.equal((await call("POST", "/api/pledge", { city: "Bot", website: "spam" })).data.count, 1, "hidden spam field is ignored");
  assert.equal((await call("POST", "/api/contact", { kind: "volunteer" })).status, 400);
  assert.equal((await call("POST", "/api/contact", { kind: "volunteer", name: "Ravi", contact: "ravi@example.com", message: "I can help in Nashik" })).status, 200);
});

test("owner page needs the password and sees pledges and messages", async () => {
  assert.equal((await call("GET", "/api/admin/summary")).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { password: "nope" })).status, 401);
  const { token } = (await call("POST", "/api/admin/login", { password: "testpass123" })).data;
  const s = (await call("GET", "/api/admin/summary", null, { token })).data;
  assert.equal(s.pledges, 1);
  assert.equal(s.openMessages, 1);
  assert.equal(s.messages[0].message, "I can help in Nashik");
  await call("POST", `/api/admin/messages/${s.messages[0].id}/done`, {}, { token });
  assert.equal((await call("GET", "/api/admin/summary", null, { token })).data.openMessages, 0);
  const csv = await call("GET", "/api/admin/export/pledges", null, { token });
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.text, /Pune/);
});

test("owner password ignores quotes and spaces typed around it", () => {
  const ownerPassword = require("../server/owner-password");
  const keep = process.env.ADMIN_PASSWORD;
  for (const v of ['"testpass123"', " testpass123 ", "'testpass123'"]) { process.env.ADMIN_PASSWORD = v; assert.equal(ownerPassword(), "testpass123"); }
  process.env.ADMIN_PASSWORD = keep;
});

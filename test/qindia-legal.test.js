// Policy pages, Grievance Officer details, complaint form and the 180-day legal hold on qindiaglobal.com.
// Run with: npm test
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
function call(method, p, body, { token, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw || (body ? JSON.stringify(body) : null);
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": raw ? "application/octet-stream" : "application/json", "x-forwarded-for": "10.9.0." + ipN++, ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => { const s = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, text: s, data: json, headers: res.headers }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
const human = async () => { const { token } = (await call("GET", "/api/human")).data; return { human: token, n: solve(token) }; };
const PAGES = ["terms", "privacy", "community-guidelines", "grievance", "cookies", "advertising", "referral", "copyright", "disclaimer"];

test("all policy pages are served and link each other; old terms page redirects", async () => {
  const idx = await call("GET", "/legal/");
  assert.equal(idx.status, 200);
  for (const p of PAGES) {
    const r = await call("GET", "/legal/" + p);
    assert.equal(r.status, 200, p);
    assert.match(r.text, /not approved by, endorsed by, or connected with/, p + " has the disclaimer");
    assert.match(idx.text, new RegExp('href="/legal/' + p + '"'), "index links " + p);
  }
  for (const f of ["/legal/legal.js", "/legal/legal.css"]) assert.equal((await call("GET", f)).status, 200);
  const old = await call("GET", "/terms.html");
  assert.equal(old.status, 301); assert.equal(old.headers.location, "/legal/terms");
  assert.equal((await call("GET", "/privacy")).headers.location, "/legal/privacy");
  const terms = (await call("GET", "/legal/terms")).text;
  assert.match(terms, /Mediation Act, 2023/); assert.match(terms, /Arbitration and Conciliation Act, 1996/); assert.match(terms, /High Court of Judicature at Bombay/);
  assert.match((await call("GET", "/")).text, /href="\/legal\/grievance"/, "home footer links the grievance page");
});

test("grievance officer details: defaults, owner can change them", async () => {
  let c = (await call("GET", "/api/legal-contact")).data;
  assert.equal(c.officer, "Adv. Vijay Gulab Badgujar"); assert.equal(c.city, "Mumbai");
  assert.equal((await call("POST", "/api/admin/legal", { phone: "123" })).status, 401);
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  assert.equal((await call("POST", "/api/admin/legal", { email: "not-an-email" }, { token: own })).status, 400);
  assert.equal((await call("POST", "/api/admin/legal", { officer: "Adv. Vijay Gulab Badgujar", phone: "+91 90000 00000", hours: "10 to 6" }, { token: own })).status, 200);
  c = (await call("GET", "/api/legal-contact")).data;
  assert.equal(c.phone, "+91 90000 00000"); assert.equal(c.email, "vijaybadgujar999@gmail.com");
});

test("complaint form gives a number and reaches the owner", async () => {
  assert.equal((await call("POST", "/api/grievance", { kind: "nci", name: "Asha", contact: "a@b.in", details: "Morphed photo of me", agree: true })).status, 403, "needs human check");
  assert.equal((await call("POST", "/api/grievance", { kind: "nci", name: "Asha", contact: "", details: "Morphed photo of me", agree: true, ...(await human()) })).status, 400, "needs contact");
  const r = await call("POST", "/api/grievance", { kind: "nci", name: "Asha", contact: "a@b.in", link: "https://qindiaglobal.com/community#/p/1", details: "Morphed photo of me", agree: true, ...(await human()) });
  assert.equal(r.status, 200); assert.match(r.data.number, /^Q-\d+$/);
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  const m = (await call("GET", "/api/admin/summary", null, { token: own })).data.messages.find(x => "Q-" + x.id === r.data.number);
  assert.equal(m.kind, "nci"); assert.match(m.message, /Link: https:\/\/qindiaglobal.com/);
});

test("removed posts and closed accounts are kept out of sight for 180 days; rules reminder", async () => {
  const { token } = (await call("POST", "/api/s/signup", { username: "ravi_q", name: "Ravi", password: "password1", agree: true, ...(await human()) })).data;
  assert.equal((await call("GET", "/api/s/me", null, { token })).data.rulesDue, false, "just agreed at sign-up");
  const post = (await call("POST", "/api/s/posts", { text: "Queue at Thane station" }, { token })).data.post;
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  await call("POST", "/api/admin/community", { action: "post-delete", id: post.id }, { token: own });
  assert.equal((await call("GET", "/api/s/posts/" + post.id)).status, 404);
  await call("POST", "/api/s/delete-account", { password: "password1" }, { token });
  const db = require("../server/db");
  const rows = db.prepare("SELECT kind, data, expires_at - created_at AS span FROM q_legal_hold").all();
  assert.ok(rows.some(x => x.kind === "post" && JSON.parse(x.data).text === "Queue at Thane station"));
  const acc = rows.find(x => x.kind === "account");
  assert.equal(JSON.parse(acc.data).username, "ravi_q"); assert.ok(!("pass_hash" in JSON.parse(acc.data)));
  assert.equal(acc.span, 180 * 24 * 3600_000);
  assert.equal((await call("GET", "/api/admin/legal", null, { token: own })).data.hold.length, 2);
});

// qindiaglobal.com referral rewards: progress, payment details, monthly share of ad income (none when income is 0).
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qiref-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { server } = require("../server/index.js");
const db = require("../server/db");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function call(method, p, body, { token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      let s = ""; res.setEncoding("utf8"); res.on("data", c => (s += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, text: s, data: json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
const addUser = (username, refBy, ip = "x") => db.prepare("INSERT INTO s_users(username, name, pass_salt, pass_hash, rec_salt, rec_hash, ip_hash, created_at, ref_by) VALUES(?,?,?,?,?,?,?,?,?)")
  .run(username, username, "s", "h", "s", "h", ip, Date.now(), refBy ?? null).lastInsertRowid;
const loginAs = id => { const t = crypto.randomBytes(16).toString("hex"); db.prepare("INSERT INTO s_sessions(token_hash, user_id, created_at, used_at) VALUES(?,?,?,?)").run(crypto.createHash("sha256").update(t).digest("hex"), id, Date.now(), Date.now()); return t; };

test("referral pages, progress, payment details and monthly share", async () => {
  for (const p of ["/referral", "/admin-referral", "/legal/referral"]) assert.equal((await call("GET", p)).status, 200, p);
  assert.match((await call("GET", "/legal/referral")).text, /no advertising income for a month, the pool is zero/);
  assert.deepEqual((await call("GET", "/api/referral/rules")).data, { on: true, share: 10, target: 1000 });
  const { token: owner } = (await call("POST", "/api/admin/login", { password: "testpass123" })).data;
  // a small target keeps the test quick
  assert.equal((await call("POST", "/api/admin/referral/settings", { share: 10, target: 3, on: true }, { token: owner })).status, 200);

  const asha = addUser("asha", null, "net-a"), ravi = addUser("ravi", null, "net-r");
  for (let i = 0; i < 3; i++) addUser("a" + i, asha, i === 0 ? "net-a" : "o" + i);
  for (let i = 0; i < 6; i++) addUser("r" + i, ravi, "p" + i);
  const banned = addUser("a9", asha); db.prepare("UPDATE s_users SET status = 'banned' WHERE id = ?").run(banned); // blocked accounts do not count
  addUser("solo", null); // not invited

  const ta = loginAs(asha);
  assert.equal((await call("GET", "/api/referral/me")).status, 401);
  const me = (await call("GET", "/api/referral/me", null, { token: ta })).data;
  assert.equal(me.signups, 3); assert.equal(me.link, "https://qindiaglobal.com/community?ref=asha");
  assert.equal((await call("POST", "/api/referral/payee", { legal_name: "Asha Patil", pan: "BAD" }, { token: ta })).status, 400);
  assert.equal((await call("POST", "/api/referral/payee", { legal_name: "Asha Patil", pan: "abcde1234f", upi: "asha@okaxis" }, { token: ta })).status, 200);
  assert.equal((await call("GET", "/api/referral/me", null, { token: ta })).data.payee.pan, "••••••234F");

  // a month with no ad income: nothing to pay
  await call("POST", "/api/admin/referral/month", { month: "2026-11", income: 0 }, { token: owner });
  let a = (await call("GET", "/api/admin/referral", null, { token: owner })).data;
  assert.ok(a.payouts.every(p => p.amount === 0));
  // ₹9,000 income → pool ₹900, split 3:6
  const m = (await call("POST", "/api/admin/referral/month", { month: "2026-11", income: 9000 }, { token: owner })).data;
  assert.equal(m.pool, 900); assert.equal(m.people, 2);
  a = (await call("GET", "/api/admin/referral", null, { token: owner })).data;
  const pa = a.payouts.find(p => p.username === "asha"), pr = a.payouts.find(p => p.username === "ravi");
  assert.equal(pa.amount, 300); assert.equal(pr.amount, 600);
  assert.equal(a.top.find(t => t.username === "asha").sameNet, 1);
  assert.equal(a.top.find(t => t.username === "asha").payee.pan, "ABCDE1234F");
  await call("POST", "/api/admin/referral/payout/" + pa.id, { ref: "UPI 123" }, { token: owner });
  // working the month out again keeps what was paid
  await call("POST", "/api/admin/referral/month", { month: "2026-11", income: 12000 }, { token: owner });
  a = (await call("GET", "/api/admin/referral", null, { token: owner })).data;
  assert.equal(a.payouts.find(p => p.username === "asha").amount, 300);
  assert.equal(a.payouts.find(p => p.username === "asha").status, "paid");
  assert.equal(a.payouts.find(p => p.username === "ravi").amount, 800);
  // advertisers + Google, shown publicly
  await call("POST", "/api/admin/referral/month", { month: "2026-12", direct: 4000, network: 2000 }, { token: owner });
  const rep = (await call("GET", "/api/referral/report")).data.months;
  const dec = rep.find(m => m.month === "2026-12"), nov = rep.find(m => m.month === "2026-11");
  assert.equal(dec.income, 6000); assert.equal(dec.direct, 4000); assert.equal(dec.network, 2000);
  assert.equal(dec.pool, 600); assert.equal(dec.people, 2); assert.equal(dec.signups, 9);
  assert.equal(nov.paid, 1);
  const mine = (await call("GET", "/api/referral/me", null, { token: ta })).data.payouts;
  assert.equal(mine.find(p => p.month === "2026-11").status, "paid");
});

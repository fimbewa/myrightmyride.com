// qindiaglobal.com advertising: owner ads, advertiser requests, counting, AdSense settings and ads.txt.
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qiads-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { solve } = require("../server/qindia-safety");
const { server } = require("../server/index.js");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function call(method, p, body, { host = "qindiaglobal.com", token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: p, method, headers: { host, "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      let s = ""; res.setEncoding("utf8"); res.on("data", c => (s += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, text: s, data: json, headers: res.headers }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
async function proof() { const { token } = (await call("GET", "/api/human")).data; return { human: token, n: solve(token), agree: "on" }; }
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");

test("pages and files for ads are served", async () => {
  for (const p of ["/ads.js", "/ads-form.js", "/advertise", "/admin-ads"]) assert.equal((await call("GET", p)).status, 200, p);
  for (const p of ["/", "/blog/", "/blog/queue-mumbai-local"]) {
    const t = (await call("GET", p)).text;
    assert.match(t, /class="qi-ad" data-slot="/, p);
    assert.match(t, /src="\/ads\.js"/, p);
  }
  assert.match((await call("GET", "/legal/terms")).text, /AdSense/); // /terms.html now redirects here
  assert.equal((await call("GET", "/ads.txt")).status, 404); // no publisher ID yet
});

test("owner adds an ad; it shows, counts views and clicks once per visitor", async () => {
  const { token } = (await call("POST", "/api/admin/login", { password: "testpass123" })).data;
  assert.equal((await call("GET", "/api/admin/ads")).status, 401);
  assert.equal((await call("POST", "/api/admin/ads", { title: "Shop", link: "javascript:alert(1)", slots: ["home"] }, { token })).status, 400);
  const made = await call("POST", "/api/admin/ads", { advertiser: "Ravi Shoes", title: "50% off shoes", text: "Near Dadar station", link: "https://example.com/shoes", slots: ["home", "post"], image: PNG, paid: 1500 }, { token });
  assert.equal(made.status, 200, made.text);
  const id = made.data.id;
  const got = (await call("GET", "/api/ads?slots=home,blog,post")).data;
  assert.equal(got.ads.home.id, id);
  assert.equal(got.ads.post.id, id);
  assert.equal(got.ads.blog, undefined);
  assert.equal(got.adsense, null);
  assert.equal((await call("GET", got.ads.home.img)).status, 200);
  await call("POST", `/api/ads/${id}/view`); await call("POST", `/api/ads/${id}/view`);
  const go = await call("GET", `/ads/go/${id}`);
  assert.equal(go.status, 302); assert.equal(go.headers.location, "https://example.com/shoes");
  await call("GET", `/ads/go/${id}`);
  const list = (await call("GET", "/api/admin/ads", null, { token })).data;
  const ad = list.ads.find(a => a.id === id);
  assert.equal(ad.views, 1); assert.equal(ad.clicks, 1);
  assert.equal(list.totals.paid, 1500);
  assert.equal(list.days[0].views, 1);
  // pause takes it off; ads that ended are not shown
  await call("POST", `/api/admin/ads/${id}`, { action: "pause" }, { token });
  assert.equal((await call("GET", "/api/ads?slots=home")).data.ads.home, undefined);
  await call("POST", `/api/admin/ads/${id}`, { action: "resume" }, { token });
  await call("POST", `/api/admin/ads/${id}`, { action: "save", title: "Old", link: "https://example.com", slots: ["home"], ends: "2020-01-01" }, { token });
  assert.equal((await call("GET", "/api/ads?slots=home")).data.ads.home, undefined);
  await call("POST", `/api/admin/ads/${id}`, { action: "delete" }, { token });
});

test("advertiser request waits for approval; AdSense settings and ads.txt", async () => {
  assert.equal((await call("POST", "/api/advertise", { advertiser: "A", contact: "a@b.in", title: "T", link: "https://a.in", agree: "on" })).status, 403); // no human proof
  const sent = await call("POST", "/api/advertise", { advertiser: "Tea Stall", contact: "98xxxxxx", title: "Best chai", link: "https://chai.example", slots: ["blog"], ...(await proof()) });
  assert.equal(sent.status, 200, sent.text);
  assert.equal((await call("GET", "/api/ads?slots=blog")).data.ads.blog, undefined);
  const { token } = (await call("POST", "/api/admin/login", { password: "testpass123" })).data;
  const ad = (await call("GET", "/api/admin/ads", null, { token })).data.ads.find(a => a.title === "Best chai");
  assert.equal(ad.status, "pending");
  await call("POST", `/api/admin/ads/${ad.id}`, { action: "approve" }, { token });
  assert.equal((await call("GET", "/api/ads?slots=blog")).data.ads.blog.title, "Best chai");

  assert.equal((await call("POST", "/api/admin/ads-settings", { adsenseClient: "hello" }, { token })).status, 400);
  const ok = await call("POST", "/api/admin/ads-settings", { enabled: true, adsenseClient: "pub-1234567890123456", adsenseSlot: "9876543210", adsenseMode: "auto", rates: "Home: ₹1,000/week" }, { token });
  assert.equal(ok.status, 200);
  assert.equal((await call("GET", "/ads.txt")).text, "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
  const g = (await call("GET", "/api/ads?slots=home")).data.adsense;
  assert.deepEqual(g, { client: "ca-pub-1234567890123456", slot: "9876543210", auto: true });
  assert.equal((await call("GET", "/api/ads/rates")).data.rates, "Home: ₹1,000/week");
  await call("POST", "/api/admin/ads-settings", { enabled: false }, { token });
  const off = (await call("GET", "/api/ads?slots=blog")).data;
  assert.deepEqual(off.ads, {}); assert.equal(off.adsense, null);
  // myrightmyride.com is not affected
  assert.notEqual((await call("GET", "/api/ads?slots=home", null, { host: "myrightmyride.com" })).status, 200);
});

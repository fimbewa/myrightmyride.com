// qindiaglobal.com: pages, pledge counter, contact form and owner page, reached by the qindiaglobal Host header.
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qi-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { solve, isBad, isDoubtful } = require("../server/qindia-safety");
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

// What the browser does before sending a form: fetch a token and do the small sum.
async function proof() { const { token } = (await call("GET", "/api/human")).data; return { human: token, n: solve(token), agree: "on" }; }
const pledge = async b => call("POST", "/api/pledge", { ...b, ...(await proof()) });

test("qindiaglobal pages are served for its domain only", async () => {
  const home = await call("GET", "/");
  assert.equal(home.status, 200);
  assert.match(home.text, /Qindiaglobal/);
  for (const p of ["/i18n.js", "/i18n-in1.js", "/i18n-in2.js", "/site.js", "/site.css", "/poster.html", "/admin", "/sitemap.xml", "/robots.txt", "/og.png", "/legal/terms", "/pledge.js"]) assert.equal((await call("GET", p)).status, 200, p);
  const www = await call("GET", "/", null, { host: "www.qindiaglobal.com" });
  assert.match(www.text, /Qindiaglobal/);
  for (const p of ["/blog/", "/blog/queue-mumbai-local", "/blog/blog.css", "/blog/blog.js", "/blog/img/rush-vs-queue.png", "/blog/img/five-steps.svg"]) assert.equal((await call("GET", p)).status, 200, p);
  const post = await call("GET", "/blog/queue-mumbai-local");
  assert.match(post.text, /data-t="disc"/); // the blog keeps the "not government approved" disclaimer
  const other = await call("GET", "/", null, { host: "myrightmyride.com" });
  assert.doesNotMatch(other.text, /Qindiaglobal ·/);
});

test("every language has every line, including the disclaimer", () => {
  global.window = {};
  for (const f of ["i18n.js", "i18n-in1.js", "i18n-in2.js"]) require("../sites/qindiaglobal/" + f);
  const T = window.QI_T, keys = Object.keys(T.en).filter(k => k !== "title");
  assert.equal(window.QI_LANGS.filter(x => x[2] === "in").length, 22, "all 22 scheduled languages of India");
  assert.equal(window.QI_LANGS.length, Object.keys(T).length);
  for (const [l] of window.QI_LANGS) {
    for (const k of keys) assert.ok(T[l][k], `${l} is missing ${k}`);
    assert.match(T[l].disc, /qindiaglobal\.com/, l);
  }
});

test("pledge counter and contact form", async () => {
  assert.equal((await call("GET", "/api/pledge")).data.count, 0);
  assert.equal((await call("POST", "/api/pledge", { name: "Asha" })).status, 400, "city is needed");
  assert.equal((await call("POST", "/api/pledge", { city: "Pune", agree: "on" })).status, 403, "robots without the human check are refused");
  assert.equal((await call("POST", "/api/pledge", { city: "Pune", ...(await proof()), agree: false })).data.error, "agree");
  const p = await pledge({ name: "Asha", city: "Pune", country: "India", lang: "mr" });
  assert.equal(p.status, 200);
  assert.equal(p.data.count, 1);
  assert.deepEqual(p.data.recent[0], { city: "Pune", country: "India" });
  assert.equal((await call("GET", "/api/pledge")).data.recent[0].name, undefined, "names are never shown publicly");
  assert.equal((await call("POST", "/api/pledge", { city: "Bot", website: "spam" })).data.count, 1, "hidden spam field is ignored");
  await pledge({ city: "Thane", contact: "no-consent@example.com" });
  await pledge({ city: "Nagpur", contact: "9876543210", consent: "on" });
  assert.equal((await call("GET", "/api/pledge")).text.includes("9876543210"), false, "contacts are never public");
  assert.equal((await call("POST", "/api/contact", { kind: "volunteer" })).status, 400);
  assert.equal((await call("POST", "/api/contact", { kind: "volunteer", message: "hi", agree: "on" })).status, 403, "robots are refused");
  assert.equal((await call("POST", "/api/contact", { kind: "volunteer", name: "Ravi", contact: "ravi@example.com", message: "I can help in Nashik", ...(await proof()) })).status, 200);
});

test("owner page needs the password and sees pledges and messages", async () => {
  assert.equal((await call("GET", "/api/admin/summary")).status, 401);
  assert.equal((await call("POST", "/api/admin/login", { password: "nope" })).status, 401);
  const { token } = (await call("POST", "/api/admin/login", { password: "testpass123" })).data;
  const s = (await call("GET", "/api/admin/summary", null, { token })).data;
  assert.equal(s.pledges, 3);
  assert.equal(s.pledgesWithContact, 1, "email/phone is kept only with consent");
  assert.equal(s.latestPledges.find(r => r.city === "Thane").contact, null);
  assert.equal(s.latestPledges.find(r => r.city === "Nagpur").contact, "9876543210");
  assert.equal(s.byKind.find(k => k.kind === "volunteer").n, 1);
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

test("owner can set a new password after proving it through a GitHub file", async () => {
  const start = await call("POST", "/api/admin/reset/start", {});
  assert.equal(start.status, 200);
  assert.match(start.data.code, /^QI-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(start.data.github, /github\.com\/fimbewa\/myrightmyride\.com\/new\/main\?filename=owner-reset%2FQI-/);
  const waiting = await call("POST", "/api/admin/reset/finish", { code: start.data.code, password: "brandnew123" });
  assert.equal(waiting.status, 409, "no GitHub file yet, so it must wait");
  const dirPath = path.join(__dirname, "..", "owner-reset"), file = path.join(dirPath, start.data.code);
  fs.mkdirSync(dirPath, { recursive: true }); fs.writeFileSync(file, "test");
  try {
    assert.equal((await call("POST", "/api/admin/reset/finish", { code: start.data.code, password: "short" })).status, 400);
    const done = await call("POST", "/api/admin/reset/finish", { code: start.data.code, password: "brandnew123" });
    assert.equal(done.status, 200);
    assert.ok(done.data.token);
    assert.equal((await call("POST", "/api/admin/reset/finish", { code: start.data.code, password: "again12345" })).status, 410, "a code works once");
    assert.equal((await call("POST", "/api/admin/login", { password: "testpass123" })).status, 401, "old password no longer works");
    assert.equal((await call("POST", "/api/admin/login", { password: "brandnew123" })).status, 200);
    assert.equal((await call("POST", "/api/admin/login", { password: "brandnew123" }, { host: "myrightmyride.com" })).status, 200, "same password on the other owner page");
  } finally { fs.rmSync(file, { force: true }); }
});

test("a human token works once and cannot be faked", async () => {
  const pr = await proof();
  assert.equal((await call("POST", "/api/contact", { message: "one", ...pr })).status, 200);
  assert.equal((await call("POST", "/api/contact", { message: "two", ...pr })).status, 403, "used twice");
  const fake = await proof(); const parts = fake.human.split("."); parts[2] = "0".repeat(32);
  assert.equal((await call("POST", "/api/contact", { message: "three", ...fake, human: parts.join(".") })).status, 403, "forged");
  const lazy = await proof();
  assert.equal((await call("POST", "/api/contact", { message: "four", ...lazy, n: lazy.n + 1 })).status, 403, "sum not done");
});

test("rude, sexual or abusive words and links are refused; normal words are fine", () => {
  for (const bad of ["fuck you", "f.u.c.k", "porn", "chutiya", "चूतिया", "मादरचोद", "visit www.example.com", "call 98765 43210", "nudes"]) assert.ok(isBad(bad), bad);
  for (const ok of ["Pune", "Vancouver, BC", "Gandhinagar", "I will always wait my turn", "Mahatma Gandhi Road", "मैं कतार में खड़ा रहूँगा", "Kozhikode", "dengue free"]) assert.ok(!isBad(ok), ok);
});

test("personal pledge page and Pledge wall: clean lines show at once, doubtful ones wait for the owner", async () => {
  assert.equal((await pledge({ city: "Mumbai", wall: "Nice porn site" })).data.error, "bad", "rude lines are refused");
  assert.equal((await pledge({ city: "Mumbai", wall: "see www.spam.in" })).data.error, "bad", "links are refused");
  const p = await pledge({ name: "Meera Iyer", city: "Mumbai", country: "India", lang: "hi", wall: "Let people get off first <b>please</b>" });
  assert.equal(p.status, 200);
  assert.match(p.data.slug, /^[a-z0-9]{8}$/);
  const page = await call("GET", "/p/" + p.data.slug);
  assert.equal(page.status, 200);
  assert.match(page.text, /Meera Iyer/);
  assert.match(page.text, /noindex/);
  assert.match(page.text, /data-lang="hi"/);
  assert.match(page.text, /og:url" content="https:\/\/qindiaglobal.com\/p\//);
  assert.doesNotMatch(page.text, /\{\{/, "every blank is filled");
  assert.equal(p.data.wall, "ok", "a clean line goes on the wall at once");
  assert.equal((await call("GET", "/p/nosuchpage")).text.includes("Meera"), false);
  const loud = await pledge({ city: "Thane", wall: "I HATE PEOPLE WHO PUSH AT THE DOOR" });
  assert.equal(loud.data.wall, "pending", "a doubtful line waits");
  const { token } = (await call("POST", "/api/admin/login", { password: "brandnew123" })).data;
  let s = (await call("GET", "/api/admin/summary", null, { token })).data;
  assert.equal(s.wallPending, 1);
  assert.equal((await call("GET", "/api/wall")).data.items.length, 1, "the doubtful line is not shown yet");
  await call("POST", "/api/admin/wall/" + s.wall[0].id, { action: "ok" }, { token });
  assert.equal((await call("GET", "/api/wall")).data.items.length, 2, "shown after the owner approves it");
  await call("POST", "/api/admin/wall/" + s.wall[0].id, { action: "delete" }, { token });
  const w = (await call("GET", "/api/wall")).data.items;
  const id = w[0].id;
  assert.equal(w.length, 1);
  assert.equal(w[0].name, "Meera", "only the first name is public");
  assert.equal(w[0].text, "Let people get off first b please /b", "no HTML gets through");
  assert.match((await call("GET", "/p/" + p.data.slug)).text, /Let people get off first/);
  for (let i = 0; i < 3; i++) await call("POST", `/api/wall/${id}/report`, {});
  assert.ok(isDoubtful("Vote for my party") && !isDoubtful("Let people get off first"));
  assert.equal((await call("GET", "/api/wall")).data.items.length, 0, "3 reports take it down until checked again");
  s = (await call("GET", "/api/admin/summary", null, { token })).data;
  assert.equal(s.wall.find(x => x.id === id).reports, 3);
  assert.equal(s.wall.find(x => x.id === id).wall_status, "pending");
  await call("POST", "/api/admin/wall/" + id, { action: "ban" }, { token });
  assert.equal((await pledge({ city: "Mumbai" })).status, 403, "a blocked sender cannot post again");
  await call("POST", "/api/admin/unban-all", {}, { token });
  assert.notEqual((await pledge({ city: "Mumbai" })).status, 403, "unblocked again");
});

test("owner can publish blog posts up to 250,000 characters", async () => {
  assert.equal((await call("POST", "/api/admin/posts", { title: "x", body: "y" })).status, 401);
  const { token } = (await call("POST", "/api/admin/login", { password: "brandnew123" })).data;
  // 250,000 characters in Devanagari is about 750 KB, near the old 1 MB body limit, so test that too.
  const head = "# Queue first\n\nलाइन में खड़े रहें। ", tail = "\n\n- one https://example.com/a?b=1&c=2\n- two <script>alert(1)</script>\n- [Read the news](https://example.org/news-1), and https://example.org/x.";
  const long = head + "क".repeat(250000 - [...head].length - [...tail].length) + tail;
  assert.equal([...long].length, 250000);
  const ok = await call("POST", "/api/admin/posts", { title: "Queue first, always", body: long }, { token });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.data.url, "/blog/queue-first-always");
  const page = await call("GET", "/blog/queue-first-always");
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Queue first, always<\/h1>/);
  assert.match(page.text, /<h2>Queue first<\/h2>/);
  assert.match(page.text, /<li>one <a href="https:\/\/example.com\/a\?b=1&amp;c=2"/);
  assert.match(page.text, /<li><a href="https:\/\/example.org\/news-1" target="_blank" rel="noopener nofollow ugc">Read the news<\/a>, and <a href="https:\/\/example.org\/x"/);
  assert.doesNotMatch(page.text, /<script>alert/);
  assert.match(page.text, /data-t="disc"/);
  assert.match((await call("GET", "/blog/")).text, /href="\/blog\/queue-first-always"/);
  assert.equal((await call("GET", "/blog/queue-mumbai-local")).status, 200); // the older post still works
  const tooLong = await call("POST", "/api/admin/posts", { title: "Too long", body: "a".repeat(250001) }, { token });
  assert.equal(tooLong.status, 413);
  const list = (await call("GET", "/api/admin/posts", null, { token })).data;
  assert.equal(list.max, 250000);
  const id = list.posts[0].id;
  assert.equal((await call("POST", `/api/admin/posts/${id}`, { title: "New title", body: "Short now." }, { token })).status, 200);
  assert.match((await call("GET", "/blog/queue-first-always")).text, /New title/);
  await call("POST", `/api/admin/posts/${id}`, { action: "delete" }, { token });
  assert.equal((await call("GET", "/blog/queue-first-always")).status, 200); // falls back to the home page, like other unknown pages
  assert.doesNotMatch((await call("GET", "/blog/")).text, /queue-first-always/);
  // Visitor forms keep their small limits against spam.
  assert.equal((await call("POST", "/api/contact", { message: "a".repeat(1_100_000) })).status, 413);
});

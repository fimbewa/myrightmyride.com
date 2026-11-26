// Q India Community: "Continue with Google / Facebook". Google and Facebook are imitated here (no internet needed).
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qio-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { server } = require("../server/index.js");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// Pretend to be Google and Facebook: only the right code and secret give a profile.
const realFetch = global.fetch;
let person = { sub: "g-111", name: "Meera Shah" };
global.fetch = async (url, opts = {}) => {
  const u = String(url), json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
  if (u === "https://oauth2.googleapis.com/token") {
    const f = new URLSearchParams(opts.body);
    if (f.get("code") !== "good" || f.get("client_secret") !== "gsecret123" || !f.get("redirect_uri").endsWith("/auth/google/callback")) return json({ error: "invalid_grant" }, 400);
    return json({ access_token: "gat" });
  }
  if (u === "https://openidconnect.googleapis.com/v1/userinfo") return opts.headers.authorization === "Bearer gat" ? json(person) : json({ error: "bad" }, 401);
  if (u.startsWith("https://graph.facebook.com/v21.0/oauth/access_token?")) return new URL(u).searchParams.get("code") === "good" ? json({ access_token: "fat" }) : json({ error: { message: "bad" } }, 400);
  if (u.startsWith("https://graph.facebook.com/v21.0/me?")) return new URL(u).searchParams.get("appsecret_proof") ? json({ id: "fb-222", name: "Ravi Fb" }) : json({ error: {} }, 400);
  return realFetch(url, opts);
};

function call(method, p, body, { token, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      let s = ""; res.setEncoding("utf8"); res.on("data", c => (s += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, data: json, location: res.headers.location || "", cookie: (res.headers["set-cookie"] || [])[0] || "" }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
// Tap the button, "agree" at Google/Facebook, come back. Returns the one-time code given to the page.
async function signIn(p, { code = "good", ref = "" } = {}) {
  const start = await call("GET", `/auth/${p}/start${ref ? "?ref=" + ref : ""}`);
  assert.equal(start.status, 302);
  const to = new URL(start.location), state = to.searchParams.get("state");
  const cb = await call("GET", `/auth/${p}/callback?code=${code}&state=${state}`, null, { cookie: start.cookie.split(";")[0] });
  assert.equal(cb.status, 302);
  return { start: to, back: cb.location };
}

test("Google and Facebook sign-in: owner keys, first join, next login, safety checks", async () => {
  assert.deepEqual((await call("GET", "/api/s/oauth")).data, { google: false, facebook: false });
  assert.match((await call("GET", "/auth/google/start")).location, /#\/oauth-error\/off$/);
  // owner saves keys on /admin; the secret is never shown back
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  assert.equal((await call("POST", "/api/admin/oauth", { provider: "google", id: "123-abc.apps.googleusercontent.com", secret: "gsecret123" })).status, 401);
  assert.equal((await call("POST", "/api/admin/oauth", { provider: "google", id: "123-abc.apps.googleusercontent.com", secret: "gsecret123" }, { token: own })).status, 200);
  assert.equal((await call("POST", "/api/admin/oauth", { provider: "facebook", id: "998877", secret: "fbsecret99" }, { token: own })).status, 200);
  const cfg = (await call("GET", "/api/admin/oauth", null, { token: own })).data;
  assert.equal(cfg.google.on, true); assert.equal(cfg.google.redirect, "http://qindiaglobal.com/auth/google/callback");
  assert.ok(!JSON.stringify(cfg).includes("gsecret123"), "secret not sent back");
  assert.deepEqual((await call("GET", "/api/s/oauth")).data, { google: true, facebook: true });
  // saving with an empty secret keeps the saved one
  await call("POST", "/api/admin/oauth", { provider: "google", id: "123-abc.apps.googleusercontent.com", secret: "" }, { token: own });

  // a referrer, to check the invite link survives the trip to Google
  const { token: h } = (await call("GET", "/api/human")).data; const { solve } = require("../server/qindia-safety");
  await call("POST", "/api/s/signup", { username: "inviter", name: "Inviter", password: "password1", agree: true, human: h, n: solve(h) });

  // first time with Google: choose a username, then logged in
  const g = await signIn("google", { ref: "inviter" });
  assert.equal(g.start.origin + g.start.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(g.start.searchParams.get("scope"), "openid profile", "no email asked");
  const code = g.back.match(/^\/community#\/oauth\/([a-f0-9]{48})$/)[1];
  const claim = (await call("POST", "/api/s/oauth/claim", { code })).data;
  assert.deepEqual(claim.pending, { provider: "Google", name: "Meera Shah", username: "meera_shah" });
  assert.equal((await call("POST", "/api/s/oauth/finish", { code, name: "Meera Shah", username: "meera_shah", agree: false })).status, 400, "18+ tick needed");
  const fin = await call("POST", "/api/s/oauth/finish", { code, name: "Meera Shah", username: "meera_shah", agree: true });
  assert.equal(fin.status, 200);
  const me = (await call("GET", "/api/s/me", null, { token: fin.data.token })).data;
  assert.equal(me.username, "meera_shah"); assert.equal(me.hasPassword, false); assert.deepEqual(me.linked, ["google"]);
  const db = require("../server/db");
  assert.equal(db.prepare("SELECT r.username FROM s_users u JOIN s_users r ON r.id = u.ref_by WHERE u.username = 'meera_shah'").get().username, "inviter");
  assert.equal((await call("POST", "/api/s/oauth/finish", { code, name: "X", username: "another", agree: true })).status, 410, "code works once");

  // next time: straight in, same account
  const again = await signIn("google");
  const c2 = again.back.split("/oauth/")[1];
  const t2 = (await call("POST", "/api/s/oauth/claim", { code: c2 })).data.token;
  assert.equal((await call("GET", "/api/s/me", null, { token: t2 })).data.username, "meera_shah");
  assert.equal((await call("POST", "/api/s/oauth/claim", { code: c2 })).status, 410, "one-time code");

  // safety: wrong browser (no cookie), made-up state, cancelled, bad code
  const s = await call("GET", "/auth/google/start");
  const st = new URL(s.location).searchParams.get("state");
  assert.match((await call("GET", `/auth/google/callback?code=good&state=${st}`)).location, /oauth-error\/expired/);
  assert.match((await call("GET", "/auth/google/callback?code=good&state=" + "a".repeat(32), null, { cookie: "qi_oauth=" + "a".repeat(32) })).location, /oauth-error\/expired/);
  assert.match((await signIn("google", { code: "bad" })).back, /oauth-error\/failed/);
  const s3 = await call("GET", "/auth/google/start");
  assert.match((await call("GET", `/auth/google/callback?error=access_denied&state=${new URL(s3.location).searchParams.get("state")}`, null, { cookie: s3.cookie.split(";")[0] })).location, /oauth-error\/cancel/);

  // Facebook works the same way
  const fb = await signIn("facebook");
  const fcode = fb.back.split("/oauth/")[1];
  assert.equal((await call("POST", "/api/s/oauth/claim", { code: fcode })).data.pending.provider, "Facebook");
  assert.equal((await call("POST", "/api/s/oauth/finish", { code: fcode, name: "Ravi", username: "meera_shah", agree: true })).status, 409, "username taken");
  const ft = (await call("POST", "/api/s/oauth/finish", { code: fcode, name: "Ravi", username: "ravi_fb", agree: true })).data.token;

  // a member with no password: cannot unlink their only sign-in; sets a password; deletes the account by typing the username
  assert.equal((await call("POST", "/api/s/oauth/unlink", { provider: "facebook" }, { token: ft })).status, 400);
  assert.equal((await call("POST", "/api/s/password", { password: "newpass123" }, { token: ft })).status, 200);
  assert.equal((await call("POST", "/api/s/login", { username: "ravi_fb", password: "newpass123" })).status, 200);
  assert.equal((await call("POST", "/api/s/delete-account", { confirm: "wrong" }, { token: t2 })).status, 401);
  assert.equal((await call("POST", "/api/s/delete-account", { confirm: "@Meera_Shah" }, { token: t2 })).status, 200);
  // after deleting, the same Google account starts fresh
  const fresh = await signIn("google");
  assert.ok((await call("POST", "/api/s/oauth/claim", { code: fresh.back.split("/oauth/")[1] })).data.pending);

  // banned members cannot come back through Google/Facebook
  const fid = db.prepare("SELECT id FROM s_users WHERE username = 'ravi_fb'").get().id;
  await call("POST", "/api/admin/community", { action: "ban", id: fid }, { token: own });
  assert.match((await signIn("facebook")).back, /oauth-error\/banned/);
  // owner switches Google off
  await call("POST", "/api/admin/oauth", { provider: "google", id: "", secret: "" }, { token: own });
  assert.equal((await call("GET", "/api/s/oauth")).data.google, false);
});

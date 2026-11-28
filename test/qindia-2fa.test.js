// Two-step login (authenticator app codes + backup codes) for members and for the owner page.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qi2-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { solve } = require("../server/qindia-safety");
const { server } = require("../server/index.js");
const totp = require("../server/totp");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let ipN = 1;
function call(method, p, body, { token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": "application/json", "x-forwarded-for": "10.8.0." + ipN++, ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      let s = ""; res.on("data", c => { s += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, data: json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
const at = (secret, d = 0) => totp.codeAt(secret, totp.stepNow() + d);

test("TOTP matches the RFC 6238 test value", () => {
  const secret = totp.b32encode(Buffer.from("12345678901234567890"));
  assert.equal(totp.codeAt(secret, Math.floor(59 / 30)), "287082");
  assert.equal(totp.codeAt(secret, Math.floor(1111111109 / 30)), "081804");
  assert.ok(totp.otpauth(secret, "@a").startsWith("otpauth://totp/Qindiaglobal%3A%40a?secret="));
});

test("member: turn on, log in with app code, backup code once, reset still asks, turn off", async () => {
  const { token: ht } = (await call("GET", "/api/human")).data;
  const rec = (await call("POST", "/api/s/signup", { username: "meera", name: "Meera", password: "password1", agree: true, human: ht, n: solve(ht) })).data.recovery;
  let A = (await call("POST", "/api/s/login", { username: "meera", password: "password1" })).data.token;
  const s = (await call("POST", "/api/s/2fa/setup", {}, { token: A })).data;
  assert.match(s.qr, /^data:image\/png;base64,/); assert.match(s.secret, /^[A-Z2-7]{32}$/);
  assert.equal((await call("POST", "/api/s/2fa/enable", { code: "000000" }, { token: A })).status, 401);
  const on = await call("POST", "/api/s/2fa/enable", { code: at(s.secret) }, { token: A });
  assert.equal(on.status, 200); assert.equal(on.data.backup.length, 10);
  assert.equal((await call("GET", "/api/s/me", null, { token: A })).data.tfa, true);

  // password alone is not enough
  let l = (await call("POST", "/api/s/login", { username: "meera", password: "password1" })).data;
  assert.equal(l.need2fa, true); assert.equal(l.token, undefined);
  assert.equal((await call("POST", "/api/s/login/2fa", { ticket: l.ticket, code: at(s.secret) })).status, 401, "the code used to turn on cannot be used again");
  let ok = await call("POST", "/api/s/login/2fa", { ticket: l.ticket, code: at(s.secret, 1) });
  assert.equal(ok.status, 200); assert.ok(ok.data.token);
  assert.equal((await call("POST", "/api/s/login/2fa", { ticket: l.ticket, code: at(s.secret, 1) })).status, 410, "ticket used once");
  // backup code works once
  l = (await call("POST", "/api/s/login", { username: "meera", password: "password1" })).data;
  ok = await call("POST", "/api/s/login/2fa", { ticket: l.ticket, code: on.data.backup[0].toUpperCase() });
  assert.equal(ok.status, 200); assert.equal(ok.data.usedBackup, true); assert.equal(ok.data.backupsLeft, 9);
  l = (await call("POST", "/api/s/login", { username: "meera", password: "password1" })).data;
  assert.equal((await call("POST", "/api/s/login/2fa", { ticket: l.ticket, code: on.data.backup[0] })).status, 401);
  // 5 wrong codes end the ticket
  for (let i = 0; i < 3; i++) await call("POST", "/api/s/login/2fa", { ticket: l.ticket, code: "999999" });
  assert.match((await call("POST", "/api/s/login/2fa", { ticket: l.ticket, code: "999999" })).data.error, /too many times/);
  // a password reset with the recovery code still needs the app; the new recovery code comes after it
  const r = (await call("POST", "/api/s/recover", { username: "meera", code: rec, password: "password2" })).data;
  assert.equal(r.need2fa, true); assert.equal(r.recovery, undefined);
  const r2 = await call("POST", "/api/s/login/2fa", { ticket: r.ticket, code: on.data.backup[1] });
  assert.match(r2.data.recovery, /^[A-Z2-9]{4}-/);
  A = r2.data.token;
  // turn off needs a code
  assert.equal((await call("POST", "/api/s/2fa/disable", { code: "123" }, { token: A })).status, 401);
  assert.equal((await call("POST", "/api/s/2fa/disable", { code: on.data.backup[2] }, { token: A })).status, 200);
  assert.ok((await call("POST", "/api/s/login", { username: "meera", password: "password2" })).data.token);
});

test("owner page: two-step login, and the GitHub reset turns it off", async () => {
  let T = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  assert.equal((await call("GET", "/api/admin/2fa", null, { token: T })).data.on, false);
  const s = (await call("POST", "/api/admin/2fa/setup", {}, { token: T })).data;
  const on = (await call("POST", "/api/admin/2fa/enable", { code: at(s.secret) }, { token: T })).data;
  assert.equal(on.backup.length, 10);
  const l = (await call("POST", "/api/admin/login", { password: "testpass123" })).data;
  assert.equal(l.need2fa, true); assert.equal(l.token, undefined);
  assert.equal((await call("POST", "/api/admin/login/2fa", { ticket: l.ticket, code: "000000" })).status, 401);
  T = (await call("POST", "/api/admin/login/2fa", { ticket: l.ticket, code: at(s.secret, 1) })).data.token;
  assert.equal((await call("GET", "/api/admin/summary", null, { token: T })).status, 200);
  // a member reset by the owner also turns off that member's two-step login
  const db = require("../server/db");
  db.prepare("UPDATE s_users SET tfa_secret = 'AAAA', tfa_backup = '[]' WHERE username = 'meera'").run();
  const id = db.prepare("SELECT id FROM s_users WHERE username = 'meera'").get().id;
  const np = (await call("POST", "/api/admin/community/reset-password", { id }, { token: T })).data.password;
  assert.ok((await call("POST", "/api/s/login", { username: "meera", password: np })).data.token);
  // GitHub reset: create the file the way the auto-update would
  const st = (await call("POST", "/api/admin/reset/start", {})).data;
  const f = path.join(__dirname, "..", "owner-reset", st.code); fs.writeFileSync(f, "test");
  try { assert.ok((await call("POST", "/api/admin/reset/finish", { code: st.code, password: "newowner123" })).data.token); }
  finally { fs.rmSync(f); }
  assert.ok((await call("POST", "/api/admin/login", { password: "newowner123" })).data.token, "no app code needed after the GitHub reset");
});

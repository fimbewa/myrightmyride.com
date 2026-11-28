// Forgotten password: username or email on the recovery form, email codes, owner reset, and the tiny Gmail (SMTP) sender.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qie-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
process.env.QI_MAIL_TEST = "1";
const { solve } = require("../server/qindia-safety");
const { server } = require("../server/index.js");
const mailer = require("../server/mailer");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let ipN = 1;
function call(method, p, body, { token, ip, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": "application/json", "x-forwarded-for": ip || "10.9.0." + ipN++, ...(token ? { authorization: "Bearer " + token } : {}), ...(cookie ? { cookie } : {}) } }, res => {
      let s = ""; res.on("data", c => { s += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, data: json, headers: res.headers }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
async function signup(username) {
  const { token } = (await call("GET", "/api/human")).data;
  return call("POST", "/api/s/signup", { username, name: username, password: "password1", agree: true, human: token, n: solve(token) });
}
const lastCode = () => (mailer.sendMail.outbox || []).at(-1).text.match(/code is: (\d{6})/)[1];
let ownerCookie;
async function ownerLogin() {
  const r = await call("POST", "/api/admin/login", { password: "testpass123" });
  assert.equal(r.status, 200, "owner /admin login still works");
  ownerCookie = r.data.token;
  // the owner's own "Forgot the password?" (proved through GitHub) still starts and waits for the GitHub file
  const st = await call("POST", "/api/admin/reset/start", {});
  assert.equal(st.status, 200); assert.match(st.data.github, /github\.com\/fimbewa\/myrightmyride\.com\/new\/main\?filename=owner-reset/);
  assert.equal((await call("POST", "/api/admin/reset/finish", { code: st.data.code, password: "whatever123" })).data.waiting, true);
}

test("recovery form: clear errors, username or email, spaces and small letters in the code", async () => {
  const a = await signup("vijay");
  const rec = a.data.recovery;
  let r = await call("POST", "/api/s/recover", { username: "vijay@gmail.com", code: rec, password: "newpass11" });
  assert.equal(r.status, 404); assert.match(r.data.error, /No account has this email/);
  r = await call("POST", "/api/s/recover", { username: "vijayy", code: rec, password: "newpass11" });
  assert.equal(r.status, 404); assert.match(r.data.error, /No account has the username "vijayy"/);
  r = await call("POST", "/api/s/recover", { username: "vijay", code: "AAAA-BBBB-CCCC-DDDD", password: "newpass11" });
  assert.equal(r.status, 401); assert.match(r.data.error, /does not match @vijay/);
  r = await call("POST", "/api/s/recover", { username: "  @Vijay ", code: " " + rec.toLowerCase().replace(/-/g, " ") + " ", password: "newpass11" });
  assert.equal(r.status, 200);
  assert.equal((await call("POST", "/api/s/login", { username: "vijay", password: "newpass11" })).status, 200);
});

test("email codes: owner sets up email, member saves an email, then resets the password with a 6-digit code", async () => {
  let A = (await call("POST", "/api/s/login", { username: "vijay", password: "newpass11" })).data.token;
  assert.equal((await call("GET", "/api/s/reset/info")).data.email, false);
  assert.equal((await call("POST", "/api/s/email/start", { email: "v@example.com" }, { token: A })).status, 503, "off until the owner sets it up");
  await ownerLogin();
  assert.equal((await call("POST", "/api/admin/mail", { kind: "gmail", user: "owner@gmail.com", pass: "short" }, { token: ownerCookie })).status, 400);
  assert.equal((await call("POST", "/api/admin/mail", { kind: "gmail", user: "owner@gmail.com", pass: "abcd efgh ijkl mnop" })).status, 401, "owner only");
  assert.equal((await call("POST", "/api/admin/mail", { kind: "gmail", user: "owner@gmail.com", pass: "abcd efgh ijkl mnop" }, { token: ownerCookie })).status, 200);
  const g = (await call("GET", "/api/admin/mail", null, { token: ownerCookie })).data;
  assert.equal(g.on, true); assert.equal(g.pass, undefined, "the secret is never sent back");
  assert.equal((await call("POST", "/api/admin/mail/test", {}, { token: ownerCookie })).status, 200);
  assert.equal((await call("GET", "/api/s/reset/info")).data.email, true);

  // no email saved yet
  let r = await call("POST", "/api/s/reset/start", { username: "vijay" });
  assert.equal(r.status, 409); assert.match(r.data.error, /no email saved/);
  // save an email: a code goes to it first
  assert.equal((await call("POST", "/api/s/email/start", { email: "not-an-email" }, { token: A })).status, 400);
  assert.equal((await call("POST", "/api/s/email/start", { email: " Vijay@Example.com " }, { token: A })).status, 200);
  assert.equal(mailer.sendMail.outbox.at(-1).to, "vijay@example.com");
  assert.equal((await call("POST", "/api/s/email/confirm", { code: "000000" }, { token: A })).status, 401);
  assert.equal((await call("POST", "/api/s/email/confirm", { code: lastCode() }, { token: A })).status, 200);
  assert.equal((await call("GET", "/api/s/me", null, { token: A })).data.email, "vijay@example.com");
  // another member cannot take the same email
  const B = (await signup("bina")).data.token;
  assert.equal((await call("POST", "/api/s/email/start", { email: "vijay@example.com" }, { token: B })).status, 409);

  // reset by email, typing the email itself
  r = await call("POST", "/api/s/reset/start", { username: "VIJAY@example.com" });
  assert.equal(r.status, 200); assert.equal(r.data.to, "vi***@example.com"); assert.equal(r.data.username, "vijay");
  assert.equal((await call("POST", "/api/s/reset/start", { username: "vijay" })).status, 429, "one code a minute");
  const code = lastCode();
  r = await call("POST", "/api/s/reset/finish", { username: "vijay", code: "111111", password: "brandnew1" });
  assert.equal(r.status, 401); assert.match(r.data.error, /4 tries left/);
  r = await call("POST", "/api/s/reset/finish", { username: "vijay", code: code.slice(0, 3) + " " + code.slice(3), password: "brandnew1" });
  assert.equal(r.status, 200); assert.match(r.data.recovery, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal((await call("GET", "/api/s/me", null, { token: A })).status, 401, "old phones logged out");
  assert.equal((await call("POST", "/api/s/reset/finish", { username: "vijay", code, password: "again1234" })).status, 401, "code used once");
  assert.equal((await call("POST", "/api/s/login", { username: "vijay@example.com", password: "brandnew1" })).status, 200, "log in with email too");
});

test("a code stops working after 5 wrong tries or 10 minutes", async () => {
  const db = require("../server/db");
  const u = db.prepare("SELECT * FROM s_users WHERE username = 'vijay'").get();
  const put = (tries, exp) => db.prepare("INSERT OR REPLACE INTO s_codes(user_id, purpose, email, salt, code_hash, tries, expires_at, created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(u.id, "reset", u.email, "s", require("crypto").createHash("sha256").update("s123456").digest("hex"), tries, exp, Date.now());
  put(5, Date.now() + 60_000);
  assert.match((await call("POST", "/api/s/reset/finish", { username: "vijay", code: "123456", password: "brandnew2" })).data.error, /expired/);
  put(0, Date.now() - 1);
  assert.match((await call("POST", "/api/s/reset/finish", { username: "vijay", code: "123456", password: "brandnew2" })).data.error, /expired/);
  put(0, Date.now() + 60_000);
  assert.equal((await call("POST", "/api/s/reset/finish", { username: "vijay", code: "123456", password: "brandnew1" })).status, 200);
});

test("new recovery code and owner reset", async () => {
  const A = (await call("POST", "/api/s/login", { username: "vijay", password: "brandnew1" })).data.token;
  assert.equal((await call("POST", "/api/s/recovery/new", { password: "wrong" }, { token: A })).status, 401);
  const rec = (await call("POST", "/api/s/recovery/new", { password: "brandnew1" }, { token: A })).data.recovery;
  assert.equal((await call("POST", "/api/s/recover", { username: "vijay", code: rec, password: "viacode99" })).status, 200);
  const db = require("../server/db");
  const id = db.prepare("SELECT id FROM s_users WHERE username = 'vijay'").get().id;
  assert.equal((await call("POST", "/api/admin/community/reset-password", { id })).status, 401);
  const o = (await call("POST", "/api/admin/community/reset-password", { id }, { token: ownerCookie })).data;
  assert.equal(o.username, "vijay");
  assert.equal((await call("POST", "/api/s/login", { username: "vijay", password: o.password })).status, 200);
});

test("Gmail sender speaks SMTP correctly", async () => {
  const seen = [];
  const srv = net.createServer(s => {
    s.write("220 hi\r\n"); let buf = "", inData = false;
    s.on("data", d => {
      buf += d; let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 2); seen.push(l);
        if (inData) { if (l === ".") { inData = false; s.write("250 queued\r\n"); } continue; }
        if (l.startsWith("EHLO")) s.write("250-hello\r\n250 AUTH LOGIN\r\n");
        else if (l === "AUTH LOGIN") s.write("334 VXNlcm5hbWU6\r\n");
        else if (l === Buffer.from("me@gmail.com").toString("base64")) s.write("334 UGFzc3dvcmQ6\r\n");
        else if (l === Buffer.from("abcdabcdabcdabcd").toString("base64")) s.write("235 ok\r\n");
        else if (l.startsWith("MAIL FROM") || l.startsWith("RCPT TO")) s.write("250 ok\r\n");
        else if (l === "DATA") { inData = true; s.write("354 go\r\n"); }
        else if (l === "QUIT") s.end("221 bye\r\n");
        else s.write("535 no\r\n");
      }
    });
  });
  await new Promise(r => srv.listen(0, r));
  const p = srv.address().port;
  await mailer.smtpSend({ user: "me@gmail.com", pass: "abcdabcdabcdabcd", to: "you@example.com", subject: "Code 123456", text: "Your code is: 123456", connect: () => net.connect(p) });
  assert.ok(seen.includes("RCPT TO:<you@example.com>"));
  await assert.rejects(mailer.smtpSend({ user: "me@gmail.com", pass: "wrongwrongwrongw", to: "a@b.co", subject: "x", text: "y", connect: () => net.connect(p) }), /did not accept/);
  srv.close();
});

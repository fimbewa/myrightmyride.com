// qindiaglobal.com owner page: "Download full backup" (server/qindia-backup.js).
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs"), zlib = require("node:zlib");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qi-bk-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { solve } = require("../server/qindia-safety");
const { crc32 } = require("../server/qindia-backup");
const { server } = require("../server/index.js");
const Database = require("better-sqlite3");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function call(method, p, body, { token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => { const buf = Buffer.concat(chunks), s = buf.toString("utf8"); let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, headers: res.headers, buf, text: s, data: json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

// Reads a zip through its central directory and returns { name: Buffer }, checking every CRC.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > 0, "zip end record");
  const n = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize), data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(crc32(data), crc, "crc of " + name);
    out[name] = data; p += 46 + nlen + xlen + clen;
  }
  return out;
}

test("owner downloads a full backup zip; links are one-time; logins are not in it", async () => {
  // Some data: a pledge, a Community member and a photo file.
  const { token: h } = (await call("GET", "/api/human")).data;
  assert.equal((await call("POST", "/api/pledge", { city: "Pune", name: "Asha", contact: "asha@example.com", consent: "on", agree: "on", human: h, n: solve(h) })).status, 200);
  const { token: h2 } = (await call("GET", "/api/human")).data;
  const su = await call("POST", "/api/s/signup", { username: "backupper", name: "B", password: "password1", agree: true, human: h2, n: solve(h2) });
  assert.equal(su.status, 200);
  const media = path.join(dir, "media");
  fs.writeFileSync(path.join(media, "a".repeat(32) + ".jpg"), Buffer.from("not really a jpeg"));

  // Owner only.
  assert.equal((await call("GET", "/api/admin/backup")).status, 401);
  assert.equal((await call("POST", "/api/admin/backup/start", {})).status, 401);
  assert.equal((await call("GET", "/api/admin/backup/download?t=abc")).status, 410);
  const tok = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;

  const info = await call("GET", "/api/admin/backup", null, { token: tok });
  assert.equal(info.status, 200);
  assert.ok(info.data.photos >= 1);

  const { url } = (await call("POST", "/api/admin/backup/start", { photos: true }, { token: tok })).data;
  const dl = await call("GET", url);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers["content-type"], "application/zip");
  assert.match(dl.headers["content-disposition"], /qindiaglobal-backup-.*\.zip/);
  assert.equal((await call("GET", url)).status, 410, "a link works only once");

  const files = unzip(dl.buf);
  assert.ok(files["READ-ME.txt"].toString().includes("KEEP THIS FILE SAFE"));
  assert.ok(files["media/" + "a".repeat(32) + ".jpg"]);
  assert.match(files["tables/q_pledges.csv"].toString(), /Pune/);
  assert.match(files["tables/s_users.csv"].toString(), /backupper/);
  assert.doesNotMatch(files["tables/s_users.csv"].toString().split("\r\n")[0], /pass|recover/i, "no password columns in spreadsheets");
  assert.ok(!files["tables/admin_sessions.csv"] && !files["tables/s_sessions.csv"]);

  // The database copy is complete but has no live logins.
  const copyFile = path.join(dir, "restored.db");
  fs.writeFileSync(copyFile, files["qindiaglobal-database.db"]);
  const copy = new Database(copyFile, { readonly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM q_pledges").get().n, 1);
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM s_users").get().n, 1);
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM s_sessions").get().n, 0);
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM admin_sessions").get().n, 0);
  copy.close();

  // Without photos.
  const { url: url2 } = (await call("POST", "/api/admin/backup/start", { photos: false }, { token: tok })).data;
  const small = unzip((await call("GET", url2)).buf);
  assert.ok(!Object.keys(small).some(k => k.startsWith("media/")));
  assert.ok(small["qindiaglobal-database.db"]);

  // Logged for the owner.
  const log = (await call("GET", "/api/admin/backup", null, { token: tok })).data.log;
  assert.equal(log.length, 2);
  assert.ok(log.every(x => x.ok === 1 && x.bytes > 0));
});

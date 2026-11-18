// End-to-end test of a full ride: login, driver approval, booking, accept, OTP start, meter fare, payment, admin.
// Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mrmr-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.SHOW_OTP_ON_SCREEN = "true";
process.env.SMS_PROVIDER = "console";
const { server } = require("../server/index.js");
let base;

before(() => new Promise(r => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, p, body, token) {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function login(phone, name) {
  const r = await call("POST", "/api/auth/request-otp", { phone });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const v = await call("POST", "/api/auth/verify", { phone, code: r.data.otp, name });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return v.data.token;
}

test("coming soon mode: closed to the public, owner can preview", async () => {
  const home = await fetch(base + "/");
  assert.match(await home.text(), /Coming soon/);
  assert.equal((await call("POST", "/api/auth/request-otp", { phone: "9876543210" })).status, 503);
  assert.equal((await fetch(base + "/admin")).status, 200);
  const aT = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  const owner = await fetch(base + "/", { headers: { cookie: "mrmr_owner=" + aT } });
  assert.doesNotMatch(await owner.text(), /<h1>Coming soon/);
  assert.equal((await call("PUT", "/api/admin/settings", { comingSoon: false }, aT)).status, 200);
  assert.doesNotMatch(await (await fetch(base + "/")).text(), /<h1>Coming soon/);
});

test("full ride flow", async () => {
  const cfg = await call("GET", "/api/config");
  assert.equal(cfg.status, 200);
  assert.match(cfg.data.noCommissionText, /no commission/i);

  assert.equal((await call("POST", "/api/auth/request-otp", { phone: "12345" })).status, 400, "bad mobile is refused");

  const pT = await login("9876543210", "Asha Passenger");
  const dT = await login("9123456789", "Ravi Driver");

  // driver registers without undertaking -> refused, with it -> pending
  assert.equal((await call("POST", "/api/driver/profile", { vehicleType: "auto", vehicleNo: "MH01AB1234", licenceNo: "MH0120200001", upi: "ravi@upi" }, dT)).status, 400);
  const prof = await call("POST", "/api/driver/profile", { vehicleType: "auto", vehicleNo: "MH01AB1234", licenceNo: "MH0120200001", upi: "ravi@upi", undertaking: true }, dT);
  assert.equal(prof.status, 200, JSON.stringify(prof.data));
  assert.notEqual((await call("POST", "/api/driver/online", { online: true }, dT)).status, 200, "unapproved driver cannot go online");

  // admin approves
  assert.equal((await call("POST", "/api/admin/login", { password: "wrong-password" })).status, 401);
  const aT = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  const users = (await call("GET", "/api/admin/users", null, aT)).data;
  const drv = users.find(u => u.phone === "9123456789");
  assert.equal(drv.logged_in, 1);
  assert.equal((await call("POST", `/api/admin/drivers/${drv.id}/status`, { status: "approved" }, aT)).status, 200);
  assert.equal((await call("POST", "/api/driver/online", { online: true }, dT)).status, 200);

  // passenger books: missing boxes refused, then ok
  const ride = { vehicleType: "auto", pickup: { lat: 19.076, lng: 72.8777, label: "CSMT" }, drop: { lat: 19.0544, lng: 72.8402, label: "Bandra" }, payMethod: "upi", insurance: "none" };
  assert.equal((await call("POST", "/api/rides", ride, pT)).status, 400);
  const made = await call("POST", "/api/rides", { ...ride, safetyAck: true, payUndertaking: true }, pT);
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = made.data.id, otp = made.data.otp;
  assert.match(otp, /^\d{4}$/);

  const reqs = (await call("GET", "/api/driver/requests", null, dT)).data;
  assert.ok(reqs.some(r => r.id === id));
  assert.equal(reqs.find(r => r.id === id).otp, undefined, "driver never sees the OTP");
  assert.equal((await call("POST", `/api/rides/${id}/accept`, { lat: 19.07, lng: 72.87 }, dT)).status, 200);
  assert.equal((await call("POST", `/api/rides/${id}/start`, { otp: "0000" === otp ? "1111" : "0000" }, dT)).status, 400, "wrong OTP refused");
  assert.equal((await call("POST", `/api/rides/${id}/start`, { otp }, dT)).status, 200);
  assert.equal((await call("POST", "/api/driver/location", { lat: 19.06, lng: 72.86 }, dT)).status, 200);
  const done = await call("POST", `/api/rides/${id}/complete`, { meterFare: 142 }, dT);
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.finalFare, 142);

  const qr = await call("GET", `/api/rides/${id}/upi-qr`, null, pT);
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  assert.match(qr.data.link, /^upi:\/\/pay\?.*am=142/);
  assert.equal((await call("POST", `/api/rides/${id}/paid`, {}, pT)).status, 200);
  const mine = (await call("GET", "/api/rides/mine", null, pT)).data;
  assert.equal(mine[0].paid, true);
  assert.ok(mine[0].track.length >= 1, "route is saved for the timeline");

  // passenger-decided fare is kept, driver cannot change it
  const fixed = await call("POST", "/api/rides", { ...ride, safetyAck: true, payUndertaking: true, fareMode: "fixed", fixedFare: 200 }, pT);
  assert.equal(fixed.status, 200);
  await call("POST", `/api/rides/${fixed.data.id}/accept`, {}, dT);
  await call("POST", `/api/rides/${fixed.data.id}/start`, { otp: fixed.data.otp }, dT);
  assert.equal((await call("POST", `/api/rides/${fixed.data.id}/complete`, { meterFare: 999 }, dT)).data.finalFare, 200);

  // admin changes a text, the site shows it
  assert.equal((await call("PUT", "/api/admin/settings", { tagline: "Test tagline" }, aT)).status, 200);
  assert.equal((await call("GET", "/api/config")).data.tagline, "Test tagline");
  const ov = (await call("GET", "/api/admin/overview", null, aT)).data;
  assert.equal(ov.users, 2);

  // complaints: ticket number, admin reply, owner sees it
  assert.equal((await call("POST", "/api/complaints", { category: "fare", description: "short" }, pT)).status, 400);
  assert.equal((await call("POST", "/api/complaints", { category: "fare", rideId: 99999, description: "Driver asked for more than the meter." }, pT)).status, 400);
  const cp = await call("POST", "/api/complaints", { category: "fare", rideId: id, description: "Driver asked for more than the meter.\nPlease check." }, pT);
  assert.equal(cp.status, 200, JSON.stringify(cp.data));
  assert.match(cp.data.ticket, /^MR\d{6}\d{5}$/);
  assert.equal(cp.data.ride.id, id);
  assert.match(cp.data.description, /\n/);
  const adm = (await call("GET", "/api/admin/complaints?status=open", null, aT)).data;
  assert.equal(adm.length, 1); assert.equal(adm[0].user.phone, "9876543210");
  assert.equal((await call("POST", `/api/admin/complaints/${cp.data.id}`, { status: "resolved", reply: "Refund arranged with driver." }, aT)).status, 200);
  const mineC = (await call("GET", "/api/complaints/mine", null, pT)).data;
  assert.equal(mineC[0].status, "resolved"); assert.equal(mineC[0].reply, "Refund arranged with driver.");
  assert.equal((await call("GET", "/api/complaints/mine", null, dT)).data.length, 0, "others' complaints stay private");
  assert.equal((await call("GET", "/api/admin/overview", null, aT)).data.complaintsOpen, 0);

  // logout
  assert.equal((await call("POST", "/api/auth/logout", {}, pT)).status, 200);
  assert.equal((await call("GET", "/api/me", null, pT)).status, 401);
});

// myrightmyride.com server: website, API, live updates (Socket.IO) and admin panel.
require("dotenv").config();
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const db = require("./db");
const settings = require("./settings");
const { sendOtp } = require("./sms");

const PORT = Number(process.env.PORT || 3000);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin"); // map and search services need to see which site is asking
  next();
});
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));
app.get("/tiles/:z/:x/:y", require("./tiles").handler);
app.use("/vendor/leaflet", express.static(path.join(__dirname, "..", "node_modules", "leaflet", "dist")));

// ---------- helpers ----------
const now = () => Date.now();
const token = () => crypto.randomBytes(24).toString("hex");
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const PHONE_RX = /^[6-9]\d{9}$/;
const normPhone = p => String(p || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
const clean = (s, n = 120) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const okLatLng = (lat, lng) => num(lat) !== null && num(lng) !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function userFromToken(t) {
  if (!t) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(t) || null;
}
function auth(req, res, next) {
  const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const u = userFromToken(t);
  if (!u) return bad(res, "Please log in again.", 401);
  if (u.blocked) return bad(res, "This account has been blocked. Contact the site owner.", 403);
  db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(now(), u.id);
  req.user = u; req.token = t;
  next();
}
function adminAuth(req, res, next) {
  const t = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t || !db.prepare("SELECT 1 FROM admin_sessions WHERE token = ?").get(t)) return bad(res, "Admin login needed.", 401);
  next();
}
function driverOf(userId) { return db.prepare("SELECT * FROM drivers WHERE user_id = ?").get(userId) || null; }

// What a person may see of a ride. The OTP is shown only to the passenger.
function rideView(r, viewer) {
  if (!r) return null;
  const p = db.prepare("SELECT name, phone FROM users WHERE id = ?").get(r.passenger_id);
  const d = r.driver_id ? db.prepare("SELECT u.name, u.phone, dr.vehicle_no, dr.upi FROM users u LEFT JOIN drivers dr ON dr.user_id = u.id WHERE u.id = ?").get(r.driver_id) : null;
  const isPassenger = viewer && viewer.id === r.passenger_id;
  const isDriver = viewer && viewer.id === r.driver_id;
  const out = {
    id: r.id, status: r.status, vehicleType: r.vehicle_type,
    pickup: { lat: r.pickup_lat, lng: r.pickup_lng, label: r.pickup_label },
    drop: { lat: r.drop_lat, lng: r.drop_lng, label: r.drop_label },
    note: r.note, fareMode: r.fare_mode, fixedFare: r.fixed_fare, finalFare: r.final_fare,
    payMethod: r.pay_method, paid: !!r.paid, paidAt: r.paid_at, insurance: r.insurance,
    payUndertaking: !!r.pay_undertaking, driverUndertaking: !!r.driver_undertaking,
    cancelledBy: r.cancelled_by,
    createdAt: r.created_at, acceptedAt: r.accepted_at, startedAt: r.started_at, endedAt: r.ended_at,
    passenger: p ? { name: p.name, phone: (isDriver || isPassenger) ? p.phone : undefined } : null,
    driver: d ? { name: d.name, phone: (isPassenger || isDriver) ? d.phone : undefined, vehicleNo: d.vehicle_no, upi: d.upi || null } : null,
    driverPos: r.driver_lat != null ? { lat: r.driver_lat, lng: r.driver_lng } : null,
    track: JSON.parse(r.track || "[]"),
  };
  if (isPassenger && !["started", "completed", "cancelled"].includes(r.status)) out.otp = r.otp;
  return out;
}
function pushRide(id) {
  const r = db.prepare("SELECT * FROM rides WHERE id = ?").get(id);
  if (!r) return;
  io.to("user:" + r.passenger_id).emit("ride", rideView(r, { id: r.passenger_id }));
  if (r.driver_id) io.to("user:" + r.driver_id).emit("ride", rideView(r, { id: r.driver_id }));
  if (r.status === "requested") io.to("drivers:" + r.vehicle_type).emit("request", rideView(r, null));
  else io.to("drivers:" + r.vehicle_type).emit("request-gone", { id: r.id });
}

// ---------- public config ----------
app.get("/api/config", (req, res) => {
  const s = settings.getAll();
  res.json({
    ...s,
    vehicles: s.vehicles.filter(v => v.active),
    insurancePlans: s.insurancePlans.filter(p => p.active),
    otpOnScreen: (process.env.SMS_PROVIDER || "console") === "console" && process.env.SHOW_OTP_ON_SCREEN === "true",
  });
});

// ---------- login with mobile + OTP ----------
app.post("/api/auth/request-otp", async (req, res) => {
  const phone = normPhone(req.body.phone);
  if (!PHONE_RX.test(phone)) return bad(res, "Enter a valid 10-digit Indian mobile number.");
  const prev = db.prepare("SELECT sent_at FROM otps WHERE phone = ?").get(phone);
  if (prev && now() - prev.sent_at < 30_000) return bad(res, "Please wait 30 seconds before asking for a new OTP.", 429);
  const u = db.prepare("SELECT blocked FROM users WHERE phone = ?").get(phone);
  if (u && u.blocked) return bad(res, "This account has been blocked. Contact the site owner.", 403);
  const otp = String(crypto.randomInt(100000, 1000000));
  db.prepare(`INSERT INTO otps(phone, code_hash, expires_at, attempts, sent_at) VALUES(?,?,?,0,?)
    ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`)
    .run(phone, sha(phone + ":" + otp), now() + 10 * 60_000, now());
  try {
    const r = await sendOtp(phone, otp);
    res.json({ ok: true, otp: r.showOnScreen ? otp : undefined });
  } catch (e) {
    console.error("SMS failed", e.message);
    bad(res, "Could not send the SMS right now. Please try again in a minute.", 502);
  }
});

app.post("/api/auth/verify", (req, res) => {
  const phone = normPhone(req.body.phone);
  const code = String(req.body.code || "").trim();
  const name = clean(req.body.name, 40);
  const row = db.prepare("SELECT * FROM otps WHERE phone = ?").get(phone);
  if (!row || row.expires_at < now()) return bad(res, "The OTP has expired. Ask for a new one.");
  if (row.attempts >= 5) return bad(res, "Too many wrong tries. Ask for a new OTP.", 429);
  if (row.code_hash !== sha(phone + ":" + code)) {
    db.prepare("UPDATE otps SET attempts = attempts + 1 WHERE phone = ?").run(phone);
    return bad(res, "That OTP doesn't match. Check it and try again.");
  }
  db.prepare("DELETE FROM otps WHERE phone = ?").run(phone);
  let u = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (!u) {
    if (!name) return bad(res, "Enter your name.");
    const info = db.prepare("INSERT INTO users(name, phone, created_at) VALUES(?,?,?)").run(name, phone, now());
    u = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  } else if (name && name !== u.name) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, u.id);
  }
  if (u.blocked) return bad(res, "This account has been blocked. Contact the site owner.", 403);
  const t = token();
  db.prepare("INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)").run(t, u.id, now());
  db.prepare("UPDATE users SET logged_in = 1, last_login = ?, last_seen = ? WHERE id = ?").run(now(), now(), u.id);
  res.json({ token: t, user: meView(u.id) });
});

app.post("/api/auth/logout", auth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(req.token);
  const left = db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id = ?").get(req.user.id).n;
  db.prepare("UPDATE users SET logged_in = ?, last_logout = ? WHERE id = ?").run(left ? 1 : 0, now(), req.user.id);
  db.prepare("UPDATE drivers SET online = 0 WHERE user_id = ?").run(req.user.id);
  res.json({ ok: true });
});

function meView(id) {
  const u = db.prepare("SELECT id, name, phone FROM users WHERE id = ?").get(id);
  const d = driverOf(id);
  return { ...u, driver: d ? { vehicleType: d.vehicle_type, vehicleNo: d.vehicle_no, licenceNo: d.licence_no, upi: d.upi, status: d.status, online: !!d.online, undertaking: !!d.undertaking_at } : null };
}
app.get("/api/me", auth, (req, res) => res.json(meView(req.user.id)));

// ---------- passenger ----------
app.post("/api/rides", auth, (req, res) => {
  const b = req.body, s = settings.getAll();
  if (!s.vehicles.some(v => v.active && v.key === b.vehicleType)) return bad(res, "Choose a vehicle.");
  if (!okLatLng(b.pickup?.lat, b.pickup?.lng) || !okLatLng(b.drop?.lat, b.drop?.lng)) return bad(res, "Choose both pickup and drop places.");
  if (!["cash", "upi", "card"].includes(b.payMethod)) return bad(res, "Choose how you will pay.");
  if (!b.safetyAck || !b.payUndertaking) return bad(res, "Please tick both boxes to confirm.");
  const fareMode = b.fareMode === "fixed" && s.allowPassengerFare ? "fixed" : "meter";
  const fixed = fareMode === "fixed" ? Math.round(Number(b.fixedFare)) : null;
  if (fareMode === "fixed" && !(fixed >= 10 && fixed < 100000)) return bad(res, "Enter the fare you want to pay, in rupees.");
  const ins = b.insurance === "none" || s.insurancePlans.some(p => p.active && p.key === b.insurance) ? b.insurance : null;
  if (!ins) return bad(res, "Choose a ride cover, or choose No insurance.");
  const open = db.prepare("SELECT id FROM rides WHERE passenger_id = ? AND status IN ('requested','accepted','started')").get(req.user.id);
  if (open) return bad(res, "You already have a ride in progress.");
  const info = db.prepare(`INSERT INTO rides(passenger_id, vehicle_type, pickup_lat, pickup_lng, pickup_label, drop_lat, drop_lng, drop_label, note,
      fare_mode, fixed_fare, pay_method, insurance, otp, pay_undertaking, safety_ack, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?)`)
    .run(req.user.id, b.vehicleType, b.pickup.lat, b.pickup.lng, clean(b.pickup.label) || "Pickup point", b.drop.lat, b.drop.lng, clean(b.drop.label) || "Drop point",
      clean(b.note), fareMode, fixed, b.payMethod, ins, String(crypto.randomInt(1000, 10000)), now());
  pushRide(info.lastInsertRowid);
  res.json(rideView(db.prepare("SELECT * FROM rides WHERE id = ?").get(info.lastInsertRowid), req.user));
});

app.get("/api/rides/mine", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM rides WHERE passenger_id = ? OR driver_id = ? ORDER BY created_at DESC LIMIT 200").all(req.user.id, req.user.id);
  res.json(rows.map(r => rideView(r, req.user)));
});

function loadRide(req, res) {
  const r = db.prepare("SELECT * FROM rides WHERE id = ?").get(Number(req.params.id));
  if (!r) { bad(res, "Ride not found.", 404); return null; }
  return r;
}

app.post("/api/rides/:id/cancel", auth, (req, res) => {
  const r = loadRide(req, res); if (!r) return;
  if (r.passenger_id === req.user.id && ["requested", "accepted"].includes(r.status)) {
    db.prepare("UPDATE rides SET status = 'cancelled', cancelled_by = 'passenger', ended_at = ? WHERE id = ?").run(now(), r.id);
  } else if (r.driver_id === req.user.id && r.status === "accepted") {
    // Driver gives the ride back so another driver can take it.
    db.prepare("UPDATE rides SET status = 'requested', driver_id = NULL, driver_lat = NULL, driver_lng = NULL, driver_undertaking = 0, accepted_at = NULL WHERE id = ?").run(r.id);
  } else return bad(res, "This ride can't be cancelled now.");
  pushRide(r.id); res.json({ ok: true });
});

app.post("/api/rides/:id/paid", auth, (req, res) => {
  const r = loadRide(req, res); if (!r) return;
  const who = r.passenger_id === req.user.id ? "passenger" : r.driver_id === req.user.id ? "driver" : null;
  if (!who || r.status !== "completed") return bad(res, "You can't mark this ride paid.");
  db.prepare("UPDATE rides SET paid = 1, paid_at = ?, paid_confirmed_by = ? WHERE id = ?").run(now(), who, r.id);
  pushRide(r.id); res.json({ ok: true });
});

// UPI QR code for paying the driver directly (no payment company in between).
app.get("/api/rides/:id/upi-qr", auth, async (req, res) => {
  const r = loadRide(req, res); if (!r) return;
  if (r.passenger_id !== req.user.id || !r.driver_id) return bad(res, "Not available.", 403);
  const d = driverOf(r.driver_id), u = db.prepare("SELECT name FROM users WHERE id = ?").get(r.driver_id);
  if (!d || !d.upi) return bad(res, "This driver hasn't added a UPI ID.", 404);
  const amt = r.final_fare || r.fixed_fare;
  const link = `upi://pay?pa=${encodeURIComponent(d.upi)}&pn=${encodeURIComponent(u.name)}${amt ? "&am=" + amt : ""}&cu=INR&tn=${encodeURIComponent("myrightmyride ride " + r.id)}`;
  res.json({ link, upi: d.upi, svg: await QRCode.toString(link, { type: "svg", margin: 1, width: 180 }) });
});

// ---------- drivers ----------
app.post("/api/driver/profile", auth, (req, res) => {
  const b = req.body, s = settings.getAll();
  if (!s.vehicles.some(v => v.active && v.key === b.vehicleType)) return bad(res, "Choose your vehicle type.");
  const vno = clean(b.vehicleNo, 14).toUpperCase();
  if (vno.length < 6) return bad(res, "Enter your vehicle number.");
  if (!b.undertaking) return bad(res, "Please tick the undertaking about fares.");
  const upi = clean(b.upi, 60);
  if (upi && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) return bad(res, "That UPI ID doesn't look right. It should look like name@bank.");
  const existing = driverOf(req.user.id);
  const status = existing ? existing.status : (s.requireDriverApproval ? "pending" : "approved");
  db.prepare(`INSERT INTO drivers(user_id, vehicle_type, vehicle_no, licence_no, upi, status, undertaking_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET vehicle_type = excluded.vehicle_type, vehicle_no = excluded.vehicle_no, licence_no = excluded.licence_no, upi = excluded.upi, undertaking_at = excluded.undertaking_at`)
    .run(req.user.id, b.vehicleType, vno, clean(b.licenceNo, 20).toUpperCase() || null, upi || null, status, now());
  res.json(meView(req.user.id));
});

app.post("/api/driver/online", auth, (req, res) => {
  const d = driverOf(req.user.id);
  if (!d) return bad(res, "Register as a driver first.");
  if (d.status !== "approved") return bad(res, d.status === "blocked" ? "Your driver account is blocked." : "Your driver account is waiting for approval by the site owner.");
  const on = !!req.body.online;
  db.prepare("UPDATE drivers SET online = ? WHERE user_id = ?").run(on ? 1 : 0, req.user.id);
  res.json(meView(req.user.id));
});

app.get("/api/driver/requests", auth, (req, res) => {
  const d = driverOf(req.user.id);
  if (!d || d.status !== "approved") return res.json([]);
  const rows = db.prepare("SELECT * FROM rides WHERE status = 'requested' AND vehicle_type = ? AND created_at > ? ORDER BY created_at DESC LIMIT 50")
    .all(d.vehicle_type, now() - 60 * 60_000);
  res.json(rows.map(r => rideView(r, null)));
});

app.post("/api/rides/:id/accept", auth, (req, res) => {
  const d = driverOf(req.user.id);
  if (!d || d.status !== "approved" || !d.online) return bad(res, "Go online first.");
  const busy = db.prepare("SELECT id FROM rides WHERE driver_id = ? AND status IN ('accepted','started')").get(req.user.id);
  if (busy) return bad(res, "Finish your current ride first.");
  const info = db.prepare(`UPDATE rides SET status = 'accepted', driver_id = ?, accepted_at = ?, driver_undertaking = 1, driver_lat = ?, driver_lng = ?
      WHERE id = ? AND status = 'requested' AND vehicle_type = ?`)
    .run(req.user.id, now(), d.lat, d.lng, Number(req.params.id), d.vehicle_type);
  if (!info.changes) return bad(res, "Another driver took that ride. Pick another request.", 409);
  pushRide(Number(req.params.id));
  res.json(rideView(db.prepare("SELECT * FROM rides WHERE id = ?").get(Number(req.params.id)), req.user));
});

app.post("/api/rides/:id/start", auth, (req, res) => {
  const r = loadRide(req, res); if (!r) return;
  if (r.driver_id !== req.user.id || r.status !== "accepted") return bad(res, "You can't start this ride.");
  if (String(req.body.otp || "").trim() !== r.otp) return bad(res, "That OTP doesn't match. Ask the passenger to read it again.");
  db.prepare("UPDATE rides SET status = 'started', started_at = ? WHERE id = ?").run(now(), r.id);
  pushRide(r.id); res.json({ ok: true });
});

app.post("/api/rides/:id/complete", auth, (req, res) => {
  const r = loadRide(req, res); if (!r) return;
  if (r.driver_id !== req.user.id || r.status !== "started") return bad(res, "You can't complete this ride.");
  const fare = r.fare_mode === "fixed" ? r.fixed_fare : Math.round(Number(req.body.meterFare));
  if (!(fare > 0 && fare < 100000)) return bad(res, "Enter the fare shown on your meter.");
  db.prepare("UPDATE rides SET status = 'completed', final_fare = ?, ended_at = ? WHERE id = ?").run(fare, now(), r.id);
  pushRide(r.id); res.json(rideView(db.prepare("SELECT * FROM rides WHERE id = ?").get(r.id), req.user));
});

// Driver GPS position. While on a ride it is shared with that ride's passenger and saved as the route.
app.post("/api/driver/location", auth, (req, res) => {
  const { lat, lng } = req.body;
  if (!okLatLng(lat, lng)) return bad(res, "Bad location.");
  db.prepare("UPDATE drivers SET lat = ?, lng = ?, loc_at = ? WHERE user_id = ?").run(lat, lng, now(), req.user.id);
  const r = db.prepare("SELECT * FROM rides WHERE driver_id = ? AND status IN ('accepted','started')").get(req.user.id);
  if (r) {
    const track = JSON.parse(r.track || "[]");
    const last = track[track.length - 1];
    if (!last || Math.abs(last[0] - lat) + Math.abs(last[1] - lng) > 0.00005) track.push([+lat.toFixed(6), +lng.toFixed(6)]);
    db.prepare("UPDATE rides SET driver_lat = ?, driver_lng = ?, track = ? WHERE id = ?").run(lat, lng, JSON.stringify(track.slice(-2000)), r.id);
    io.to("user:" + r.passenger_id).emit("driver-pos", { rideId: r.id, lat, lng });
  }
  res.json({ ok: true });
});

// ---------- places added by the owner or suggested by users (for example housing societies) ----------
app.get("/api/places", (req, res) => {
  const q = clean(req.query.q, 60), state = clean(req.query.state, 60), district = clean(req.query.district, 60), category = clean(req.query.category, 40);
  const where = ["status = 'approved'"], args = [];
  if (q) { where.push("name LIKE ?"); args.push("%" + q + "%"); }
  if (state) { where.push("state = ?"); args.push(state); }
  if (district) { where.push("district = ?"); args.push(district); }
  if (category) { where.push("category = ?"); args.push(category); }
  res.json(db.prepare(`SELECT id, name, category, state, district, taluka, lat, lng FROM places WHERE ${where.join(" AND ")} ORDER BY name LIMIT 500`).all(...args));
});
app.post("/api/places/suggest", auth, (req, res) => {
  const b = req.body;
  const name = clean(b.name, 120);
  if (name.length < 3 || !okLatLng(b.lat, b.lng)) return bad(res, "Enter the place name and set it on the map.");
  db.prepare("INSERT INTO places(name, category, state, district, taluka, lat, lng, status, suggested_by, created_at) VALUES(?,?,?,?,?,?,?, 'pending', ?, ?)")
    .run(name, clean(b.category, 40) || "other", clean(b.state, 60), clean(b.district, 60), clean(b.taluka, 60), b.lat, b.lng, req.user.id, now());
  res.json({ ok: true });
});

// ---------- admin ----------
app.post("/api/admin/login", (req, res) => {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || pw.length < 8) return bad(res, "Set ADMIN_PASSWORD (at least 8 characters) in the server's .env file first.", 503);
  const given = Buffer.from(sha(String(req.body.password || ""))), want = Buffer.from(sha(pw));
  if (!crypto.timingSafeEqual(given, want)) return bad(res, "Wrong password.", 401);
  const t = token();
  db.prepare("INSERT INTO admin_sessions(token, created_at) VALUES(?,?)").run(t, now());
  res.json({ token: t });
});
app.post("/api/admin/logout", adminAuth, (req, res) => {
  db.prepare("DELETE FROM admin_sessions WHERE token = ?").run((req.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  res.json({ ok: true });
});
app.get("/api/admin/overview", adminAuth, (req, res) => {
  const c = sql => db.prepare(sql).get().n;
  const dayAgo = now() - 24 * 3600_000;
  res.json({
    users: c("SELECT COUNT(*) n FROM users"),
    loggedIn: c("SELECT COUNT(*) n FROM users WHERE logged_in = 1"),
    activeNow: db.prepare("SELECT COUNT(*) n FROM users WHERE last_seen > ?").get(now() - 5 * 60_000).n,
    drivers: c("SELECT COUNT(*) n FROM drivers"),
    driversPending: c("SELECT COUNT(*) n FROM drivers WHERE status = 'pending'"),
    driversOnline: c("SELECT COUNT(*) n FROM drivers WHERE online = 1"),
    ridesToday: db.prepare("SELECT COUNT(*) n FROM rides WHERE created_at > ?").get(dayAgo).n,
    ridesOpen: c("SELECT COUNT(*) n FROM rides WHERE status IN ('requested','accepted','started')"),
    insuredToday: db.prepare("SELECT COUNT(*) n FROM rides WHERE created_at > ? AND insurance != 'none'").get(dayAgo).n,
    placesPending: c("SELECT COUNT(*) n FROM places WHERE status = 'pending'"),
  });
});
app.get("/api/admin/users", adminAuth, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name, u.phone, u.created_at, u.last_login, u.last_logout, u.logged_in, u.last_seen, u.blocked,
      d.vehicle_type, d.vehicle_no, d.licence_no, d.upi, d.status AS driver_status, d.online
    FROM users u LEFT JOIN drivers d ON d.user_id = u.id ORDER BY u.last_seen DESC NULLS LAST LIMIT 1000`).all());
});
app.post("/api/admin/users/:id/block", adminAuth, (req, res) => {
  const block = !!req.body.blocked, id = Number(req.params.id);
  db.prepare("UPDATE users SET blocked = ? WHERE id = ?").run(block ? 1 : 0, id);
  if (block) { db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id); db.prepare("UPDATE users SET logged_in = 0 WHERE id = ?").run(id); db.prepare("UPDATE drivers SET online = 0 WHERE user_id = ?").run(id); }
  res.json({ ok: true });
});
app.post("/api/admin/drivers/:id/status", adminAuth, (req, res) => {
  const st = req.body.status;
  if (!["pending", "approved", "blocked"].includes(st)) return bad(res, "Unknown status.");
  db.prepare("UPDATE drivers SET status = ?, online = CASE WHEN ? = 'approved' THEN online ELSE 0 END WHERE user_id = ?").run(st, st, Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/admin/rides", adminAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM rides ORDER BY created_at DESC LIMIT 500").all();
  res.json(rows.map(r => ({ ...rideView(r, { id: -1 }), passenger: db.prepare("SELECT name, phone FROM users WHERE id = ?").get(r.passenger_id),
    driver: r.driver_id ? db.prepare("SELECT u.name, u.phone, d.vehicle_no FROM users u LEFT JOIN drivers d ON d.user_id = u.id WHERE u.id = ?").get(r.driver_id) : null, track: undefined })));
});
app.get("/api/admin/settings", adminAuth, (req, res) => res.json(settings.getAll()));
app.put("/api/admin/settings", adminAuth, (req, res) => res.json(settings.save(req.body || {})));
app.get("/api/admin/places", adminAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM places ORDER BY status = 'pending' DESC, created_at DESC LIMIT 2000").all());
});
app.post("/api/admin/places", adminAuth, (req, res) => {
  // Accepts one place or a list (from a spreadsheet saved as CSV and read in the browser).
  const list = Array.isArray(req.body) ? req.body : [req.body];
  const ins = db.prepare("INSERT INTO places(name, category, state, district, taluka, lat, lng, status, created_at) VALUES(?,?,?,?,?,?,?, 'approved', ?)");
  let added = 0;
  db.transaction(() => { for (const p of list.slice(0, 5000)) {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (clean(p.name).length < 2 || !okLatLng(lat, lng)) continue;
    ins.run(clean(p.name), clean(p.category, 40) || "other", clean(p.state, 60), clean(p.district, 60), clean(p.taluka, 60), lat, lng, now()); added++;
  } })();
  res.json({ added });
});
app.post("/api/admin/places/:id", adminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (req.body.action === "approve") db.prepare("UPDATE places SET status = 'approved' WHERE id = ?").run(id);
  else if (req.body.action === "delete") db.prepare("DELETE FROM places WHERE id = ?").run(id);
  else return bad(res, "Unknown action.");
  res.json({ ok: true });
});

// ---------- live updates ----------
io.use((socket, next) => {
  const u = userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!u || u.blocked) return next(new Error("login needed"));
  socket.user = u; next();
});
io.on("connection", socket => {
  socket.join("user:" + socket.user.id);
  const d = driverOf(socket.user.id);
  if (d && d.status === "approved") socket.join("drivers:" + d.vehicle_type);
  socket.on("driver-room", () => {
    const d2 = driverOf(socket.user.id);
    for (const r of socket.rooms) if (r.startsWith("drivers:")) socket.leave(r);
    if (d2 && d2.status === "approved") socket.join("drivers:" + d2.vehicle_type);
  });
});

// Old unanswered requests expire after an hour; sessions after 90 days.
setInterval(() => {
  db.prepare("UPDATE rides SET status = 'cancelled', cancelled_by = 'expired', ended_at = ? WHERE status = 'requested' AND created_at < ?").run(now(), now() - 60 * 60_000);
  db.prepare("DELETE FROM sessions WHERE created_at < ?").run(now() - 90 * 24 * 3600_000);
  db.prepare("DELETE FROM admin_sessions WHERE created_at < ?").run(now() - 7 * 24 * 3600_000);
  db.prepare("DELETE FROM otps WHERE expires_at < ?").run(now());
}, 5 * 60_000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`myrightmyride.com running on http://localhost:${PORT}`));
}
module.exports = { app, server };

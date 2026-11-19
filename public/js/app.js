// myrightmyride.com web app: login, passenger booking, driver mode, live tracking, payments and ride timeline.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const t = (s, v) => I18N.t(s, v);               // fixed website text in the chosen language
  const tx = s => I18N.tText(s, S.cfg && S.cfg.operatorName); // owner-editable text (translated only while unchanged)
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mrmr." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { v == null ? localStorage.removeItem("mrmr." + k) : localStorage.setItem("mrmr." + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const S = {
    token: store.get("token", null), me: null, cfg: null, role: store.get("role", "p"),
    rides: [], requests: [], socket: null, msg: "", selRide: null, complaints: [],
    book: { pickup: null, drop: null, vehicle: null, fareMode: "meter", fixedFare: "", pay: null, insurance: null, safety: false, undertake: false, note: "" },
    login: { phone: "", name: "", sent: false, devOtp: null },
    gpsWatch: null, lastSent: 0, myPos: null, pickMode: null,
  };
  const PAY_EN = { cash: ["Cash", "Pay the driver in cash"], upi: ["UPI", "GPay, PhonePe, Paytm, BHIM or any UPI app"], card: ["Card", "Debit or credit card, if the driver has a card machine"] };
  const payName = k => t(PAY_EN[k][0]);
  const locale = () => ({ hi: "hi-IN", mr: "mr-IN" }[I18N.lang] || "en-IN");
  const time = ms => ms ? new Date(ms).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }) : "–";
  const vehName = k => tx((S.cfg.vehicles.find(v => v.key === k) || { name: k }).name);
  const insName = k => k === "none" ? t("Not insured") : tx((S.cfg.insurancePlans.find(p => p.key === k) || { name: k }).name);
  const kmBetween = (a, b) => L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng)) / 1000;

  async function api(path, opts = {}) {
    const res = await fetch(path, { method: opts.method || (opts.body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.token) { logoutLocal(); throw new Error("Please log in again."); }
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }
  const tryApi = async (fn, after) => { try { S.msg = ""; await fn(); } catch (e) { S.msg = e.message; } after ? after() : render(); };

  // ---------- map ----------
  let map, layers = {};
  function initMap() {
    map = L.map("map", { zoomControl: true }).setView([19.07, 72.88], 11);
    L.tileLayer(S.cfg.tileUrl, { maxZoom: 19, attribution: S.cfg.tileAttribution }).addTo(map);
    layers.requests = L.layerGroup().addTo(map);
    map.on("click", async e => {
      if (!S.pickMode) return;
      const kind = S.pickMode; S.pickMode = null; hint(t("Finding the address…"));
      setPoint(kind, { lat: e.latlng.lat, lng: e.latlng.lng, label: await Places.reverse(e.latlng.lat, e.latlng.lng) });
    });
    $("locateMe").onclick = () => locate(p => { map.setView([p.lat, p.lng], 16); });
  }
  const hint = t => ($("mapHint").textContent = t);
  const dot = (color, text) => L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px #0006;color:#fff;font:700 12px system-ui;display:grid;place-items:center">${text}</div>` });
  function marker(key, pos, color, text, tip) {
    if (!pos) { if (layers[key]) { map.removeLayer(layers[key]); layers[key] = null; } return; }
    if (!layers[key]) layers[key] = L.marker([pos.lat, pos.lng], { icon: dot(color, text) }).addTo(map);
    else layers[key].setLatLng([pos.lat, pos.lng]);
    if (tip) layers[key].bindTooltip(tip);
  }
  function line(key, pts, opts) {
    if (layers[key]) { map.removeLayer(layers[key]); layers[key] = null; }
    if (pts && pts.length > 1) layers[key] = L.polyline(pts, opts).addTo(map);
  }
  function fit(points) { const p = points.filter(Boolean); if (p.length === 1) map.setView([p[0].lat, p[0].lng], 15); else if (p.length > 1) map.fitBounds(L.latLngBounds(p.map(x => [x.lat, x.lng])), { padding: [40, 40] }); }
  function drawMap() {
    const r = activeRide() || (S.selRide && S.rides.find(x => x.id === S.selRide));
    const pk = r ? r.pickup : S.role === "p" ? S.book.pickup : null, dp = r ? r.drop : S.role === "p" ? S.book.drop : null;
    marker("pickup", pk, "#1f8a4c", "P", pk && t("Pickup: {p}", { p: pk.label }));
    marker("drop", dp, "#b3261e", "D", dp && t("Drop: {p}", { p: dp.label }));
    line("route", pk && dp && !(r && r.track.length > 1) ? [[pk.lat, pk.lng], [dp.lat, dp.lng]] : null, { color: "#1f6f63", dashArray: "6 6", weight: 3 });
    line("track", r && r.track.length > 1 ? r.track : null, { color: "#e8a317", weight: 5 });
    marker("driver", r && ["accepted", "started"].includes(r.status) && r.driverPos ? r.driverPos : null, "#15302c", vehName(r?.vehicleType || "")[0] || "V", t("Driver"));
    layers.requests.clearLayers();
    if (S.role === "d" && !r) for (const q of S.requests) L.marker([q.pickup.lat, q.pickup.lng], { icon: dot("#e8a317", "•") }).bindTooltip(t("Passenger waiting: {p}", { p: q.pickup.label })).addTo(layers.requests);
  }
  function locate(cb) {
    if (!navigator.geolocation) { hint(t("This browser can't share your location.")); return; }
    hint(t("Finding your location…"));
    navigator.geolocation.getCurrentPosition(p => {
      S.myPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      marker("me", S.myPos, "#2563eb", "", t("You are here"));
      hint(t("Your location, accurate to about {m} m", { m: Math.round(p.coords.accuracy) }));
      cb && cb(S.myPos);
    }, e => hint(e.code === 1 ? t("Location permission was refused. Allow location for this site in your browser settings.") : t("Could not get your location. Turn on GPS and try again.")),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }
  function setPoint(kind, p) {
    S.book[kind] = p;
    const inp = $(kind === "pickup" ? "bkPick" : "bkDrop"); if (inp) inp.value = p.label;
    drawMap(); fit([S.book.pickup, S.book.drop]); updateBookState();
    hint(S.book.pickup && S.book.drop ? t("About {km} km in a straight line", { km: kmBetween(S.book.pickup, S.book.drop).toFixed(1) }) : S.book.pickup ? t("Now set your drop place") : t("Now set your pickup place"));
  }

  // ---------- login ----------
  function renderLogin() {
    const L_ = S.login, v = $("loginView");
    v.innerHTML = `<h2>${t("Log in")}</h2>
      <p class="note">${t("Log in with your mobile number to book or drive. No Google account needed.")}</p>
      <div class="grid2">
        <label for="lgName">${t("Your name")}<input id="lgName" maxlength="40" autocomplete="name" value="${esc(L_.name)}"></label>
        <label for="lgPhone">${t("Mobile number")}<input id="lgPhone" inputmode="tel" maxlength="13" autocomplete="tel" placeholder="${t("10-digit mobile")}" value="${esc(L_.phone)}"></label>
      </div>
      ${L_.sent ? `${L_.devOtp ? `<p class="note">${t("Test mode: your OTP is {otp}. On the live site it comes by SMS.", { otp: `<b class="mono">${esc(L_.devOtp)}</b>` })}</p>` : `<p class="note">${t("We sent a 6-digit OTP by SMS to {phone}.", { phone: esc(L_.phone) })}</p>`}
        <label for="lgCode">${t("Enter the OTP")}<input id="lgCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="mono"></label>
        <button class="btn wide" id="lgVerify">${t("Log in")}</button><button class="btn sec wide" id="lgResend">${t("Send a new OTP")}</button>`
      : `<button class="btn wide" id="lgSend">${t("Send OTP")}</button>`}
      ${S.msg ? `<div class="err">${esc(S.msg)}</div>` : ""}`;
    $("lgName").oninput = e => (L_.name = e.target.value);
    $("lgPhone").oninput = e => (L_.phone = e.target.value);
    const send = () => tryApi(async () => { const r = await api("/api/auth/request-otp", { body: { phone: L_.phone } }); L_.sent = true; L_.devOtp = r.otp || null; });
    if ($("lgSend")) $("lgSend").onclick = () => { if (!L_.name.trim()) { S.msg = t("Enter your name."); return render(); } send(); };
    if ($("lgResend")) $("lgResend").onclick = send;
    if ($("lgVerify")) $("lgVerify").onclick = () => tryApi(async () => {
      const r = await api("/api/auth/verify", { body: { phone: L_.phone, code: $("lgCode").value, name: L_.name } });
      S.token = r.token; store.set("token", r.token); S.me = r.user; S.login = { phone: "", name: "", sent: false, devOtp: null };
      await afterLogin();
    });
  }
  async function afterLogin() {
    connectSocket();
    await refreshRides();
    S.complaints = await api("/api/complaints/mine").catch(() => []);
    if (S.me.driver && S.me.driver.online) startGps();
    render(); fitActive();
  }
  function logoutLocal() {
    S.token = null; S.me = null; store.set("token", null); stopGps();
    if (S.socket) { S.socket.disconnect(); S.socket = null; }
    S.rides = []; S.requests = []; S.complaints = []; render();
  }

  // ---------- data ----------
  async function refreshRides() { S.rides = await api("/api/rides/mine").catch(() => S.rides); if (S.role === "d") S.requests = await api("/api/driver/requests").catch(() => []); }
  function activeRide() {
    if (!S.me) return null;
    return S.rides.find(r => S.role === "p"
      ? isMinePassenger(r) && ["requested", "accepted", "started"].includes(r.status)
      : isMineDriver(r) && ["accepted", "started"].includes(r.status)) || null;
  }
  const isMinePassenger = r => r.passenger && r.passenger.phone === S.me.phone;
  const isMineDriver = r => r.driver && r.driver.phone === S.me.phone;
  function upsertRide(r) { const i = S.rides.findIndex(x => x.id === r.id); if (i >= 0) S.rides[i] = { ...S.rides[i], ...r }; else S.rides.unshift(r); }
  function connectSocket() {
    if (S.socket || !window.io) return;
    S.socket = io({ auth: { token: S.token } });
    S.socket.on("ride", r => { upsertRide(r); S.requests = S.requests.filter(q => q.id !== r.id || r.status === "requested"); render(); });
    S.socket.on("request", q => { if (!S.requests.some(x => x.id === q.id)) S.requests.unshift(q); if (S.role === "d") render(); });
    S.socket.on("request-gone", ({ id }) => { S.requests = S.requests.filter(q => q.id !== id); if (S.role === "d") render(); });
    S.socket.on("driver-pos", ({ rideId, lat, lng }) => {
      const r = S.rides.find(x => x.id === rideId); if (!r) return;
      r.driverPos = { lat, lng }; if (r.status === "started") r.track = [...r.track, [lat, lng]];
      drawMap(); renderRideEta(r);
    });
    S.socket.on("connect", () => { $("banner").hidden = true; refreshRides().then(render); });
    S.socket.on("disconnect", () => { $("banner").hidden = false; $("banner").textContent = t("Reconnecting… live updates paused."); });
    S.socket.on("complaint", c => {
      const i = S.complaints.findIndex(x => x.id === c.id); if (i >= 0) S.complaints[i] = c; else S.complaints.unshift(c);
      $("banner").hidden = false; $("banner").textContent = t("Update on your complaint {t}", { t: c.ticket });
      setTimeout(() => ($("banner").hidden = true), 8000); renderHelp();
    });
  }

  // ---------- passenger ----------
  function renderPassenger() {
    const v = $("pView"), r = activeRide();
    const due = S.rides.find(x => isMinePassenger(x) && x.status === "completed" && !x.paid && Date.now() - (x.endedAt || 0) < 48 * 3600e3);
    if (r) { v.innerHTML = rideHtmlP(r); bindRideP(r); return; }
    if (v.dataset.mode !== "book") { v.innerHTML = bookHtml(); v.dataset.mode = "book"; bindBook(); }
    $("bkPay").innerHTML = due ? payHtml(due) : ""; if (due) bindPay(due);
    $("bkMsg").textContent = S.msg; updateBookState();
  }
  function bookHtml() {
    const c = S.cfg, b = S.book;
    if (!b.vehicle) b.vehicle = c.vehicles[0]?.key;
    return `<div id="bkPay"></div>
    <h2>${t("Book a ride")}</h2>
    <div class="field"><label for="bkPick">${t("Pickup place")}<input id="bkPick" autocomplete="off" placeholder="${t("Type address, village, station, office, society…")}" value="${esc(b.pickup?.label || "")}"></label></div>
    <div class="row"><button class="chip" data-gps="pickup" type="button">${t("📍 Use my current location")}</button><button class="chip" data-station="pickup" type="button">${t("🚉 Pick me up at a railway station")}</button><button class="chip" data-list="pickup" type="button">${t("Choose from list")}</button><button class="chip" data-tap="pickup" type="button">${t("Tap on map")}</button></div>
    <div class="field"><label for="bkDrop">${t("Drop place")}<input id="bkDrop" autocomplete="off" placeholder="${t("Where do you want to go?")}" value="${esc(b.drop?.label || "")}"></label></div>
    <div class="row"><button class="chip" data-station="drop" type="button">${t("🚉 Railway station")}</button><button class="chip" data-list="drop" type="button">${t("Choose from list")}</button><button class="chip" data-tap="drop" type="button">${t("Tap on map")}</button><button class="chip" id="bkSuggest" type="button">${t("Suggest a missing place")}</button></div>
    <label for="bkNote">${t("House no. or landmark for the driver (optional)")}<input id="bkNote" maxlength="120" value="${esc(b.note)}" placeholder="${t("e.g. Flat 4, Sai Krupa CHS, near the temple gate")}"></label>
    <div class="lbl">${t("Vehicle")}</div>
    <div class="veh">${c.vehicles.map(x => `<button type="button" data-veh="${esc(x.key)}" aria-pressed="${b.vehicle === x.key}">${esc(tx(x.name))}</button>`).join("")}</div>
    <div class="box"><div class="lbl">${t("Fare")}</div>
      <label class="opt" for="fm-meter"><input type="radio" name="fm" id="fm-meter" value="meter" ${b.fareMode === "meter" ? "checked" : ""}><span><b>${t("As per meter")}</b><br><span class="note">${t("Pay what the vehicle's meter shows at the end of the ride")}</span></span></label>
      ${c.allowPassengerFare ? `<label class="opt" for="fm-fixed"><input type="radio" name="fm" id="fm-fixed" value="fixed" ${b.fareMode === "fixed" ? "checked" : ""}><span><b>${t("I will decide the fare")}</b><br><span class="note">${t("Set your own price. Drivers can accept or decline it but cannot change it.")}</span></span></label>
      <label for="bkFixed" id="bkFixedWrap" ${b.fareMode === "fixed" ? "" : "hidden"}>${t("Your fare for this ride (₹)")}<input id="bkFixed" inputmode="numeric" maxlength="5" value="${esc(b.fixedFare)}"></label>` : ""}
    </div>
    <div class="box"><div class="lbl">${t("How will you pay?")}</div>
      ${Object.entries(PAY_EN).map(([k, [n, s]]) => `<label class="opt" for="pay-${k}"><input type="radio" name="pay" id="pay-${k}" value="${k}" ${b.pay === k ? "checked" : ""}><span><b>${t(n)}</b><br><span class="note">${t(s)}</span></span></label>`).join("")}
      <p class="note">${t("Payment is free. The site takes no fee and never handles your money. You pay the driver directly after the ride.")}</p>
    </div>
    <div class="box hl"><div class="row between"><div class="lbl">${t("Ride insurance")}</div><span class="pill s-accepted">${t("Recommended")}</span></div>
      <p class="note">${t("We recommend insuring every ride. Choose a cover, or choose \"No insurance\".")}</p>
      ${c.insurancePlans.map(p => `<label class="opt" for="ins-${esc(p.key)}"><input type="radio" name="ins" id="ins-${esc(p.key)}" value="${esc(p.key)}" ${b.insurance === p.key ? "checked" : ""}><span><b>${esc(tx(p.name))}</b>${p.price ? ` · ${t("₹{price} per ride", { price: esc(p.price) })}` : ""}<br><span class="note">${esc(tx(p.details))}</span></span></label>`).join("")}
      <label class="opt" for="ins-none"><input type="radio" name="ins" id="ins-none" value="none" ${b.insurance === "none" ? "checked" : ""}><span><b>${t("No insurance")}</b><br><span class="note">${t("I will ride without insurance")}</span></span></label>
      <p class="note">${esc(tx(c.insuranceNote))}</p>
    </div>
    <label class="opt" for="bkSafety"><input type="checkbox" id="bkSafety" ${b.safety ? "checked" : ""}><span>${esc(tx(c.safetyCheckbox))}</span></label>
    <label class="opt" for="bkUnder"><input type="checkbox" id="bkUnder" ${b.undertake ? "checked" : ""}><span id="bkUnderText">${esc(tx(b.fareMode === "fixed" ? c.payUndertakingFixed : c.payUndertakingMeter))}</span></label>
    <p class="note">${t("By booking you agree to the")} <a href="/terms" target="_blank" rel="noopener">${t("Terms of Use for riders")}</a>.</p>
    <button class="btn wide" id="bkGo" type="button"></button>
    <div class="err" id="bkMsg"></div>`;
  }
  function bindBook() {
    const b = S.book, c = S.cfg;
    Places.attachSearch($("bkPick"), p => setPoint("pickup", p), hint);
    Places.attachSearch($("bkDrop"), p => setPoint("drop", p), hint);
    document.querySelectorAll("[data-gps]").forEach(x => x.onclick = () => locate(async p => setPoint("pickup", { ...p, label: await Places.reverse(p.lat, p.lng) })));
    document.querySelectorAll("[data-list]").forEach(x => x.onclick = () => Places.openListPicker(p => setPoint(x.dataset.list, p)));
    document.querySelectorAll("[data-station]").forEach(x => x.onclick = () => openStationPicker(x.dataset.station));
    document.querySelectorAll("[data-tap]").forEach(x => x.onclick = () => { S.pickMode = x.dataset.tap; hint(x.dataset.tap === "pickup" ? t("Tap the map where you want your pickup.") : t("Tap the map where you want your drop.")); $("mapCard").scrollIntoView({ behavior: "smooth", block: "center" }); });
    $("bkSuggest").onclick = suggestPlace;
    $("bkNote").oninput = e => (b.note = e.target.value);
    document.querySelectorAll("[data-veh]").forEach(x => x.onclick = () => { b.vehicle = x.dataset.veh; document.querySelectorAll("[data-veh]").forEach(y => y.setAttribute("aria-pressed", y === x)); });
    document.querySelectorAll('input[name="fm"]').forEach(x => x.onchange = () => { b.fareMode = x.value; if ($("bkFixedWrap")) $("bkFixedWrap").hidden = b.fareMode !== "fixed"; $("bkUnderText").textContent = tx(b.fareMode === "fixed" ? c.payUndertakingFixed : c.payUndertakingMeter); updateBookState(); });
    if ($("bkFixed")) $("bkFixed").oninput = e => { b.fixedFare = e.target.value.replace(/\D/g, ""); updateBookState(); };
    document.querySelectorAll('input[name="pay"]').forEach(x => x.onchange = () => { b.pay = x.value; updateBookState(); });
    document.querySelectorAll('input[name="ins"]').forEach(x => x.onchange = () => { b.insurance = x.value; updateBookState(); });
    $("bkSafety").onchange = e => { b.safety = e.target.checked; updateBookState(); };
    $("bkUnder").onchange = e => { b.undertake = e.target.checked; updateBookState(); };
    $("bkGo").onclick = () => tryApi(async () => {
      const r = await api("/api/rides", { body: { vehicleType: b.vehicle, pickup: b.pickup, drop: b.drop, note: b.note, fareMode: b.fareMode, fixedFare: b.fixedFare, payMethod: b.pay, insurance: b.insurance, safetyAck: b.safety, payUndertaking: b.undertake } });
      upsertRide(r);
      S.book = { pickup: null, drop: null, vehicle: b.vehicle, fareMode: "meter", fixedFare: "", pay: null, insurance: null, safety: b.safety, undertake: false, note: "" };
      $("pView").dataset.mode = "";
    });
  }
  function updateBookState() {
    const b = S.book, go = $("bkGo"); if (!go) return;
    const missing = !b.pickup ? "Set your pickup place" : !b.drop ? "Set your drop place" : b.fareMode === "fixed" && !(Number(b.fixedFare) >= 10) ? "Enter your fare" : !b.pay ? "Choose how you will pay" : !b.insurance ? "Choose a ride cover or No insurance" : !b.safety || !b.undertake ? "Tick both boxes" : null;
    const v = vehName(b.vehicle);
    go.disabled = !!missing;
    go.textContent = missing ? t(missing) : I18N.lang === "en" ? `Find ${/^[aeiou]/i.test(v) ? "an" : "a"} ${v.toLowerCase()} driver` : t("Find {v} driver", { v });
  }
  function steps(st) { const a = ["requested", "accepted", "started", "completed"], l = ["Searching", "Driver coming", "On the way", "Done"], i = a.indexOf(st); return `<div class="steps">${l.map((x, j) => `<span class="${j <= i ? "on" : ""}">${j ? "→ " : ""}${t(x)}</span>`).join("")}</div>`; }
  const fareText = r => r.fareMode === "fixed" ? t("₹{f}, decided by passenger", { f: r.fixedFare }) : t("As per meter");
  function rideHtmlP(r) {
    return `<div class="row between"><h2>${r.status === "requested" ? t("Finding you a driver…") : r.status === "accepted" ? t("Your driver is on the way") : t("Enjoy your ride")}</h2><span class="pill s-${r.status}">${t(r.status)}</span></div>
    ${steps(r.status)}
    <dl class="kv"><dt>${t("From")}</dt><dd>${esc(r.pickup.label)}</dd><dt>${t("To")}</dt><dd>${esc(r.drop.label)}</dd>
      <dt>${t("Vehicle")}</dt><dd>${esc(vehName(r.vehicleType))}</dd><dt>${t("Fare")}</dt><dd>${esc(fareText(r))}</dd>
      <dt>${t("Payment")}</dt><dd>${esc(t("{m}, directly to the driver after the ride", { m: payName(r.payMethod) }))}</dd><dt>${t("Insurance")}</dt><dd>${esc(insName(r.insurance))}</dd>
      ${r.driver ? `<dt>${t("Driver")}</dt><dd>${esc(r.driver.name)} · <a href="tel:${esc(r.driver.phone)}">${esc(r.driver.phone)}</a></dd><dt>${t("Vehicle no.")}</dt><dd>${esc(r.driver.vehicleNo)}</dd>` : ""}
      <dt>${t("Arrives in")}</dt><dd id="etaP">–</dd>
      ${r.driverUndertaking ? `<dt>${t("Driver's undertaking")}</dt><dd>${esc(tx(S.cfg.driverUndertaking))}</dd>` : ""}</dl>
    ${r.otp ? `<div><div class="lbl">${t("Tell your driver this OTP to start the ride")}</div><div class="otp">${esc(r.otp)}</div></div>` : ""}
    ${r.status === "requested" ? `<p class="note">${esc(t("Nearby {v} drivers can see your request now.", { v: I18N.lang === "en" ? vehName(r.vehicleType).toLowerCase() : vehName(r.vehicleType) }))}</p>` : ""}
    ${r.status !== "started" ? `<button class="btn danger wide" id="rCancel">${t("Cancel ride")}</button>` : ""}
    ${S.msg ? `<div class="err">${esc(S.msg)}</div>` : ""}`;
  }
  function bindRideP(r) { if ($("rCancel")) $("rCancel").onclick = () => tryApi(() => api(`/api/rides/${r.id}/cancel`, { body: {} }).then(refreshRides)); renderRideEta(r); }
  function renderRideEta(r) {
    const el = $("etaP") || $("etaD"); if (!el) return;
    const target = r.status === "started" ? r.drop : r.pickup;
    el.textContent = r.driverPos && r.status !== "requested" ? t("{km} km away · about {min} min", { km: kmBetween(r.driverPos, target).toFixed(1), min: Math.max(1, Math.round(kmBetween(r.driverPos, target) / 20 * 60)) }) : "–";
  }
  function payHtml(r) {
    const f = esc(r.finalFare);
    return `<div class="box hl"><div class="row between"><h2>${t("Pay your driver")}</h2><span class="fare">₹${f}</span></div>
      <dl class="kv"><dt>${t("Driver")}</dt><dd>${esc(r.driver?.name)} · ${esc(r.driver?.vehicleNo)}</dd><dt>${t("Pay by")}</dt><dd>${esc(payName(r.payMethod))}</dd></dl>
      ${r.payMethod === "upi" ? (r.driver?.upi ? `<div class="row" style="align-items:flex-start"><div class="qr" id="payQr"></div><div style="display:grid;gap:8px;min-width:0;flex:1">
        <span class="note">${t("Scan with any UPI app, or pay to:")}</span><b class="mono" style="overflow-wrap:anywhere;user-select:all">${esc(r.driver.upi)}</b>
        <div class="row"><button class="btn sec small" id="payCopy" type="button">${t("Copy UPI ID")}</button><a class="btn sec small" id="payOpen" href="#">${t("Open UPI app")}</a></div></div></div>`
        : `<p class="note">${t("This driver hasn't added a UPI ID. Ask them for their UPI number or QR code.")}</p>`) : `<p class="note">${r.payMethod === "cash" ? t("Pay ₹{f} in cash.", { f }) : t("Pay ₹{f} on the driver's card machine.", { f })}</p>`}
      <button class="btn wide" id="payDone" type="button">${t("I have paid ₹{f}", { f })}</button></div>`;
  }
  function bindPay(r) {
    if ($("payQr")) api(`/api/rides/${r.id}/upi-qr`).then(q => { $("payQr").innerHTML = q.svg; $("payOpen").href = q.link; }).catch(() => {});
    if ($("payCopy")) $("payCopy").onclick = async e => { try { await navigator.clipboard.writeText(r.driver.upi); e.target.textContent = t("Copied"); } catch { e.target.textContent = t("Select the ID"); } };
    $("payDone").onclick = () => tryApi(() => api(`/api/rides/${r.id}/paid`, { body: {} }).then(refreshRides));
  }
  function suggestPlace() {
    const sheet = $("sheet"); sheet.hidden = false;
    const kinds = [["housing", "Housing society"], ["clubs", "Club"], ["govt", "Government office"], ["courts", "Court"], ["govhosp", "Government hospital"], ["privhosp", "Private hospital"], ["transport", "Station or bus stand"], ["other", "Other"]];
    sheet.innerHTML = `<div class="card"><div class="row between"><h2>${t("Suggest a missing place")}</h2><button class="btn sec small" id="sgClose" type="button">${t("Close")}</button></div>
      <p class="note">${t("For example your housing society, club or office. The site owner checks it before it appears for everyone.")}</p>
      <label for="sgName">${t("Name of the place")}<input id="sgName" maxlength="120"></label>
      <div class="grid2"><label for="sgCat">${t("Kind")}<select id="sgCat">${kinds.map(([k, n]) => `<option value="${k}">${t(n)}</option>`).join("")}</select></label>
      <label for="sgState">${t("State")}<input id="sgState" value="Maharashtra"></label><label for="sgDist">${t("District")}<input id="sgDist"></label><label for="sgTal">${t("Taluka")}<input id="sgTal"></label></div>
      <p class="note">${t("Location: we use your current pickup point.")}${S.book.pickup ? ` (${esc(S.book.pickup.label)})` : ""} ${t("Set the pickup on the map first if it's somewhere else.")}</p>
      <button class="btn wide" id="sgSend" type="button">${t("Send suggestion")}</button><p class="err" id="sgMsg"></p></div>`;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ""; };
    $("sgClose").onclick = close;
    $("sgSend").onclick = async () => {
      const p = S.book.pickup || S.myPos;
      if (!p) { $("sgMsg").textContent = t("Set a pickup point or use your current location first."); return; }
      try { await api("/api/places/suggest", { body: { name: $("sgName").value, category: $("sgCat").value, state: $("sgState").value, district: $("sgDist").value, taluka: $("sgTal").value, lat: p.lat, lng: p.lng } }); close(); hint(t("Thank you. The place will appear once the owner approves it.")); }
      catch (e) { $("sgMsg").textContent = e.message; }
    };
  }

  // ---------- railway stations ----------
  function openStationPicker(kind) {
    const sheet = $("sheet"); sheet.hidden = false;
    const groups = window.RAIL_STATIONS || [];
    sheet.innerHTML = `<div class="card" role="dialog" aria-label="${t(kind === "pickup" ? "Pick me up at a railway station" : "Drop me at a railway station")}">
      <div class="row between"><h2>${t(kind === "pickup" ? "Pick me up at a railway station" : "Drop me at a railway station")}</h2><button class="btn sec small" id="stClose" type="button">${t("Close")}</button></div>
      <input id="stFilter" placeholder="${t("Search station or city…")}" autocomplete="off">
      ${kind === "pickup" ? `<label for="stExit">${t("Which exit or platform? (optional)")}<input id="stExit" maxlength="60" placeholder="${t("e.g. Platform 1, main exit")}"></label>` : ""}
      <p class="note">${t("Mumbai local, Metro and Monorail stations: type the name in the pickup box.")}</p>
      <div class="list" id="stList"></div></div>`;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ""; };
    $("stClose").onclick = close;
    sheet.onclick = e => { if (e.target === sheet) close(); };
    const draw = () => {
      const f = $("stFilter").value.trim().toLowerCase();
      let h = "";
      for (const g of groups) {
        const list = g.s.filter(([n, d]) => !f || n.toLowerCase().includes(f) || d.toLowerCase().includes(f));
        if (!list.length) continue;
        h += `<div class="tl-day">${t(g.g)}</div>` + list.map(([n, d, lat, lng]) => `<button class="tl-item" type="button" data-st="${esc(n)}" data-lat="${lat}" data-lng="${lng}"><b>🚉 ${esc(n)}</b><span class="note">${esc(d)}</span></button>`).join("");
      }
      $("stList").innerHTML = h || `<p class="note">${t("No station found. Try another spelling.")}</p>`;
    };
    $("stFilter").oninput = draw; draw();
    $("stList").onclick = async e => {
      const b = e.target.closest("[data-st]"); if (!b) return;
      const exit = $("stExit") ? $("stExit").value.trim() : "";
      close(); hint(t("Finding the station on the map…"));
      const pos = await Places.findStation(b.dataset.st, +b.dataset.lat, +b.dataset.lng);
      const name = b.dataset.st + (/station|terminus|terminal/i.test(b.dataset.st) ? "" : " railway station");
      if (exit) { S.book.note = [exit, S.book.note].filter(Boolean).join(" · "); if ($("bkNote")) $("bkNote").value = S.book.note; }
      setPoint(kind, { lat: pos.lat, lng: pos.lng, label: name });
      if (!pos.exact) hint(t("Check the pin on the map. Use Tap on map to move it if needed."));
    };
    setTimeout(() => $("stFilter") && $("stFilter").focus(), 50);
  }

  // ---------- help and complaints (ticket numbers) ----------
  const C_CATS = { driver: "Driver's behaviour", passenger: "Passenger's behaviour", fare: "Fare or overcharging", safety: "Safety", payment: "Payment",
    vehicle: "Vehicle condition", lost: "Lost item", app: "Website problem", other: "Other" };
  const C_ST = { open: "Open", in_progress: "Being looked into", resolved: "Resolved", closed: "Closed" };
  const C_PILL = { open: "s-requested", in_progress: "s-accepted", resolved: "s-started", closed: "s-completed" };
  function renderHelp() {
    const v = $("helpView"); if (!v) return;
    v.hidden = !S.me; if (!S.me) return;
    const list = S.complaints.slice(0, 10);
    v.innerHTML = `<div class="row between"><h2>${t("Help and complaints")}</h2><button class="btn sec small" id="hpNew" type="button">${t("Raise a complaint")}</button></div>
      <p class="note">${t("Had a problem? Raise a complaint and get a ticket number. We reply here.")}</p>
      ${list.length ? `<div class="lbl">${t("Your complaints")}</div><div class="list">${list.map(c => `<div class="req">
        <div class="row between"><b class="mono">${esc(c.ticket)}</b><span class="pill ${C_PILL[c.status]}">${t(C_ST[c.status])}</span></div>
        <div class="note">${t(C_CATS[c.category] || "Other")} · ${new Date(c.createdAt).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}${c.ride ? " · " + esc(t("Ride: {r}", { r: c.ride.from + " → " + c.ride.to })) : ""}</div>
        <div style="white-space:pre-wrap">${esc(c.description)}</div>
        ${c.reply ? `<div class="box"><b>${t("Reply")}</b><span style="white-space:pre-wrap">${esc(c.reply)}</span></div>` : ""}</div>`).join("")}</div>` : ""}`;
    $("hpNew").onclick = openComplaintForm;
  }
  function openComplaintForm() {
    const sheet = $("sheet"); sheet.hidden = false;
    const rides = S.rides.filter(r => r.status !== "requested").slice(0, 15);
    sheet.innerHTML = `<div class="card" role="dialog" aria-label="${t("Raise a complaint")}">
      <div class="row between"><h2>${t("Raise a complaint")}</h2><button class="btn sec small" id="cpClose" type="button">${t("Close")}</button></div>
      <label for="cpCat">${t("What is it about?")}<select id="cpCat">${Object.entries(C_CATS).map(([k, n]) => `<option value="${k}">${t(n)}</option>`).join("")}</select></label>
      <label for="cpRide">${t("Which ride? (optional)")}<select id="cpRide"><option value="">${t("Not about a ride")}</option>${rides.map(r => `<option value="${r.id}">${esc(new Date(r.createdAt).toLocaleDateString(locale(), { day: "numeric", month: "short" }) + " · " + r.pickup.label + " → " + r.drop.label)}</option>`).join("")}</select></label>
      <label for="cpText">${t("Describe the problem")}<textarea id="cpText" maxlength="2000" rows="5"></textarea></label>
      <button class="btn wide" id="cpSend" type="button">${t("Submit complaint")}</button><p class="err" id="cpMsg"></p></div>`;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ""; };
    $("cpClose").onclick = close;
    $("cpSend").onclick = async () => {
      $("cpSend").disabled = true;
      try {
        const c = await api("/api/complaints", { body: { category: $("cpCat").value, rideId: $("cpRide").value || null, description: $("cpText").value, role: S.role === "d" ? "driver" : "passenger" } });
        S.complaints.unshift(c); close(); renderHelp();
        $("banner").hidden = false; $("banner").textContent = t("Complaint registered. Your ticket number is {t}.", { t: c.ticket });
        setTimeout(() => ($("banner").hidden = true), 10000);
      } catch (e) { $("cpMsg").textContent = e.message; $("cpSend").disabled = false; }
    };
  }

  // ---------- driver ----------
  function renderDriver() {
    const v = $("dView"), d = S.me.driver, r = activeRide();
    if (r) { v.innerHTML = rideHtmlD(r); bindRideD(r); return; }
    if (!d || v.dataset.edit === "1") { v.innerHTML = driverFormHtml(d); bindDriverForm(); return; }
    const today = S.rides.filter(x => isMineDriver(x) && x.status === "completed" && new Date(x.endedAt).toDateString() === new Date().toDateString());
    const unpaid = S.rides.filter(x => isMineDriver(x) && x.status === "completed" && !x.paid && Date.now() - (x.endedAt || 0) < 48 * 3600e3);
    v.innerHTML = `<div class="row between"><h2>${t("Driver")}</h2>${d.status !== "approved" ? `<span class="pill s-requested">${d.status === "pending" ? t("Waiting for approval") : t("Blocked")}</span>` : d.online ? `<span class="pill s-started">${t("Online")}</span>` : `<span class="pill s-completed">${t("Offline")}</span>`}</div>
      <dl class="kv"><dt>${t("Vehicle")}</dt><dd>${esc(vehName(d.vehicleType))} · ${esc(d.vehicleNo)}</dd><dt>UPI</dt><dd>${esc(d.upi || t("Not added"))}</dd><dt>${t("Today")}</dt><dd>${t("{n} rides · ₹{e} earned, all yours", { n: today.length, e: today.reduce((s, x) => s + (x.finalFare || 0), 0) })}</dd></dl>
      ${d.status === "pending" ? `<p class="note">${t("The site owner will check your details and approve your account. You can go online after that.")}</p>` : ""}
      ${d.status === "approved" ? `<button class="btn wide ${d.online ? "sec" : ""}" id="dOnline" type="button">${d.online ? t("Go offline") : t("Go online")}</button>` : ""}
      <button class="btn sec small" id="dEdit" type="button">${t("Edit my details")}</button>
      ${d.online ? `<div class="lbl">${t("Ride requests ({n})", { n: S.requests.length })}</div><div class="list">${S.requests.length ? S.requests.map(q => `<div class="req">
        <div class="row between"><b>${esc(q.pickup.label)} → ${esc(q.drop.label)}</b><span class="fare" style="font-size:${q.fareMode === "fixed" ? 20 : 14}px">${q.fareMode === "fixed" ? "₹" + esc(q.fixedFare) : t("As per meter")}</span></div>
        <div class="note">${S.myPos ? t("{km} km from you", { km: kmBetween(S.myPos, q.pickup).toFixed(1) }) + " · " : ""}${t("trip about {km} km", { km: kmBetween(q.pickup, q.drop).toFixed(1) })} · ${t("pays by {m}", { m: payName(q.payMethod) })}${q.note ? " · " + esc(q.note) : ""}${q.fareMode === "fixed" ? "<br>" + t("Fare decided by the passenger. You can accept or decline it, but not change it.") : ""}</div>
        <button class="btn" data-acc="${q.id}" type="button">${t("Accept")}</button></div>`).join("") : `<p class="note">${t("No requests right now. New ones appear here automatically.")}</p>`}</div>` : ""}
      ${unpaid.length ? `<div class="lbl">${t("Waiting for payment")}</div><div class="list">${unpaid.map(x => `<div class="req"><div class="row between"><b>${esc(x.passenger?.name)} · ${esc(payName(x.payMethod))}</b><span class="fare" style="font-size:20px">₹${esc(x.finalFare)}</span></div><button class="btn sec" data-recv="${x.id}" type="button">${t("Payment received")}</button></div>`).join("")}</div>` : ""}
      ${S.msg ? `<div class="err">${esc(S.msg)}</div>` : ""}`;
    if ($("dOnline")) $("dOnline").onclick = () => tryApi(async () => {
      S.me = await api("/api/driver/online", { body: { online: !d.online } });
      if (S.me.driver.online) { startGps(); S.socket && S.socket.emit("driver-room"); S.requests = await api("/api/driver/requests"); } else stopGps();
    });
    $("dEdit").onclick = () => { $("dView").dataset.edit = "1"; render(); };
    v.querySelectorAll("[data-acc]").forEach(x => x.onclick = () => tryApi(async () => { upsertRide(await api(`/api/rides/${x.dataset.acc}/accept`, { body: {} })); S.requests = S.requests.filter(q => q.id !== +x.dataset.acc); fitActive(); }));
    v.querySelectorAll("[data-recv]").forEach(x => x.onclick = () => tryApi(() => api(`/api/rides/${x.dataset.recv}/paid`, { body: {} }).then(refreshRides)));
  }
  function driverFormHtml(d) {
    const c = S.cfg;
    return `<h2>${d ? t("Edit driver details") : t("Drive with myrightmyride")}</h2>
      <p class="note">${t("No commission. You keep everything the passenger pays.")}</p>
      <div class="grid2">
        <label for="dfVeh">${t("Vehicle type")}<select id="dfVeh">${c.vehicles.map(v => `<option value="${esc(v.key)}" ${d && d.vehicleType === v.key ? "selected" : ""}>${esc(tx(v.name))}</option>`).join("")}</select></label>
        <label for="dfNo">${t("Vehicle number")}<input id="dfNo" maxlength="14" placeholder="MH 15 AB 1234" value="${esc(d?.vehicleNo || "")}"></label>
        <label for="dfLic">${t("Driving licence number")}<input id="dfLic" maxlength="20" value="${esc(d?.licenceNo || "")}"></label>
        <label for="dfUpi">${t("Your UPI ID (optional)")}<input id="dfUpi" maxlength="60" placeholder="9876543210@upi" value="${esc(d?.upi || "")}"></label>
      </div>
      <label class="opt" for="dfUnder"><input type="checkbox" id="dfUnder" ${d?.undertaking ? "checked" : ""}><span>${esc(tx(c.driverUndertaking))}</span></label>
      <button class="btn wide" id="dfSave" type="button">${t("Save")}</button>
      ${d ? `<button class="btn sec wide" id="dfCancel" type="button">${t("Cancel")}</button>` : ""}
      ${S.msg ? `<div class="err">${esc(S.msg)}</div>` : ""}`;
  }
  function bindDriverForm() {
    $("dfSave").onclick = () => tryApi(async () => {
      S.me = await api("/api/driver/profile", { body: { vehicleType: $("dfVeh").value, vehicleNo: $("dfNo").value, licenceNo: $("dfLic").value, upi: $("dfUpi").value, undertaking: $("dfUnder").checked } });
      $("dView").dataset.edit = ""; S.socket && S.socket.emit("driver-room");
    });
    if ($("dfCancel")) $("dfCancel").onclick = () => { $("dView").dataset.edit = ""; render(); };
  }
  function rideHtmlD(r) {
    const target = r.status === "accepted" ? r.pickup : r.drop;
    const nav = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${r.driverPos ? r.driverPos.lat + "%2C" + r.driverPos.lng : ""}%3B${target.lat}%2C${target.lng}`;
    return `<div class="row between"><h2>${r.status === "accepted" ? esc(t("Pick up {n}", { n: r.passenger?.name })) : esc(t("Drop {n}", { n: r.passenger?.name }))}</h2><span class="pill s-${r.status}">${t(r.status)}</span></div>
      ${steps(r.status)}
      <dl class="kv"><dt>${t("Passenger")}</dt><dd>${esc(r.passenger?.name)} · <a href="tel:${esc(r.passenger?.phone)}">${esc(r.passenger?.phone)}</a></dd>
        <dt>${t("Pickup")}</dt><dd>${esc(r.pickup.label)}${r.note ? " · " + esc(r.note) : ""}</dd><dt>${t("Drop")}</dt><dd>${esc(r.drop.label)}</dd>
        <dt>${t("Collect")}</dt><dd>${t("{f}, paid by {m} after the ride", { f: `<b>${esc(fareText(r))}</b>`, m: esc(payName(r.payMethod)) })}</dd>
        <dt>${t("Distance")}</dt><dd id="etaD">–</dd></dl>
      <p class="note">${esc(tx(S.cfg.driverUndertaking))}</p>
      <a class="btn sec wide" href="${nav}" target="_blank" rel="noopener">${t("Directions on OpenStreetMap")}</a>
      ${r.status === "accepted" ? `<label for="dOtp">${t("Ask the passenger for their 4-digit OTP")}<input id="dOtp" inputmode="numeric" maxlength="4" class="mono" style="font-size:22px;letter-spacing:.3em"></label>
        <button class="btn wide" id="dStart" type="button">${t("Start ride")}</button><button class="btn danger wide" id="dGiveBack" type="button">${t("Cancel pickup")}</button>`
      : `${r.fareMode === "fixed" ? "" : `<label for="dMeter">${t("Fare shown on your meter (₹)")}<input id="dMeter" inputmode="numeric" maxlength="5"></label>`}<button class="btn wide" id="dEnd" type="button">${t("Complete ride")}</button>`}
      ${S.msg ? `<div class="err">${esc(S.msg)}</div>` : ""}`;
  }
  function bindRideD(r) {
    renderRideEta(r);
    if ($("dStart")) $("dStart").onclick = () => tryApi(() => api(`/api/rides/${r.id}/start`, { body: { otp: $("dOtp").value } }).then(refreshRides));
    if ($("dGiveBack")) $("dGiveBack").onclick = () => tryApi(() => api(`/api/rides/${r.id}/cancel`, { body: {} }).then(refreshRides));
    if ($("dEnd")) $("dEnd").onclick = () => tryApi(() => api(`/api/rides/${r.id}/complete`, { body: { meterFare: $("dMeter") ? $("dMeter").value : null } }).then(refreshRides));
  }
  function startGps() {
    if (S.gpsWatch !== null || !navigator.geolocation) return;
    S.gpsWatch = navigator.geolocation.watchPosition(p => {
      S.myPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      marker("me", S.myPos, "#2563eb", "", t("You"));
      if (Date.now() - S.lastSent > 8000) { S.lastSent = Date.now(); api("/api/driver/location", { body: S.myPos }).catch(() => {}); }
      const r = activeRide(); if (r) { r.driverPos = S.myPos; renderRideEta(r); }
    }, e => hint(e.code === 1 ? t("Allow location so passengers can see you coming.") : t("Waiting for GPS…")), { enableHighAccuracy: true, maximumAge: 5000 });
  }
  function stopGps() { if (S.gpsWatch !== null) { navigator.geolocation.clearWatch(S.gpsWatch); S.gpsWatch = null; } }

  // ---------- timeline ----------
  function renderTimeline() {
    const v = $("tlView");
    const mine = S.rides.filter(x => (S.role === "p" ? isMinePassenger(x) : isMineDriver(x)) && ["completed", "cancelled"].includes(x.status));
    v.hidden = false;
    if (!mine.length) { v.innerHTML = `<div class="lbl">${t("Your timeline")}</div><p class="note">${t("Your finished rides will appear here, day by day, with the route each one took.")}</p>`; return; }
    let h = `<div class="lbl">${t("Your timeline")}</div><p class="note">${t("Tap a ride to see its route on the map.")}</p><div class="tl">`, day = "";
    for (const x of mine) {
      const d = new Date(x.createdAt).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      if (d !== day) { day = d; h += `<div class="tl-day">${d}</div>`; }
      const who = S.role === "p" ? (x.driver ? `${esc(x.driver.name)} · ${esc(x.driver.vehicleNo)}` : t("No driver")) : esc(x.passenger?.name);
      h += `<button class="tl-item" type="button" data-tl="${x.id}" aria-pressed="${S.selRide === x.id}"><span class="row between"><b>${time(x.startedAt || x.createdAt)} → ${time(x.endedAt)}</b><span>${x.status === "completed" ? `₹${esc(x.finalFare)} ${x.fareMode === "fixed" ? t("fixed") : t("meter")} · ${x.paid ? t("paid") : t("unpaid")}` : t("Cancelled")}</span></span>
        <span>${esc(x.pickup.label)} → ${esc(x.drop.label)}</span><span class="note">${esc(vehName(x.vehicleType))} · ${who} · ${esc(payName(x.payMethod))}${S.role === "p" && x.insurance !== "none" ? " · " + esc(insName(x.insurance)) : ""}</span></button>`;
    }
    v.innerHTML = h + "</div>";
    v.querySelectorAll("[data-tl]").forEach(b => b.onclick = () => { S.selRide = S.selRide === +b.dataset.tl ? null : +b.dataset.tl; render(); const r = S.rides.find(x => x.id === S.selRide); if (r) { fit(r.track.length > 1 ? r.track.map(([lat, lng]) => ({ lat, lng })) : [r.pickup, r.drop]); $("mapCard").scrollIntoView({ behavior: "smooth", block: "center" }); } });
  }

  // ---------- shell ----------
  function fitActive() { const r = activeRide(); if (r) fit([r.pickup, r.drop, r.driverPos]); }
  function render() {
    const c = S.cfg, out = !S.me;
    I18N.applyStatic();
    $("tagline").textContent = tx(c.tagline); $("noCommission").textContent = tx(c.noCommissionText); $("govDisclaimer").textContent = tx(c.governmentDisclaimer);
    $("operatorLine").textContent = [c.operatorName && t("Operated by {name}", { name: c.operatorName }), c.operatorCin && "CIN " + c.operatorCin,
      c.operatorAddress && t("Registered office: {a}", { a: c.operatorAddress }), c.contactEmail && t("Email: {e}", { e: c.contactEmail }),
      c.contactPhone && t("Phone: {p}", { p: c.contactPhone })].filter(Boolean).join(" · "); $("safetyText").textContent = tx(c.safetyText);
    $("loginView").hidden = !out; $("roleSeg").hidden = out; $("who").hidden = out;
    if (out) { $("pView").hidden = $("dView").hidden = $("tlView").hidden = $("helpView").hidden = true; renderLogin(); drawMap(); return; }
    $("who").innerHTML = `<span>${t("Logged in as {name}", { name: `<b>${esc(S.me.name)}</b>` })} · ${esc(S.me.phone)}</span><button class="btn sec small" id="logout" type="button">${t("Log out")}</button>`;
    $("logout").onclick = async () => { try { await api("/api/auth/logout", { body: {} }); } catch { /* ignore */ } logoutLocal(); };
    $("roleP").setAttribute("aria-pressed", S.role === "p"); $("roleD").setAttribute("aria-pressed", S.role === "d");
    $("pView").hidden = S.role !== "p"; $("dView").hidden = S.role !== "d";
    if (S.role === "p") renderPassenger(); else renderDriver();
    renderTimeline(); renderHelp(); drawMap();
  }
  $("roleP").onclick = () => { S.role = "p"; S.msg = ""; store.set("role", "p"); $("pView").dataset.mode = ""; render(); };
  $("roleD").onclick = async () => { S.role = "d"; S.msg = ""; store.set("role", "d"); S.requests = await api("/api/driver/requests").catch(() => []); render(); };

  (async function boot() {
    try { S.cfg = await (await fetch("/api/config")).json(); } catch { document.body.innerHTML = `<p style='padding:20px'>${t("Could not reach myrightmyride.com. Check your internet connection and reload.")}</p>`; return; }
    I18N.picker($("langSel"), () => { $("pView").dataset.mode = ""; render(); });
    Places.init(S.cfg); initMap();
    if (S.token) { try { S.me = await api("/api/me"); await afterLogin(); return; } catch { logoutLocal(); } }
    render();
  })();
})();

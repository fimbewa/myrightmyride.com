// Owner panel: change texts, vehicles, insurance plans and map services, approve drivers and places,
// and see users (who is logged in), drivers and rides. No coding needed.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = t => t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "–";
  let token = null; try { token = localStorage.getItem("mrmr-admin"); } catch {}
  let tab = "overview";

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { "content-type": "application/json", authorization: "Bearer " + (token || ""), ...(opts.headers || {}) },
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/api/admin/login") { setToken(null); show(); throw new Error("Please log in again."); }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  function setToken(t) {
    token = t;
    try { t ? localStorage.setItem("mrmr-admin", t) : localStorage.removeItem("mrmr-admin"); } catch {}
    ownerCookie();
  }
  // Lets the owner see the real website in this browser while the "Coming soon" page is on.
  function ownerCookie() {
    const sec = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = token ? `mrmr_owner=${token}; path=/; max-age=604800; SameSite=Lax${sec}` : "mrmr_owner=; path=/; max-age=0";
  }

  function show() {
    const inn = !!token;
    $("loginCard").hidden = inn; $("tabs").hidden = !inn; $("view").hidden = !inn; $("logout").hidden = !inn;
    if (inn) { ownerCookie(); load(); }
  }
  $("loginForm").onsubmit = async e => {
    e.preventDefault(); $("loginErr").textContent = "";
    try { const r = await api("/api/admin/login", { method: "POST", body: { password: $("pw").value } }); setToken(r.token); $("pw").value = ""; show(); }
    catch (err) { $("loginErr").textContent = err.message; }
  };
  $("logout").onclick = async () => { try { await api("/api/admin/logout", { method: "POST" }); } catch {} setToken(null); show(); };
  $("tabs").onclick = e => {
    const b = e.target.closest("button[data-t]"); if (!b) return;
    tab = b.dataset.t;
    for (const x of $("tabs").querySelectorAll("button")) x.setAttribute("aria-pressed", x === b ? "true" : "false");
    load();
  };

  const V = () => $("view");
  function msg(text, ok = true) { const el = V().querySelector(".saved"); if (el) { el.textContent = text; el.className = "saved " + (ok ? "note" : "err"); } }

  async function load() {
    V().innerHTML = '<p class="note">Loading…</p>';
    try { await ({ overview, users, drivers, rides, texts, options, places })[tab](); }
    catch (e) { V().innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  // ---------- overview ----------
  async function overview() {
    const [o, st] = await Promise.all([api("/api/admin/overview"), api("/api/admin/settings")]);
    const s = [["Users", o.users], ["Logged in", o.loggedIn], ["Active in last 5 min", o.activeNow], ["Drivers", o.drivers],
      ["Drivers waiting for approval", o.driversPending], ["Drivers online", o.driversOnline], ["Rides in last 24 h", o.ridesToday],
      ["Rides in progress", o.ridesOpen], ["Insured rides, 24 h", o.insuredToday], ["Places waiting for approval", o.placesPending]];
    V().innerHTML = `<div class="box ${st.comingSoon ? "" : "hl"}">
        <div class="row between"><h2>${st.comingSoon ? "🚧 Website shows “Coming soon”" : "✅ Website is open to the public"}</h2></div>
        <p class="note">${st.comingSoon ? "Visitors see only the Coming soon page and cannot log in or book. You can still use the real website in this browser while you are logged in here."
          : "Anyone can log in, book rides and register as a driver."}</p>
        <div class="row"><button class="btn ${st.comingSoon ? "" : "sec"}" id="csToggle">${st.comingSoon ? "Open the website to the public" : "Show Coming soon page again"}</button>
          <a class="btn sec" href="/" target="_blank" rel="noopener">Preview the website</a></div></div>
      <h2>Overview</h2><div class="stats">${s.map(([k, v]) => `<div class="stat"><span class="note">${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
      <p class="note">Changes you make in this panel show on the website straight away. Nobody takes a commission or fee.</p>`;
    $("csToggle").onclick = async () => {
      const open = st.comingSoon;
      if (open && !confirm("Open myrightmyride.com to the public now? Anyone will be able to log in and book rides.")) return;
      await api("/api/admin/settings", { method: "PUT", body: { comingSoon: !open } }); load();
    };
  }

  // ---------- users ----------
  async function users() {
    const list = await api("/api/admin/users");
    V().innerHTML = `<div class="row between"><h2>Users and logins</h2><input id="uq" placeholder="Search name or mobile" style="max-width:240px"></div>
      <div class="scroll"><table><thead><tr><th>Name</th><th>Mobile</th><th>Status</th><th>Last login</th><th>Last logout</th><th>Last seen</th><th>Joined</th><th></th></tr></thead><tbody id="ub"></tbody></table></div>`;
    const draw = () => {
      const q = $("uq").value.trim().toLowerCase();
      $("ub").innerHTML = list.filter(u => !q || (u.name || "").toLowerCase().includes(q) || u.phone.includes(q)).map(u => `<tr>
        <td>${esc(u.name || "–")}${u.driver_status ? ` <span class="note">(driver)</span>` : ""}</td><td class="mono">${esc(u.phone)}</td>
        <td>${u.blocked ? '<span class="err">Blocked</span>' : u.logged_in ? '<span class="on">● Logged in</span>' : '<span class="off">Logged out</span>'}</td>
        <td>${when(u.last_login)}</td><td>${when(u.last_logout)}</td><td>${when(u.last_seen)}</td><td>${when(u.created_at)}</td>
        <td><button class="btn small ${u.blocked ? "sec" : "danger"}" data-block="${u.id}" data-v="${u.blocked ? 0 : 1}">${u.blocked ? "Unblock" : "Block"}</button></td></tr>`).join("")
        || '<tr><td colspan="8" class="note">No users yet.</td></tr>';
    };
    $("uq").oninput = draw; draw();
    V().onclick = async e => {
      const b = e.target.closest("[data-block]"); if (!b) return;
      if (b.dataset.v === "1" && !confirm("Block this user? They will be logged out and cannot book or drive.")) return;
      await api(`/api/admin/users/${b.dataset.block}/block`, { method: "POST", body: { blocked: b.dataset.v === "1" } }); load();
    };
  }

  // ---------- drivers ----------
  async function drivers() {
    const list = (await api("/api/admin/users")).filter(u => u.driver_status);
    list.sort((a, b) => (a.driver_status === "pending" ? -1 : 0) - (b.driver_status === "pending" ? -1 : 0));
    V().innerHTML = `<h2>Drivers</h2><p class="note">Check each driver's vehicle and licence before you approve them. Only approved drivers can go online.</p>
      <div class="scroll"><table><thead><tr><th>Name</th><th>Mobile</th><th>Vehicle</th><th>Number</th><th>Licence</th><th>UPI</th><th>Status</th><th>Online</th><th></th></tr></thead><tbody>
      ${list.map(d => `<tr><td>${esc(d.name)}</td><td class="mono">${esc(d.phone)}</td><td>${esc(d.vehicle_type)}</td><td class="mono">${esc(d.vehicle_no)}</td>
        <td class="mono">${esc(d.licence_no)}</td><td class="mono">${esc(d.upi || "–")}</td>
        <td><span class="pill ${d.driver_status === "approved" ? "s-started" : d.driver_status === "pending" ? "s-requested" : "s-cancelled"}">${esc(d.driver_status)}</span></td>
        <td>${d.online ? '<span class="on">● Online</span>' : '<span class="off">Offline</span>'}</td>
        <td class="row">${d.driver_status !== "approved" ? `<button class="btn small" data-d="${d.id}" data-s="approved">Approve</button>` : ""}
          ${d.driver_status !== "blocked" ? `<button class="btn small danger" data-d="${d.id}" data-s="blocked">Block</button>` : ""}</td></tr>`).join("")
        || '<tr><td colspan="9" class="note">No drivers have registered yet.</td></tr>'}</tbody></table></div>`;
    V().onclick = async e => {
      const b = e.target.closest("[data-d]"); if (!b) return;
      await api(`/api/admin/drivers/${b.dataset.d}/status`, { method: "POST", body: { status: b.dataset.s } }); load();
    };
  }

  // ---------- rides ----------
  async function rides() {
    const list = await api("/api/admin/rides");
    V().innerHTML = `<h2>Rides</h2><p class="note">The latest 500 rides. Fares are paid directly to drivers. The site takes nothing.</p>
      <div class="scroll"><table><thead><tr><th>When</th><th>Status</th><th>Vehicle</th><th>Passenger</th><th>Driver</th><th>From → To</th><th>Fare</th><th>Pay</th><th>Insurance</th></tr></thead><tbody>
      ${list.map(r => `<tr><td>${when(r.createdAt)}</td><td><span class="pill s-${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.vehicleType)}</td>
        <td>${esc(r.passenger?.name)}<br><span class="mono note">${esc(r.passenger?.phone)}</span></td>
        <td>${r.driver ? `${esc(r.driver.name)}<br><span class="mono note">${esc(r.driver.phone)} · ${esc(r.driver.vehicle_no)}</span>` : "–"}</td>
        <td>${esc(r.pickup.label)} → ${esc(r.drop.label)}</td>
        <td>${r.finalFare != null ? "₹" + esc(r.finalFare) : r.fareMode === "fixed" ? "₹" + esc(r.fixedFare) + " (decided)" : "As per meter"}</td>
        <td>${esc(r.payMethod)}${r.paid ? ' <span class="on">✓ paid</span>' : ""}</td><td>${esc(r.insurance)}</td></tr>`).join("")
        || '<tr><td colspan="9" class="note">No rides yet.</td></tr>'}</tbody></table></div>`;
  }

  // ---------- website texts ----------
  const TEXTS = [
    ["operatorName", "Company that operates the website", false],
    ["operatorCin", "Company CIN", false],
    ["operatorAddress", "Registered office address", false],
    ["contactEmail", "Contact email shown in the footer", false],
    ["contactPhone", "Contact phone shown in the footer", false],
    ["siteName", "Website name", false], ["tagline", "Tagline under the name", false],
    ["noCommissionText", "No-commission and payment text (footer)", true],
    ["governmentDisclaimer", "Disclaimer: citizens' initiative, not government approved ({operator} is replaced by the company name)", true],
    ["safetyText", "Passenger safety text (footer)", true],
    ["safetyCheckbox", "Safety checkbox the passenger must tick", true],
    ["payUndertakingMeter", "Passenger undertaking: pay as per meter", true],
    ["payUndertakingFixed", "Passenger undertaking: pay the fare they decided", true],
    ["driverUndertaking", "Driver undertaking before going online", true],
    ["insuranceNote", "Note under the insurance plans", true],
  ];
  async function texts() {
    const s = await api("/api/admin/settings");
    V().innerHTML = `<h2>Website texts</h2><form id="tf" class="list">${TEXTS.map(([k, label, big]) => `<label>${esc(label)}
      ${big ? `<textarea name="${k}">${esc(s[k])}</textarea>` : `<input name="${k}" value="${esc(s[k])}">`}</label>`).join("")}
      <div class="row"><button class="btn">Save texts</button><span class="saved note"></span></div></form>`;
    $("tf").onsubmit = async e => {
      e.preventDefault();
      const patch = Object.fromEntries(TEXTS.map(([k]) => [k, e.target.elements[k].value.trim()]));
      try { await api("/api/admin/settings", { method: "PUT", body: patch }); msg("Saved. The website shows the new texts now."); } catch (err) { msg(err.message, false); }
    };
  }

  // ---------- vehicles, insurance, switches, maps ----------
  async function options() {
    const s = await api("/api/admin/settings");
    const vehRow = v => `<div class="ed veh-row"><input data-f="key" value="${esc(v.key)}" placeholder="short code, e.g. erick"><input data-f="name" value="${esc(v.name)}" placeholder="Name shown, e.g. E-rickshaw">
      <label class="opt"><input type="checkbox" data-f="active" ${v.active ? "checked" : ""}> Show</label></div>`;
    const insRow = p => `<div class="ed ins ins-row"><input data-f="key" value="${esc(p.key)}" placeholder="short code"><input data-f="name" value="${esc(p.name)}" placeholder="Plan name">
      <input data-f="details" value="${esc(p.details)}" placeholder="What it covers"><label class="opt"><input type="checkbox" data-f="active" ${p.active ? "checked" : ""}> Show</label>
      <input data-f="price" value="${p.price ?? ""}" placeholder="Price in ₹ (leave empty until finalised)" inputmode="numeric"></div>`;
    V().innerHTML = `<form id="of" class="list">
      <h2>Vehicle types</h2><p class="note">Untick "Show" to hide a type. Keep the short code the same once rides use it.</p>
      <div id="vehs" class="list">${s.vehicles.map(vehRow).join("")}</div>
      <div><button type="button" class="btn sec small" id="addVeh">+ Add vehicle type</button></div>
      <h2>Insurance plans</h2><p class="note">Leave the price empty until it is finalised with the partner insurer. Passengers then see "Details coming soon".</p>
      <div id="ins" class="list">${s.insurancePlans.map(insRow).join("")}</div>
      <div><button type="button" class="btn sec small" id="addIns">+ Add plan</button></div>
      <h2>Rules</h2>
      <label class="opt"><input type="checkbox" name="allowPassengerFare" ${s.allowPassengerFare ? "checked" : ""}> Let passengers choose "I will decide the fare" (drivers can only accept or decline it)</label>
      <label class="opt"><input type="checkbox" name="requireDriverApproval" ${s.requireDriverApproval ? "checked" : ""}> New drivers must be approved by me before going online</label>
      <h2>Map services</h2><p class="note">Free OpenStreetMap services by default. When traffic grows, run your own copies on your server and put their addresses here (see the setup guide).</p>
      <label>Map tiles address<input name="tileUrl" value="${esc(s.tileUrl)}"></label>
      <label>Map credit line<input name="tileAttribution" value="${esc(s.tileAttribution)}"></label>
      <label>Place search (Photon) address<input name="searchUrl" value="${esc(s.searchUrl)}"></label>
      <label>Place lists (Overpass) address<input name="overpassUrl" value="${esc(s.overpassUrl)}"></label>
      <div class="row"><button class="btn">Save</button><span class="saved note"></span></div></form>`;
    $("addVeh").onclick = () => $("vehs").insertAdjacentHTML("beforeend", vehRow({ key: "", name: "", active: true }));
    $("addIns").onclick = () => $("ins").insertAdjacentHTML("beforeend", insRow({ key: "", name: "", details: "Details coming soon.", price: null, active: true }));
    const read = row => Object.fromEntries([...row.querySelectorAll("[data-f]")].map(i => [i.dataset.f, i.type === "checkbox" ? i.checked : i.value.trim()]));
    $("of").onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements;
      const vehicles = [...V().querySelectorAll(".veh-row")].map(read).filter(v => v.key && v.name)
        .map(v => ({ key: v.key.toLowerCase().replace(/[^a-z0-9-]/g, ""), name: v.name, active: v.active }));
      const insurancePlans = [...V().querySelectorAll(".ins-row")].map(read).filter(p => p.key && p.name)
        .map(p => ({ key: p.key.toLowerCase().replace(/[^a-z0-9-]/g, ""), name: p.name, details: p.details, active: p.active, price: p.price === "" ? null : Number(p.price) }));
      if (!vehicles.some(v => v.active)) return msg("Keep at least one vehicle type showing.", false);
      if (vehicles.some(v => v.key === "none") || insurancePlans.some(p => p.key === "none")) return msg('"none" cannot be used as a short code.', false);
      try {
        await api("/api/admin/settings", { method: "PUT", body: { vehicles, insurancePlans, allowPassengerFare: f.allowPassengerFare.checked,
          requireDriverApproval: f.requireDriverApproval.checked, tileUrl: f.tileUrl.value.trim(), tileAttribution: f.tileAttribution.value.trim(),
          searchUrl: f.searchUrl.value.trim(), overpassUrl: f.overpassUrl.value.trim() } });
        msg("Saved.");
      } catch (err) { msg(err.message, false); }
    };
  }

  // ---------- places ----------
  const CATS = ["transport", "courts", "govt", "govhosp", "privhosp", "housing", "clubs", "worship", "edu", "market", "tourism", "other"];
  async function places() {
    const list = await api("/api/admin/places");
    const pending = list.filter(p => p.status === "pending");
    V().innerHTML = `<h2>Places</h2>
      <p class="note">Places added here appear in the pickup and drop search and in the State → District → Taluka lists. Passengers can also suggest places, which wait for your approval.</p>
      <h2>Waiting for approval (${pending.length})</h2>${placeTable(pending, true)}
      <h2>Add one place</h2>
      <form id="pf" class="grid2">
        <label>Name<input name="name" required></label>
        <label>Category<select name="category">${CATS.map(c => `<option>${c}</option>`).join("")}</select></label>
        <label>State<input name="state" value="Maharashtra"></label><label>District<input name="district"></label>
        <label>Taluka<input name="taluka"></label>
        <label>Latitude, longitude<input name="ll" placeholder="e.g. 19.0760, 72.8777" required></label>
        <div class="row"><button class="btn">Add place</button><span class="saved note"></span></div>
      </form>
      <h2>Add many places from a spreadsheet</h2>
      <p class="note">Save the sheet as CSV with these columns in the first row: <span class="mono">name,category,state,district,taluka,lat,lng</span></p>
      <input type="file" id="csv" accept=".csv,text/csv">
      <h2>All approved places (${list.length - pending.length})</h2>${placeTable(list.filter(p => p.status !== "pending"), false)}`;
    $("pf").onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements, [lat, lng] = f.ll.value.split(",").map(x => Number(x.trim()));
      try {
        const r = await api("/api/admin/places", { method: "POST", body: { name: f.name.value, category: f.category.value, state: f.state.value, district: f.district.value, taluka: f.taluka.value, lat, lng } });
        if (!r.added) throw new Error("Check the name and the latitude, longitude.");
        load();
      } catch (err) { msg(err.message, false); }
    };
    $("csv").onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const rows = parseCsv(await file.text()); const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
      const items = rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
      try { const r = await api("/api/admin/places", { method: "POST", body: items }); alert(`Added ${r.added} of ${items.length} places.`); load(); }
      catch (err) { alert(err.message); }
    };
    V().onclick = async e => {
      const b = e.target.closest("[data-p]"); if (!b) return;
      if (b.dataset.a === "delete" && !confirm("Delete this place?")) return;
      await api(`/api/admin/places/${b.dataset.p}`, { method: "POST", body: { action: b.dataset.a } }); load();
    };
  }
  function placeTable(list, approve) {
    if (!list.length) return '<p class="note">None.</p>';
    return `<div class="scroll"><table><thead><tr><th>Name</th><th>Category</th><th>State / District / Taluka</th><th>Location</th><th></th></tr></thead><tbody>
      ${list.slice(0, 1000).map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${esc([p.state, p.district, p.taluka].filter(Boolean).join(" / "))}</td>
        <td><a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}" target="_blank" rel="noopener">${(+p.lat).toFixed(4)}, ${(+p.lng).toFixed(4)}</a></td>
        <td class="row">${approve ? `<button class="btn small" data-p="${p.id}" data-a="approve">Approve</button>` : ""}<button class="btn small danger" data-p="${p.id}" data-a="delete">Delete</button></td></tr>`).join("")}
      </tbody></table></div>`;
  }
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }

  show();
})();

// Finding places in India for pickup and drop, using only open data (OpenStreetMap):
//  - typed search (Photon geocoder), limited to India
//  - built-in quick list (Mumbai stations, MSRTC stands, Maharashtra offices, courts, hospitals)
//  - places the owner added in the admin panel (for example housing societies)
//  - "Choose from list": State -> District -> Taluka -> kind of place (Overpass API)
(function () {
  const INDIA_BBOX = "68,6,98,37";
  let CFG = { searchUrl: "https://photon.komoot.io", overpassUrl: "https://overpass-api.de/api/interpreter" };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const BUILTIN = (window.BUILTIN_PLACES || []).flatMap(g => g.s.map(n => ({ name: n, group: g.g })));

  async function photon(q, extra = "") {
    const r = await fetch(`${CFG.searchUrl}/api/?q=${encodeURIComponent(q)}&limit=8&bbox=${INDIA_BBOX}${extra}`);
    if (!r.ok) throw new Error("search");
    return ((await r.json()).features || []).map(f => {
      const p = f.properties, [lng, lat] = f.geometry.coordinates;
      const name = p.name || p.street || "Place";
      const sub = [p.osm_value ? p.osm_value.replace(/_/g, " ") : "", p.city || p.county, p.district, p.state].filter(Boolean).join(" · ");
      return { label: [name, p.city || p.county || p.district, p.state].filter(Boolean).join(", "), title: name, sub, lat, lng };
    });
  }
  async function reverse(lat, lng) {
    try {
      const r = await fetch(`${CFG.searchUrl}/reverse?lat=${lat}&lon=${lng}`);
      const p = (await r.json()).features?.[0]?.properties;
      if (p) return [p.name || [p.housenumber, p.street].filter(Boolean).join(" "), p.district || p.city || p.county, p.state].filter(Boolean).join(", ");
    } catch { /* fall through */ }
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  async function geocodeBuiltin(item) {
    const isBus = /MSRTC/.test(item.group), isStation = /local|Metro|Monorail/.test(item.group);
    const q = item.name.replace(/\s*\(.*?\)\s*/g, " ") + (isBus ? " bus stand" : isStation ? " railway station" : "") + (/Mumbai/.test(item.group) ? " Mumbai" : " Maharashtra");
    const res = await photon(q).catch(() => []);
    return res[0] ? { label: `${item.name} (${item.group})`, lat: res[0].lat, lng: res[0].lng } : null;
  }

  // Typed search box with suggestions. onPick({label, lat, lng})
  function attachSearch(input, onPick, onStatus = () => {}) {
    const wrap = input.closest(".field");
    const box = document.createElement("div"); box.className = "sugg"; box.hidden = true; wrap.appendChild(box);
    let timer, seq = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      timer = setTimeout(async () => {
        const my = ++seq, ql = q.toLowerCase();
        const local = BUILTIN.filter(x => x.name.toLowerCase().includes(ql)).slice(0, 5);
        let mine = [];
        try { mine = await (await fetch("/api/places?q=" + encodeURIComponent(q))).json(); } catch { /* ignore */ }
        let found = [];
        try { found = await photon(q); } catch { onStatus("Search could not reach the map service. Check your internet connection."); }
        if (my !== seq) return;
        box.innerHTML = "";
        const add = (title, sub, pick) => {
          const b = document.createElement("button"); b.type = "button";
          b.innerHTML = `<b>${esc(title)}</b><br><small>${esc(sub)}</small>`;
          b.addEventListener("mousedown", e => e.preventDefault());
          b.onclick = async () => { box.hidden = true; const p = await pick(); if (p) { input.value = p.label; onPick(p); } else onStatus("Couldn't find that place on the map. Try typing it differently."); };
          box.appendChild(b);
        };
        for (const p of mine.slice(0, 5)) add(p.name, [p.category, p.district, p.state].filter(Boolean).join(" · "), async () => ({ label: p.name + (p.district ? ", " + p.district : ""), lat: p.lat, lng: p.lng }));
        for (const x of local) add(x.name, x.group, () => geocodeBuiltin(x));
        for (const f of found) add(f.title, f.sub, async () => f);
        box.hidden = !box.children.length;
      }, 300);
    });
    input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 200));
  }

  async function overpass(q) {
    const r = await fetch(CFG.overpassUrl, { method: "POST", body: "data=" + encodeURIComponent(q) });
    if (!r.ok) throw new Error("overpass");
    return r.json();
  }
  const enName = t => t["name:en"] || t.name || "";

  const GOV_RX = /civil|district hospital|sub.?district|rural hospital|primary health|\bphc\b|\bchc\b|\buphc\b|community health|health (centre|center)|govt|government|sarkari|shaskiya|esic|\besi\b|municipal|\bbmc\b|\bpmc\b|corporation|nagar parishad|zilla|medical college|gmc|aiims|railway hospital|police hospital|cantonment|military|naval|kem hospital|j\.? ?j\.? hospital|sassoon|cooper|nair hospital|sion hospital|rugnalaya|state hospital|general hospital/i;
  const isHealth = t => /^(hospital|clinic|doctors)$/.test(t.amenity || "") || /^(hospital|centre|clinic)$/.test(t.healthcare || "") || /hospital|health cent|phc|dispensary|rugnalaya/i.test(t.name || "");
  const isGovt = t => /^(government|public|state|municipal|central)$/i.test(t["operator:type"] || t.ownership || "") || GOV_RX.test([t.name, t["name:en"], t.operator].filter(Boolean).join(" "));
  const HQ = ['nwr["amenity"~"^(hospital|clinic|doctors)$"]', 'nwr["healthcare"~"^(hospital|centre|clinic)$"]', 'nwr["name"~"Hospital|Primary Health|PHC|Health Centre|Rugnalaya|Dispensary",i]'];
  const CATS = {
    transport: { n: "Railway stations and bus stands", q: ['nwr["railway"~"^(station|halt)$"]', 'nwr["amenity"="bus_station"]', 'node["highway"="bus_stop"]["name"]'] },
    courts: { n: "Courts (High Court, District, Taluka)", q: ['nwr["amenity"="courthouse"]', 'nwr["name"~"High Court|District Court|Sessions Court|Civil Court|Nyayalaya|Family Court|Consumer",i]'] },
    govt: { n: "Collector, Tahsildar, SDO and govt offices", q: ['nwr["office"="government"]', 'nwr["amenity"="townhall"]', 'nwr["amenity"="police"]', 'nwr["name"~"Collector|Collectorate|Tahsil|Tehsil|Mamlatdar|Sub.?Divisional|SDO|Prant|Zilla Parishad|Panchayat Samiti|Gram Panchayat|Municipal|Nagar Parishad|Nagar Panchayat|RTO",i]'] },
    govhosp: { n: "Government / public hospitals", q: HQ, f: t => isHealth(t) && isGovt(t) },
    privhosp: { n: "Private hospitals and clinics", q: HQ, f: t => isHealth(t) && !isGovt(t) },
    housing: { n: "Housing societies", q: ['nwr["landuse"="residential"]["name"]', 'nwr["building"~"^(apartments|residential)$"]["name"]', 'nwr["place"="neighbourhood"]', 'nwr["name"~"Co.?op|CHS|Society|Housing|Apartment|Residency",i]'] },
    clubs: { n: "Clubs and gymkhanas", q: ['nwr["club"]', 'nwr["amenity"="social_club"]', 'nwr["leisure"="sports_centre"]["name"]', 'nwr["name"~"Club|Gymkhana",i]'] },
    worship: { n: "Temples and religious places", q: ['nwr["amenity"="place_of_worship"]["name"]'] },
    edu: { n: "Schools and colleges", q: ['nwr["amenity"~"^(school|college|university)$"]["name"]'] },
    market: { n: "Markets and malls", q: ['nwr["amenity"="marketplace"]', 'nwr["shop"="mall"]'] },
    tourism: { n: "Tourist spots and parks", q: ['nwr["tourism"~"^(attraction|museum|viewpoint)$"]', 'nwr["historic"]["name"]', 'nwr["leisure"="park"]["name"]'] },
  };
  const STATES = ["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Andaman and Nicobar Islands","Chandigarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Jammu and Kashmir","Ladakh","Lakshadweep","Puducherry"];

  // A sheet that lets the person choose State -> District -> Taluka -> kind of place, then a place.
  function openListPicker(onPick, onClose) {
    const sheet = document.getElementById("sheet");
    sheet.hidden = false;
    sheet.innerHTML = `<div class="card" role="dialog" aria-label="Choose a place from the list">
      <div class="row between"><h2>Choose from list</h2><button class="btn sec small" id="lpClose" type="button">Close</button></div>
      <div class="grid2">
        <label for="lpState">State<select id="lpState"><option value="">Choose state</option>${STATES.map(s => `<option>${esc(s)}</option>`).join("")}</select></label>
        <label for="lpDist">District<select id="lpDist" disabled><option value="">Choose district</option></select></label>
        <label for="lpTal">Taluka<select id="lpTal" disabled><option value="">Whole district</option></select></label>
        <label for="lpCat">Kind of place<select id="lpCat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}">${esc(c.n)}</option>`).join("")}</select></label>
      </div>
      <button class="btn" id="lpLoad" type="button">Show places</button>
      <p class="note" id="lpStatus"></p>
      <input id="lpFilter" placeholder="Filter by name…" hidden>
      <div class="list" id="lpList"></div>
    </div>`;
    const $ = id => document.getElementById(id), st = t => ($("lpStatus").textContent = t);
    const close = () => { sheet.hidden = true; sheet.innerHTML = ""; onClose && onClose(); };
    $("lpClose").onclick = close;
    sheet.onclick = e => { if (e.target === sheet) close(); };
    const fill = (sel, items, first) => { sel.innerHTML = `<option value="">${first}</option>` + items.map(x => `<option value="${x.area}">${esc(x.n)}</option>`).join(""); sel.disabled = !items.length; };
    async function areas(parent, level) {
      const j = await overpass(`[out:json][timeout:60];area(${parent})->.p;rel(area.p)["boundary"="administrative"]["admin_level"="${level}"];out tags;`);
      return j.elements.map(e => ({ area: 3600000000 + e.id, n: enName(e.tags) })).filter(x => x.n).sort((a, b) => a.n.localeCompare(b.n));
    }
    $("lpState").onchange = async e => {
      fill($("lpDist"), [], "Choose district"); fill($("lpTal"), [], "Whole district");
      if (!e.target.value) return;
      st("Loading districts…");
      try {
        const n = e.target.value;
        const j = await overpass(`[out:json][timeout:30];(rel["boundary"="administrative"]["admin_level"="4"]["name:en"="${n}"];rel["boundary"="administrative"]["admin_level"="4"]["name"="${n}"];);out ids;`);
        if (!j.elements[0]) throw 0;
        fill($("lpDist"), await areas(3600000000 + j.elements[0].id, 5), "Choose district"); st("");
      } catch { st("Could not load districts right now. Please try again in a minute."); }
    };
    $("lpDist").onchange = async e => {
      fill($("lpTal"), [], "Whole district"); if (!e.target.value) return;
      st("Loading talukas…");
      try { fill($("lpTal"), await areas(e.target.value, 6), "Whole district"); st(""); } catch { st("Could not load talukas. You can still search the whole district."); }
    };
    let items = [];
    const draw = () => {
      const f = $("lpFilter").value.trim().toLowerCase(), box = $("lpList");
      const shown = items.filter(x => !f || x.name.toLowerCase().includes(f)).slice(0, 300);
      box.innerHTML = shown.length ? "" : `<p class="note">Nothing found. Places not yet on OpenStreetMap won't appear. You can suggest a missing place from the booking screen.</p>`;
      for (const x of shown) {
        const b = document.createElement("button"); b.type = "button"; b.className = "tl-item";
        b.innerHTML = `<b>${esc(x.name)}</b><span class="note">${esc(x.sub)}</span>`;
        b.onclick = () => { close(); onPick({ label: x.name + (x.where ? ", " + x.where : ""), lat: x.lat, lng: x.lng }); };
        box.appendChild(b);
      }
    };
    $("lpFilter").oninput = draw;
    $("lpLoad").onclick = async () => {
      const area = $("lpTal").value || $("lpDist").value, catKey = $("lpCat").value, cat = CATS[catKey];
      if (!area) { st("Choose a state and a district first."); return; }
      const where = [$("lpTal").value ? $("lpTal").selectedOptions[0].textContent : "", $("lpDist").selectedOptions[0].textContent].filter(Boolean).join(", ");
      st("Loading " + cat.n.toLowerCase() + "…");
      try {
        const [j, mine] = await Promise.all([
          overpass(`[out:json][timeout:60];area(${area})->.a;(${cat.q.map(x => x + "(area.a);").join("")});out center 2000;`),
          fetch(`/api/places?state=${encodeURIComponent($("lpState").value)}&district=${encodeURIComponent($("lpDist").selectedOptions[0].textContent)}&category=${catKey}`).then(r => r.json()).catch(() => []),
        ]);
        const seen = new Set();
        items = mine.map(p => ({ name: p.name, lat: p.lat, lng: p.lng, where, sub: "Added on myrightmyride" + (p.taluka ? " · " + p.taluka : "") }))
          .concat(j.elements.filter(el => !cat.f || cat.f(el.tags || {})).map(el => {
            const t = el.tags || {}, name = enName(t), lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
            if (!name || lat == null) return null;
            const kind = cat.f ? (isGovt(t) ? "Government" : "Private") : (t.amenity || t.office || t.railway || t.landuse || t.building || t.club || t.leisure || t.tourism || "").replace(/_/g, " ");
            return { name, lat, lng, where, sub: [kind, t["addr:city"] || t["addr:suburb"] || ""].filter(Boolean).join(" · ") };
          }).filter(Boolean))
          .filter(x => { const k = x.name + x.lat.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; })
          .sort((a, b) => a.name.localeCompare(b.name));
        $("lpFilter").hidden = false; $("lpFilter").value = ""; draw();
        st(`${items.length} found in ${where}.`);
      } catch { st("Could not load places right now. The map server may be busy. Please try again in a minute."); }
    };
  }

  window.Places = {
    init(cfg) { CFG = { ...CFG, ...cfg }; },
    attachSearch, openListPicker, reverse, esc,
  };
})();

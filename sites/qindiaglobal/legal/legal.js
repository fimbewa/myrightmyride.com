// Shared script for the policy pages in /legal/: fills in the Grievance Officer's details that the owner saves on
// /admin, marks the current page in the menu, and runs the complaint form on /legal/grievance.
(function () {
  if (location.pathname.replace(/\.html$/, "") === "/legal/terms" && location.hash === "#privacy") { location.replace("/legal/privacy"); return; }
  const here = location.pathname.replace(/\.html$/, "").replace(/\/$/, "/index");
  document.querySelectorAll(".lnav a").forEach(a => { if (a.getAttribute("href").replace(/\/$/, "/index") === here) a.setAttribute("aria-current", "page"); });
  const y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();

  fetch("/api/legal-contact").then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(c => {
    document.querySelectorAll("[data-gc]").forEach(el => {
      const v = c[el.dataset.gc];
      if (!v) { if (/^\[/.test(el.textContent)) el.classList.add("ph"); return; }
      if (el.dataset.gc === "email") { const a = document.createElement("a"); a.href = "mailto:" + v; a.textContent = v; el.replaceChildren(a); }
      else el.textContent = v;
      el.classList.remove("ph");
    });
    document.querySelectorAll("[data-gc-hide-empty]").forEach(el => { el.hidden = !c[el.dataset.gcHideEmpty]; });
  });

  const f = document.getElementById("gform");
  if (!f) return;
  function sha256hex(str) {
    const bytes = [...str].map(ch => ch.charCodeAt(0) & 255), l = bytes.length;
    bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
    const bits = l * 8; for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    let hh = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < bytes.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let [a, b, c, d, e, f, g, k] = hh;
      for (let i = 0; i < 64; i++) {
        const t1 = (k + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      hh = hh.map((x, i) => (x + [a, b, c, d, e, f, g, k][i]) | 0);
    }
    return hh.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  let ticket = null, ticketAt = 0;
  const newTicket = () => { ticketAt = Date.now(); ticket = fetch("/api/human").then(r => r.json()).catch(() => null); };
  newTicket();
  async function prove() {
    const tk = await ticket, wait = ticketAt + 3300 - Date.now(); newTicket();
    if (!tk) return {};
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    for (let n = 0; n < 5e6; n++) if (sha256hex(tk.token + ":" + n).startsWith(tk.work)) return { human: tk.token, n };
    return {};
  }
  const kind = new URLSearchParams(location.search).get("type");
  if (kind && f.kind.querySelector('option[value="' + kind.replace(/[^a-z]/g, "") + '"]')) f.kind.value = kind;
  const msg = document.getElementById("gmsg");
  f.onsubmit = async e => {
    e.preventDefault();
    const b = f.querySelector("button"); b.disabled = true; msg.className = "msg"; msg.textContent = "Sending… (a few seconds)";
    try {
      const body = { kind: f.kind.value, name: f.name.value, contact: f.contact.value, city: f.city.value, link: f.link.value, details: f.details.value, agree: f.agree.checked, website: f.website.value, ...(await prove()) };
      const res = await fetch("/api/grievance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not send. Please try again or write to the email above.");
      f.reset(); msg.className = "msg ok";
      msg.textContent = "Received. Your complaint number is " + d.number + ". Please note it down. This is our acknowledgement; we will reply to the contact you gave.";
    } catch (err) { msg.className = "msg bad"; msg.textContent = err.message; }
    b.disabled = false;
  };
})();

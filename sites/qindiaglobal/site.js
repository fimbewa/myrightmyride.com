// qindiaglobal.com page behaviour: language, pledge counter, share buttons, posters and the contact form.
(function () {
  const $ = id => document.getElementById(id);
  const SITE = "https://qindiaglobal.com/";
  const sel = $("lang");
  let lang = QI_pick(), t = k => k;

  QI_fillSelect(sel);
  $("year").textContent = new Date().getFullYear();

  function setLang(l) {
    lang = l; sel.value = l; t = QI_apply(l);
    document.title = t("title");
    document.querySelector('meta[name="description"]').content = t("desc");
    const link = SITE + (l === "en" ? "" : "?lang=" + l);
    document.querySelector('link[rel="canonical"]').href = link;
    QI_SHARE.render($("siteShare"), shareOpts(link));
    $("pHabits").href = "/poster.html?type=habits&lang=" + l;
    $("pSign").href = "/poster.html?type=sign&lang=" + l;
    const u = new URL(location.href);
    if (l === "en") u.searchParams.delete("lang"); else u.searchParams.set("lang", l);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    showCount(lastCount);
    renderPhotos();
    showMine();
    renderWall();
  }
  sel.onchange = () => setLang(sel.value);


  // ---------- real photos (free to use under the Unsplash License; shown from Unsplash with credit) ----------
  const U = (id, w) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;
  const PHOTOS = {
    galCrowd: [
      ["photo-1785243957730-30a9bde75507", "Kylli Kittus", "commuters-stand-in-the-open-doorway-of-a-crowded-train-XOO3PKGGiaM", "Mumbai"],
      ["photo-1757841239542-c29c68d4b130", "Dhruv Bhatt", "people-walking-on-a-busy-train-station-platform-lyU8971Llrs", "Mumbai Central"],
      ["photo-1665206221704-624dd27939ad", "Anirudh", "a-group-of-people-walking-in-a-train-station-H4ISZ-_m54w", "Churchgate, Mumbai"],
      ["photo-1723472093218-3655345623eb", "Chinmay Chari", "KX9hz77SHO8", "Dadar, Mumbai"]
    ],
    galQueue: [
      ["photo-1792057251867-258839ee1159", "Rrushik Rrawal", "western-railway-commuter-train-at-station-btp0wqLwFtw", "Mumbai"],
      ["photo-1760816418270-fc76fda62668", "Zoshua Colah", "people-waiting-on-a-busy-metro-station-platform-R300Nf6qfH0", "Delhi Metro"],
      ["photo-1733315384471-0b84f65775c2", "KC Shum", "a-group-of-people-waiting-for-a-train-at-a-train-station-imeRxScAw30", ""]
    ]
  };
  function renderPhotos() {
    for (const [box, list] of Object.entries(PHOTOS)) {
      const el = $(box); el.replaceChildren();
      for (const [id, who, page, place] of list) {
        const f = document.createElement("figure");
        const img = new Image();
        img.src = U(id, 640); img.srcset = `${U(id, 480)} 480w, ${U(id, 800)} 800w`; img.sizes = "(max-width:520px) 90vw, 360px";
        img.loading = "lazy"; img.decoding = "async"; img.alt = place ? `${place}: ${who}` : who;
        img.onerror = () => f.remove();
        const c = document.createElement("figcaption");
        if (place) { const b = document.createElement("b"); b.textContent = place + " · "; c.append(b); }
        const a = document.createElement("a");
        a.href = `https://unsplash.com/photos/${page}?utm_source=qindiaglobal&utm_medium=referral`; a.target = "_blank"; a.rel = "noopener";
        a.textContent = `${t("photo")}: ${who} / Unsplash`;
        c.append(a); f.append(img, c); el.append(f);
      }
    }
  }

  // ---------- share (buttons drawn by share.js) ----------
  function shareOpts(url) {
    return { url, text: t("shareText"), title: "Qindiaglobal", copyLabel: t("copy_btn"), copiedLabel: t("copied"), moreLabel: t("more_btn") };
  }

  // ---------- pledge counter ----------
  let lastCount = null;
  function showCount(n) {
    if (typeof n !== "number") return;
    lastCount = n;
    $("count").textContent = n.toLocaleString(["es", "fr", "ar"].includes(lang) ? lang : "en-IN");
    $("counter").hidden = n < 1;
  }
  function showRecent(list) {
    const places = [...new Set((list || []).map(p => [p.city, p.country].filter(Boolean).join(", ")))].slice(0, 6);
    $("recentList").textContent = places.join(" · ");
    $("recent").hidden = !places.length;
  }
  async function api(path, body) {
    const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw Object.assign(new Error("api"), { status: res.status, code: data && data.error });
    return data;
  }

  // ---------- only humans: a signed token fetched when the page opens, plus a small sum done on the phone ----------
  let ticket = null, ticketAt = 0;
  const newTicket = () => { ticketAt = Date.now(); ticket = api("/api/human").catch(() => null); };
  newTicket();
  // Small SHA-256 (works on every phone browser, also without https).
  const K256 = []; (() => { const f = x => (x - Math.floor(x)) * 2 ** 32 | 0; let n = 2, c = 0; while (c < 64) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) K256[c++] = f(Math.cbrt(n)); n++; } })();
  function sha256hex(str) {
    const bytes = [...str].map(ch => ch.charCodeAt(0) & 255), l = bytes.length;
    bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
    const bits = l * 8; for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < bytes.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (k + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = h.map((x, i) => (x + [a, b, c, d, e, f, g, k][i]) | 0);
    }
    return h.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  async function prove() {
    const tk = await ticket, wait = ticketAt + 3300 - Date.now(); newTicket();
    if (!tk) return {};
    if (wait > 0) await new Promise(r => setTimeout(r, wait)); // a person needs a few seconds to fill a form anyway
    for (let n = 0; n < 5e6; n++) if (sha256hex(tk.token + ":" + n).startsWith(tk.work)) return { human: tk.token, n };
    return {};
  }
  const ERR = { city: "err_city", message: "err_msg", agree: "err_agree", bad: "err_bad", human: "err_wait" };

  // ---------- my own pledge page ----------
  let mySlug = null; try { mySlug = localStorage.getItem("qi_slug"); } catch {}
  function showMine() {
    if (!mySlug) return;
    const link = SITE + "p/" + mySlug + (lang === "en" ? "" : "?lang=" + lang);
    $("mineLink").href = link; $("mineLink").textContent = link.replace("https://", "");
    QI_SHARE.render($("mineShare"), Object.assign(shareOpts(link), { note: false }));
    $("mine").hidden = false;
  }

  // ---------- Pledge wall (only lines the owner approved) ----------
  let wall = [];
  const reportedIds = new Set();
  function renderWall() {
    const box = $("wallList"); box.replaceChildren();
    for (const w of wall) {
      const f = document.createElement("figure"), q = document.createElement("blockquote"), c = document.createElement("figcaption");
      q.textContent = "“" + w.text + "”";
      const who = document.createElement("span"); who.textContent = (w.name || t("citizen")) + (w.city ? ", " + w.city : "");
      const b = document.createElement("button"); b.type = "button"; b.className = "rep";
      b.textContent = reportedIds.has(w.id) ? t("reported") : t("report"); b.disabled = reportedIds.has(w.id);
      b.onclick = () => { reportedIds.add(w.id); b.textContent = t("reported"); b.disabled = true; api("/api/wall/" + w.id + "/report", {}).catch(() => {}); };
      c.append(who, b); f.append(q, c); box.append(f);
    }
    $("wall").hidden = !wall.length;
  }
  api("/api/wall").then(d => { wall = d.items || []; renderWall(); }).catch(() => {});
  // Typing an email/phone ticks the consent box (the person can untick it); without the tick it is not saved.
  const pf = $("pledgeForm");
  pf.contact.addEventListener("input", () => { if (pf.contact.value.trim() && !pf.contact.dataset.touched) pf.consent.checked = true; });
  pf.consent.addEventListener("change", () => { pf.contact.dataset.touched = "1"; });
  api("/api/pledge").then(d => { showCount(d.count); showRecent(d.recent); }).catch(() => {});

  const form = (id, msgId, onSubmit) => {
    const f = $(id), msg = $(msgId);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f)); data.lang = lang;
      const btn = f.querySelector("button"); btn.disabled = true; msg.className = "msg";
      try { msg.textContent = await onSubmit(data, f); msg.classList.add("ok"); }
      catch (err) { msg.textContent = ERR[err.code] ? t(ERR[err.code]) : err.message && err.message !== "api" ? err.message : err.code && err.status === 429 ? err.code : t("err"); msg.classList.add("bad"); }
      finally { btn.disabled = false; }
    });
  };
  form("pledgeForm", "pledgeMsg", async (data, f) => {
    if (!data.city.trim()) { f.city.focus(); throw new Error(t("err_city")); }
    if (!f.agree.checked) { f.agree.focus(); throw new Error(t("err_agree")); }
    const d = await api("/api/pledge", Object.assign(data, await prove()));
    showCount(d.count); showRecent(d.recent);
    f.reset();
    if (d.slug) { mySlug = d.slug; try { localStorage.setItem("qi_slug", d.slug); } catch {} showMine(); }
    try { localStorage.setItem("qi_pledged", "1"); } catch {}
    setTimeout(() => $("mine").scrollIntoView({ behavior: "smooth", block: "center" }), 1500);
    return t("pledge_thanks");
  });
  form("joinForm", "joinMsg", async (data, f) => {
    if (!data.message.trim()) { f.message.focus(); throw new Error(t("err_msg")); }
    if (!f.agree.checked) { f.agree.focus(); throw new Error(t("err_agree")); }
    await api("/api/contact", Object.assign(data, await prove()));
    f.reset();
    return t("sent");
  });

  setLang(lang);
})();

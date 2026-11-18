// qindiaglobal.com page behaviour: language, pledge counter, share buttons, posters and the contact form.
(function () {
  const $ = id => document.getElementById(id);
  const SITE = "https://qindiaglobal.com/";
  const sel = $("lang");
  let lang = QI_pick(), t = k => k;

  QI_LANGS.forEach(([code, name]) => sel.add(new Option(name, code)));
  $("year").textContent = new Date().getFullYear();

  function setLang(l) {
    lang = l; sel.value = l; t = QI_apply(l);
    document.title = t("title");
    document.querySelector('meta[name="description"]').content = t("desc");
    const link = SITE + (l === "en" ? "" : "?lang=" + l);
    document.querySelector('link[rel="canonical"]').href = link;
    const text = t("shareText") + " " + link;
    $("sWa").href = "https://wa.me/?text=" + encodeURIComponent(text);
    $("sX").href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(t("shareText")) + "&url=" + encodeURIComponent(link);
    $("sFb").href = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link);
    $("sTg").href = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(t("shareText"));
    $("pHabits").href = "/poster.html?type=habits&lang=" + l;
    $("pSign").href = "/poster.html?type=sign&lang=" + l;
    const u = new URL(location.href);
    if (l === "en") u.searchParams.delete("lang"); else u.searchParams.set("lang", l);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    showCount(lastCount);
    renderPhotos();
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

  // ---------- share ----------
  const shareLink = () => SITE + (lang === "en" ? "" : "?lang=" + lang);
  $("sCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(t("shareText") + " " + shareLink()); }
    catch { const a = document.createElement("textarea"); a.value = shareLink(); document.body.append(a); a.select(); document.execCommand("copy"); a.remove(); }
    $("sCopy").textContent = t("copied");
    setTimeout(() => { $("sCopy").textContent = t("copy_btn"); }, 2500);
  };
  if (navigator.share) {
    $("sMore").hidden = false;
    $("sMore").onclick = () => navigator.share({ title: "Qindiaglobal", text: t("shareText"), url: shareLink() }).catch(() => {});
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
    if (!res.ok || !data) throw Object.assign(new Error("api"), { status: res.status });
    return data;
  }
  api("/api/pledge").then(d => { showCount(d.count); showRecent(d.recent); }).catch(() => {});

  const form = (id, msgId, onSubmit) => {
    const f = $(id), msg = $(msgId);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f)); data.lang = lang;
      const btn = f.querySelector("button"); btn.disabled = true; msg.className = "msg";
      try { msg.textContent = await onSubmit(data, f); msg.classList.add("ok"); }
      catch (err) { msg.textContent = err.message && err.message !== "api" ? err.message : t("err"); msg.classList.add("bad"); }
      finally { btn.disabled = false; }
    });
  };
  form("pledgeForm", "pledgeMsg", async (data, f) => {
    if (!data.city.trim()) { f.city.focus(); throw new Error(t("err_city")); }
    const d = await api("/api/pledge", data);
    showCount(d.count); showRecent(d.recent);
    f.reset();
    try { localStorage.setItem("qi_pledged", "1"); } catch {}
    setTimeout(() => $("share").scrollIntoView({ behavior: "smooth" }), 1800);
    return t("pledge_thanks");
  });
  form("joinForm", "joinMsg", async (data, f) => {
    if (!data.message.trim()) { f.message.focus(); throw new Error(t("err_msg")); }
    await api("/api/contact", data);
    f.reset();
    return t("sent");
  });

  setLang(lang);
})();

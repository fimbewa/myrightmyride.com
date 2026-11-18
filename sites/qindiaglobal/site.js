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
  }
  sel.onchange = () => setLang(sel.value);

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

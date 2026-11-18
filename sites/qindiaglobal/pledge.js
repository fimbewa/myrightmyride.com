// A person's own pledge page (qindiaglobal.com/p/<code>): language and share buttons.
(function () {
  const $ = id => document.getElementById(id);
  const card = $("pcard"), link = "https://qindiaglobal.com/p/" + card.dataset.slug;
  const sel = $("lang");
  QI_fillSelect(sel);
  // The language in the address wins; otherwise the visitor's own choice; otherwise the language the pledge was made in.
  const fromUrl = new URLSearchParams(location.search).get("lang");
  let saved = null; try { saved = localStorage.getItem("qi_lang"); } catch {}
  let lang = [fromUrl, saved, card.dataset.lang].find(l => l && QI_T[l]) || "en", t = k => k;
  function setLang(l) {
    lang = l; sel.value = l; t = QI_apply(l);
    if (!card.dataset.name) $("pcName").textContent = t("citizen");
    $("pcWall").hidden = !$("pcWall").textContent.trim();
    $("joinToo").href = "/" + (l === "en" ? "" : "?lang=" + l) + "#pledge";
    const text = t("shareText");
    $("sWa").href = "https://wa.me/?text=" + encodeURIComponent(text + " " + link);
    $("sFb").href = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link);
    $("sX").href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(link);
    $("sTg").href = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(text);
  }
  sel.onchange = () => setLang(sel.value);
  $("sCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(t("shareText") + " " + link); }
    catch { const a = document.createElement("textarea"); a.value = link; document.body.append(a); a.select(); document.execCommand("copy"); a.remove(); }
    $("sCopy").textContent = t("copied");
    setTimeout(() => { $("sCopy").textContent = t("copy_btn"); }, 2500);
  };
  setLang(lang);
})();

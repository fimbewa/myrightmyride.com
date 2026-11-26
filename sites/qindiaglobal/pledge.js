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
    QI_SHARE.render($("pageShare"), { url: link, text: t("shareText"), title: "Qindiaglobal", copyLabel: t("copy_btn"), copiedLabel: t("copied"), moreLabel: t("more_btn") });
  }
  sel.onchange = () => setLang(sel.value);
  setLang(lang);
})();

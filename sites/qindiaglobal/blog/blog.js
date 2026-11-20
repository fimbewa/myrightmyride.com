// Q India blog pages: the posts are in English; the language menu translates the disclaimer and footer.
(function () {
  const sel = document.getElementById("lang"); QI_fillSelect(sel);
  const main = document.querySelector("main");
  const go = l => { sel.value = l; QI_apply(l); document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; main.dir = "ltr"; };
  sel.onchange = () => go(sel.value); go(QI_pick());
  const link = location.origin + location.pathname, text = document.querySelector("h1").textContent;
  const set = (id, href) => { const a = document.getElementById(id); if (a) a.href = href; };
  set("sWa", "https://wa.me/?text=" + encodeURIComponent(text + " " + link));
  set("sFb", "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link));
  set("sX", "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(link));
})();

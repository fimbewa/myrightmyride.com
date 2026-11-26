// Q India blog pages: the posts are in English; the language menu translates the disclaimer and footer.
(function () {
  const sel = document.getElementById("lang"); QI_fillSelect(sel);
  const main = document.querySelector("main");
  const go = l => { sel.value = l; QI_apply(l); document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; main.dir = "ltr"; };
  sel.onchange = () => go(sel.value); go(QI_pick());
  // Share buttons on posts are drawn by /share.js (elements with data-qshare).
})();

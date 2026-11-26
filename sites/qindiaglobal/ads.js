// qindiaglobal.com ad boxes. Any element <div class="qi-ad" data-slot="home|blog|post|feed"></div> on a page
// gets one ad, always marked "Ad". When no own ad runs for that box, Google AdSense can fill it (owner's choice).
(function () {
  const boxes = [...document.querySelectorAll(".qi-ad[data-slot]")];
  const css = document.createElement("style");
  css.textContent = `.qi-ad{margin:22px 0}.qi-ad:empty{display:none}
.qi-ad-box{position:relative;background:#fff;border:1px solid var(--line,#dfe3ec);border-radius:16px;overflow:hidden}
.qi-ad-box a{display:block;text-decoration:none;color:var(--ink,#14213d)}
.qi-ad-box img{display:block;width:100%;height:auto;max-height:340px;object-fit:cover;background:#f4f6fa}
.qi-ad-in{padding:10px 14px 12px}.qi-ad-in b{display:block;font-size:17px;color:var(--deep,#1d3557)}
.qi-ad-in span{display:block;font-size:14px;color:var(--muted,#5c6474)}
.qi-ad-tag{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted,#5c6474);padding:6px 14px 0}
.qi-ad-tag em{font-style:normal;font-weight:700;border:1px solid currentColor;border-radius:4px;padding:0 5px}
.qi-ad-tag a{display:inline;color:inherit;text-decoration:underline}`;
  document.head.appendChild(css);

  let adsenseLoaded = false;
  function loadAdsense(client) {
    if (adsenseLoaded) return; adsenseLoaded = true;
    const s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
    document.head.appendChild(s);
  }
  function tag(label) {
    const t = document.createElement("div"); t.className = "qi-ad-tag";
    const em = document.createElement("em"); em.textContent = label;
    const a = document.createElement("a"); a.href = "/advertise"; a.textContent = "Advertise here";
    t.append(em, a); return t;
  }
  function own(box, ad, label) {
    const wrap = document.createElement("aside"); wrap.className = "qi-ad-box"; wrap.setAttribute("aria-label", "Advertisement");
    const a = document.createElement("a"); a.href = ad.go; if (!ad.house) { a.target = "_blank"; a.rel = "sponsored noopener"; }
    if (ad.img) { const img = document.createElement("img"); img.src = ad.img; img.alt = ad.title; img.loading = "lazy"; a.append(img); }
    const inner = document.createElement("div"); inner.className = "qi-ad-in";
    const b = document.createElement("b"); b.textContent = ad.title; inner.append(b);
    if (ad.text) { const s = document.createElement("span"); s.textContent = ad.text; inner.append(s); }
    if (ad.by) { const s = document.createElement("span"); s.textContent = ad.by; inner.append(s); }
    a.append(inner); wrap.append(tag(label), a); box.replaceChildren(wrap);
    // Count a view only when at least half of the ad is on the screen.
    const send = () => { try { navigator.sendBeacon ? navigator.sendBeacon("/api/ads/" + ad.id + "/view") : fetch("/api/ads/" + ad.id + "/view", { method: "POST", keepalive: true }); } catch {} };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); send(); } }, { threshold: 0.5 });
      io.observe(wrap);
    } else send();
  }
  function google(box, g, label) {
    const wrap = document.createElement("aside"); wrap.className = "qi-ad-box"; wrap.setAttribute("aria-label", "Advertisement");
    const ins = document.createElement("ins"); ins.className = "adsbygoogle"; ins.style.display = "block";
    ins.setAttribute("data-ad-client", g.client); ins.setAttribute("data-ad-slot", g.slot);
    ins.setAttribute("data-ad-format", "auto"); ins.setAttribute("data-full-width-responsive", "true");
    wrap.append(tag(label), ins); box.replaceChildren(wrap);
    loadAdsense(g.client);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  }

  const slots = [...new Set(boxes.map(b => b.dataset.slot))].join(",");
  fetch("/api/ads?slots=" + encodeURIComponent(slots)).then(r => r.json()).then(d => {
    const label = d.label || "Ad", g = d.adsense;
    boxes.forEach(box => {
      const ad = d.ads && d.ads[box.dataset.slot];
      if (ad) own(box, ad, label);
      else if (g && g.slot) google(box, g, label);
    });
    if (g && g.auto) loadAdsense(g.client); // Google's own "Auto ads" may also place ads on the page
  }).catch(() => {});
})();

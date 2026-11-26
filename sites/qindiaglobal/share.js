// Share buttons for every qindiaglobal.com page.
// Plain links to each network's own "share" page: no tracking scripts, no cookies, nothing loads until a button is tapped.
// Instagram and YouTube have no web "share" link, so the phone's own share menu ("More apps") and "Copy link" cover them.
//
// Use:  <div class="qshare" data-qshare></div>                        (link = this page, text = the page's <h1>)
//       <div class="qshare" data-qshare data-url="…" data-text="…"></div>
//       QI_SHARE.render(element, { url, text, copyLabel, copiedLabel, moreLabel })   (again at any time, e.g. after a language change)
//       QI_SHARE.popup({ url, text })                                  (a share box over the page)
window.QI_SHARE = (function () {
  const e = encodeURIComponent;
  const NETS = [
    ["wa", "WhatsApp", (u, t) => "https://wa.me/?text=" + e(t + " " + u)],
    ["fb", "Facebook", u => "https://www.facebook.com/sharer/sharer.php?u=" + e(u)],
    ["x", "X", (u, t) => "https://twitter.com/intent/tweet?text=" + e(t) + "&url=" + e(u)],
    ["li", "LinkedIn", u => "https://www.linkedin.com/sharing/share-offsite/?url=" + e(u)],
    ["tg", "Telegram", (u, t) => "https://t.me/share/url?url=" + e(u) + "&text=" + e(t)],
    ["th", "Threads", (u, t) => "https://www.threads.net/intent/post?text=" + e(t + " " + u)],
    ["rd", "Reddit", (u, t) => "https://www.reddit.com/submit?url=" + e(u) + "&title=" + e(t)],
    ["em", "Email", (u, t, title) => "mailto:?subject=" + e(title || t) + "&body=" + e(t + "\n\n" + u)],
  ];
  const ICON = { wa: "✆", fb: "f", x: "𝕏", li: "in", tg: "➤", th: "@", rd: "r", em: "✉" };

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const a = document.createElement("textarea"); a.value = text; a.setAttribute("readonly", ""); a.style.position = "fixed"; a.style.opacity = "0";
      document.body.append(a); a.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch {}
      a.remove(); return ok;
    }
  }

  function pageDefaults(box) {
    const canon = document.querySelector('link[rel="canonical"]');
    const h1 = document.querySelector("h1");
    return {
      url: (box && box.dataset.url) || (canon && canon.href) || location.origin + location.pathname,
      text: (box && box.dataset.text) || (h1 && h1.textContent.trim()) || document.title,
    };
  }

  function render(box, opts) {
    if (!box) return;
    const o = Object.assign(pageDefaults(box), opts || {});
    const url = o.url, text = o.text || "", title = o.title || text;
    box.textContent = "";
    box.classList.add("qshare");
    const row = el("div", "qs-row");
    for (const [k, name, make] of NETS) {
      const a = el("a", "qs-btn qs-" + k);
      a.href = make(url, text, title);
      if (k !== "em") { a.target = "_blank"; a.rel = "noopener"; }
      a.setAttribute("aria-label", "Share on " + name);
      a.append(el("b", null, ICON[k]), document.createTextNode(name));
      row.append(a);
    }
    const copyLabel = o.copyLabel || "Copy link", copied = o.copiedLabel || "Link copied";
    const c = el("button", "qs-btn qs-copy"); c.type = "button";
    c.append(el("b", null, "⧉"), document.createTextNode(copyLabel));
    c.onclick = async () => {
      const ok = await copy(text ? text + " " + url : url);
      c.lastChild.textContent = ok ? copied : url;
      setTimeout(() => { c.lastChild.textContent = copyLabel; }, 2500);
    };
    row.append(c);
    if (navigator.share) {
      const m = el("button", "qs-btn qs-more"); m.type = "button";
      m.append(el("b", null, "⋯"), document.createTextNode((o.moreLabel || "More apps") + " (Instagram, YouTube…)"));
      m.onclick = () => navigator.share({ title, text, url }).catch(() => {});
      row.append(m);
    }
    box.append(row);
    if (o.note !== false) box.append(el("p", "qs-note", o.noteText ||
      "Instagram and YouTube: tap “More apps” on your phone, or tap “Copy link” and paste the link into your story, bio, post or video description."));
  }

  function popup(opts) {
    const old = document.querySelector(".qs-pop"); if (old) old.remove();
    const bg = el("div", "qs-pop"), card = el("div", "qs-card");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-label", "Share");
    const close = el("button", "qs-close", "✕"); close.type = "button"; close.setAttribute("aria-label", "Close");
    const shut = () => { bg.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = ev => { if (ev.key === "Escape") shut(); };
    close.onclick = shut; bg.onclick = ev => { if (ev.target === bg) shut(); };
    document.addEventListener("keydown", onKey);
    const box = el("div");
    card.append(close, el("h3", null, (opts && opts.heading) || "Share"), box);
    bg.append(card); document.body.append(bg);
    render(box, opts);
    close.focus();
  }

  function auto() { document.querySelectorAll("[data-qshare]").forEach(b => { if (!b.dataset.qsDone) { b.dataset.qsDone = "1"; render(b); } }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto();

  return { render, popup, copy };
})();

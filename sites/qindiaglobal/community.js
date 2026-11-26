// Q India Community: the page at qindiaglobal.com/community. One page; the part after # picks the screen:
// #/ feed · #/new · #/p/<id> post · #/u/<username> profile · #/search · #/chats · #/chat/<username> · #/notifs · #/me · #/login · #/signup · #/recover
(function () {
  "use strict";
  const view = document.getElementById("view");
  let tok = ""; try { tok = localStorage.getItem("qi_s_token") || ""; } catch {}
  // Invited by a member: qindiaglobal.com/community?ref=<username>. Remembered until sign-up.
  try { const ref = new URLSearchParams(location.search).get("ref"); if (ref && /^[a-z0-9_.]{3,20}$/i.test(ref)) localStorage.setItem("qi_s_ref", ref.toLowerCase()); } catch {}
  const savedRef = () => { try { return localStorage.getItem("qi_s_ref") || ""; } catch { return ""; } };
  let me = null; // { username, name, avatar, ... } when logged in
  let timer = null; // the open chat checks for new messages every few seconds

  // The disclaimer in the visitor's language (the rest of the page is English for now).
  try { if (window.QI_apply && window.QI_pick) { QI_apply(QI_pick()); document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; } } catch {}

  // ---------- small helpers ----------
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) e[k] = v; else if (k === "cls") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }
  const show = (...nodes) => { view.replaceChildren(...nodes); };
  async function api(path, opts = {}) {
    const headers = { ...(opts.raw ? { "content-type": "application/octet-stream" } : { "content-type": "application/json" }) };
    if (tok) headers.authorization = "Bearer " + tok;
    let res;
    try { res = await fetch(path, { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers, body: opts.raw || (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }); }
    catch { throw new Error("No internet connection. Please try again."); }
    const d = await res.json().catch(() => ({}));
    if (res.status === 401 && tok && !opts.noLogout) { setToken(""); me = null; }
    if (res.status === 413) throw new Error("This photo is too big. Please choose a smaller one.");
    if (!res.ok) throw Object.assign(new Error(d.error === "human" ? "Please wait a moment and try again." : d.error || "Something went wrong. Please try again."), { status: res.status });
    return d;
  }
  function setToken(t) { tok = t; try { t ? localStorage.setItem("qi_s_token", t) : localStorage.removeItem("qi_s_token"); } catch {} }
  const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min"; if (s < 86400) return Math.floor(s / 3600) + " h";
    if (s < 7 * 86400) return Math.floor(s / 86400) + " d";
    return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  const clock = ms => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const avatar = (u, cls = "") => u.avatar ? h("img", { cls: "av " + cls, src: u.avatar, alt: "" }) : h("span", { cls: "av " + cls, "aria-hidden": "true", text: [...(u.name || u.username || "?")][0] });
  const whoLink = (u, sub) => h("a", { cls: "row who grow", href: "#/u/" + u.username }, avatar(u), h("span", { cls: "grow" }, h("b", { text: u.name }), h("small", { text: "@" + u.username + (sub ? " · " + sub : "") })));
  // Text with clickable web links (the text itself is never treated as HTML).
  function richText(text) {
    const out = [], rx = /https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g; let last = 0, m;
    while ((m = rx.exec(text))) { out.push(text.slice(last, m.index)); out.push(h("a", { href: m[0], target: "_blank", rel: "noopener nofollow ugc", text: m[0] })); last = m.index + m[0].length; }
    out.push(text.slice(last)); return out;
  }
  const msgBox = () => h("p", { cls: "msg" });
  const say = (box, text, ok) => { box.textContent = text; box.className = "msg " + (ok ? "ok" : "bad"); };
  function needLogin(why) {
    show(h("div", { cls: "card" }, h("h1", { text: "Join Q India Community" }), h("p", { text: why || "Please log in or create a free account to do this." }),
      h("p", {}, h("a", { cls: "btn", href: "#/signup" }, "Create free account"), " ", h("a", { cls: "sbtn", href: "#/login" }, "Log in"))));
  }
  function menu(btnHost, items) {
    const dots = h("button", { cls: "dots", type: "button", "aria-label": "More" }, "⋯");
    const wrap = h("span", { cls: "more" }, dots);
    dots.onclick = e => {
      e.stopPropagation();
      const open = wrap.querySelector(".more-menu"); if (open) { open.remove(); return; }
      const m = h("div", { cls: "more-menu" }, items.filter(Boolean).map(([label, fn]) => h("button", { type: "button", onclick: ev => { ev.stopPropagation(); m.remove(); fn(); } }, label)));
      wrap.append(m);
      setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }));
    };
    if (btnHost) btnHost.append(wrap);
    return wrap;
  }
  async function report(kind, id) {
    if (!me) return needLogin("Please log in to report.");
    const reason = prompt("Why are you reporting this? (for example: nudity, abuse, spam, fake)") ;
    if (reason === null) return;
    try { await api("/api/s/report", { body: { kind, id, reason } }); alertNote("Thank you. The site owner will check it."); } catch (e) { alertNote(e.message); }
  }
  function alertNote(text) { const n = h("div", { cls: "note", role: "status", text }); view.prepend(n); setTimeout(() => n.remove(), 5000); window.scrollTo(0, 0); }

  // ---------- photos: shrink on the phone before sending (saves data and server space; removes GPS details) ----------
  async function shrink(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("This file is not a photo the browser can open. Please choose a JPEG or PNG photo.")); i.src = url; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadPhoto(file, max = 1600) {
    const blob = await shrink(file, max);
    if (!blob) throw new Error("Could not read the photo.");
    return (await api("/api/s/upload", { method: "POST", raw: blob })).id;
  }
  function photoPicker(onPick, label = "📷 Photo") {
    const input = h("input", { type: "file", accept: "image/*", "aria-label": "Add a photo" });
    input.onchange = () => { if (input.files[0]) onPick(input.files[0]); input.value = ""; };
    return h("label", { cls: "sbtn filebtn", title: "Add a photo" }, label, input);
  }

  // ---------- only humans (same check as the pledge form) ----------
  const K256 = []; (() => { const f = x => (x - Math.floor(x)) * 2 ** 32 | 0; let n = 2, c = 0; while (c < 64) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) K256[c++] = f(Math.cbrt(n)); n++; } })();
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
  const newTicket = () => { ticketAt = Date.now(); ticket = api("/api/human").catch(() => null); };
  async function prove() {
    const tk = await ticket, wait = ticketAt + 3300 - Date.now(); newTicket();
    if (!tk) return {};
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    for (let n = 0; n < 5e6; n++) if (sha256hex(tk.token + ":" + n).startsWith(tk.work)) return { human: tk.token, n };
    return {};
  }

  // ---------- log in, sign up, forgotten password ----------
  function showRecovery(code, then) {
    show(h("div", { cls: "card" },
      h("h1", { text: "Save your recovery code" }),
      h("p", { text: "If you ever forget your password, this code lets you set a new one. Write it down or take a screenshot now. It is shown only once." }),
      h("p", { cls: "code", text: code }),
      h("p", {}, h("button", { cls: "btn", onclick: then }, "I have saved it"))));
  }
  function loginPage() {
    const m = msgBox();
    const f = h("form", { cls: "card" },
      h("h1", { text: "Log in" }),
      h("div", {}, h("label", { for: "lu", text: "Username" }), h("input", { id: "lu", name: "username", autocomplete: "username", autocapitalize: "none", required: true })),
      h("div", {}, h("label", { for: "lp", text: "Password" }), h("input", { id: "lp", name: "password", type: "password", autocomplete: "current-password", required: true })),
      h("button", { cls: "btn" }, "Log in"), m,
      h("p", { cls: "muted" }, "New here? ", h("a", { href: "#/signup" }, "Create a free account"), " · ", h("a", { href: "#/recover" }, "Forgot password?")));
    f.onsubmit = async e => {
      e.preventDefault(); say(m, "Please wait…", true);
      try { const d = await api("/api/s/login", { body: { username: f.username.value, password: f.password.value }, noLogout: true }); setToken(d.token); await loadMe(); go("#/"); }
      catch (err) { say(m, err.message); }
    };
    show(f);
  }
  function signupPage() {
    newTicket();
    const m = msgBox();
    const f = h("form", { cls: "card" },
      h("h1", { text: "Create your free account" }),
      h("p", { cls: "muted", text: "Join citizens who queue up and board with dignity. Share posts and photos, follow people and message friends. Everything is free." }),
      h("div", {}, h("label", { for: "sn", text: "Your name" }), h("input", { id: "sn", name: "name", maxlength: 50, autocomplete: "name", required: true })),
      h("div", {}, h("label", { for: "su", text: "Choose a username" }), h("input", { id: "su", name: "username", maxlength: 20, autocomplete: "username", autocapitalize: "none", placeholder: "for example ravi_patil", required: true }),
        h("small", { cls: "muted", text: "3 to 20 small English letters, numbers, _ or ." })),
      h("div", {}, h("label", { for: "sc", text: "City (optional)" }), h("input", { id: "sc", name: "city", maxlength: 60 })),
      h("div", {}, h("label", { for: "sp", text: "Password (at least 8 characters)" }), h("input", { id: "sp", name: "password", type: "password", minlength: 8, autocomplete: "new-password", required: true })),
      h("input", { name: "website", tabindex: "-1", autocomplete: "off", style: "position:absolute;left:-5000px", "aria-hidden": "true" }),
      h("label", { cls: "tick" }, h("input", { type: "checkbox", name: "agree", required: true }), h("span", {}, "I am 18 or older. I agree to the ", h("a", { href: "/legal/terms", target: "_blank" }, "Terms of Use"), " and ", h("a", { href: "/legal/community-guidelines", target: "_blank" }, "Community Guidelines"), ", and I consent to Qindiaglobal using my details as the ", h("a", { href: "/legal/privacy", target: "_blank" }, "Privacy Policy"), " explains. I will not post nudity, abuse, hate or spam.")),
      h("p", { cls: "muted", style: "font-size:13px;margin:0" }, "Privacy notice: we use your name, username, password (stored scrambled), optional city and photo, and what you post, only to run your free account and keep the community safe. You can delete your account and withdraw consent at any time in Settings. Questions or complaints: ", h("a", { href: "/legal/grievance", target: "_blank" }, "Grievance Officer"), "."),
      h("button", { cls: "btn" }, "Create account"), m,
      h("p", { cls: "muted" }, "Already have an account? ", h("a", { href: "#/login" }, "Log in")));
    f.username.oninput = () => { f.username.value = f.username.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""); };
    f.onsubmit = async e => {
      e.preventDefault(); const b = f.querySelector("button.btn"); b.disabled = true; say(m, "Checking that you are a person… (a few seconds)", true);
      try {
        const d = await api("/api/s/signup", { body: { name: f.name.value, username: f.username.value, city: f.city.value, password: f.password.value, agree: f.agree.checked, website: f.website.value, ref: savedRef(), ...(await prove()) }, noLogout: true });
        try { localStorage.removeItem("qi_s_ref"); } catch {}
        setToken(d.token); await loadMe(); showRecovery(d.recovery, () => go("#/me/edit"));
      } catch (err) { say(m, err.message); b.disabled = false; }
    };
    show(f);
  }
  function recoverPage() {
    const m = msgBox();
    const f = h("form", { cls: "card" },
      h("h1", { text: "Forgot your password?" }),
      h("p", { cls: "muted", text: "Use the recovery code you saved when you made your account." }),
      h("input", { name: "username", placeholder: "Username", autocapitalize: "none", required: true }),
      h("input", { name: "code", placeholder: "Recovery code, like ABCD-EFGH-JKLM-NPQR", autocapitalize: "characters", required: true }),
      h("input", { name: "password", type: "password", placeholder: "New password (at least 8 characters)", minlength: 8, autocomplete: "new-password", required: true }),
      h("button", { cls: "btn" }, "Set new password"), m,
      h("p", { cls: "muted", text: "Lost the code too? Write to the site owner using the form on the home page, from the city and name on your profile." }));
    f.onsubmit = async e => {
      e.preventDefault(); say(m, "Please wait…", true);
      try { const d = await api("/api/s/recover", { body: { username: f.username.value, code: f.code.value, password: f.password.value }, noLogout: true }); setToken(d.token); await loadMe(); showRecovery(d.recovery, () => go("#/")); }
      catch (err) { say(m, err.message); }
    };
    show(f);
  }

  // ---------- posts ----------
  function postCard(p, { full } = {}) {
    const likeBtn = h("button", { type: "button", cls: p.liked ? "on" : "" }, (p.liked ? "♥ " : "♡ ") + (p.likes || "") + " Like");
    likeBtn.onclick = async () => {
      if (!me) return needLogin("Please log in to like posts.");
      try { const d = await api(`/api/s/posts/${p.id}/like`, { body: { like: !p.liked } }); p.liked = d.liked; p.likes = d.likes; likeBtn.className = p.liked ? "on" : ""; likeBtn.textContent = (p.liked ? "♥ " : "♡ ") + (p.likes || "") + " Like"; }
      catch (e) { alertNote(e.message); }
    };
    const link = location.origin + "/community#/p/" + p.id;
    const share = h("button", { type: "button" }, "↗ Share");
    share.onclick = async () => {
      const text = (p.text || "A post on Q India Community").slice(0, 100);
      if (navigator.share) return navigator.share({ title: "Q India Community", text, url: link }).catch(() => {});
      window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + link), "_blank", "noopener");
    };
    const head = h("div", { cls: "row ph" }, whoLink(p.user, ago(p.created_at)));
    menu(head, [
      ["Copy link", () => navigator.clipboard && navigator.clipboard.writeText(link).then(() => alertNote("Link copied."))],
      p.mine && ["Delete post", async () => { if (!confirm("Delete this post?")) return; try { await api(`/api/s/posts/${p.id}/delete`, { body: {} }); full ? go("#/") : card.remove(); } catch (e) { alertNote(e.message); } }],
      !p.mine && ["Report post", () => report("post", p.id)],
    ]);
    const card = h("article", { cls: "post" }, head,
      p.status === "pending" && h("p", { cls: "wait", text: "Only you can see this for now. The site owner checks photos and some posts before everyone sees them." }),
      p.text && h("div", { cls: "tx" }, richText(p.text)),
      p.photo && h("img", { cls: "pic", src: p.photo, alt: "Photo shared by " + p.user.name, loading: "lazy" }),
      h("div", { cls: "acts" }, likeBtn, full ? h("span", { cls: "muted", style: "flex:1;text-align:center;padding:8px", text: "💬 " + p.comments }) : h("a", { href: "#/p/" + p.id }, "💬 " + (p.comments || "") + " Comment"), share));
    return card;
  }
  function composer(after) {
    const m = msgBox(); let photo = null, file = null;
    const prev = h("div", { cls: "prev", hidden: true });
    const f = h("form", { cls: "card compose" },
      h("div", { cls: "row" }, me && avatar(me, "sm"), h("b", { text: "Share with the community" })),
      h("textarea", { name: "text", maxlength: 5000, placeholder: "What's happening? Share a good queue you saw, a tip, or a photo." }), prev,
      h("div", { cls: "row" }, photoPicker(async fl => {
        file = fl; photo = null; prev.hidden = false; prev.replaceChildren(h("p", { cls: "muted", text: "Preparing photo…" }));
        try {
          photo = await uploadPhoto(fl);
          if (file !== fl) return;
          const rm = h("button", { type: "button", cls: "sbtn" }, "✕ Remove"); rm.onclick = () => { photo = null; file = null; prev.hidden = true; prev.replaceChildren(); };
          prev.replaceChildren(h("img", { src: URL.createObjectURL(fl), alt: "" }), rm);
        } catch (e) { prev.replaceChildren(h("p", { cls: "msg bad", text: e.message })); photo = null; }
      }), h("span", { cls: "grow" }), h("button", { cls: "btn" }, "Post")), m);
    f.onsubmit = async e => {
      e.preventDefault();
      if (file && !photo) return say(m, "Please wait until the photo is ready.");
      say(m, "Posting…", true);
      try {
        const d = await api("/api/s/posts", { body: { text: f.text.value, photo } });
        f.reset(); photo = null; file = null; prev.hidden = true; prev.replaceChildren();
        say(m, d.post.status === "pending" ? "Posted. The site owner will check it soon; until then only you can see it." : "Posted.", true);
        after && after(d.post);
      } catch (err) { say(m, err.message); }
    };
    return f;
  }
  // Reminder of the rules, at least every 3 months and when they change (IT Intermediary Rules 2021, rule 3(1)(c)).
  function rulesNote() {
    if (!me || !me.rulesDue) return "";
    const box = h("div", { cls: "card", style: "border:2px solid #e85d04" },
      h("h2", { text: "A reminder of our rules" }),
      h("p", {}, "Please follow the ", h("a", { href: "/legal/terms", target: "_blank" }, "Terms of Use"), ", ", h("a", { href: "/legal/community-guidelines", target: "_blank" }, "Community Guidelines"), " and ", h("a", { href: "/legal/privacy", target: "_blank" }, "Privacy Policy"), "."),
      h("p", { text: "If you break them, we may remove your content and suspend or close your account at once. Posting unlawful content (for example sexual content, child abuse, deepfakes, hate, threats or false news) can be punished under the Information Technology Act, 2000, the Bharatiya Nyaya Sanhita, 2023 and other laws, and we must report some of it to the authorities." }),
      h("p", {}, "To complain or appeal, contact our ", h("a", { href: "/legal/grievance", target: "_blank" }, "Grievance Officer"), "."));
    const ok = h("button", { cls: "btn" }, "I understand");
    ok.onclick = async () => { ok.disabled = true; await api("/api/s/rules-seen", { body: {} }).catch(() => {}); me.rulesDue = false; box.remove(); };
    box.append(ok);
    return box;
  }
  async function feedPage(tab) {
    tab = me && tab !== "all" ? tab || "following" : "all";
    const list = h("div");
    const tabs = me && h("div", { cls: "tabs" }, h("a", { href: "#/following", cls: tab === "following" ? "on" : "" }, "Following"), h("a", { href: "#/all", cls: tab === "all" ? "on" : "" }, "Everyone"));
    const top = me ? composer(p => list.prepend(postCard(p))) : h("div", { cls: "card" }, h("h1", { text: "Q India Community" }),
      h("p", { text: "Share posts and photos, follow people, and message friends privately. Free for everyone, always." }),
      h("p", {}, h("a", { cls: "btn", href: "#/signup" }, "Create free account"), " ", h("a", { cls: "sbtn", href: "#/login" }, "Log in")));
    show(rulesNote(), top, tabs, list);
    await loadMore(list, b => `/api/s/feed?tab=${tab}&before=${b}`, d => d.posts.map(p => postCard(p)),
      tab === "following" ? h("div", { cls: "empty" }, h("p", { text: "Nothing here yet. Follow people to see their posts, or look at everyone's posts." }), h("a", { cls: "sbtn", href: "#/all" }, "See everyone"), " ", h("a", { cls: "sbtn", href: "#/search" }, "Find people"))
        : h("p", { cls: "empty", text: "No posts yet. Be the first to share something!" }));
  }
  // Fills a list page by page ("Show more" button at the end).
  async function loadMore(list, url, render, emptyNode, before = 2 ** 53) {
    let d;
    try { d = await api(url(before)); } catch (e) { list.append(h("p", { cls: "msg bad", text: e.message })); return null; }
    const items = render(d);
    if (!items.length && before === 2 ** 53) { list.append(emptyNode); return d; }
    list.append(...items);
    if (d.more) {
      const ids = (d.posts || []).map(p => p.id), b = h("button", { cls: "sbtn loadmore" }, "Show more");
      b.onclick = () => { b.remove(); loadMore(list, url, render, emptyNode, Math.min(...ids)); };
      list.append(b);
    }
    return d;
  }
  async function postPage(id) {
    let d; try { d = await api("/api/s/posts/" + id); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const box = h("div");
    const draw = c => {
      const bub = h("div", { cls: "bub" }, h("div", { cls: "row" }, h("a", { cls: "who grow", href: "#/u/" + c.user.username }, h("b", { text: c.user.name })), h("small", { cls: "muted", text: ago(c.created_at) })), h("p", {}, richText(c.text)),
        c.status === "pending" && h("small", { cls: "muted", text: "Waiting for a check; only you can see it." }));
      const row = h("div", { cls: "cmt" }, h("a", { href: "#/u/" + c.user.username }, avatar(c.user, "sm")), bub);
      menu(row, [
        c.canDelete && ["Delete comment", async () => { try { await api(`/api/s/comments/${c.id}/delete`, { body: {} }); row.remove(); } catch (e) { alertNote(e.message); } }],
        !c.mine && ["Report comment", () => report("comment", c.id)],
      ]);
      return row;
    };
    d.comments.forEach(c => box.append(draw(c)));
    let form = null;
    if (me) {
      const m = msgBox();
      form = h("form", { cls: "card" }, h("textarea", { name: "text", maxlength: 1000, placeholder: "Write a comment…", required: true }), h("button", { cls: "btn" }, "Comment"), m);
      form.onsubmit = async e => {
        e.preventDefault();
        try {
          const r = await api(`/api/s/posts/${id}/comments`, { body: { text: form.text.value } });
          box.append(draw({ id: r.id, text: form.text.value, created_at: Date.now(), status: r.status, mine: true, canDelete: true, user: me })); form.reset(); say(m, "", true);
        } catch (err) { say(m, err.message); }
      };
    } else form = h("p", { cls: "muted" }, h("a", { href: "#/login" }, "Log in"), " to comment.");
    show(postCard(d.post, { full: true }), h("h1", { text: "Comments" }), box, form);
  }

  // ---------- people ----------
  async function profilePage(username, list) {
    let d; try { d = await api("/api/s/users/" + encodeURIComponent(username)); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const u = d.user;
    if (list) {
      const r = await api(`/api/s/users/${encodeURIComponent(username)}/${list}`).catch(e => ({ users: [], error: e.message }));
      return show(h("h1", { text: (list === "followers" ? "Followers of " : "Followed by ") + u.name }),
        h("div", { cls: "list" }, r.users.length ? r.users.map(x => h("a", { cls: "li", href: "#/u/" + x.username }, avatar(x), h("span", { cls: "grow" }, h("b", { text: x.name }), h("div", { cls: "last", text: "@" + x.username })))) : h("p", { cls: "empty", text: "Nobody yet." })));
    }
    const btns = h("div", { cls: "btns" });
    if (u.me) btns.append(h("a", { cls: "sbtn dark", href: "#/me/edit" }, "Edit profile"), h("a", { cls: "sbtn", href: "#/me/settings" }, "Settings"));
    else if (u.iBlocked) {
      const ub = h("button", { cls: "sbtn" }, "Unblock"); ub.onclick = async () => { await api(`/api/s/users/${u.username}/block`, { body: { block: false } }).catch(() => {}); route(); }; btns.append(ub);
    } else {
      const fb = h("button", { cls: "sbtn " + (u.iFollow ? "" : "main") }, u.iFollow ? "Following ✓" : u.followsMe ? "Follow back" : "Follow");
      fb.onclick = async () => {
        if (!me) return needLogin("Please log in to follow people.");
        try { await api(`/api/s/users/${u.username}/follow`, { body: { follow: !u.iFollow } }); route(); } catch (e) { alertNote(e.message); }
      };
      btns.append(fb, h("a", { cls: "sbtn", href: me ? "#/chat/" + u.username : "#/login" }, "💬 Message"));
      menu(btns, [
        ["Report profile", () => report("user", u.username)],
        me && ["Block", async () => { if (!confirm("Block @" + u.username + "? They will not be able to message you or see your posts.")) return; await api(`/api/s/users/${u.username}/block`, { body: {} }).catch(() => {}); route(); }],
      ]);
    }
    const head = h("div", { cls: "card prof" }, avatar(u, "big"), h("h1", { text: u.name }), h("div", { cls: "muted", text: "@" + u.username + (u.city ? " · " + u.city : "") + (u.followsMe && !u.me ? " · follows you" : "") }),
      u.bio && h("p", { cls: "bio" }, richText(u.bio)),
      h("div", { cls: "nums" }, h("span", {}, h("b", { text: u.posts }), "posts"), h("a", { href: `#/u/${u.username}/followers` }, h("b", { text: u.followers }), "followers"), h("a", { href: `#/u/${u.username}/following` }, h("b", { text: u.following }), "following")), btns);
    const listBox = h("div");
    show(head, u.iBlocked ? h("p", { cls: "empty", text: "You blocked this person." }) : listBox);
    if (!u.iBlocked) {
      listBox.append(...d.posts.map(p => postCard(p)));
      if (!d.posts.length) listBox.append(h("p", { cls: "empty", text: u.me ? "You have not posted yet. Tap ＋ Post below." : "No posts yet." }));
      if (d.more) { const b = h("button", { cls: "sbtn loadmore" }, "Show more"); b.onclick = () => { b.remove(); loadMore(listBox, x => `/api/s/users/${u.username}?before=${x}`, r => r.posts.map(p => postCard(p)), h("span"), Math.min(...d.posts.map(p => p.id))); }; listBox.append(b); }
    }
  }
  function searchPage() {
    const q = h("input", { type: "search", placeholder: "Search people by name, username or city", autocapitalize: "none" });
    const list = h("div", { cls: "list" });
    let t = null;
    const run = async () => {
      const d = await api("/api/s/search?q=" + encodeURIComponent(q.value)).catch(() => ({ users: [] }));
      list.replaceChildren(...(d.users.length ? d.users.map(x => h("a", { cls: "li", href: "#/u/" + x.username }, avatar(x), h("span", { cls: "grow" }, h("b", { text: x.name }), h("div", { cls: "last", text: "@" + x.username })))) : [h("p", { cls: "empty", text: "Nobody found." })]));
    };
    q.oninput = () => { clearTimeout(t); t = setTimeout(run, 300); };
    show(h("h1", { text: "Find people" }), q, h("p", { cls: "muted", text: "Newest members are shown first." }), list);
    run(); q.focus();
  }
  async function notifsPage() {
    if (!me) return needLogin();
    let d; try { d = await api("/api/s/notifs"); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const TXT = { like: "liked your post", comment: "commented on your post", follow: "started following you" };
    show(h("h1", { text: "Alerts" }), h("div", { cls: "list" }, d.items.length ? d.items.map(n => h("a", { cls: "li" + (n.read ? "" : " unread"), href: n.post_id ? "#/p/" + n.post_id : "#/u/" + n.user.username },
      avatar(n.user), h("span", { cls: "grow" }, h("b", { text: n.user.name }), " ", TXT[n.kind] || n.kind, h("div", { cls: "last", text: ago(n.created_at) })))) : h("p", { cls: "empty", text: "No alerts yet. When someone likes, comments or follows you, it shows here." })));
    badges();
  }

  // ---------- my profile and settings ----------
  async function editPage() {
    if (!me) return needLogin();
    await loadMe();
    const m = msgBox(); let avatarId;
    const pic = h("div", { cls: "row" }, avatar(me, "big"));
    const f = h("form", { cls: "card" }, h("h1", { text: "Edit profile" }), pic,
      h("div", { cls: "row" }, photoPicker(async fl => {
        say(m, "Preparing photo…", true);
        try { avatarId = await uploadPhoto(fl, 512); pic.replaceChildren(h("img", { cls: "av big", src: URL.createObjectURL(fl), alt: "" })); say(m, "Tap Save to keep this photo.", true); } catch (e) { say(m, e.message); }
      }), me.avatar && h("button", { type: "button", cls: "sbtn", onclick: () => { avatarId = null; pic.replaceChildren(avatar({ name: me.name })); } }, "Remove photo")),
      h("div", {}, h("label", { text: "Name" }), h("input", { name: "name", maxlength: 50, value: me.name, required: true })),
      h("div", {}, h("label", { text: "City" }), h("input", { name: "city", maxlength: 60, value: me.city || "" })),
      h("div", {}, h("label", { text: "About me" }), h("textarea", { name: "bio", maxlength: 300, placeholder: "A few words about you" })),
      h("button", { cls: "btn" }, "Save"), m);
    f.bio.value = me.bio || "";
    f.onsubmit = async e => {
      e.preventDefault();
      const body = { name: f.name.value, city: f.city.value, bio: f.bio.value }; if (avatarId !== undefined) body.avatar = avatarId;
      try { await api("/api/s/me", { body }); await loadMe(); go("#/u/" + me.username); } catch (err) { say(m, err.message); }
    };
    show(f);
  }
  async function settingsPage() {
    if (!me) return needLogin();
    await loadMe();
    const dmMsg = msgBox();
    const dm = h("select", { name: "dm" }, h("option", { value: "everyone" }, "Everyone (people I don't follow can send one request)"), h("option", { value: "following" }, "Only people I follow"));
    dm.value = me.dm; dm.onchange = async () => { try { await api("/api/s/me", { body: { dm: dm.value } }); say(dmMsg, "Saved.", true); } catch (e) { say(dmMsg, e.message); } };
    const pm = msgBox();
    const pf = h("form", {}, h("input", { name: "old", type: "password", placeholder: "Current password", autocomplete: "current-password", required: true }),
      h("input", { name: "password", type: "password", placeholder: "New password (at least 8 characters)", minlength: 8, autocomplete: "new-password", required: true }), h("button", { cls: "sbtn dark" }, "Change password"), pm);
    pf.onsubmit = async e => { e.preventDefault(); try { await api("/api/s/password", { body: { old: pf.old.value, password: pf.password.value } }); pf.reset(); say(pm, "Password changed. Other phones were logged out.", true); } catch (err) { say(pm, err.message); } };
    const dmsg = msgBox();
    const df = h("form", {}, h("p", { cls: "muted", text: "This removes your profile, posts, comments, likes, photos and the messages you sent. It cannot be undone." }),
      h("input", { name: "password", type: "password", placeholder: "Your password", autocomplete: "current-password", required: true }), h("button", { cls: "sbtn" }, "Delete my account"), dmsg);
    df.onsubmit = async e => {
      e.preventDefault(); if (!confirm("Delete your account and everything in it forever?")) return;
      try { await api("/api/s/delete-account", { body: { password: df.password.value } }); setToken(""); me = null; badges(); go("#/"); } catch (err) { say(dmsg, err.message); }
    };
    const out = h("button", { cls: "sbtn" }, "Log out");
    out.onclick = async () => { await api("/api/s/logout", { body: {} }).catch(() => {}); setToken(""); me = null; badges(); go("#/"); };
    const invite = location.origin + "/community?ref=" + me.username;
    const inv = h("div", { cls: "card" }, h("label", { text: "Invite friends" }), h("p", { cls: "muted", text: "Share your own link. People who join with it are counted as invited by you." }),
      h("p", { cls: "code", style: "font-size:15px", text: invite }),
      h("button", { cls: "sbtn main", onclick: () => navigator.share ? navigator.share({ title: "Join me on Q India Community", url: invite }).catch(() => {}) : window.open("https://wa.me/?text=" + encodeURIComponent("Join me on Q India Community: " + invite), "_blank", "noopener") }, "Share my invite link"));
    show(h("h1", { text: "Settings" }), inv,
      h("div", { cls: "card" }, h("label", { text: "Who can message me" }), dm, dmMsg),
      h("div", { cls: "card" }, h("label", { text: "Password" }), pf),
      h("div", { cls: "card" }, h("p", {}, "Logged in as ", h("b", { text: "@" + me.username })), out),
      h("div", { cls: "card" }, h("label", { text: "Delete account" }), df));
  }

  // ---------- private messages ----------
  async function chatsPage() {
    if (!me) return needLogin("Please log in to see your messages.");
    let d; try { d = await api("/api/s/chats"); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    show(h("h1", { text: "Messages" }),
      h("p", { cls: "muted", text: "Private chats between two people. To start one, open someone's profile and tap Message." }),
      h("div", { cls: "list" }, d.chats.length ? d.chats.map(c => h("a", { cls: "li" + (c.unread ? " unread" : ""), href: "#/chat/" + c.user.username }, avatar(c.user),
        h("span", { cls: "grow" }, h("span", { cls: "row" }, h("b", { cls: "grow", text: c.user.name }), c.request && h("span", { cls: "tag", text: "Request" }), h("small", { cls: "muted", text: ago(c.at) })), h("div", { cls: "last", text: (c.lastMine ? "You: " : "") + c.last })),
        c.unread && h("span", { cls: "dot" }))) : h("div", { cls: "empty" }, h("p", { text: "No messages yet." }), h("a", { cls: "sbtn", href: "#/search" }, "Find people"))));
  }
  async function chatPage(username) {
    if (!me) return needLogin("Please log in to send messages.");
    let d; try { d = await api("/api/s/chats/" + encodeURIComponent(username)); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const u = d.user, box = h("div", { cls: "msgs" });
    let lastId = 0, lastDay = "";
    const add = m => {
      const day = new Date(m.at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      if (day !== lastDay) { box.append(h("div", { cls: "day", text: day })); lastDay = day; }
      const b = h("div", { cls: "bubble" + (m.mine ? " me" : "") }, m.photo && h("img", { src: m.photo, alt: "Photo", loading: "lazy" }), m.text, h("small", { text: clock(m.at) }));
      b.oncontextmenu = e => { e.preventDefault(); };
      const opts = m.mine ? [["Delete for both", async () => { try { await api(`/api/s/messages/${m.id}/delete`, { body: {} }); b.remove(); } catch (er) { alertNote(er.message); } }]] : [["Report message", () => report("message", m.id)]];
      let press = null;
      b.onpointerdown = () => { press = setTimeout(() => { const mm = menu(null, opts); b.append(mm); mm.querySelector("button").click(); }, 600); };
      b.onpointerup = b.onpointerleave = () => clearTimeout(press);
      b.ondblclick = () => { const mm = menu(null, opts); b.append(mm); mm.querySelector("button").click(); };
      box.append(b); lastId = Math.max(lastId, m.id);
    };
    d.messages.forEach(add);
    const m = msgBox();
    const ta = h("textarea", { name: "text", rows: 1, maxlength: 2000, placeholder: "Message", "aria-label": "Message" });
    let sending = false;
    const send = async (text, photo) => {
      if (sending) return; sending = true;
      try { await api("/api/s/chats/" + encodeURIComponent(u.username), { body: { text, photo } }); say(m, "", true); await poll(); }
      catch (e) { say(m, e.message); } finally { sending = false; }
    };
    const f = h("form", {}, photoPicker(async fl => { say(m, "Sending photo…", true); try { const id = await uploadPhoto(fl); await send("", id); } catch (e) { say(m, e.message); } }, "📷"), ta, h("button", { cls: "btn", "aria-label": "Send" }, "➤"));
    f.onsubmit = e => { e.preventDefault(); const t = ta.value.trim(); if (!t) return; ta.value = ""; send(t); };
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); f.requestSubmit(); } };
    const head = h("div", { cls: "head" }, h("a", { href: "#/chats", cls: "sbtn", "aria-label": "Back" }, "←"), whoLink(u, u.last_seen && Date.now() - u.last_seen < 15 * 60_000 ? "active now" : u.last_seen ? "active " + ago(u.last_seen) + (Date.now() - u.last_seen < 7 * 86400_000 ? " ago" : "") : ""));
    menu(head, [["Report @" + u.username, () => report("user", u.username)], ["Block @" + u.username, async () => { if (!confirm("Block @" + u.username + "?")) return; await api(`/api/s/users/${u.username}/block`, { body: {} }).catch(() => {}); go("#/chats"); }]]);
    const notes = h("div");
    const setCannot = why => notes.replaceChildren(...(why ? [h("p", { cls: "note", text: why })] : []));
    setCannot(d.cannot);
    show(h("div", { cls: "chat" }, head, notes, box, f, m), h("p", { cls: "muted", text: "Messages are private between you two and are kept on the Qindia server. The site owner sees a message only if one of you reports it. Do not share passwords, OTPs or bank details." }));
    box.scrollTop = box.scrollHeight;
    async function poll() {
      const r = await api(`/api/s/chats/${encodeURIComponent(u.username)}?after=${lastId}`).catch(() => null);
      if (!r || !view.contains(box)) return;
      const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      r.messages.forEach(add); setCannot(r.cannot);
      if (r.messages.length && (near || r.messages.some(x => x.mine))) box.scrollTop = box.scrollHeight;
    }
    timer = setInterval(() => { if (!document.hidden) poll(); }, 3000);
  }

  // ---------- badges (unread messages and alerts) ----------
  async function loadMe() {
    if (!tok) { me = null; return; }
    try { me = await api("/api/s/me"); } catch (e) { if (e.status === 401 || e.status === 403) { me = null; setToken(""); } }
    paintBadges();
  }
  function paintBadges() {
    const set = (id, n) => { const b = document.getElementById(id); b.hidden = !n; b.textContent = n > 99 ? "99+" : n || ""; };
    set("bChats", me ? me.messages : 0); set("bNotifs", me ? me.notifs : 0);
  }
  const badges = () => (tok ? loadMe() : paintBadges());
  setInterval(() => { if (!document.hidden && tok) loadMe(); }, 30000);

  // ---------- screens ----------
  async function route() {
    clearInterval(timer); timer = null;
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const [a, b, c] = parts;
    const nav = { "": "home", following: "home", all: "home", search: "search", new: "new", chats: "chats", chat: "chats", notifs: "notifs", me: "me", login: "me", signup: "me", recover: "me" }[a || ""] || (a === "u" && me && b === me.username ? "me" : "");
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("on", x.dataset.nav === nav));
    window.scrollTo(0, 0);
    switch (a || "") {
      case "": case "following": case "all": return feedPage(a);
      case "login": return me ? go("#/") : loginPage();
      case "signup": return me ? go("#/") : signupPage();
      case "recover": return recoverPage();
      case "new": return me ? show(composer(p => go("#/p/" + p.id))) : needLogin();
      case "p": return postPage(Number(b));
      case "u": return profilePage(b, c === "followers" || c === "following" ? c : null);
      case "search": return searchPage();
      case "notifs": return notifsPage();
      case "chats": return chatsPage();
      case "chat": return chatPage(b);
      case "me": return !me ? needLogin() : b === "edit" ? editPage() : b === "settings" ? settingsPage() : go("#/u/" + me.username);
      default: return feedPage();
    }
  }
  window.addEventListener("hashchange", route);
  loadMe().then(route);
})();

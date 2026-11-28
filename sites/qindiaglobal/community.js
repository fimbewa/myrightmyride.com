// Q India Community: the page at qindiaglobal.com/community. One page; the part after # picks the screen:
// #/ feed · #/new · #/p/<id> post · #/u/<username> profile · #/search · #/chats · #/chat/<username> · #/notifs · #/me · #/login · #/signup · #/recover
// #/watch · #/watch/popular · #/watch/subs · #/watch/u/<username> · #/watch/pg/<handle> · #/v/<id> (Watch) · #/pages · #/pages/new · #/pg/<handle> · #/pg/<handle>/edit (Pages) · #/share/<post id> · #/reels (short videos) · #/status/new · #/status/<username> (Status / Stories) · #/groups · #/g/new · #/g/<id> · #/g/<id>/info · #/join/<code> (group chats)
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
  const show = (...nodes) => { view.replaceChildren(...nodes.filter(n => n != null && n !== false && n !== "")); };
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
  // A page asked for login first (for example a group invite link): go back there afterwards.
  const afterLogin = dflt => { let x = ""; try { x = sessionStorage.getItem("qi_after_login") || ""; sessionStorage.removeItem("qi_after_login"); } catch {} return x || dflt; };
  const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min"; if (s < 86400) return Math.floor(s / 3600) + " h";
    if (s < 7 * 86400) return Math.floor(s / 86400) + " d";
    return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  const clock = ms => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const avatar = (u, cls = "") => u.avatar ? h("img", { cls: "av " + cls, src: u.avatar, alt: "" }) : h("span", { cls: "av " + cls, "aria-hidden": "true", text: [...(u.name || u.username || "?")][0] });
  // A person (#/u/<username>) or a Page (#/pg/<handle>).
  const whoLink = (u, sub) => h("a", { cls: "row who grow", href: (u.page ? "#/pg/" : "#/u/") + u.username }, avatar(u), h("span", { cls: "grow" }, h("b", { text: u.name }), h("small", { text: (u.page ? "Page · @" : "@") + u.username + (sub ? " · " + sub : "") })));
  // Text with clickable web links (the text itself is never treated as HTML).
  function richText(text) {
    const out = [], rx = /https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g; let last = 0, m;
    while ((m = rx.exec(text))) { out.push(text.slice(last, m.index)); out.push(h("a", { href: m[0], target: "_blank", rel: "noopener nofollow ugc", text: m[0] })); last = m.index + m[0].length; }
    out.push(text.slice(last)); return out;
  }
  // YouTube links play right in the post (youtube-nocookie.com); every other link opens in a new tab. No file is kept on our server.
  const ytFrame = (id, cls = "pic yt") => h("div", { cls }, h("iframe", { src: "https://www.youtube-nocookie.com/embed/" + id, title: "YouTube video", loading: "lazy",
    allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin" }));
  const ytThumb = id => "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  const msgBox = () => h("p", { cls: "msg" });
  // ✨ Writing help (write-help.js): ideas, tidy-up, translate and hashtags. Free: on-device AI where the browser has it, simple helpers everywhere else.
  const writeHelp = (ta, kind, max) => { try { return window.QI_WRITE ? QI_WRITE.panel(ta, { kind, max }) : null; } catch { return null; } };
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
  // The Community is text only for now (the server says so in /api/s/me): no photo, video or voice buttons.
  const mediaOn = () => !!(me && me.media);
  function photoPicker(onPick, label = "📷 Photo") {
    if (!mediaOn()) return null;
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
  // "Continue with Google / Facebook" buttons, shown only for the ones the owner switched on.
  let oauthOn = null;
  function socialButtons() {
    const box = h("div", { cls: "social" });
    (oauthOn || (oauthOn = api("/api/s/oauth").catch(() => ({})))).then(on => {
      const ref = savedRef(), q = ref ? "?ref=" + encodeURIComponent(ref) : "";
      const btns = [["google", "Continue with Google", "G"], ["facebook", "Continue with Facebook", "f"]].filter(([p]) => on[p])
        .map(([p, label, icon]) => h("a", { cls: "sbtn social-" + p, href: "/auth/" + p + "/start" + q }, h("b", { "aria-hidden": "true", text: icon }), label));
      if (btns.length) box.append(...btns, h("p", { cls: "or", text: "or with a username" }));
    });
    return box;
  }
  function oauthError(why) {
    const TXT = { cancel: "Sign-in was cancelled.", expired: "The sign-in took too long or was opened in another browser. Please try again.", failed: "Google or Facebook did not confirm the sign-in. Please try again, or use a username and password.",
      off: "This sign-in option is not switched on yet. Please use a username and password.", banned: "This account has been stopped by the site owner for breaking the rules.", busy: "Too many tries. Please wait a little." };
    loginPage(); alertNote(TXT[why] || TXT.failed);
  }
  async function oauthPage(code) {
    let d; try { d = await api("/api/s/oauth/claim", { body: { code }, noLogout: true }); } catch (e) { loginPage(); return alertNote(e.message); }
    if (d.token) { setToken(d.token); await loadMe(); return go(afterLogin("#/")); }
    const m = msgBox();
    const f = h("form", { cls: "card" },
      h("h1", { text: "Almost done" }),
      h("p", { cls: "muted", text: "You signed in with " + d.pending.provider + ". Choose how your name and username appear on Q India Community." }),
      h("div", {}, h("label", { for: "on", text: "Your name" }), h("input", { id: "on", name: "name", maxlength: 50, value: d.pending.name, required: true })),
      h("div", {}, h("label", { for: "ou", text: "Username" }), h("input", { id: "ou", name: "username", maxlength: 20, value: d.pending.username, autocapitalize: "none", required: true }),
        h("small", { cls: "muted", text: "3 to 20 small English letters, numbers, _ or ." })),
      h("div", {}, h("label", { for: "oc", text: "City (optional)" }), h("input", { id: "oc", name: "city", maxlength: 60 })),
      h("label", { cls: "tick" }, h("input", { type: "checkbox", name: "agree", required: true }), h("span", {}, "I am 18 or older. I agree to the ", h("a", { href: "/legal/terms", target: "_blank" }, "Terms of Use"), " and ", h("a", { href: "/legal/community-guidelines", target: "_blank" }, "Community Guidelines"), ", and I consent to Qindiaglobal using my details as the ", h("a", { href: "/legal/privacy", target: "_blank" }, "Privacy Policy"), " explains.")),
      h("p", { cls: "muted", style: "font-size:13px;margin:0", text: "From " + d.pending.provider + " we receive only your name and an account number, nothing else. We never post on your " + d.pending.provider + "." }),
      h("button", { cls: "btn" }, "Join"), m);
    f.username.oninput = () => { f.username.value = f.username.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""); };
    f.onsubmit = async e => {
      e.preventDefault(); say(m, "Please wait…", true);
      try {
        const r = await api("/api/s/oauth/finish", { body: { code, name: f.name.value, username: f.username.value, city: f.city.value, agree: f.agree.checked, ref: savedRef() }, noLogout: true });
        try { localStorage.removeItem("qi_s_ref"); } catch {}
        setToken(r.token); await loadMe(); go("#/me/edit");
      } catch (err) { say(m, err.message); }
    };
    show(f);
  }
  function loginPage() {
    const m = msgBox();
    const f = h("form", { cls: "card" },
      h("h1", { text: "Log in" }), socialButtons(),
      h("div", {}, h("label", { for: "lu", text: "Username" }), h("input", { id: "lu", name: "username", autocomplete: "username", autocapitalize: "none", required: true })),
      h("div", {}, h("label", { for: "lp", text: "Password" }), h("input", { id: "lp", name: "password", type: "password", autocomplete: "current-password", required: true })),
      h("button", { cls: "btn" }, "Log in"), m,
      h("p", { cls: "muted" }, "New here? ", h("a", { href: "#/signup" }, "Create a free account"), " · ", h("a", { href: "#/recover" }, "Forgot password?")));
    f.onsubmit = async e => {
      e.preventDefault(); say(m, "Please wait…", true);
      try { const d = await api("/api/s/login", { body: { username: f.username.value, password: f.password.value }, noLogout: true }); setToken(d.token); await loadMe(); go(afterLogin("#/")); }
      catch (err) { say(m, err.message); }
    };
    show(f);
  }
  function signupPage() {
    newTicket();
    const m = msgBox();
    const f = h("form", { cls: "card" },
      h("h1", { text: "Create your free account" }), socialButtons(),
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
        setToken(d.token); await loadMe(); showRecovery(d.recovery, () => go(afterLogin("#/me/edit")));
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
    // Share: on Q India Community (to my followers) or outside (WhatsApp and other apps).
    const share = h("button", { type: "button" }, "↗ Share");
    const outside = () => {
      const text = (p.text || "A post on Q India Community").slice(0, 100);
      if (navigator.share) return navigator.share({ title: "Q India Community", text, url: link }).catch(() => {});
      window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + link), "_blank", "noopener");
    };
    share.onclick = e => {
      e.stopPropagation();
      if (p.status !== "ok") return outside();
      const m = h("div", { cls: "more-menu share-menu" },
        h("button", { type: "button", onclick: () => { m.remove(); me ? go("#/share/" + (p.shared && p.shared.id ? p.shared.id : p.id)) : needLogin("Please log in to share posts."); } }, "🔁 Share on Q India Community"),
        h("button", { type: "button", onclick: () => { m.remove(); outside(); } }, "📤 Share on WhatsApp or other apps"));
      share.parentNode.style.position = "relative"; share.parentNode.append(m);
      setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }));
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
      p.video && videoEl(p.video, { cls: "pic vid", poster: p.poster || null }),
      p.video && p.status === "ok" && h("a", { cls: "watchlink", href: "#/v/" + p.id }, "▶ Open in Watch" + (p.duration ? " · " + dur(p.duration) : "") + " · " + views(p.views)),
      !p.video && p.yt && ytFrame(p.yt),
      !p.video && p.yt && p.status === "ok" && h("a", { cls: "watchlink", href: "#/v/" + p.id }, "▶ Open in Watch · " + views(p.views)),
      p.shared && sharedBox(p.shared),
      h("div", { cls: "acts" }, likeBtn, full ? h("span", { cls: "muted", style: "flex:1;text-align:center;padding:8px", text: "💬 " + p.comments }) : h("a", { href: "#/p/" + p.id }, "💬 " + (p.comments || "") + " Comment"), share));
    return card;
  }
  // The original post inside a share.
  function sharedBox(o) {
    if (o.gone) return h("p", { cls: "shared muted", text: "This post is no longer available." });
    return h("a", { cls: "shared", href: "#/p/" + o.id }, h("div", { cls: "row" }, avatar(o.user, "sm"), h("span", { cls: "grow" }, h("b", { text: o.user.name }), " ", h("small", { cls: "muted", text: ago(o.created_at) }))),
      o.text && h("div", { cls: "tx" }, [...o.text].length > 300 ? [...o.text].slice(0, 300).join("") + "…" : o.text),
      o.photo && h("img", { src: o.photo, alt: "", loading: "lazy" }), o.video && h("video", { src: o.video + "#t=0.1", preload: "metadata", muted: true, playsinline: true }));
  }
  async function sharePage(id) {
    if (!me) return needLogin("Please log in to share posts.");
    let d; try { d = await api("/api/s/posts/" + id); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const pages = (await api("/api/s/pages").catch(() => ({ mine: [] }))).mine.filter(x => !x.closed);
    const m = msgBox();
    const as = pages.length ? h("select", { name: "as", "aria-label": "Share as" }, h("option", { value: "" }, "Share as me (" + me.name + ")"), pages.map(x => h("option", { value: x.handle }, "Share as Page: " + x.name))) : null;
    const f = h("form", { cls: "card compose" }, h("h1", { text: "Share this post" }),
      h("textarea", { name: "text", maxlength: 5000, placeholder: "Say something about this (optional)" }), sharedBox(d.post), as, h("button", { cls: "btn" }, "Share"), m);
    f.onsubmit = async e => {
      e.preventDefault(); say(m, "Sharing…", true);
      try { const r = await api("/api/s/posts", { body: { text: f.text.value, share: d.post.id, page: as && as.value || undefined } }); go("#/p/" + r.post.id); } catch (err) { say(m, err.message); }
    };
    show(f);
  }
  function composer(after, page) {
    const m = msgBox(); let photo = null, file = null, video = null, poster = null, vlen = 0;
    const prev = h("div", { cls: "prev", hidden: true });
    const ta = h("textarea", { name: "text", maxlength: 5000, placeholder: mediaOn() ? "What's happening? Share a good queue you saw, a tip, or a photo." : "What's happening? Share a good queue you saw, a tip, or paste a link (YouTube, Instagram, news…)." });
    const help = writeHelp(ta, "post", 5000);
    const f = h("form", { cls: "card compose" },
      h("div", { cls: "row" }, page ? avatar(page, "sm") : me && avatar(me, "sm"), h("b", { text: page ? "Post as " + page.name : "Share with the community" })),
      ta, help, prev,
      h("div", { cls: "row" }, photoPicker(async fl => {
        file = fl; photo = null; video = null; prev.hidden = false; prev.replaceChildren(h("p", { cls: "muted", text: "Preparing photo…" }));
        try {
          photo = await uploadPhoto(fl);
          if (file !== fl) return;
          const rm = h("button", { type: "button", cls: "sbtn" }, "✕ Remove"); rm.onclick = () => { photo = null; file = null; prev.hidden = true; prev.replaceChildren(); };
          prev.replaceChildren(h("img", { src: URL.createObjectURL(fl), alt: "" }), rm);
        } catch (e) { prev.replaceChildren(h("p", { cls: "msg bad", text: e.message })); photo = null; }
      }), videoPicker(async fl => {
        file = fl; photo = null; video = null; prev.hidden = false;
        const status = h("p", { cls: "muted", text: "Checking the video…" }); prev.replaceChildren(status);
        try {
          vlen = await checkVideo(fl);
          const pb = await posterOf(fl);
          poster = pb ? await api("/api/s/upload", { method: "POST", raw: pb }).then(r => r.id).catch(() => null) : null;
          const id = await uploadAV(fl, "video", pc => { status.textContent = "Uploading video… " + pc + "%"; }, vlen > VIDEO_MAX_S + 1);
          if (file !== fl) return;
          video = id;
          const rm = h("button", { type: "button", cls: "sbtn" }, "✕ Remove"); rm.onclick = () => { video = null; file = null; prev.hidden = true; prev.replaceChildren(); };
          prev.replaceChildren(h("video", { src: URL.createObjectURL(fl), controls: true, playsinline: true, muted: true, style: "max-width:100%;max-height:300px;border-radius:12px;display:block" }), rm);
        } catch (e) { prev.replaceChildren(h("p", { cls: "msg bad", text: e.message })); video = null; }
      }), h("span", { cls: "grow" }), h("button", { cls: "btn" }, "Post")), m);
    f.onsubmit = async e => {
      e.preventDefault();
      if (file && !photo && !video) return say(m, "Please wait until the photo or video is ready.");
      say(m, "Posting…", true);
      try {
        const d = await api("/api/s/posts", { body: { text: f.text.value, photo, video, poster: video ? poster : undefined, duration: video ? vlen : undefined, page: page ? page.handle : undefined } });
        f.reset(); photo = null; file = null; video = null; prev.hidden = true; prev.replaceChildren();
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
    const tabs = me && h("div", { cls: "tabs" }, h("a", { href: "#/following", cls: tab === "following" ? "on" : "" }, "Following"), h("a", { href: "#/all", cls: tab === "all" ? "on" : "" }, "Everyone"), h("a", { href: "#/pages" }, "Pages"));
    const top = me ? composer(p => list.prepend(postCard(p))) : h("div", { cls: "card" }, h("h1", { text: "Q India Community" }),
      h("p", { text: "Share posts and photos, follow people, and message friends privately. Free for everyone, always." }),
      h("p", {}, h("a", { cls: "btn", href: "#/signup" }, "Create free account"), " ", h("a", { cls: "sbtn", href: "#/login" }, "Log in")));
    show(rulesNote(), me && storyBar(), top, tabs, list);
    await loadMore(list, b => `/api/s/feed?tab=${tab}&before=${b}`, d => d.posts.map(p => postCard(p)),
      tab === "following" ? h("div", { cls: "empty" }, h("p", { text: "Nothing here yet. Follow people to see their posts, or look at everyone's posts." }), h("a", { cls: "sbtn", href: "#/all" }, "See everyone"), " ", h("a", { cls: "sbtn", href: "#/search" }, "Find people"))
        : h("p", { cls: "empty", text: "No posts yet. Be the first to share something!" }));
    feedAd(list);
  }
  // One ad box in the feed, after the third post (always marked "Ad"; filled by /ads.js, hidden when there is no ad).
  function feedAd(list) {
    const posts = list.querySelectorAll("article.post");
    if (posts.length < 3 || list.querySelector(".qi-ad")) return;
    posts[2].after(h("div", { cls: "qi-ad", "data-slot": "feed" }));
    document.body.append(h("script", { src: "/ads.js" })); // ads.js looks for ad boxes each time it runs
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
    if (mediaOn()) btns.append(h("a", { cls: "sbtn", href: "#/watch/u/" + u.username }, "▶ Videos"));
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
    const TXT = { like: "liked your post", comment: "commented on your post", follow: "started following you", share: "shared your post" };
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
    const pf = h("form", {}, !me.hasPassword && h("p", { cls: "muted", text: "You joined with Google or Facebook. Set a password if you also want to log in with your username." }),
      me.hasPassword && h("input", { name: "old", type: "password", placeholder: "Current password", autocomplete: "current-password", required: true }),
      h("input", { name: "password", type: "password", placeholder: "New password (at least 8 characters)", minlength: 8, autocomplete: "new-password", required: true }), h("button", { cls: "sbtn dark" }, "Change password"), pm);
    pf.onsubmit = async e => { e.preventDefault(); try { await api("/api/s/password", { body: { old: pf.old ? pf.old.value : "", password: pf.password.value } }); await loadMe(); pf.reset(); say(pm, "Password changed. Other phones were logged out.", true); } catch (err) { say(pm, err.message); } };
    const dmsg = msgBox();
    const df = h("form", {}, h("p", { cls: "muted", text: "This removes your profile, posts, comments, likes, photos and the messages you sent. It cannot be undone." }),
      me.hasPassword ? h("input", { name: "password", type: "password", placeholder: "Your password", autocomplete: "current-password", required: true })
        : h("input", { name: "confirm", placeholder: "Type your username (" + me.username + ") to confirm", autocapitalize: "none", required: true }),
      h("button", { cls: "sbtn" }, "Delete my account"), dmsg);
    df.onsubmit = async e => {
      e.preventDefault(); if (!confirm("Delete your account and everything in it forever?")) return;
      try { await api("/api/s/delete-account", { body: { password: df.password ? df.password.value : "", confirm: df.confirm ? df.confirm.value : "" } }); setToken(""); me = null; badges(); go("#/"); } catch (err) { say(dmsg, err.message); }
    };
    const out = h("button", { cls: "sbtn" }, "Log out");
    out.onclick = async () => { await api("/api/s/logout", { body: {} }).catch(() => {}); setToken(""); me = null; badges(); go("#/"); };
    const invite = location.origin + "/community?ref=" + me.username;
    const inv = h("div", { cls: "card" }, h("label", { text: "Invite friends" }), h("p", { cls: "muted", text: "Share your own link and invite friends and family to join the queue movement." }),
      h("p", { cls: "muted" }, "Every friend you bring is one more person who queues with dignity, and inspires others to do the same. Inviting is voluntary; Qindiaglobal pays no fee, reward or commission for invitations. ", h("a", { href: "/legal/referral" }, "Why inviting matters")),
      h("p", { cls: "code", style: "font-size:15px", text: invite }),
      h("button", { cls: "sbtn main", onclick: () => navigator.share ? navigator.share({ title: "Join me on Q India Community", url: invite }).catch(() => {}) : window.open("https://wa.me/?text=" + encodeURIComponent("Join me on Q India Community: " + invite), "_blank", "noopener") }, "Share my invite link"));
    show(h("h1", { text: "Settings" }), inv,
      h("div", { cls: "card" }, h("label", { text: "Who can message me" }), dm, dmMsg),
      h("div", { cls: "card" }, h("label", { text: "Password" }), pf),
      (me.linked || []).length > 0 && h("div", { cls: "card" }, h("label", { text: "Signed in with" }), ...(me.linked || []).map(p => {
        const b = h("button", { cls: "sbtn" }, "Remove");
        b.onclick = async () => { try { await api("/api/s/oauth/unlink", { body: { provider: p } }); settingsPage(); } catch (e) { alertNote(e.message); } };
        return h("p", { cls: "row" }, h("b", { cls: "grow", text: p === "google" ? "Google" : "Facebook" }), b);
      })),
      h("div", { cls: "card" }, h("p", {}, "Logged in as ", h("b", { text: "@" + me.username })), out),
      h("div", { cls: "card" }, h("label", { text: "Delete account" }), df));
  }

  // ---------- private messages ----------
  async function chatsPage() {
    if (!me) return needLogin("Please log in to see your messages.");
    let d; try { d = await api("/api/s/chats"); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    show(h("h1", { text: "Messages" }), chatTabs("chats"),
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
      const b = h("div", { cls: "bubble" + (m.mine ? " me" : "") }, m.photo && h("img", { src: m.photo, alt: "Photo", loading: "lazy" }), m.audio && h("audio", { src: m.audio, controls: true, preload: "none" }), m.text && richText(m.text), h("small", { text: clock(m.at) }));
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
    const send = async (text, photo, audio) => {
      if (sending) return; sending = true;
      try { await api("/api/s/chats/" + encodeURIComponent(u.username), { body: { text, photo, audio } }); say(m, "", true); await poll(); }
      catch (e) { say(m, e.message); } finally { sending = false; }
    };
    const voice = voiceButton(async blob => { say(m, "Sending voice message…", true); try { const id = await uploadAV(blob, "audio"); await send("", null, id); } catch (e) { say(m, e.message); } }, t => say(m, t));
    const f = h("form", {}, photoPicker(async fl => { say(m, "Sending photo…", true); try { const id = await uploadPhoto(fl); await send("", id); } catch (e) { say(m, e.message); } }, "📷"), voice, ta, h("button", { cls: "btn", "aria-label": "Send" }, "➤"));
    f.onsubmit = e => { e.preventDefault(); const t = ta.value.trim(); if (!t) return; ta.value = ""; send(t); };
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); f.requestSubmit(); } };
    const head = h("div", { cls: "head" }, h("a", { href: "#/chats", cls: "sbtn", "aria-label": "Back" }, "←"), whoLink(u, u.last_seen && Date.now() - u.last_seen < 15 * 60_000 ? "active now" : u.last_seen ? "active " + ago(u.last_seen) + (Date.now() - u.last_seen < 7 * 86400_000 ? " ago" : "") : ""));
    head.append(h("button", { type: "button", cls: "sbtn callbtn", "aria-label": "Voice call", title: "Voice call", onclick: () => startCall(u, "audio") }, "📞"),
      h("button", { type: "button", cls: "sbtn callbtn", "aria-label": "Video call", title: "Video call", onclick: () => startCall(u, "video") }, "📹"));
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

  // ---------- Pages (like Facebook Pages) ----------
  const pageRow = pg => h("a", { cls: "li", href: "#/pg/" + pg.handle }, avatar(pg), h("span", { cls: "grow" }, h("b", { text: pg.name }), h("div", { cls: "last", text: (pg.category || "Page") + " · " + pg.followers + " follower" + (pg.followers === 1 ? "" : "s") })), pg.closed && h("span", { cls: "tag", text: "Closed" }));
  async function pagesPage() {
    if (!me) return needLogin("Please log in to see Pages.");
    let d; try { d = await api("/api/s/pages"); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const q = h("input", { type: "search", placeholder: "Search Pages", autocapitalize: "none" });
    const disc = h("div", { cls: "list" });
    const paint = list => disc.replaceChildren(...(list.length ? list.map(pageRow) : [h("p", { cls: "muted", text: "No Pages found." })]));
    paint(d.discover);
    let t = null; q.oninput = () => { clearTimeout(t); t = setTimeout(async () => paint((await api("/api/s/pages?q=" + encodeURIComponent(q.value)).catch(() => d)).discover), 300); };
    show(h("div", { cls: "row", style: "margin:14px 0 4px" }, h("h1", { cls: "grow", style: "margin:0", text: "Pages" }), h("a", { cls: "sbtn main", href: "#/pages/new" }, "＋ Create a Page")),
      h("p", { cls: "muted", text: "Pages are for a station, a route, a cause, volunteers or an organisation. Follow a Page to see its posts in your Following feed." }),
      d.mine.length > 0 && h("h2", { text: "My Pages" }), d.mine.length > 0 && h("div", { cls: "list" }, d.mine.map(pageRow)),
      d.following.length > 0 && h("h2", { text: "Pages I follow" }), d.following.length > 0 && h("div", { cls: "list" }, d.following.map(pageRow)),
      h("h2", { text: "Discover Pages" }), q, disc);
  }
  async function pageForm(handle) {
    if (!me) return needLogin();
    let pg = null, cats = [];
    try { const d = await api("/api/s/pages"); cats = d.categories; if (handle) pg = d.mine.find(x => x.handle === handle); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    if (handle && !pg) return show(h("p", { cls: "empty", text: "Only the Page's owner can change it." }));
    const m = msgBox(), pics = {};
    const picBtn = (k, label, max) => photoPicker(async fl => { say(m, "Preparing photo…", true); try { pics[k] = await uploadPhoto(fl, max); say(m, "Photo ready. Tap Save.", true); } catch (e) { say(m, e.message); } }, label);
    const f = h("form", { cls: "card" }, h("h1", { text: pg ? "Edit Page" : "Create a Page" }),
      h("div", {}, h("label", { for: "pn", text: "Page name" }), h("input", { id: "pn", name: "name", maxlength: 60, value: pg ? pg.name : "", placeholder: "for example Dadar Queue Volunteers", required: true })),
      !pg && h("div", {}, h("label", { for: "ph", text: "Page address" }), h("input", { id: "ph", name: "handle", maxlength: 30, autocapitalize: "none", placeholder: "for example dadar_queue", required: true }),
        h("small", { cls: "muted", text: "3 to 30 small English letters, numbers, _ or . It cannot be changed later." })),
      h("div", {}, h("label", { for: "pc", text: "Category" }), h("select", { id: "pc", name: "category" }, cats.map(c => h("option", { value: c }, c)))),
      h("div", {}, h("label", { for: "pa", text: "About (optional)" }), h("textarea", { id: "pa", name: "about", maxlength: 1000, rows: 3 })),
      h("div", { cls: "row", style: "flex-wrap:wrap" }, picBtn("avatar", "📷 Page photo", 512), picBtn("cover", "🖼 Cover photo", 1600)),
      h("button", { cls: "btn" }, pg ? "Save" : "Create Page"), m);
    if (pg) { f.category.value = pg.category; f.about.value = pg.about; } else f.handle.oninput = () => { f.handle.value = f.handle.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""); };
    f.onsubmit = async e => {
      e.preventDefault(); say(m, "Please wait…", true);
      const body = { name: f.name.value, category: f.category.value, about: f.about.value, ...pics };
      try { if (pg) { await api("/api/s/pages/" + pg.handle, { body }); go("#/pg/" + pg.handle); } else { const r = await api("/api/s/pages", { body: { ...body, handle: f.handle.value } }); go("#/pg/" + r.handle); } }
      catch (err) { say(m, err.message); }
    };
    const parts = [f];
    if (pg) {
      const del = h("button", { cls: "sbtn", type: "button" }, "Delete this Page");
      del.onclick = async () => { if (!confirm("Delete the Page " + pg.name + " and all its posts forever?")) return; try { await api("/api/s/pages/" + pg.handle, { body: { delete: true } }); go("#/pages"); } catch (e) { alertNote(e.message); } };
      parts.push(h("div", { cls: "card" }, h("label", { text: "Delete Page" }), h("p", { cls: "muted", text: "This removes the Page and all its posts. It cannot be undone." }), del));
    }
    show(...parts);
  }
  async function pageView(handle) {
    if (!me) { try { sessionStorage.setItem("qi_after_login", "#/pg/" + handle); } catch {} return needLogin("Please log in or create a free account to see this Page."); }
    let d; try { d = await api("/api/s/pages/" + encodeURIComponent(handle)); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const pg = d.page, btns = h("div", { cls: "btns" });
    if (pg.mine) btns.append(h("a", { cls: "sbtn dark", href: `#/pg/${pg.handle}/edit` }, "Edit Page"));
    else {
      const fb = h("button", { cls: "sbtn " + (pg.following ? "" : "main") }, pg.following ? "Following ✓" : "Follow");
      fb.onclick = async () => { try { await api(`/api/s/pages/${pg.handle}/follow`, { body: { follow: !pg.following } }); route(); } catch (e) { alertNote(e.message); } };
      btns.append(fb);
      menu(btns, [["Report Page", () => report("page", pg.id)]]);
    }
    if (mediaOn()) btns.append(h("a", { cls: "sbtn", href: "#/watch/pg/" + pg.handle }, "▶ Videos"));
    const link = location.origin + "/community#/pg/" + pg.handle;
    btns.append(h("button", { cls: "sbtn", type: "button", onclick: () => navigator.share ? navigator.share({ title: pg.name, url: link }).catch(() => {}) : window.open("https://wa.me/?text=" + encodeURIComponent(pg.name + " on Q India Community: " + link), "_blank") }, "↗ Share"));
    const head = h("div", { cls: "card prof pg" }, pg.cover ? h("img", { cls: "cover", src: pg.cover, alt: "" }) : h("div", { cls: "cover" }), avatar(pg, "big"),
      h("h1", { text: pg.name }), h("div", { cls: "muted", text: (pg.category || "Page") + " · @" + pg.handle + " · " + pg.followers + " follower" + (pg.followers === 1 ? "" : "s") }),
      pg.closed && h("p", { cls: "note", text: "The site owner closed this Page for breaking the rules. Only you can see it." }),
      pg.about && h("p", { cls: "bio" }, richText(pg.about)), btns);
    const list = h("div");
    list.append(...d.posts.map(p => postCard(p)));
    if (!d.posts.length) list.append(h("p", { cls: "empty", text: pg.mine ? "Write the Page's first post above." : "No posts yet." }));
    if (d.more) { const b = h("button", { cls: "sbtn loadmore" }, "Show more"); b.onclick = () => { b.remove(); loadMore(list, x => `/api/s/pages/${pg.handle}?before=${x}`, r => r.posts.map(p => postCard(p)), h("span"), Math.min(...d.posts.map(p => p.id))); }; list.append(b); }
    show(head, pg.mine && !pg.closed && composer(p => { list.querySelector(".empty")?.remove(); list.prepend(postCard(p)); }, pg), list);
  }

  // ---------- Watch (like YouTube): videos, channels, views ----------
  const dur = s => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, "0"); return hh ? hh + ":" + String(mm).padStart(2, "0") + ":" + ss : mm + ":" + ss; };
  const views = n => (n >= 100000 ? (n / 100000).toFixed(1).replace(/\.0$/, "") + " lakh" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n || 0)) + " view" + (n === 1 ? "" : "s");
  const titleOf = v => { const t = (v.text || "").replace(/https?:\/\/\S+/g, "").split("\n").map(x => x.trim()).find(Boolean) || ""; return t ? ([...t].length > 90 ? [...t].slice(0, 90).join("") + "…" : t) : "Video by " + v.user.name; };
  const videoTile = v => h("a", { cls: "vt", href: "#/v/" + v.id },
    h("span", { cls: "thumb" }, !v.video && v.yt ? h("img", { src: ytThumb(v.yt), alt: "", loading: "lazy" }) : v.poster ? h("img", { src: v.poster, alt: "", loading: "lazy" }) : h("video", { src: v.video + "#t=0.5", preload: "metadata", muted: true, playsinline: true }), v.duration > 0 && h("i", { text: dur(v.duration) })),
    h("span", { cls: "row", style: "align-items:flex-start" }, avatar(v.user, "sm"), h("span", { cls: "grow" }, h("b", { text: titleOf(v) }), h("small", { cls: "muted", text: v.user.name + " · " + views(v.views) + " · " + ago(v.created_at) }))));
  const watchTabs = on => h("div", { cls: "tabs" }, [mediaOn() && ["#/reels", "Reels", "reels"], ["#/watch", "Latest", "latest"], ["#/watch/popular", "Popular", "popular"], me && ["#/watch/subs", "Subscriptions", "subs"]].filter(Boolean)
    .map(([href, label, k]) => h("a", { href, cls: on === k ? "on" : "" }, label)));
  async function watchPage(a, b) {
    const sort = a === "popular" || a === "subs" ? a : "latest";
    const chan = a === "u" ? "user=" + encodeURIComponent(b) : a === "pg" ? "page=" + encodeURIComponent(b) : "";
    const grid = h("div", { cls: "vgrid" });
    const title = chan ? h("div", { cls: "row", style: "margin:14px 0 6px" }, h("a", { cls: "sbtn", href: (a === "pg" ? "#/pg/" : "#/u/") + b }, "←"), h("h1", { style: "margin:0", text: "Videos" })) : null;
    show(title || h("h1", { text: "Watch" }), !chan && watchTabs(sort), !chan && me && h("p", {}, h("a", { cls: "sbtn main", href: "#/new" }, mediaOn() ? "＋ Upload a video" : "＋ Post a YouTube link")), grid);
    let skip = 0;
    const load = async () => {
      let d; try { d = await api(`/api/s/watch?${chan || "sort=" + sort}&skip=${skip}`); } catch (e) { return grid.append(h("p", { cls: "empty", text: e.message })); }
      grid.append(...d.videos.map(videoTile)); skip = d.next;
      if (!skip) grid.append(h("p", { cls: "empty", text: sort === "subs" ? "Videos from people and Pages you follow will show here." : "No videos yet." }));
      if (d.more) { const m = h("button", { cls: "sbtn loadmore" }, "Show more"); m.onclick = () => { m.remove(); load(); }; grid.after(m); }
    };
    await load();
  }
  async function videoPage(id) {
    let d; try { d = await api("/api/s/watch/" + id); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const v = d.video, ch = d.channel;
    const player = !v.video && v.yt ? ytFrame(v.yt, "player yt") : h("video", { cls: "player", src: v.video, poster: v.poster || null, controls: true, playsinline: true, autoplay: true, preload: "metadata" });
    let counted = false;
    if (!v.video) { counted = true; api(`/api/s/watch/${v.id}/view`, { body: {} }).catch(() => {}); } // a YouTube player cannot tell us when it plays
    player.onplay = () => { if (!counted) { counted = true; api(`/api/s/watch/${v.id}/view`, { body: {} }).catch(() => {}); } };
    const sub = !ch.mine && h("button", { cls: "sbtn " + (ch.subscribed ? "" : "dark") }, ch.subscribed ? "Subscribed ✓" : "Subscribe");
    if (sub) sub.onclick = async () => {
      if (!me) return needLogin("Please log in to subscribe.");
      try { await api(ch.page ? `/api/s/pages/${ch.username}/follow` : `/api/s/users/${ch.username}/follow`, { body: { follow: !ch.subscribed } }); ch.subscribed = !ch.subscribed; ch.subscribers += ch.subscribed ? 1 : -1;
        sub.textContent = ch.subscribed ? "Subscribed ✓" : "Subscribe"; sub.className = "sbtn " + (ch.subscribed ? "" : "dark"); subs.textContent = ch.subscribers + " subscriber" + (ch.subscribers === 1 ? "" : "s"); } catch (e) { alertNote(e.message); }
    };
    const subs = h("small", { cls: "muted", text: ch.subscribers + " subscriber" + (ch.subscribers === 1 ? "" : "s") });
    const like = h("button", { type: "button", cls: "sbtn" + (v.liked ? " main" : "") }, (v.liked ? "♥ " : "♡ ") + (v.likes || "") + " Like");
    like.onclick = async () => {
      if (!me) return needLogin("Please log in to like videos.");
      try { const r = await api(`/api/s/posts/${v.id}/like`, { body: { like: !v.liked } }); v.liked = r.liked; v.likes = r.likes; like.className = "sbtn" + (v.liked ? " main" : ""); like.textContent = (v.liked ? "♥ " : "♡ ") + (v.likes || "") + " Like"; } catch (e) { alertNote(e.message); }
    };
    const link = location.origin + "/community#/v/" + v.id;
    const desc = (v.text || "").trim();
    show(h("div", { cls: "watch" }, player),
      h("h1", { cls: "vtitle", text: titleOf(v) }), h("p", { cls: "muted", style: "margin:0", text: views(v.views) + " · " + ago(v.created_at) }),
      v.status === "pending" && h("p", { cls: "note", text: "Only you can see this until the site owner checks it." }),
      h("div", { cls: "row", style: "margin:10px 0;flex-wrap:wrap" }, h("a", { cls: "row who grow", href: (ch.page ? "#/watch/pg/" : "#/watch/u/") + ch.username }, avatar(ch), h("span", { cls: "grow" }, h("b", { text: ch.name }), subs)), sub),
      h("div", { cls: "row", style: "flex-wrap:wrap" }, like, h("a", { cls: "sbtn", href: "#/p/" + v.id }, "💬 " + (v.comments || "") + " Comments"),
        h("button", { cls: "sbtn", type: "button", onclick: () => navigator.share ? navigator.share({ title: titleOf(v), url: link }).catch(() => {}) : window.open("https://wa.me/?text=" + encodeURIComponent(titleOf(v) + " " + link), "_blank") }, "↗ Share"),
        !v.mine && h("button", { cls: "sbtn", type: "button", onclick: () => report("post", v.id) }, "⚑ Report")),
      desc && h("div", { cls: "card", style: "white-space:pre-wrap" }, richText(desc)),
      d.next.length > 0 && h("h2", { text: "Up next" }), h("div", { cls: "vgrid" }, d.next.map(videoTile)));
  }
  // A cover picture for a video, taken from the video on the phone (about a third of the way in).
  function posterOf(file) {
    return new Promise(ok => {
      const v = document.createElement("video"), url = URL.createObjectURL(file);
      v.muted = true; v.playsInline = true; v.preload = "auto";
      const done = b => { URL.revokeObjectURL(url); ok(b); };
      v.onloadeddata = () => { v.currentTime = Math.min(2, (v.duration || 3) / 3); };
      v.onseeked = () => {
        try {
          const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement("canvas");
          c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); c.toBlob(done, "image/jpeg", 0.8);
        } catch { done(null); }
      };
      v.onerror = () => done(null);
      setTimeout(() => done(null), 8000);
      v.src = url;
    });
  }

  // ---------- short videos and voice messages ----------
  // Short videos (Reels) up to 90 seconds / 40 MB; longer videos (Watch) up to 10 minutes / 100 MB.
  const VIDEO_MAX_MB = 40, VIDEO_MAX_S = 90, LONG_MAX_MB = 100, LONG_MAX_S = 600, VOICE_MAX_S = 120;
  // Sends a video or voice file, showing progress (videos can take a while on mobile data).
  function uploadAV(blob, kind, onProgress, long) {
    return new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open("POST", "/api/s/upload-av?kind=" + kind + (long ? "&long=1" : ""));
      x.setRequestHeader("content-type", "application/octet-stream");
      if (tok) x.setRequestHeader("authorization", "Bearer " + tok);
      if (onProgress) x.upload.onprogress = e => e.lengthComputable && onProgress(Math.round(100 * e.loaded / e.total));
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status === 200 ? ok(d.id) : no(new Error(x.status === 413 ? "This file is too big. Please choose a shorter video (up to " + VIDEO_MAX_MB + " MB)." : d.error || "Could not send. Please try again.")); };
      x.onerror = () => no(new Error("No internet connection. Please try again."));
      x.send(blob);
    });
  }
  // Checks a video from the phone: size and length. Gives back its length in seconds.
  function checkVideo(file) {
    return new Promise((ok, no) => {
      const mb = Math.round(file.size / 1048576);
      if (file.size > LONG_MAX_MB * 1048576) return no(new Error("This video is " + mb + " MB. Please choose one up to " + LONG_MAX_MB + " MB (record in 720p or 480p to keep it small)."));
      const v = document.createElement("video"), url = URL.createObjectURL(file);
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = () => {
        const d = v.duration; URL.revokeObjectURL(url);
        if (d > LONG_MAX_S + 1) return no(new Error("This video is " + Math.round(d / 60) + " minutes long. Please choose one up to " + LONG_MAX_S / 60 + " minutes."));
        if (d <= VIDEO_MAX_S + 1 && file.size > VIDEO_MAX_MB * 1048576) return no(new Error("This short video is " + mb + " MB. Please choose one up to " + VIDEO_MAX_MB + " MB (record in 720p)."));
        ok(d);
      };
      v.onerror = () => { URL.revokeObjectURL(url); no(new Error("This video cannot be played in the browser. Please choose an MP4 video.")); };
      v.src = url;
    });
  }
  function videoPicker(onPick) {
    if (!mediaOn()) return null;
    const input = h("input", { type: "file", accept: "video/mp4,video/webm,video/quicktime,video/*", "aria-label": "Add a video" });
    input.onchange = () => { if (input.files[0]) onPick(input.files[0]); input.value = ""; };
    return h("label", { cls: "sbtn filebtn", title: "Add a short video" }, "🎬 Video", input);
  }
  const videoEl = (src, extra = {}) => h("video", { cls: "vid", src: src + "#t=0.1", controls: true, playsinline: true, preload: "metadata", ...extra });
  // 🎤 button for chats: tap to record, tap ✓ to send, ✕ to cancel. Stops by itself after 2 minutes.
  function voiceButton(onDone, onError) {
    if (!mediaOn()) return null;
    const wrap = h("span", { cls: "voice" });
    const mic = h("button", { type: "button", cls: "sbtn", "aria-label": "Record a voice message", title: "Voice message" }, "🎤");
    wrap.append(mic);
    if (!window.MediaRecorder || !navigator.mediaDevices) { mic.hidden = true; return wrap; }
    mic.onclick = async () => {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { return onError("Please allow the microphone to send a voice message."); }
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : {});
      const parts = []; let cancelled = false, secs = 0;
      const clockEl = h("b", { cls: "rec", text: "● 0:00" });
      const stopBtn = h("button", { type: "button", cls: "btn", "aria-label": "Send voice message" }, "✓");
      const cancelBtn = h("button", { type: "button", cls: "sbtn", "aria-label": "Cancel" }, "✕");
      const tick = setInterval(() => { secs++; clockEl.textContent = "● " + Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0"); if (secs >= VOICE_MAX_S) rec.stop(); }, 1000);
      rec.ondataavailable = e => e.data.size && parts.push(e.data);
      rec.onstop = () => {
        clearInterval(tick); stream.getTracks().forEach(t => t.stop()); wrap.replaceChildren(mic);
        if (!cancelled && parts.length && secs >= 1) onDone(new Blob(parts, { type: rec.mimeType || type }));
      };
      stopBtn.onclick = () => rec.stop();
      cancelBtn.onclick = () => { cancelled = true; rec.stop(); };
      wrap.replaceChildren(cancelBtn, clockEl, stopBtn);
      rec.start(1000);
    };
    return wrap;
  }

  // ---------- Reels: short videos, one screen each ----------
  async function reelsPage() {
    const list = h("div", { cls: "reels" });
    const top = h("div", {}, watchTabs("reels"));
    show(top, list);
    // Fill the screen between the title and the menu bar at the bottom.
    const fit = () => { if (!view.contains(list)) return removeEventListener("resize", fit); list.style.height = Math.max(360, innerHeight - list.getBoundingClientRect().top - window.scrollY - document.getElementById("nav").offsetHeight - 8) + "px"; };
    fit(); addEventListener("resize", fit);
    let muted = true, seen = new Set();
    const io = new IntersectionObserver(es => es.forEach(e => { const v = e.target; if (e.isIntersecting) { v.muted = muted; v.play().catch(() => {}); } else v.pause(); }), { threshold: 0.6 });
    const reel = p => {
      const v = h("video", { src: p.video, playsinline: true, loop: true, muted: true, preload: "metadata" });
      v.onclick = () => { muted = !muted; list.querySelectorAll("video").forEach(x => { x.muted = muted; }); sound.textContent = muted ? "🔇" : "🔊"; };
      const sound = h("span", { cls: "snd", text: "🔇" });
      const like = h("button", { type: "button", cls: p.liked ? "on" : "" }, "♥", h("small", { text: p.likes || "" }));
      like.onclick = async () => {
        if (!me) return needLogin("Please log in to like videos.");
        try { const d = await api(`/api/s/posts/${p.id}/like`, { body: { like: !p.liked } }); p.liked = d.liked; p.likes = d.likes; like.className = p.liked ? "on" : ""; like.lastChild.textContent = p.likes || ""; } catch (e) { alertNote(e.message); }
      };
      const shareB = h("button", { type: "button" }, "↗", h("small", { text: "Share" }));
      shareB.onclick = () => { const link = location.origin + "/community#/p/" + p.id; navigator.share ? navigator.share({ title: "Q India Community", url: link }).catch(() => {}) : window.open("https://wa.me/?text=" + encodeURIComponent(link), "_blank", "noopener"); };
      const side = h("div", { cls: "side" }, like, h("a", { href: "#/p/" + p.id }, "💬", h("small", { text: p.comments || "" })), shareB);
      menu(side, [!p.mine && ["Report video", () => report("post", p.id)], p.mine && ["Open post", () => go("#/p/" + p.id)]]);
      const cap = h("div", { cls: "cap" }, h("a", { href: "#/u/" + p.user.username, cls: "row who" }, avatar(p.user, "sm"), h("b", { text: p.user.name })), p.text && h("p", {}, richText(p.text)),
        p.status === "pending" && h("small", { text: "Only you can see this until the site owner checks it." }));
      io.observe(v);
      return h("div", { cls: "reel" }, v, sound, side, cap);
    };
    let before = 2 ** 53, busy = false, done = false;
    const more = async () => {
      if (busy || done) return; busy = true;
      try {
        const d = await api("/api/s/reels?before=" + before);
        d.posts.filter(p => !seen.has(p.id)).forEach(p => { seen.add(p.id); list.append(reel(p)); });
        if (d.posts.length) before = Math.min(...d.posts.map(p => p.id));
        done = !d.more;
        if (!list.children.length) list.replaceWith(h("div", { cls: "empty" }, h("p", { text: mediaOn() ? "No videos yet. Be the first to share a short video of a good queue!" : "No videos here. The Community is text only for now." }), mediaOn() && h("a", { cls: "sbtn main", href: "#/new" }, "＋ Add a video")));
      } catch (e) { alertNote(e.message); } finally { busy = false; }
    };
    list.onscroll = () => { if (list.scrollTop + list.clientHeight * 2 > list.scrollHeight) more(); };
    await more();
  }

  // ---------- Status / Stories (disappear after 24 hours) ----------
  const BG = ["#1d3557", "#e85d04", "#2a9d8f", "#6a4c93", "#c1121f", "#264653"];
  let storyTimer = null;
  function storyBar() {
    const bar = h("div", { cls: "stories", "aria-label": "Status updates" });
    api("/api/s/stories").then(d => {
      const mineP = d.people.find(p => p.me);
      const st = (href, ringCls, face, label) => h("a", { cls: "st", href }, h("span", { cls: "ring " + ringCls }, face), h("small", { text: label }));
      bar.append(st(mineP ? "#/status/" + me.username : "#/status/new", mineP ? "seen" : "add", avatar(me), "My status"));
      if (mineP) bar.append(st("#/status/new", "add", h("span", { cls: "av plus", "aria-hidden": "true", text: "＋" }), "Add"));
      d.people.filter(p => !p.me).forEach(p => bar.append(st("#/status/" + p.user.username, p.unseen ? "" : "seen", avatar(p.user), [...p.user.name].slice(0, 10).join(""))));
    }).catch(() => bar.remove());
    return bar;
  }
  async function storyPage(username) {
    if (!me) return needLogin("Please log in to see status updates.");
    let d; try { d = await api("/api/s/stories"); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const order = d.people;
    let pi = order.findIndex(p => p.user.username === username);
    if (pi < 0) { go("#/"); return setTimeout(() => alertNote("This status is no longer available."), 300); }
    let si = Math.max(0, order[pi].stories.findIndex(s => !s.seen));
    if (order[pi].me) si = 0;
    const bars = h("div", { cls: "sv-bars" }), body = h("div", { cls: "sv-body" }), head = h("div", { cls: "sv-head" }), foot = h("div", { cls: "sv-foot" });
    const box = h("div", { cls: "sv", role: "dialog", "aria-label": "Status" }, bars, head, body, foot);
    let paused = false, left = 0, startAt = 0, fill = null;
    const close = () => { clearTimeout(storyTimer); go("#/"); };
    function next() { const p = order[pi]; if (si < p.stories.length - 1) si++; else if (pi < order.length - 1) { pi++; si = 0; } else return close(); draw(); }
    function prev() { if (si > 0) si--; else if (pi > 0) { pi--; si = 0; } draw(); }
    function run(ms) { clearTimeout(storyTimer); left = ms; startAt = Date.now(); storyTimer = setTimeout(next, ms); if (fill) { fill.style.transition = "none"; fill.style.width = (100 * (1 - ms / 5500)) + "%"; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transition = "width " + ms + "ms linear"; fill.style.width = "100%"; })); } }
    function pause() { if (paused) return; paused = true; clearTimeout(storyTimer); left -= Date.now() - startAt; if (fill) { fill.style.width = getComputedStyle(fill).width; fill.style.transition = "none"; } }
    function resume() { if (!paused) return; paused = false; run(Math.max(300, left)); }
    function draw() {
      const p = order[pi], s = p.stories[si];
      bars.replaceChildren(...p.stories.map((x, i) => h("span", {}, h("i", { style: "width:" + (i < si ? 100 : 0) + "%" }))));
      fill = bars.children[si].firstChild;
      head.replaceChildren(h("a", { cls: "row who grow", href: "#/u/" + p.user.username }, avatar(p.user, "sm"), h("span", { cls: "grow" }, h("b", { text: p.me ? "My status" : p.user.name }), h("small", { text: ago(s.at) }))),
        menu(null, [p.me ? ["Delete this status", async () => { if (!confirm("Delete this status?")) return; try { await api(`/api/s/stories/${s.id}/delete`, { body: {} }); p.stories.splice(si, 1); if (!p.stories.length) return close(); si = Math.min(si, p.stories.length - 1); draw(); } catch (e) { alertNote(e.message); } }]
          : ["Report this status", () => { pause(); report("story", s.id); }]]),
        h("button", { cls: "sv-x", type: "button", "aria-label": "Close", onclick: close }, "✕"));
      body.replaceChildren();
      body.style.background = s.photo ? "#000" : BG[s.bg] || BG[0];
      if (s.photo) body.append(h("img", { src: s.photo, alt: s.text || "Status photo" }), s.text && h("p", { cls: "sv-cap", text: s.text }));
      else body.append(h("p", { cls: "sv-text" }, richText(s.text)));
      foot.replaceChildren();
      if (p.me) {
        const vb = h("button", { type: "button", cls: "sbtn" }, s.status === "pending" ? "Waiting for a check; only you can see it" : "👁 " + (s.views || 0) + " view" + (s.views === 1 ? "" : "s"));
        vb.onclick = async () => {
          pause();
          const r = await api(`/api/s/stories/${s.id}/viewers`).catch(() => ({ viewers: [] }));
          foot.replaceChildren(h("div", { cls: "sv-viewers" }, h("b", { text: "Viewed by" }), r.viewers.length ? r.viewers.map(v => h("div", { cls: "row" }, avatar(v, "sm"), h("span", { cls: "grow", text: v.name }), h("small", { text: ago(v.at) }))) : h("p", { text: "No views yet." }),
            h("button", { type: "button", cls: "sbtn", onclick: () => { draw(); } }, "Close")));
        };
        foot.append(vb);
      } else {
        const inp = h("input", { placeholder: "Reply to " + p.user.name + "…", maxlength: 1500, "aria-label": "Reply" });
        const f = h("form", { cls: "row" }, inp, h("button", { cls: "btn", "aria-label": "Send" }, "➤"));
        inp.onfocus = pause;
        f.onsubmit = async e => {
          e.preventDefault(); const t = inp.value.trim(); if (!t) return;
          try { await api("/api/s/chats/" + encodeURIComponent(p.user.username), { body: { text: "↩ Reply to your status" + (s.text ? " “" + [...s.text].slice(0, 80).join("") + "”" : "") + ":\n" + t } }); inp.value = ""; inp.blur(); alertNote("Reply sent privately."); resume(); }
          catch (er) { alertNote(er.message); }
        };
        foot.append(f);
        if (!s.seen) { s.seen = true; api(`/api/s/stories/${s.id}/view`, { body: {} }).catch(() => {}); }
      }
      paused = false; run(s.photo ? 6000 : 5500);
    }
    body.onclick = e => { if (paused) return resume(); (e.clientX - box.getBoundingClientRect().left < box.clientWidth / 3 ? prev : next)(); };
    body.onpointerdown = () => { body._t = setTimeout(pause, 250); };
    body.onpointerup = () => { clearTimeout(body._t); };
    show(box); draw();
  }
  function storyComposer() {
    if (!me) return needLogin();
    const m = msgBox(); let photo = null, file = null, bg = 0;
    const ta = h("textarea", { name: "text", maxlength: 700, placeholder: "Type a status…", "aria-label": "Status text" });
    const stage = h("div", { cls: "st-stage" }, ta);
    const paint = () => { stage.style.background = file ? "#000" : BG[bg]; ta.placeholder = file ? "Add a caption…" : "Type a status…"; stage.classList.toggle("photo", !!file); };
    const colour = h("button", { type: "button", cls: "sbtn", onclick: () => { bg = (bg + 1) % BG.length; paint(); } }, "🎨 Colour");
    const pick = photoPicker(fl => { file = fl; photo = null; stage.querySelector("img")?.remove(); stage.prepend(h("img", { src: URL.createObjectURL(fl), alt: "" })); colour.hidden = true; paint(); });
    const f = h("form", { cls: "card" }, h("h1", { text: "New status" }),
      h("p", { cls: "muted", text: "Your followers see it at the top of their feed for 24 hours, then it disappears." }),
      stage, h("div", { cls: "row" }, pick, colour), writeHelp(ta, "status", 700), h("button", { cls: "btn" }, "Share status"), m);
    f.onsubmit = async e => {
      e.preventDefault();
      if (!ta.value.trim() && !file) return say(m, mediaOn() ? "Type something or choose a photo." : "Type something first.");
      say(m, "Please wait…", true);
      try {
        if (file && !photo) photo = await uploadPhoto(file);
        const r = await api("/api/s/stories", { body: { text: ta.value, photo, bg } });
        go("#/"); if (r.status === "pending") setTimeout(() => alertNote("Your photo status will appear after a quick check by the site owner."), 300);
      } catch (err) { say(m, err.message); }
    };
    paint(); show(f); ta.focus();
  }

  // ---------- group chats ----------
  const chatTabs = on => h("div", { cls: "tabs" }, h("a", { href: "#/chats", cls: on === "chats" ? "on" : "" }, "Chats"), h("a", { href: "#/groups", cls: on === "groups" ? "on" : "" }, "Groups"));
  async function groupsPage() {
    if (!me) return needLogin("Please log in to see your groups.");
    let d; try { d = await api("/api/s/groups"); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    show(h("h1", { text: "Messages" }), chatTabs("groups"),
      h("p", {}, h("a", { cls: "sbtn main", href: "#/g/new" }, "＋ New group")),
      h("div", { cls: "list" }, d.groups.length ? d.groups.map(g => h("a", { cls: "li" + (g.unread ? " unread" : ""), href: "#/g/" + g.id }, avatar(g),
        h("span", { cls: "grow" }, h("span", { cls: "row" }, h("b", { cls: "grow", text: g.name }), g.closed && h("span", { cls: "tag", text: "Closed" }), h("small", { cls: "muted", text: ago(g.at) })), h("div", { cls: "last", text: g.last })),
        g.unread && h("span", { cls: "dot" }))) : h("div", { cls: "empty" }, h("p", { text: "No groups yet. Make one for your station, your train or your friends." }))));
  }
  // Pick people who follow me (only they can be added to a group).
  async function followerPicker(skip = new Set()) {
    const r = await api(`/api/s/users/${encodeURIComponent(me.username)}/followers`).catch(() => ({ users: [] }));
    const users = r.users.filter(u => !skip.has(u.username));
    const q = h("input", { type: "search", placeholder: "Search your followers", autocapitalize: "none" });
    const list = h("div", { cls: "pick" }, users.length ? users.map(u => h("label", { cls: "tick row" }, h("input", { type: "checkbox", value: u.username }), avatar(u, "sm"), h("span", { cls: "grow" }, h("b", { text: u.name }), " ", h("small", { cls: "muted", text: "@" + u.username }))))
      : h("p", { cls: "muted", text: skip.size ? "All your followers are already in this group." : "Nobody follows you yet. You can make the group and share its invite link." }));
    q.oninput = () => { const s = q.value.toLowerCase(); list.querySelectorAll("label").forEach(l => { l.hidden = !l.textContent.toLowerCase().includes(s); }); };
    return { node: h("div", {}, users.length > 8 && q, list), chosen: () => [...list.querySelectorAll("input:checked")].map(i => i.value) };
  }
  async function newGroupPage() {
    if (!me) return needLogin();
    const m = msgBox(); let photo;
    const pic = h("div", { cls: "row" }, avatar({ name: "＋" }, "big"));
    const pick = await followerPicker();
    const f = h("form", { cls: "card" }, h("h1", { text: "New group" }),
      h("div", { cls: "row" }, pic, photoPicker(async fl => { say(m, "Preparing photo…", true); try { photo = await uploadPhoto(fl, 512); pic.replaceChildren(h("img", { cls: "av big", src: URL.createObjectURL(fl), alt: "" })); say(m, "", true); } catch (e) { say(m, e.message); } }, "📷 Group photo")),
      h("div", {}, h("label", { for: "gn", text: "Group name" }), h("input", { id: "gn", name: "name", maxlength: 60, placeholder: "for example Dadar 8:15 local", required: true })),
      h("div", {}, h("label", { for: "ga", text: "About (optional)" }), h("textarea", { id: "ga", name: "about", maxlength: 500, rows: 2 })),
      h("div", {}, h("label", { text: "Add people" }), h("p", { cls: "muted", text: "You can add people who follow you. Anyone else can join with the group's invite link." }), pick.node),
      h("button", { cls: "btn" }, "Create group"), m);
    f.onsubmit = async e => {
      e.preventDefault(); say(m, "Please wait…", true);
      try { const r = await api("/api/s/groups", { body: { name: f.name.value, about: f.about.value, avatar: photo, members: pick.chosen() } }); go("#/g/" + r.id); }
      catch (err) { say(m, err.message); }
    };
    show(f);
  }
  async function groupPage(id) {
    if (!me) return needLogin("Please log in to see your groups.");
    let d; try { d = await api("/api/s/groups/" + id); } catch (e) { return show(h("p", { cls: "empty" }, e.message, h("br"), h("a", { cls: "sbtn", href: "#/groups" }, "My groups"))); }
    const g = d.group, box = h("div", { cls: "msgs" });
    let lastId = 0, lastDay = "";
    const add = x => {
      const day = new Date(x.at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      if (day !== lastDay) { box.append(h("div", { cls: "day", text: day })); lastDay = day; }
      lastId = Math.max(lastId, x.id);
      if (x.info) return box.append(h("div", { cls: "day info", text: x.text }));
      const b = h("div", { cls: "bubble" + (x.mine ? " me" : "") }, !x.mine && x.user && h("a", { cls: "from", href: "#/u/" + x.user.username, text: x.user.name }),
        x.photo && h("img", { src: x.photo, alt: "Photo", loading: "lazy" }), x.audio && h("audio", { src: x.audio, controls: true, preload: "none" }), x.text && richText(x.text), h("small", { text: clock(x.at) }));
      const opts = [(x.mine || g.admin) && ["Delete for everyone", async () => { try { await api(`/api/s/group-messages/${x.id}/delete`, { body: {} }); b.remove(); } catch (er) { alertNote(er.message); } }],
        !x.mine && ["Report message", () => report("groupmsg", x.id)]].filter(Boolean);
      let press = null;
      b.oncontextmenu = e => e.preventDefault();
      const open = () => { const mm = menu(null, opts); b.append(mm); mm.querySelector("button").click(); };
      b.onpointerdown = () => { press = setTimeout(open, 600); };
      b.onpointerup = b.onpointerleave = () => clearTimeout(press);
      b.ondblclick = open;
      box.append(b);
    };
    d.messages.forEach(add); badges();
    const m = msgBox(), notes = h("div");
    const setCannot = why => notes.replaceChildren(...(why ? [h("p", { cls: "note", text: why })] : []));
    setCannot(d.cannot);
    const ta = h("textarea", { name: "text", rows: 1, maxlength: 2000, placeholder: "Message", "aria-label": "Message" });
    let sending = false;
    const send = async (text, photo, audio) => {
      if (sending) return; sending = true;
      try { await api(`/api/s/groups/${id}/messages`, { body: { text, photo, audio } }); say(m, "", true); await poll(); }
      catch (e) { say(m, e.message); } finally { sending = false; }
    };
    const voice = voiceButton(async blob => { say(m, "Sending voice message…", true); try { const aid = await uploadAV(blob, "audio"); await send("", null, aid); } catch (e) { say(m, e.message); } }, t => say(m, t));
    const f = h("form", {}, photoPicker(async fl => { say(m, "Sending photo…", true); try { const pid = await uploadPhoto(fl); await send("", pid); } catch (e) { say(m, e.message); } }, "📷"), voice, ta, h("button", { cls: "btn", "aria-label": "Send" }, "➤"));
    f.onsubmit = e => { e.preventDefault(); const t = ta.value.trim(); if (!t) return; ta.value = ""; send(t); };
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); f.requestSubmit(); } };
    const head = h("div", { cls: "head" }, h("a", { href: "#/groups", cls: "sbtn", "aria-label": "Back" }, "←"),
      h("a", { cls: "row who grow", href: `#/g/${id}/info` }, avatar(g), h("span", { cls: "grow" }, h("b", { text: g.name }), h("small", { text: g.members + " members · tap for group info" }))));
    show(h("div", { cls: "chat" }, head, notes, box, f, m), h("p", { cls: "muted", text: "Group messages are kept on the Qindia server. All members can see them. The site owner sees a message only if a member reports it. Never share passwords, OTPs or bank details." }));
    box.scrollTop = box.scrollHeight;
    async function poll() {
      const r = await api(`/api/s/groups/${id}?after=${lastId}`).catch(() => null);
      if (!r || !view.contains(box)) return;
      const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      r.messages.forEach(add); setCannot(r.cannot); g.admin = r.group.admin;
      if (r.messages.length && (near || r.messages.some(x => x.mine))) box.scrollTop = box.scrollHeight;
    }
    timer = setInterval(() => { if (!document.hidden) poll(); }, 3000);
  }
  async function groupInfoPage(id) {
    if (!me) return needLogin();
    let d; try { d = await api("/api/s/groups/" + id); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const g = d.group, act = async (path, body, msg) => { try { await api(path, { body }); if (msg) alertNote(msg); groupInfoPage(id); } catch (e) { alertNote(e.message); } };
    const parts = [h("p", {}, h("a", { cls: "sbtn", href: "#/g/" + id }, "← Back to chat")),
      h("div", { cls: "card prof" }, avatar(g, "big"), h("h1", { text: g.name }), h("div", { cls: "muted", text: "Group · " + g.members + " members" }), g.about && h("p", { cls: "bio" }, richText(g.about)))];
    if (g.invite) {
      const link = location.origin + "/community#/join/" + g.invite;
      parts.push(h("div", { cls: "card" }, h("label", { text: "Invite link" }), h("p", { cls: "muted", text: "Anyone with this link can join the group. Share it on WhatsApp or anywhere." }),
        h("p", { cls: "code", style: "font-size:14px", text: link }),
        h("div", { cls: "row", style: "flex-wrap:wrap" },
          h("button", { cls: "sbtn main", type: "button", onclick: () => navigator.share ? navigator.share({ title: "Join " + g.name + " on Q India Community", url: link }).catch(() => {}) : window.open("https://wa.me/?text=" + encodeURIComponent("Join my group " + g.name + " on Q India Community: " + link), "_blank") }, "Share link"),
          h("button", { cls: "sbtn", type: "button", onclick: () => navigator.clipboard && navigator.clipboard.writeText(link).then(() => alertNote("Link copied.")) }, "Copy"),
          g.admin && h("button", { cls: "sbtn", type: "button", onclick: () => confirm("Make a new link? The old link will stop working.") && act("/api/s/groups/" + id, { invite: "reset" }, "New link made.") }, "New link"),
          g.admin && h("button", { cls: "sbtn", type: "button", onclick: () => act("/api/s/groups/" + id, { invite: "off" }, "Invite link switched off.") }, "Switch off"))));
    } else if (g.admin) parts.push(h("div", { cls: "card" }, h("label", { text: "Invite link" }), h("p", { cls: "muted", text: "The invite link is off." }), h("button", { cls: "sbtn main", type: "button", onclick: () => act("/api/s/groups/" + id, { invite: "reset" }) }, "Switch on")));
    if (g.admin) {
      const m = msgBox(); let photo;
      const ef = h("form", { cls: "card" }, h("label", { text: "Edit group (admins)" }),
        h("input", { name: "name", maxlength: 60, value: g.name, required: true, "aria-label": "Group name" }),
        h("textarea", { name: "about", maxlength: 500, rows: 2, placeholder: "About the group", "aria-label": "About" }),
        h("div", { cls: "row" }, photoPicker(async fl => { say(m, "Preparing photo…", true); try { photo = await uploadPhoto(fl, 512); say(m, "Tap Save to keep this photo.", true); } catch (e) { say(m, e.message); } }, "📷 Group photo")),
        h("label", { cls: "tick" }, h("input", { type: "checkbox", name: "only" }), h("span", { text: "Only admins can send messages" })),
        h("button", { cls: "sbtn dark" }, "Save"), m);
      ef.about.value = g.about; ef.only.checked = g.onlyAdmins;
      ef.onsubmit = async e => { e.preventDefault(); const body = { name: ef.name.value, about: ef.about.value, onlyAdmins: ef.only.checked }; if (photo) body.avatar = photo; act("/api/s/groups/" + id, body, "Saved."); };
      const pick = await followerPicker(new Set(d.people.map(p => p.username)));
      const am = msgBox();
      const af = h("form", { cls: "card" }, h("label", { text: "Add people" }), pick.node, h("button", { cls: "sbtn main" }, "Add to group"), am);
      af.onsubmit = async e => { e.preventDefault(); const add = pick.chosen(); if (!add.length) return say(am, "Tick the people to add."); act(`/api/s/groups/${id}/members`, { add }, "Added."); };
      parts.push(ef, af);
    }
    parts.push(h("h2", { text: g.members + " members" }), h("div", { cls: "list" }, d.people.map(p => {
      const row = h("div", { cls: "li" }, h("a", { cls: "row who grow", href: "#/u/" + p.username }, avatar(p), h("span", { cls: "grow" }, h("b", { text: p.me ? "You" : p.name }), h("div", { cls: "last", text: "@" + p.username }))), p.admin && h("span", { cls: "tag", text: "Admin" }));
      if (g.admin && !p.me) menu(row, [
        p.admin ? ["Remove as admin", () => act(`/api/s/groups/${id}/members/${p.username}`, { action: "member" })] : ["Make group admin", () => act(`/api/s/groups/${id}/members/${p.username}`, { action: "admin" })],
        ["Remove from group", () => confirm("Remove " + p.name + " from the group?") && act(`/api/s/groups/${id}/members/${p.username}`, { action: "remove" })],
      ]);
      return row;
    })));
    const leave = h("button", { cls: "sbtn", type: "button" }, "Leave group");
    leave.onclick = async () => { if (!confirm("Leave " + g.name + "?")) return; try { await api(`/api/s/groups/${id}/leave`, { body: {} }); go("#/groups"); } catch (e) { alertNote(e.message); } };
    parts.push(h("div", { cls: "card row", style: "flex-wrap:wrap" }, leave, h("button", { cls: "sbtn", type: "button", onclick: () => report("group", g.id) }, "Report group")));
    show(...parts);
  }
  async function joinPage(code) {
    if (!me) { try { sessionStorage.setItem("qi_after_login", "#/join/" + code); } catch {} return needLogin("Please log in or create a free account to join this group."); }
    let d; try { d = await api("/api/s/join/" + encodeURIComponent(code)); } catch (e) { return show(h("p", { cls: "empty", text: e.message })); }
    const g = d.group;
    if (g.member) return go("#/g/" + g.id);
    const m = msgBox(), b = h("button", { cls: "btn" }, "Join group");
    b.onclick = async () => { b.disabled = true; try { const r = await api("/api/s/join/" + encodeURIComponent(code), { body: {} }); go("#/g/" + r.id); } catch (e) { say(m, e.message); b.disabled = false; } };
    show(h("div", { cls: "card prof" }, avatar(g, "big"), h("h1", { text: g.name }), h("div", { cls: "muted", text: "Group · " + g.members + " members" }), g.about && h("p", { cls: "bio" }, richText(g.about)),
      h("p", { cls: "muted", text: "You were invited to this group. Members will see your name and messages." }), b, m));
  }

  // ---------- voice and video calls (WebRTC, phone to phone) ----------
  let callOn = null; // the call on screen, if any
  let iceCfg = null;
  const getIce = async () => iceCfg || (iceCfg = await api("/api/s/calls/config"));
  // Waits until the phone has found its network addresses (at most 4 seconds), so one message carries everything.
  const gathered = pc => new Promise(ok => { if (pc.iceGatheringState === "complete") return ok(); const t = setTimeout(ok, 4000); pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); ok(); } }); });
  function ringTone() {
    let ctx = null, timer = null;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    const beep = () => { try { navigator.vibrate && navigator.vibrate([400, 200, 400]); if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 480; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.8); } catch {} };
    beep(); timer = setInterval(beep, 2500);
    return () => { clearInterval(timer); try { navigator.vibrate && navigator.vibrate(0); ctx && ctx.close(); } catch {} };
  }
  function callScreen(user, kind, label) {
    const remote = h("video", { cls: "c-remote", autoplay: true, playsinline: true });
    const local = h("video", { cls: "c-local", autoplay: true, playsinline: true, muted: true });
    const state = h("p", { cls: "c-state", text: label });
    const btns = h("div", { cls: "c-btns" });
    const box = h("div", { cls: "call " + kind, role: "dialog", "aria-label": "Call with " + user.name }, remote, h("div", { cls: "c-who" }, avatar(user, "big"), h("h2", { text: user.name }), state), local, btns);
    document.body.append(box);
    return { box, remote, local, state, btns, close: () => box.remove() };
  }
  // The call on screen: buttons, timer, hang up. ringing=true shows only "Cancel" until live() is called.
  function inCall(ui, pc, stream, callId, kind, ringing) {
    let muted = false, camOff = false, t0 = null, tick = null, ended = false;
    const mic = h("button", { type: "button", cls: "c-btn", "aria-label": "Mute" }, "🎤");
    mic.onclick = () => { muted = !muted; stream.getAudioTracks().forEach(t => { t.enabled = !muted; }); mic.classList.toggle("off", muted); };
    const cam = kind === "video" && h("button", { type: "button", cls: "c-btn", "aria-label": "Camera off" }, "📷");
    if (cam) cam.onclick = () => { camOff = !camOff; stream.getVideoTracks().forEach(t => { t.enabled = !camOff; }); cam.classList.toggle("off", camOff); };
    const hang = h("button", { type: "button", cls: "c-btn end", "aria-label": "End call" }, "📞");
    const finish = async (why, tell = true) => {
      if (ended) return; ended = true; clearInterval(tick); clearInterval(watch);
      try { pc.close(); } catch {} stream.getTracks().forEach(t => t.stop());
      if (tell) api(`/api/s/calls/${callId}/end`, { body: {} }).catch(() => {});
      ui.state.textContent = why || "Call ended"; ui.btns.replaceChildren();
      setTimeout(() => { ui.close(); callOn = null; }, 1500);
    };
    hang.onclick = () => finish("Call ended");
    const live = () => ui.btns.replaceChildren(mic, cam || "", hang);
    if (ringing) { const cancel = h("button", { type: "button", cls: "c-btn end", "aria-label": "Cancel call" }, "📞"); cancel.onclick = () => finish("Call cancelled"); ui.btns.replaceChildren(cancel); } else live();
    pc.ontrack = e => { ui.remote.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && !t0) { t0 = Date.now(); ui.box.classList.add("live"); tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); ui.state.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }, 1000); }
      if (pc.connectionState === "failed") finish("Could not connect. The network may be blocking calls.");
    };
    // The other person hung up?
    const watch = setInterval(async () => { const c = await api("/api/s/calls/" + callId).catch(() => null); if (c && c.status !== "accepted" && c.status !== "ringing") finish(c.status === "declined" ? "Call declined" : c.status === "missed" ? "No answer" : "Call ended", false); }, 3000);
    callOn = { finish, live };
    return callOn;
  }
  async function media(kind) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "video" ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false }); }
    catch { throw new Error(kind === "video" ? "Please allow the camera and microphone to make a video call." : "Please allow the microphone to make a call."); }
  }
  async function startCall(user, kind) {
    if (callOn) return;
    if (!window.RTCPeerConnection || !navigator.mediaDevices) return alertNote("Calls do not work in this browser. Please use Chrome or the Qindia app.");
    callOn = {};
    const ui = callScreen(user, kind, "Starting…");
    let stream, pc, id = null;
    const fail = msg => { try { pc && pc.close(); } catch {} stream && stream.getTracks().forEach(t => t.stop()); ui.state.textContent = msg; ui.btns.replaceChildren(h("button", { type: "button", cls: "c-btn", onclick: () => { ui.close(); callOn = null; } }, "✕")); if (id) api(`/api/s/calls/${id}/end`, { body: {} }).catch(() => {}); };
    try {
      stream = await media(kind); ui.local.srcObject = stream;
      pc = new RTCPeerConnection(await getIce());
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
      id = (await api("/api/s/calls", { body: { to: user.username, kind, offer: pc.localDescription.sdp } })).id;
    } catch (e) { return fail(e.message); }
    ui.state.textContent = "Ringing…";
    const call = inCall(ui, pc, stream, id, kind, true), finish = call.finish;
    // Wait for the answer.
    const wait = setInterval(async () => {
      const c = await api("/api/s/calls/" + id).catch(() => null);
      if (!c || !callOn) return clearInterval(wait);
      if (c.status === "accepted" && c.answer) {
        clearInterval(wait); ui.state.textContent = "Connecting…";
        try { await pc.setRemoteDescription({ type: "answer", sdp: c.answer }); } catch { return finish("Could not connect."); }
        call.live(); // shows the in-call buttons
      } else if (c.status !== "ringing") { clearInterval(wait); finish(c.status === "declined" ? user.name + " declined the call" : c.status === "missed" ? "No answer" : "Call ended", false); }
    }, 1500);
  }
  async function incoming(c) {
    if (callOn) return;
    callOn = {};
    const ui = callScreen(c.user, c.kind, c.kind === "video" ? "Video call…" : "Voice call…");
    ui.box.classList.add("ring");
    const stop = ringTone();
    const accept = h("button", { type: "button", cls: "c-btn ok", "aria-label": "Answer" }, c.kind === "video" ? "📹" : "📞");
    const decline = h("button", { type: "button", cls: "c-btn end", "aria-label": "Decline" }, "📞");
    const gone = setInterval(async () => { const s = await api("/api/s/calls/" + c.id).catch(() => null); if (s && s.status !== "ringing" && ui.box.classList.contains("ring")) { clearInterval(gone); stop(); ui.close(); callOn = null; } }, 2000);
    decline.onclick = () => { clearInterval(gone); stop(); api(`/api/s/calls/${c.id}/end`, { body: {} }).catch(() => {}); ui.close(); callOn = null; };
    accept.onclick = async () => {
      clearInterval(gone); stop(); ui.box.classList.remove("ring"); ui.state.textContent = "Connecting…"; ui.btns.replaceChildren();
      let stream, pc;
      try {
        stream = await media(c.kind); ui.local.srcObject = stream;
        pc = new RTCPeerConnection(await getIce());
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        inCall(ui, pc, stream, c.id, c.kind);
        await pc.setRemoteDescription({ type: "offer", sdp: c.offer });
        await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
        await api(`/api/s/calls/${c.id}/answer`, { body: { answer: pc.localDescription.sdp } });
      } catch (e) { callOn && callOn.finish ? callOn.finish(e.message) : (ui.close(), callOn = null); }
    };
    ui.btns.append(decline, accept);
  }
  // Is someone calling me? Checked every 4 seconds while the page is open.
  setInterval(async () => {
    if (!tok || !me || callOn || document.hidden) return;
    const d = await api("/api/s/calls/incoming").catch(() => null);
    if (d && d.call) incoming(d.call);
  }, 4000);

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
    clearInterval(timer); timer = null; clearTimeout(storyTimer);
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const [a, b, c] = parts;
    const nav = { "": "home", following: "home", all: "home", pages: "home", pg: "home", share: "home", search: "search", reels: "reels", watch: "reels", v: "reels", new: "new", chats: "chats", chat: "chats", groups: "chats", g: "chats", join: "chats", status: "home", notifs: "notifs", me: "me", login: "me", signup: "me", recover: "me" }[a || ""] || (a === "u" && me && b === me.username ? "me" : "");
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("on", x.dataset.nav === nav));
    window.scrollTo(0, 0);
    switch (a || "") {
      case "": case "following": case "all": return feedPage(a);
      case "login": return me ? go("#/") : loginPage();
      case "signup": return me ? go("#/") : signupPage();
      case "recover": return recoverPage();
      case "oauth": return oauthPage(b);
      case "oauth-error": return me ? go("#/") : oauthError(b);
      case "new": return me ? show(composer(p => go("#/p/" + p.id))) : needLogin();
      case "p": return postPage(Number(b));
      case "u": return profilePage(b, c === "followers" || c === "following" ? c : null);
      case "search": return searchPage();
      case "reels": return reelsPage();
      case "watch": return watchPage(b, c);
      case "v": return videoPage(Number(b));
      case "pages": return b === "new" ? pageForm() : pagesPage();
      case "pg": return c === "edit" ? pageForm(b) : pageView(b);
      case "share": return sharePage(Number(b));
      case "notifs": return notifsPage();
      case "chats": return chatsPage();
      case "chat": return chatPage(b);
      case "groups": return groupsPage();
      case "g": return b === "new" ? newGroupPage() : c === "info" ? groupInfoPage(Number(b)) : groupPage(Number(b));
      case "join": return joinPage(b);
      case "status": return b === "new" ? storyComposer() : storyPage(b);
      case "me": return !me ? needLogin() : b === "edit" ? editPage() : b === "settings" ? settingsPage() : go("#/u/" + me.username);
      default: return feedPage();
    }
  }
  window.addEventListener("hashchange", route);
  loadMe().then(route);
})();

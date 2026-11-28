// Q India writing help for Status and posts: ideas, tidy/rewrite, translate (English, Hindi, Marathi) and hashtags.
// Free for members and free for the site owner: nothing is sent to a paid AI service and nothing runs on our server.
//  1. Where the browser has built-in AI (Chrome's on-device Gemini Nano: LanguageModel, Writer, Rewriter, Translator,
//     LanguageDetector), it is used on the member's own device. The big model is only downloaded if the member taps to allow it.
//  2. Everywhere else (most phones, the Android app's WebView) simple helpers run instead: idea templates in EN/HI/MR,
//     a text tidy-up, keyword hashtags, and a "Open Google Translate" link (free, opens outside the site).
// Usage: QI_WRITE.panel(textarea, { kind: "status" | "post", max: 700 }) returns an element to put under the box.
(function (root) {
  "use strict";
  const LANGS = { en: "English", hi: "हिंदी", mr: "मराठी" };

  // ---------- simple helpers (no AI, work everywhere) ----------
  const IDEAS = {
    en: [
      "Everyone queued up at the station today and boarded calmly. It felt great! 🙏",
      "No pushing, just a queue. Let people get off first, then get on. 🚆",
      "Queue up when the bus comes. It saves everyone time and nobody gets hurt. 🚌",
      "I gave my seat to an elderly passenger today. A small thing, a big difference. 💙",
      "Discipline starts with me. Let's stand in line, every single time. ✋",
      "Stay behind the yellow line on the platform. Safety first! ⚠️",
      "In the metro today, everyone let passengers get off first. Let's make it daily! 👏",
      "Standing in a queue is not a shame, it is respect. 🇮🇳",
      "Tip: keep your ticket or pass ready before you reach the gate. The line moves faster.",
      "Saw a perfect queue at the bus stop this morning. Thank you, fellow citizens! 🌟",
    ],
    hi: [
      "आज स्टेशन पर सब लोग लाइन में खड़े होकर ट्रेन में चढ़े। बहुत अच्छा लगा! 🙏",
      "धक्का नहीं, कतार। पहले उतरने दें, फिर चढ़ें। 🚆",
      "बस आने पर लाइन लगाइए। सबका समय बचता है और किसी को चोट नहीं लगती। 🚌",
      "आज मैंने एक बुज़ुर्ग यात्री को अपनी सीट दी। छोटी-सी बात, बड़ा फ़र्क। 💙",
      "अनुशासन की शुरुआत खुद से होती है। आइए, हर बार कतार में रहें। ✋",
      "प्लेटफ़ॉर्म पर पीली लाइन के पीछे रहें। सुरक्षा पहले! ⚠️",
      "आज मेट्रो में सबने पहले यात्रियों को उतरने दिया। ऐसा रोज़ हो! 👏",
      "कतार में खड़ा होना शर्म नहीं, सम्मान है। 🇮🇳",
      "सुझाव: गेट तक पहुँचने से पहले टिकट या पास तैयार रखें। लाइन जल्दी चलती है।",
      "आज सुबह बस स्टॉप पर बढ़िया कतार देखी। धन्यवाद, साथी नागरिकों! 🌟",
    ],
    mr: [
      "आज स्टेशनवर सगळे रांगेत उभे राहून गाडीत चढले. खूप छान वाटलं! 🙏",
      "धक्काबुक्की नको, रांग लावा. आधी उतरू द्या, मग चढा. 🚆",
      "बस आली की रांग लावा. सगळ्यांचा वेळ वाचतो आणि कोणाला इजा होत नाही. 🚌",
      "आज मी एका ज्येष्ठ प्रवाशाला माझी जागा दिली. छोटी गोष्ट, मोठा फरक. 💙",
      "शिस्तीची सुरुवात स्वतःपासून होते. चला, प्रत्येक वेळी रांगेत राहूया. ✋",
      "फलाटावर पिवळ्या रेषेच्या मागे उभे राहा. सुरक्षा आधी! ⚠️",
      "आज मेट्रोत सगळ्यांनी आधी प्रवाशांना उतरू दिलं. असंच रोज व्हावं! 👏",
      "रांगेत उभं राहणं ही लाज नाही, तो सन्मान आहे. 🇮🇳",
      "सूचना: गेटवर पोहोचण्याआधी तिकीट किंवा पास तयार ठेवा. रांग लवकर पुढे सरकते.",
      "आज सकाळी बस स्टॉपवर छान रांग पाहिली. धन्यवाद, नागरिकांनो! 🌟",
    ],
  };
  function ideas(lang, n = 3) {
    const bank = (IDEAS[lang] || IDEAS.en).slice();
    for (let i = bank.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bank[i], bank[j]] = [bank[j], bank[i]]; }
    return bank.slice(0, n);
  }

  // Tidy spacing and punctuation; capitalise English sentences. Never changes the words.
  function tidy(text) {
    let t = String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    t = t.replace(/ +([,.!?;:।])/g, "$1").replace(/([!?])\1+/g, "$1").replace(/\.{4,}/g, "...").replace(/।{2,}/g, "।");
    t = t.replace(/([,;:])(?=[^\s\d/])/g, "$1 ").replace(/([.!?])(?=[A-Za-z])/g, (m, p, off, s) => /https?:\/\/\S*$/.test(s.slice(0, off)) ? m : p + " ");
    t = t.replace(/(^|[.!?]\s+|\n)([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bi\b/g, "I");
    if (t && /[A-Za-z0-9]$/.test(t) && !/https?:\/\/\S+$/.test(t)) t += ".";
    if (t && /[\u0900-\u097F]$/.test(t)) t += isMarathi(t) ? "." : "।";
    return t;
  }

  const isDeva = t => /[\u0900-\u097F]/.test(t);
  const isMarathi = t => /(आहे|आहेत|आणि|नाही|आम्ही|तुम्ही|करूया|राहूया|मध्ये|च्या|ळ)/.test(t);
  const guessLang = t => !isDeva(t) ? "en" : isMarathi(t) ? "mr" : "hi";

  const TAGS = [
    [/queue|line\b|lines\b|कतार|लाइन|रांग/i, "#QueueUp"],
    [/train|local|railway|ट्रेन|लोकल|रेल|गाडी/i, "#TrainEtiquette"],
    [/mumbai|मुंबई/i, "#MumbaiLocal"],
    [/metro|मेट्रो/i, "#MetroManners"],
    [/\bbus|बस/i, "#BusQueue"],
    [/station|platform|स्टेशन|प्लेटफ़ॉर्म|प्लेटफार्म|फलाट/i, "#StationSafety"],
    [/safe|yellow line|सुरक्षा|पीली|पिवळ/i, "#SafetyFirst"],
    [/elder|senior|old|बुज़ुर्ग|बुजुर्ग|ज्येष्ठ|वृद्ध/i, "#RespectElders"],
    [/women|ladies|महिला|स्त्री/i, "#RespectWomen"],
    [/disciplin|अनुशासन|शिस्त/i, "#SelfDiscipline"],
    [/clean|litter|स्वच्छ|कचरा/i, "#SwachhBharat"],
    [/push|rush|धक्का|भीड़|गर्दी/i, "#NoPushing"],
    [/thank|धन्यवाद|शुक्रिया/i, "#ThankYou"],
  ];
  function hashtags(text, n = 6) {
    const have = new Set((String(text).match(/#[\p{L}\p{N}_]+/gu) || []).map(s => s.toLowerCase()));
    const out = ["#QIndia", "#Qindiaglobal"];
    for (const [rx, tag] of TAGS) if (rx.test(text)) out.push(tag);
    out.push("#CivicSense", "#PublicTransport");
    return [...new Set(out)].filter(t => !have.has(t.toLowerCase())).slice(0, n);
  }
  const googleTranslate = (text, to) => "https://translate.google.com/?sl=auto&tl=" + to + "&op=translate&text=" + encodeURIComponent(String(text).slice(0, 4000));

  // ---------- on-device AI (Chrome built-in AI), used only where present ----------
  const G = root;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const allowedBig = () => store.get("qi_ai_ok") === "1";
  async function avail(api, opts) {
    try { if (!G[api] || !G[api].availability) return "unavailable"; return await G[api].availability(opts); } catch { return "unavailable"; }
  }
  // "available" = ready now; "downloadable"/"downloading" = can be used after a one-time download; else none.
  async function nanoState() {
    const lm = await avail("LanguageModel", { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] });
    if (lm !== "unavailable") return { api: "LanguageModel", state: lm };
    const w = await avail("Writer", { expectedInputLanguages: ["en"], outputLanguage: "en" });
    if (w !== "unavailable") return { api: "Writer", state: w };
    return { api: null, state: "unavailable" };
  }
  const withTimeout = (p, ms, ctl) => Promise.race([p, new Promise((_, no) => setTimeout(() => { try { ctl && ctl.abort(); } catch {} no(new Error("timeout")); }, ms))]);
  const monitor = onProgress => m => { try { m.addEventListener("downloadprogress", e => onProgress && onProgress(Math.round((e.loaded || 0) * 100))); } catch {} };

  let lmSession = null;
  async function lmPrompt(text, onProgress) {
    if (!lmSession) {
      lmSession = await G.LanguageModel.create({
        initialPrompts: [{ role: "system", content: "You help members of Q India, a citizens' community about orderly queues, safety and self-discipline in public transport in India. Write short, warm, polite, family-friendly social posts. Never insult anyone, never mention politics or religion, never invent facts, names, dates or numbers. Reply with only the requested text, no explanations." }],
        expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }], monitor: monitor(onProgress),
      });
    }
    const ctl = new AbortController();
    return withTimeout(lmSession.prompt(text, { signal: ctl.signal }), 60000, ctl);
  }
  async function writerWrite(task, onProgress) {
    const w = await G.Writer.create({ tone: "casual", format: "plain-text", length: "short", expectedInputLanguages: ["en"], outputLanguage: "en",
      sharedContext: "Short social media status for a citizens' community about orderly queues and safety in public transport in India.", monitor: monitor(onProgress) });
    try { const ctl = new AbortController(); return await withTimeout(w.write(task, { signal: ctl.signal }), 60000, ctl); } finally { try { w.destroy(); } catch {} }
  }
  async function rewriterRewrite(text, opts, onProgress) {
    if ((await avail("Rewriter", { expectedInputLanguages: ["en"], outputLanguage: "en" })) === "unavailable") return null;
    const r = await G.Rewriter.create({ ...opts, format: "plain-text", expectedInputLanguages: ["en"], outputLanguage: "en", monitor: monitor(onProgress) });
    try { const ctl = new AbortController(); return await withTimeout(r.rewrite(text, { signal: ctl.signal }), 60000, ctl); } finally { try { r.destroy(); } catch {} }
  }
  async function detect(text) {
    try {
      if ((await avail("LanguageDetector", {})) !== "unavailable") {
        const d = await G.LanguageDetector.create(); const r = await d.detect(text); try { d.destroy(); } catch {}
        const top = r && r[0] && r[0].detectedLanguage;
        if (top && top !== "und" && r[0].confidence > 0.5) return top.split("-")[0];
      }
    } catch {}
    return guessLang(text);
  }
  // Translator language packs are small, so they may download when the member taps Translate.
  async function translate(text, from, to, onProgress) {
    const s = await avail("Translator", { sourceLanguage: from, targetLanguage: to });
    if (s === "unavailable") return null;
    const t = await G.Translator.create({ sourceLanguage: from, targetLanguage: to, monitor: monitor(onProgress) });
    try { const ctl = new AbortController(); return await withTimeout(t.translate(text, { signal: ctl.signal }), 60000, ctl); } finally { try { t.destroy(); } catch {} }
  }
  const clean = s => String(s || "").replace(/^["'“”\s]+|["'“”\s]+$/g, "").replace(/\*\*/g, "").trim();
  const lines = s => String(s || "").split(/\n+/).map(l => clean(l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""))).filter(l => l.length > 3);

  // ---------- the panel ----------
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith("on")) e[k] = v; else if (k === "cls") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v === true ? "" : v); }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }
  function panel(ta, { kind = "post", max = 5000 } = {}) {
    const wrap = el("div", { cls: "wh" });
    const toggle = el("button", { type: "button", cls: "sbtn wh-toggle", "aria-expanded": "false" }, "✨ Writing help");
    const box = el("div", { cls: "wh-box", hidden: true });
    let lang = store.get("qi_ai_lang") || (guessLang(ta.value) !== "en" ? guessLang(ta.value) : "en");
    if (!LANGS[lang]) lang = "en";
    const sel = el("select", { "aria-label": "Language", cls: "wh-lang", onchange: () => { lang = sel.value; store.set("qi_ai_lang", lang); } },
      Object.entries(LANGS).map(([k, v]) => el("option", { value: k, selected: k === lang, text: v })));
    const out = el("div", { cls: "wh-out", "aria-live": "polite" });
    const note = el("p", { cls: "wh-note" });
    let nano = null, busy = false;

    const set = v => { ta.value = String(v).slice(0, max); ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); };
    const progress = pc => { out.replaceChildren(el("p", { cls: "muted", text: "Getting the free AI ready on this device… " + pc + "%" })); };
    const wait = t => out.replaceChildren(el("p", { cls: "muted", text: t }));
    const choice = (text, label = "Use this") => el("div", { cls: "wh-pick" }, el("p", { text }), el("button", { type: "button", cls: "sbtn main", onclick: () => { set(text); out.replaceChildren(); } }, label));
    const canUseNano = () => nano && nano.api && (nano.state === "available" || allowedBig());

    async function paintNote() {
      nano = await nanoState();
      note.replaceChildren();
      if (nano.state === "available") note.append("🔒 Free AI running on your own device (nothing is sent to anyone). AI can make mistakes, so please read before you share.");
      else if (nano.api && !allowedBig()) {
        note.append("Simple helper (no AI yet). Your browser can add free on-device AI with a one-time download (large, use Wi-Fi). ",
          el("button", { type: "button", cls: "linkbtn", onclick: () => { store.set("qi_ai_ok", "1"); paintNote(); } }, "Turn on device AI"));
      } else if (nano.api) note.append("🔒 Free on-device AI is on. The first use downloads it once (use Wi-Fi). AI can make mistakes, so please read before you share.");
      else note.append("Simple helper: ideas, tidy-up and hashtags work on every phone. Smarter on-device AI appears automatically in browsers that have it, such as Chrome on a computer.");
    }

    async function run(fn) {
      if (busy) return; busy = true;
      [...box.querySelectorAll(".wh-acts button")].forEach(b => { b.disabled = true; });
      try { await fn(); } catch (e) { out.replaceChildren(el("p", { cls: "msg bad", text: "The AI helper could not finish this time. The simple helper still works; please try again." })); }
      finally { busy = false; [...box.querySelectorAll(".wh-acts button")].forEach(b => { b.disabled = false; }); }
    }

    // 💡 Ideas: AI ideas (English, then translated) or ready-made ideas in the chosen language.
    const doIdeas = () => run(async () => {
      const about = ta.value.trim();
      let list = [];
      if (canUseNano()) {
        wait("Thinking of ideas…");
        const task = (kind === "status" ? "Write 3 different one-line status updates (under 120 characters each, one emoji each)" : "Write 3 different short social posts (under 280 characters each)") +
          (about && guessLang(about) === "en" ? " based on this idea: " + about : " about orderly queues, letting people get off first, or safety in trains, metros and buses") + ". Put each on its own line.";
        const raw = nano.api === "LanguageModel" ? await lmPrompt(task, progress) : await writerWrite(task, progress);
        list = lines(raw).slice(0, 3);
        if (list.length && lang !== "en") {
          const tr = []; for (const l of list) { const t = await translate(l, "en", lang, progress).catch(() => null); if (!t) { tr.length = 0; break; } tr.push(t); }
          list = tr.length ? tr : [];
        }
      }
      if (!list.length) list = ideas(lang, 3);
      out.replaceChildren(...list.map(t => choice(t)), el("button", { type: "button", cls: "linkbtn", onclick: doIdeas }, "↻ More ideas"));
    });

    // ✍️ Improve: AI rewrite (English) or tidy-up (any language).
    const doImprove = () => run(async () => {
      const text = ta.value.trim();
      if (!text) return out.replaceChildren(el("p", { cls: "muted", text: "Type something first, or tap 💡 Ideas." }));
      const opts = [];
      const tidied = tidy(text);
      if (canUseNano() && (await detect(text)) === "en") {
        wait("Improving your text…");
        let a = null, b = null;
        a = await rewriterRewrite(text, { tone: "as-is", length: "as-is" }, progress).catch(() => null);
        b = await rewriterRewrite(text, { tone: "as-is", length: "shorter" }, progress).catch(() => null);
        if (!a && nano.api === "LanguageModel") a = await lmPrompt("Rewrite this so it is clear, polite and friendly. Keep the same meaning and language. Text: " + text, progress);
        if (!b && nano.api === "LanguageModel") b = await lmPrompt("Make this shorter (under " + (kind === "status" ? 120 : 200) + " characters), polite and friendly. Keep the meaning. Text: " + text, progress);
        [a, b].map(clean).filter(Boolean).forEach((t, i) => opts.push(choice(t, i ? "Use shorter" : "Use this")));
      }
      if (tidied !== text) opts.push(choice(tidied, "Use tidied text"));
      if (!opts.length) opts.push(el("p", { cls: "muted", text: canUseNano() ? "Your text already looks good! 👍" : "Your text already looks tidy. 👍 (Rewriting in your own words needs on-device AI, which this phone doesn't have.)" }));
      out.replaceChildren(...opts);
    });

    // 🌐 Translate into the chosen language.
    const doTranslate = () => run(async () => {
      const text = ta.value.trim();
      if (!text) return out.replaceChildren(el("p", { cls: "muted", text: "Type something first, then pick the language to translate into." }));
      const from = await detect(text);
      if (from === lang) return out.replaceChildren(el("p", { cls: "muted", text: "This already looks like " + LANGS[lang] + ". Pick another language above first." }));
      wait("Translating on your device…");
      const t = await translate(text, from, lang, progress).catch(() => null);
      if (t) return out.replaceChildren(choice(clean(t), "Use translation"), el("p", { cls: "wh-note", text: "Machine translation. Please check it reads right before you share." }));
      out.replaceChildren(el("p", { cls: "muted", text: "This phone can't translate on its own. You can use Google Translate for free (it opens outside the site), then copy the result back here." }),
        el("a", { cls: "sbtn", href: googleTranslate(text, lang), target: "_blank", rel: "noopener noreferrer" }, "Open Google Translate → " + LANGS[lang]));
    });

    // #️⃣ Hashtags: keyword tags, plus AI tags where available.
    const doTags = () => run(async () => {
      const text = ta.value;
      let tags = hashtags(text);
      if (canUseNano() && text.trim() && nano.api === "LanguageModel") {
        wait("Finding hashtags…");
        const raw = await lmPrompt("Suggest 4 short English hashtags (CamelCase, no spaces) for this post. Reply with only the hashtags. Post: " + text, progress).catch(() => "");
        const ai = (String(raw).match(/#[A-Za-z][A-Za-z0-9_]{1,30}/g) || []);
        const have = new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map(s => s.toLowerCase()));
        tags = [...new Set([...tags, ...ai])].filter(t => !have.has(t.toLowerCase())).slice(0, 8);
      }
      if (!tags.length) return out.replaceChildren(el("p", { cls: "muted", text: "You already have good hashtags. 👍" }));
      const chips = tags.map(t => el("button", { type: "button", cls: "sbtn wh-tag", onclick: e => { const v = ta.value.replace(/\s+$/, ""); set(v + (v ? (/#\S+$/.test(v) ? " " : "\n") : "") + t); e.target.remove(); } }, t));
      const all = el("button", { type: "button", cls: "sbtn main", onclick: () => { const v = ta.value.replace(/\s+$/, ""); const left = [...out.querySelectorAll(".wh-tag")].map(b => b.textContent); set(v + (v ? "\n" : "") + left.join(" ")); out.replaceChildren(); } }, "Add all");
      out.replaceChildren(el("p", { cls: "muted", text: "Tap a hashtag to add it:" }), el("div", { cls: "wh-tags" }, chips), all);
    });

    box.append(
      el("div", { cls: "wh-acts" },
        el("button", { type: "button", cls: "sbtn", onclick: doIdeas }, "💡 Ideas"),
        el("button", { type: "button", cls: "sbtn", onclick: doImprove }, "✍️ Improve"),
        el("button", { type: "button", cls: "sbtn", onclick: doTranslate }, "🌐 Translate"),
        el("button", { type: "button", cls: "sbtn", onclick: doTags }, "#️⃣ Hashtags"),
        sel),
      out, note);
    toggle.onclick = () => { const open = box.hidden; box.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); if (open) paintNote(); };
    wrap.append(toggle, box);
    return wrap;
  }

  const api = { panel, ideas, tidy, hashtags, guessLang, googleTranslate };
  if (typeof module === "object" && module.exports) module.exports = api; else root.QI_WRITE = api;
})(typeof window !== "undefined" ? window : globalThis);

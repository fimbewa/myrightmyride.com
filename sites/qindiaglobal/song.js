// "Pankti Mein Hum, Pragati Mein Desh" - the Qindiaglobal discipline song.
// Words and tune are original, written for qindiaglobal.com, and free for anyone to use (CC0).
// No audio file is downloaded: the tune is played by the browser itself (Web Audio), so it costs no data
// and there is no copyrighted recording. It never starts by itself; it plays only when the Play button is pressed.
(function () {
  const box = document.getElementById("song");
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!box) return;
  if (!AC) { box.classList.add("no-audio"); return; }

  const playBtn = document.getElementById("songPlay");
  const restartBtn = document.getElementById("songRestart");
  const bar = document.getElementById("songBar");
  const lines = Array.from(box.querySelectorAll(".lyrics [data-line]"));

  // ---------- the tune (D major, 92 beats a minute, 4 beats a bar) ----------
  const BPM = 92, E = 60 / BPM / 2;            // E = length of one eighth note in seconds
  const TONIC = 293.66;                        // D4
  const STEPS = [0, 2, 4, 5, 7, 9, 11];
  const hz = (deg, oct = 0) => {               // scale degree (1 = D, 8 = D above, 0 = C# below) to frequency
    const i = ((deg - 1) % 7 + 7) % 7, o = Math.floor((deg - 1) / 7) + oct;
    return TONIC * Math.pow(2, (STEPS[i] + 12 * o) / 12);
  };
  const CH = { I: [1, 3, 5], ii: [2, 4, 6], IV: [4, 6, 8], V: [5, 7, 9], vi: [6, 8, 10] };

  // Each phrase is two bars: melody as [degree, eighths], chords as [name, beats].
  const P = {
    v1: { m: [[3,1],[3,1],[2,1],[3,1],[5,1],[5,1],[4,1],[3,1],[2,1],[2,1],[3,1],[4,1],[3,4]], c: [["I",4],["V",2],["I",2]] },
    v2: { m: [[3,1],[3,1],[2,1],[1,1],[2,1],[2,1],[3,1],[2,1],[1,1],[0,1],[1,1],[2,1],[1,4]], c: [["vi",4],["V",2],["I",2]] },
    v3: { m: [[5,1],[5,1],[6,1],[5,1],[8,2],[7,1],[6,1],[5,1],[4,1],[3,1],[4,1],[5,4]], c: [["I",4],["IV",2],["I",2]] },
    v4: { m: [[6,1],[5,1],[4,1],[3,1],[2,2],[3,1],[4,1],[3,1],[2,1],[1,1],[2,1],[1,4]], c: [["IV",2],["ii",2],["V",2],["I",2]] },
    c1: { m: [[5,2],[5,1],[6,1],[8,4],[8,1],[7,1],[6,1],[7,1],[8,4]], c: [["I",4],["IV",2],["I",2]] },
    c2: { m: [[8,1],[8,1],[9,1],[8,1],[7,1],[6,1],[5,2],[6,1],[6,1],[5,1],[4,1],[5,4]], c: [["vi",2],["IV",2],["V",4]] },
    c3: { m: [[5,1],[6,1],[8,2],[5,1],[6,1],[8,2],[9,1],[8,1],[7,1],[6,1],[7,4]], c: [["IV",2],["I",2],["V",4]] },
    c4: { m: [[8,1],[8,1],[8,1],[7,1],[6,1],[5,1],[6,1],[8,1],[5,1],[4,1],[3,1],[2,1],[1,4]], c: [["vi",2],["IV",2],["V",2],["I",2]] },
    end: { m: [[1,8],[8,8]], c: [["I",8]] }
  };
  // Song order. "line" = which lyric line lights up (index in the lyrics list), or -1 for music only.
  const V = ["v1", "v2", "v3", "v4"], C = ["c1", "c2", "c3", "c4"];
  const ORDER = [["c1", -1, 0.55], ["c4", -1, 0.55]];
  let n = 0;
  const add = (keys, soft) => keys.forEach(k => ORDER.push([k, n++, soft]));
  add(V, 0.8); add(C, 1);       // verse 1, chorus
  add(V, 0.8); add(C, 1);       // verse 2, chorus
  add(V, 0.8); add(C, 1);       // verse 3, chorus
  ORDER.push(["end", -1, 0.7]);
  const PHRASE = 16 * E, TOTAL = ORDER.length * PHRASE;

  // ---------- instruments ----------
  let ctx = null, master = null, wet = null, startAt = 0, timer = 0, next = 0, raf = 0;

  function reverb() {
    const len = Math.floor(ctx.sampleRate * 2.2), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const c = ctx.createConvolver(); c.buffer = buf; return c;
  }
  function env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }
  function flute(f, t, dur, vol) {             // soft bansuri-like lead with a gentle vibrato
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = "triangle"; o.frequency.value = f; o2.type = "sine"; o2.frequency.value = f * 2;
    lfo.frequency.value = 5.2; lg.gain.value = f * 0.006; lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const g2 = ctx.createGain(); g2.gain.value = 0.18; o2.connect(g2); g2.connect(g); o.connect(g);
    env(g, t, 0.04, 0.22 * vol, Math.max(0.02, dur - 0.12), 0.25);
    g.connect(master); g.connect(wet);
    [o, o2, lfo].forEach(x => { x.start(t); x.stop(t + dur + 0.4); });
  }
  function pad(degs, t, dur, vol) {            // warm strings-like chord
    degs.forEach(d => [-0.06, 0.06].forEach(det => {
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.value = hz(d, -1) * Math.pow(2, det / 12);
      lp.type = "lowpass"; lp.frequency.value = 900;
      env(g, t, 0.25, 0.022 * vol, Math.max(0, dur - 0.3), 0.5);
      o.connect(lp); lp.connect(g); g.connect(master); g.connect(wet);
      o.start(t); o.stop(t + dur + 0.6);
    }));
  }
  function bass(f, t, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    env(g, t, 0.02, 0.28 * vol, Math.max(0, dur * 0.5), dur * 0.5);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.1);
  }
  let noise = null;
  function drum(low, t, vol) {                 // dholak-like: deep "dha" and bright "na"
    if (low) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
      env(g, t, 0.005, 0.45 * vol, 0, 0.3); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.35);
    } else {
      const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 2.5;
      env(g, t, 0.002, 0.16 * vol, 0, 0.09); s.connect(bp); bp.connect(g); g.connect(master); g.connect(wet);
      s.start(t); s.stop(t + 0.12);
      const o = ctx.createOscillator(), g2 = ctx.createGain(); o.frequency.value = 660;
      env(g2, t, 0.002, 0.05 * vol, 0, 0.12); o.connect(g2); g2.connect(master); o.start(t); o.stop(t + 0.15);
    }
  }
  const KEHERWA = [1, 1, 0, 0, 0, 0, 1, 0];    // 1 = low "dha", 0 = high "na", one per eighth note

  function phrase(i, t0) {
    const [key, , vol] = ORDER[i], p = P[key];
    let t = t0;
    for (const [d, len] of p.m) { flute(hz(d), t, len * E, vol); t += len * E; }
    t = t0;
    for (const [name, beats] of p.c) {
      const dur = beats * 2 * E;
      pad(CH[name], t, dur, vol);
      bass(hz(CH[name][0], -2), t, dur, vol);
      t += dur;
    }
    if (key !== "end") for (let b = 0; b < 16; b++) drum(KEHERWA[b % 8], t0 + b * E, vol * (b % 8 === 0 ? 1 : 0.8));
    else drum(1, t0, 0.8);
  }

  // ---------- playing, pausing and following the words ----------
  function schedule() {
    const ahead = ctx.currentTime + 1.2;
    while (next < ORDER.length && startAt + next * PHRASE < ahead) { phrase(next, startAt + next * PHRASE); next++; }
  }
  function follow() {
    if (!ctx) return;
    const pos = ctx.currentTime - startAt;
    bar.style.width = Math.min(100, (pos / TOTAL) * 100) + "%";
    const idx = Math.floor(pos / PHRASE), cur = idx >= 0 && idx < ORDER.length ? ORDER[idx][1] : -1;
    lines.forEach((el, k) => el.classList.toggle("on", k === cur));
    const on = lines[cur];
    if (on && on.dataset.seen !== "1" && box.classList.contains("follow")) {
      lines.forEach(l => (l.dataset.seen = ""));
      on.dataset.seen = "1";
      const list = box.querySelector(".lyrics");
      list.scrollTo({ top: Math.max(0, on.offsetTop - list.clientHeight / 3), behavior: "smooth" });
    }
    if (pos >= TOTAL + 1.5) { stop(); return; }
    raf = requestAnimationFrame(follow);
  }
  function start() {
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    const rv = reverb(); wet = ctx.createGain(); wet.gain.value = 0.35; wet.connect(rv); rv.connect(comp);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    startAt = ctx.currentTime + 0.15; next = 0;
    schedule(); timer = setInterval(schedule, 250);
    box.classList.add("playing", "follow"); restartBtn.hidden = false;
    raf = requestAnimationFrame(follow);
  }
  function stop() {
    clearInterval(timer); cancelAnimationFrame(raf);
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
    box.classList.remove("playing", "paused", "follow");
    lines.forEach(l => { l.classList.remove("on"); l.dataset.seen = ""; });
    bar.style.width = "0%"; restartBtn.hidden = true;
  }
  playBtn.addEventListener("click", () => {
    if (!ctx) return start();
    if (ctx.state === "running") { ctx.suspend(); box.classList.add("paused"); box.classList.remove("playing"); }
    else { ctx.resume(); box.classList.add("playing"); box.classList.remove("paused"); }
  });
  restartBtn.addEventListener("click", () => { stop(); start(); });
  // Pause when the visitor leaves the page or switches app on a phone.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && ctx && ctx.state === "running") playBtn.click();
  });
})();

// Shared by /advertise and the owner's ads page: shrink a chosen picture on the phone before sending it,
// and (for /advertise) the "only humans" proof the server asks for (same as the forms on the home page).
window.QI_ADS = (function () {
  // Picture -> JPEG data link, at most 1200 px wide, under ~600 KB.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve("");
      if (!/^image\//.test(file.type)) return reject(new Error("Please choose a picture file (JPG or PNG)."));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        const k = Math.min(1, 1200 / w); w = Math.round(w * k); h = Math.round(h * k);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
        let q = 0.85, out = c.toDataURL("image/jpeg", q);
        while (out.length > 800000 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This picture could not be opened. Try another one.")); };
      img.src = url;
    });
  }
  let ticket = null, ticketAt = 0;
  const newTicket = () => { ticketAt = Date.now(); ticket = fetch("/api/human").then(r => r.json()).catch(() => null); };
  const K256 = []; (() => { const f = x => (x - Math.floor(x)) * 2 ** 32 | 0; let n = 2, c = 0; while (c < 64) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) K256[c++] = f(Math.cbrt(n)); n++; } })();
  function sha256hex(str) {
    const bytes = [...str].map(ch => ch.charCodeAt(0) & 255), l = bytes.length;
    bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
    const bits = l * 8; for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < bytes.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (k + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = h.map((x, i) => (x + [a, b, c, d, e, f, g, k][i]) | 0);
    }
    return h.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  async function prove() {
    if (!ticket) newTicket();
    const tk = await ticket, wait = ticketAt + 3300 - Date.now(); newTicket();
    if (!tk) return {};
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    for (let n = 0; n < 5e6; n++) if (sha256hex(tk.token + ":" + n).startsWith(tk.work)) return { human: tk.token, n };
    return {};
  }
  return { shrink, prove, start: newTicket };
})();

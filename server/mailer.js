// Sending short emails (password reset codes) for free, with no extra packages.
// Two free choices, set by the site owner on /admin (stored in s_settings as "mail"):
//   Gmail:  { kind: "gmail", user: "name@gmail.com", pass: "<16-letter Google app password>" }
//           Sent through smtp.gmail.com:465 from the owner's own Gmail (about 500 emails a day, free).
//   Brevo:  { kind: "brevo", key: "<API key>", from: "<sender email verified on Brevo>" }
//           Sent through Brevo's web API (300 emails a day on the free plan).
const tls = require("tls");

const clean = s => String(s || "").replace(/[\r\n]/g, " ").trim();

// A very small SMTP client (implicit TLS on port 465, AUTH LOGIN). `connect` can be replaced in tests.
function smtpSend({ host = "smtp.gmail.com", port = 465, user, pass, from, fromName, to, subject, text, connect, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const sock = connect ? connect() : tls.connect({ host, port, servername: host });
    let buf = "", step = 0, done = false;
    const fail = e => { if (done) return; done = true; sock.destroy(); reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error("The email server did not answer in time.")), timeoutMs);
    const send = s => sock.write(s + "\r\n");
    const b64 = s => Buffer.from(String(s), "utf8").toString("base64");
    const enc = s => (/^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(s) + "?=");
    const body = String(text).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const message = [
      `From: ${enc(clean(fromName || "Qindiaglobal"))} <${clean(from || user)}>`, `To: <${clean(to)}>`, `Subject: ${enc(clean(subject))}`,
      `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      b64(body).replace(/.{1,76}/g, "$&\r\n").trimEnd(),
    ].join("\r\n");
    // Each step: the reply code we expect, then what we send next.
    const steps = [
      [220, () => send("EHLO qindiaglobal.com")],
      [250, () => send("AUTH LOGIN")],
      [334, () => send(b64(user))],
      [334, () => send(b64(pass))],
      [235, () => send(`MAIL FROM:<${clean(from || user)}>`)],
      [250, () => send(`RCPT TO:<${clean(to)}>`)],
      [250, () => send("DATA")],
      [354, () => send(message + "\r\n.")],
      [250, () => { send("QUIT"); done = true; clearTimeout(timer); sock.end(); resolve({ ok: true }); }],
    ];
    sock.setEncoding("utf8");
    sock.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
        if (/^\d{3}-/.test(l)) continue; // more lines of the same reply follow
        const code = Number(l.slice(0, 3));
        if (done || step >= steps.length) continue;
        const [want, next] = steps[step];
        if (code !== want) {
          const why = code === 535 ? "Gmail did not accept the address or app password." : "The email server said: " + l.slice(0, 200);
          return fail(new Error(why));
        }
        step++; next();
      }
    });
    sock.on("error", e => fail(new Error("Could not reach the email server (" + e.message + ").")));
    sock.on("close", () => fail(new Error("The email server closed the connection.")));
  });
}

async function brevoSend({ key, from, fromName, to, subject, text }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: from, name: fromName || "Qindiaglobal" }, to: [{ email: to }], subject, textContent: text }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error("Brevo did not send the email (" + res.status + (d.message ? ": " + String(d.message).slice(0, 200) : "") + ").");
  }
  return { ok: true };
}

// cfg is the saved "mail" setting. Returns a promise; rejects with a plain-language error.
function sendMail(cfg, { to, subject, text }) {
  if (!cfg) return Promise.reject(new Error("Email is not set up yet."));
  if (process.env.QI_MAIL_TEST === "1") { (sendMail.outbox = sendMail.outbox || []).push({ to, subject, text }); return Promise.resolve({ ok: true }); }
  if (cfg.kind === "gmail") return smtpSend({ user: cfg.user, pass: cfg.pass, from: cfg.user, fromName: cfg.name, to, subject, text });
  if (cfg.kind === "brevo") return brevoSend({ key: cfg.key, from: cfg.from, fromName: cfg.name, to, subject, text });
  return Promise.reject(new Error("Email is not set up yet."));
}
const mailReady = cfg => !!(cfg && ((cfg.kind === "gmail" && cfg.user && cfg.pass) || (cfg.kind === "brevo" && cfg.key && cfg.from)));

module.exports = { sendMail, mailReady, smtpSend };

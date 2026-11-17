// Sending the login OTP by SMS.
// SMS is the only part of the site that costs money per use (charged by the SMS company, not by us).
// Choose a provider in .env:
//   SMS_PROVIDER=console  -> no SMS is sent; the code is printed in the server log (and shown on screen if SHOW_OTP_ON_SCREEN=true). For testing only.
//   SMS_PROVIDER=http     -> calls any SMS company's HTTP API. Set SMS_HTTP_URL with {phone} and {otp} placeholders,
//                            e.g. https://api.example-sms.in/send?key=XXX&to={phone}&msg=Your+myrightmyride+OTP+is+{otp}
//                            Optional SMS_HTTP_METHOD=POST and SMS_HTTP_BODY (also with placeholders), SMS_HTTP_HEADERS as JSON.
async function sendOtp(phone, otp) {
  const provider = (process.env.SMS_PROVIDER || "console").toLowerCase();
  if (provider === "http") {
    const fill = s => String(s || "").replaceAll("{phone}", encodeURIComponent(phone)).replaceAll("{otp}", encodeURIComponent(otp));
    const method = (process.env.SMS_HTTP_METHOD || "GET").toUpperCase();
    let headers = {};
    try { headers = JSON.parse(process.env.SMS_HTTP_HEADERS || "{}"); } catch { /* ignore */ }
    const res = await fetch(fill(process.env.SMS_HTTP_URL), {
      method,
      headers,
      body: method === "GET" ? undefined : String(process.env.SMS_HTTP_BODY || "").replaceAll("{phone}", phone).replaceAll("{otp}", otp),
    });
    if (!res.ok) throw new Error("SMS provider returned " + res.status);
    return { delivered: true };
  }
  console.log(`[OTP] ${phone}: ${otp}`);
  return { delivered: false, showOnScreen: process.env.SHOW_OTP_ON_SCREEN === "true" };
}

module.exports = { sendOtp };

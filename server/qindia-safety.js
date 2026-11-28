// qindiaglobal.com safety: the "only humans" check for the forms, and the filter for rude, sexual or abusive words.
const crypto = require("crypto");

// ---------- only humans ----------
// The page asks for a signed token when it opens. To send a form it must (1) wait a few seconds, the time a person
// needs to type, and (2) do a small sum in the browser (about half a second on a phone). Each token works once.
// Robots that post straight to the API, or fill forms instantly, are refused. Reading the site (and Google) is not affected.
const MIN_FILL_MS = Number(process.env.QI_MIN_FILL_MS ?? 3000);
const MAX_AGE_MS = 6 * 3600_000;
const WORK = "000"; // sha256(token + ":" + n) must start with these hex digits

function humanCheck(secret) {
  const used = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of used) if (t - v > MAX_AGE_MS) used.delete(k); }, 3600_000).unref();
  const sign = s => crypto.createHmac("sha256", secret).update(s).digest("hex").slice(0, 32);
  return {
    issue() {
      const body = Date.now().toString(36) + "." + crypto.randomBytes(9).toString("hex");
      return { token: body + "." + sign(body), work: WORK };
    },
    // Returns "" when fine, else a short reason.
    verify(token, n) {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return "missing";
      const body = parts[0] + "." + parts[1];
      const a = Buffer.from(sign(body)), b = Buffer.from(parts[2]);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "forged";
      const age = Date.now() - parseInt(parts[0], 36);
      if (!(age >= MIN_FILL_MS)) return "too fast";
      if (age > MAX_AGE_MS) return "expired";
      if (used.has(parts[1])) return "used";
      const h = crypto.createHash("sha256").update(token + ":" + String(n)).digest("hex");
      if (!h.startsWith(WORK)) return "no work";
      used.set(parts[1], Date.now());
      return "";
    },
  };
}
// Same sum as the browser does; used by tests.
function solve(token) {
  for (let n = 0; ; n++) if (crypto.createHash("sha256").update(token + ":" + n).digest("hex").startsWith(WORK)) return n;
}

// ---------- rude, sexual or abusive words, links and ads ----------
// A basic list in English, Hinglish and Indian languages. It cannot catch everything, which is why every
// Pledge wall line also waits for the owner's approval before anyone sees it.
const STEMS = [ // any word starting with these
  "fuck", "motherf", "bitch", "asshole", "cunt", "slut", "whore", "porn", "nude", "naked", "xxx", "boob", "nsfw", "onlyfans",
  "rape", "rapist", "nigg", "fagg", "pedo", "paedo", "blowjob", "handjob", "hentai", "milf", "camgirl", "callgirl",
  "madarchod", "maderchod", "madarchot", "behenchod", "bhenchod", "benchod", "bhanchod", "behnchod", "chutiy", "chutia", "chodu", "choot",
  "gaandu", "gandu", "randi", "raand", "harami", "bhosd", "bhosad", "lavd", "lawd", "jhaat", "jhant",
  "chinal", "chhinal", "zavad", "zhavad", "zhavn", "zavn", "kutriya", "bhadv", "bhadw", "hijd",
  "punda", "thevdiya", "lanja", "soole", "thullu", "myre", "khanki", "fuddi", "lulli",
];
const WORDS = new Set([ // exact words only
  "shit", "dick", "dicks", "cock", "cocks", "pussy", "sex", "sexy", "sexual", "tit", "tits", "lund", "loda", "lodu", "gaand",
  "lauda", "laude", "lavde", "chod", "chodo", "bsdk", "mkc", "bkl", "wtf", "stfu", "kamina", "kamine", "kutte",
]);
const SCRIPT_BITS = [ // Indian scripts and Urdu: matched anywhere in the text
  "मादरचोद", "भेनचोद", "बहनचोद", "बहिनचोद", "चूतिय", "चुतिय", "चोद", "गांडू", "गाण्ड", "गांड", "रंडी", "रांड", "हरामी", "भोसड", "लंड", "लौड़", "लौडा", "लवडा", "लोडा", "झाट",
  "छिनाल", "झवाड", "झवण", "सेक्स", "पोर्न", "नंगी", "नंगा", "कुत्ती", "भड़व", "भडव",
  "চুদ", "মাগি", "খানকি", "ভোদা",
  "ஓத்த", "புண்ட", "தேவடியா", "தேவிடியா", "சுன்னி",
  "దెంగ", "లంజ", "పూకు", "మొడ్డ",
  "ಸೂಳೆ", "ತುಲ್ಲ", "ಬೋಳಿ", "ತುಣ್ಣೆ",
  "പൂറ", "മൈര", "കുണ്ണ", "പുലയാടി",
  "ભોસ", "ચોદ", "રંડી", "લોડો", "ગાંડુ",
  "ਭੈਣਚੋਦ", "ਫੁੱਦੀ", "ਚੋਦ", "ਲੰਡ",
  "ଚୋଦ", "ବେଶ୍ୟା",
  "مادرچود", "بہن چود", "بہنچود", "چوتیا", "رنڈی", "حرامی",
];
const LINK = /(https?:|www\.|\b[a-z0-9-]+\.(com|in|net|org|info|xyz|biz|io|co|me|ly|site|online|club|top|app|link|live)\b|t\.me\b|wa\.me\b|bit\.ly|@[a-z0-9_]{3,})/i;
const PHONE = /(\d[\s-]?){8,}/;
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };

// true when the text has a rude/sexual/abusive word. withLinks: also refuse links, handles and phone numbers (public text).
function isBad(text, withLinks = true) {
  const s = String(text || "");
  if (!s) return false;
  if (withLinks && (LINK.test(s) || PHONE.test(s))) return true;
  const low = s.toLowerCase();
  const spaced = " " + low.replace(/\s+/g, " ") + " ";
  if (SCRIPT_BITS.some(w => spaced.includes(w))) return true;
  const latin = low.replace(/[0-9@$!]/g, c => LEET[c] || c).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const words = latin.split(/[^a-z]+/).filter(Boolean);
  const squashed = latin.replace(/[^a-z]/g, ""); // catches "f.u.c.k" and "f u c k"
  if (words.some(w => WORDS.has(w) || STEMS.some(st => w.startsWith(st)))) return true;
  return ["fuck", "motherf", "madarchod", "behenchod", "bhenchod", "chutiya", "porn", "blowjob", "onlyfans"].some(st => squashed.includes(st));
}

// Lines that pass the filter are shown at once. These "doubtful" ones wait for the owner instead:
// shouting in capitals, lots of symbols or repeated letters, angry words, or politics/religion (rules say no attacks).
const DOUBT_WORDS = [
  "kill", "die", "dead", "hate", "stupid", "idiot", "fool", "bloody", "damn", "hell", "shame", "useless", "beat", "slap", "attack",
  "modi", "rahul", "gandhi family", "bjp", "congress", "shiv sena", "election", "vote", "party", "hindu", "muslim", "islam",
  "christian", "sikh", "jihad", "allah", "pakistan", "caste", "dalit", "brahmin", "bihari", "madrasi", "bhaiya", "outsider",
  "नफ़रत", "नफरत", "बेवकूफ", "मूर्ख", "पागल", "चुनाव", "वोट", "पार्टी", "हिंदू", "हिन्दू", "मुस्लिम", "मुसलमान", "जाति", "भाजपा", "कांग्रेस",
  "मूर्ख", "वेडा", "मराठी माणूस", "भैया",
];
function isDoubtful(text) {
  const s = String(text || ""), low = " " + s.toLowerCase() + " ";
  const letters = s.match(/[a-z]/gi) || [], caps = s.match(/[A-Z]/g) || [];
  if (letters.length >= 10 && caps.length / letters.length > 0.6) return true;
  if (/(.)\1{4,}/u.test(s)) return true;
  const symbols = s.replace(/https?:\/\/\S+/g, "").replace(/[\p{L}\p{M}\p{N}\s.,!?'"()-]/gu, "");
  if (symbols.length > Math.max(3, s.length * 0.15)) return true;
  return DOUBT_WORDS.some(w => /^[a-z ]+$/.test(w) ? new RegExp("[^a-z]" + w + "[^a-z]").test(low) : low.includes(w));
}

module.exports = { humanCheck, solve, isBad, isDoubtful, MIN_FILL_MS };

// Everything the owner can change from the admin panel, with its starting values.
// Values are stored in the `settings` table; anything not saved yet falls back to these defaults.
const db = require("./db");

const DEFAULTS = {
  siteName: "myrightmyride.com",
  tagline: "Bike · Auto · Car. No commission from drivers or passengers.",
  noCommissionText:
    "myrightmyride.com takes no commission from drivers or passengers. The final fare is what the vehicle's own meter shows, or the fare the passenger decides at booking, and you pay the driver directly by cash, UPI (GPay, PhonePe, Paytm or any UPI app) or card after the ride. Payments are free: the site never takes a fee or handles your money.",
  governmentDisclaimer:
    "myrightmyride.com is a citizens' initiative. It is not approved by, or connected with, any government body.",
  safetyText:
    "Your safety is your own responsibility. Before choosing a ride, take care to protect yourself against theft, injury or other harm. We recommend insuring every ride, either with the optional ride cover offered at booking by our partner insurers or with your own accident and personal insurance. myrightmyride.com only connects passengers and drivers.",
  safetyCheckbox:
    "I understand that my safety is my own responsibility. Before choosing a ride I will take care to protect myself against theft, injury or other harm, and I have been advised to insure my ride.",
  payUndertakingMeter:
    "I am booking this ride and undertake to pay the charges as per the vehicle's meter directly to the driver.",
  payUndertakingFixed:
    "I am booking this ride and undertake to pay the fare I have decided directly to the driver.",
  driverUndertaking:
    "I undertake to charge passengers only as per my vehicle's meter, or the fare decided by the passenger, and within the permissible fare limits.",
  vehicles: [
    { key: "bike", name: "Bike", active: true },
    { key: "auto", name: "Auto", active: true },
    { key: "car", name: "Car", active: true },
  ],
  insurancePlans: [
    { key: "basic", name: "Basic ride cover", details: "Accident cover for this ride. Details coming soon.", price: null, active: true },
    { key: "plus", name: "Plus ride cover", details: "Accident cover plus theft of belongings. Details coming soon.", price: null, active: true },
  ],
  insuranceNote: "Plans, prices and cover amounts are being finalised with licensed partner insurers. No payment is taken here.",
  // While true, visitors see the "Coming soon" page and cannot log in or book. The owner can still preview the site.
  comingSoon: true,
  allowPassengerFare: true,
  requireDriverApproval: true,
  // Map services. Defaults are the free public OpenStreetMap services, fine for testing.
  // For real traffic, run your own copies on your server and put their addresses here.
  tileUrl: "/tiles/{z}/{x}/{y}.png", // served and cached by our own server (see server/tiles.js)
  tileAttribution: "© OpenStreetMap contributors",
  searchUrl: "https://photon.komoot.io",
  overpassUrl: "https://overpass-api.de/api/interpreter",
};

const PUBLIC_KEYS = Object.keys(DEFAULTS);

function getAll() {
  const out = { ...DEFAULTS };
  for (const row of db.prepare("SELECT key, value FROM settings").all()) {
    if (row.key in DEFAULTS) {
      try { out[row.key] = JSON.parse(row.value); } catch { /* keep default */ }
    }
  }
  // Older installs saved OpenStreetMap's address directly; switch them to our own cached tiles.
  if (out.tileUrl === "https://tile.openstreetmap.org/{z}/{x}/{y}.png") out.tileUrl = DEFAULTS.tileUrl;
  return out;
}

function get(key) { return getAll()[key]; }

function save(patch) {
  const up = db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const tx = db.transaction(p => {
    for (const [k, v] of Object.entries(p)) {
      if (!(k in DEFAULTS)) continue;
      if (typeof DEFAULTS[k] !== typeof v && !(Array.isArray(DEFAULTS[k]) && Array.isArray(v))) continue;
      up.run(k, JSON.stringify(v));
    }
  });
  tx(patch);
  return getAll();
}

module.exports = { DEFAULTS, PUBLIC_KEYS, getAll, get, save };

// Map tiles served through our own server, with a disk cache.
// Browsers ask /tiles/{z}/{x}/{y}.png; we fetch each tile once from the upstream tile server (OpenStreetMap by default),
// keep it for 7 days and serve every later request from disk. This keeps load on OpenStreetMap's volunteer servers low,
// follows their tile usage policy (identifying User-Agent, caching), and costs nothing per use.
// For very high traffic, run your own tile server and set TILE_UPSTREAM in .env (or change the tile address in the owner panel).
const fs = require("fs");
const path = require("path");

const UPSTREAM = process.env.TILE_UPSTREAM || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DIR = process.env.TILE_CACHE_DIR || path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, "..", "data", "x.db")), "tiles");
const MAX_AGE = 7 * 24 * 3600_000;
const UA = "myrightmyride.com/1.0 (zero-commission ride booking; tile cache; +https://myrightmyride.com)";
const inflight = new Map();

async function fetchTile(z, x, y, file) {
  const url = UPSTREAM.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://myrightmyride.com/" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("upstream " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, file);
  return buf;
}

function handler(req, res) {
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(String(req.params.y).replace(/\.png$/, ""));
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= n || y >= n) return res.status(404).end();
  const file = path.join(DIR, String(z), String(x), y + ".png");
  const send = buf => res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }).send(buf);
  fs.stat(file, async (err, st) => {
    const fresh = !err && Date.now() - st.mtimeMs < MAX_AGE;
    if (fresh) return res.set("Cache-Control", "public, max-age=86400").sendFile(file);
    const key = file;
    try {
      if (!inflight.has(key)) inflight.set(key, fetchTile(z, x, y, file).finally(() => inflight.delete(key)));
      send(await inflight.get(key));
    } catch (e) {
      if (!err) return res.set("Cache-Control", "public, max-age=3600").sendFile(file); // serve the old copy if upstream fails
      res.status(502).end();
    }
  });
}

module.exports = { handler };

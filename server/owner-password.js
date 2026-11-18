// The owner password from ADMIN_PASSWORD. Spaces and quote marks around it are ignored, because web panels
// (such as Hostinger's Docker Manager) sometimes keep the quotes that people type around the value.
module.exports = function ownerPassword() {
  return String(process.env.ADMIN_PASSWORD || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
};

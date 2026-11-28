// Q India Community: group chats and Status / Stories. Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qig-"));
process.env.DB_FILE = path.join(dir, "test.db");
process.env.ADMIN_PASSWORD = "testpass123";
process.env.QI_MIN_FILL_MS = "0";
const { solve } = require("../server/qindia-safety");
const { server } = require("../server/index.js");
let port;
before(() => new Promise(r => server.listen(0, () => { port = server.address().port; r(); })));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let ipN = 1;
function call(method, p, body, { token, raw, ip } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw || (body ? JSON.stringify(body) : null);
    const req = http.request({ port, path: p, method, headers: { host: "qindiaglobal.com", "content-type": raw ? "application/octet-stream" : "application/json", "x-forwarded-for": ip || "10.0.0.1", ...(token ? { authorization: "Bearer " + token } : {}) } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => { const s = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(s); } catch {} resolve({ status: res.statusCode, data: json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
async function signup(username) {
  const { token } = (await call("GET", "/api/human")).data;
  return (await call("POST", "/api/s/signup", { username, name: username.toUpperCase(), password: "password1", agree: true, human: token, n: solve(token) }, { ip: "10.0.2." + ipN++ })).data.token;
}
const follow = (tok, who) => call("POST", `/api/s/users/${who}/follow`, { follow: true }, { token: tok });
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);

let A, B, C, D, G;
test("groups: create, add only followers, send, unread, admins, only-admins, invite link, leave", async () => {
  A = await signup("anita"); B = await signup("bhim"); C = await signup("chitra"); D = await signup("deepak");
  await follow(B, "anita"); await follow(C, "anita");
  // deepak does not follow anita: cannot be added
  assert.equal((await call("POST", "/api/s/groups", { name: "Dadar queue team", members: ["bhim", "deepak"] }, { token: A })).status, 400);
  assert.equal((await call("POST", "/api/s/groups", { name: "", members: [] }, { token: A })).status, 400);
  const g = await call("POST", "/api/s/groups", { name: "Dadar queue team", members: ["bhim"] }, { token: A });
  assert.equal(g.status, 200); G = g.data.id;
  // only members can open it
  assert.equal((await call("GET", "/api/s/groups/" + G, null, { token: C })).status, 404);
  assert.equal((await call("POST", `/api/s/groups/${G}/messages`, { text: "hi" }, { token: C })).status, 404);
  const sent = await call("POST", `/api/s/groups/${G}/messages`, { text: "Line up at gate 2 tomorrow" }, { token: A });
  assert.equal(sent.status, 200);
  assert.equal((await call("GET", "/api/s/me", null, { token: B })).data.messages, 1, "bhim has one unread chat");
  const open = await call("GET", "/api/s/groups/" + G, null, { token: B });
  assert.equal(open.data.group.name, "Dadar queue team"); assert.equal(open.data.people.length, 2);
  assert.ok(open.data.messages.some(m => m.info && /created/.test(m.text)));
  assert.equal(open.data.messages.at(-1).user.username, "anita");
  assert.equal((await call("GET", "/api/s/me", null, { token: B })).data.messages, 0, "read now");
  assert.equal((await call("GET", "/api/s/groups", null, { token: B })).data.groups[0].last, "ANITA: Line up at gate 2 tomorrow");
  // members cannot add or remove; admins can
  assert.equal((await call("POST", `/api/s/groups/${G}/members`, { add: ["chitra"] }, { token: B })).status, 403);
  assert.equal((await call("POST", `/api/s/groups/${G}/members`, { add: ["chitra"] }, { token: A })).status, 200);
  assert.equal((await call("POST", `/api/s/groups/${G}/members/bhim`, { action: "admin" }, { token: A })).status, 200);
  assert.equal((await call("GET", "/api/s/groups/" + G, null, { token: B })).data.group.admin, true);
  // only admins can send
  assert.equal((await call("POST", "/api/s/groups/" + G, { onlyAdmins: true }, { token: A })).status, 200);
  assert.equal((await call("POST", `/api/s/groups/${G}/messages`, { text: "me too" }, { token: C })).status, 403);
  assert.equal((await call("POST", `/api/s/groups/${G}/messages`, { text: "ok" }, { token: B })).status, 200);
  await call("POST", "/api/s/groups/" + G, { onlyAdmins: false }, { token: A });
  // photo in a group
  const ph = (await call("POST", "/api/s/upload", null, { token: C, raw: JPG })).data.id;
  assert.equal((await call("POST", `/api/s/groups/${G}/messages`, { photo: ph }, { token: C })).status, 200);
  // invite link: deepak joins
  const inv = (await call("GET", "/api/s/groups/" + G, null, { token: A })).data.group.invite;
  assert.match(inv, /^[a-z0-9]{10}$/);
  assert.equal((await call("GET", "/api/s/join/" + inv, null, { token: D })).data.group.member, false);
  assert.equal((await call("POST", "/api/s/join/" + inv, {}, { token: D })).data.id, G);
  assert.equal((await call("GET", "/api/s/groups/" + G, null, { token: D })).data.group.members, 4);
  // reset link: old one stops working
  await call("POST", "/api/s/groups/" + G, { invite: "reset" }, { token: A });
  assert.equal((await call("GET", "/api/s/join/" + inv, null, { token: D })).status, 404);
  // admin removes deepak
  assert.equal((await call("POST", `/api/s/groups/${G}/members/deepak`, { action: "remove" }, { token: A })).status, 200);
  assert.equal((await call("GET", "/api/s/groups/" + G, null, { token: D })).status, 404);
  // a member deletes own message; an admin deletes anyone's
  const m2 = (await call("POST", `/api/s/groups/${G}/messages`, { text: "oops" }, { token: C })).data.id;
  assert.equal((await call("POST", `/api/s/group-messages/${m2}/delete`, {}, { token: A })).status, 200);
  // the last admin leaves: someone else becomes admin
  await call("POST", `/api/s/groups/${G}/members/bhim`, { action: "member" }, { token: A });
  assert.equal((await call("POST", `/api/s/groups/${G}/leave`, {}, { token: A })).status, 200);
  const after = (await call("GET", "/api/s/groups/" + G, null, { token: B })).data;
  assert.equal(after.people.filter(p => p.admin).length, 1);
  assert.ok(after.messages.some(m => m.info && /left/.test(m.text)));
});

test("group reports reach the owner, who can delete the message or close the group", async () => {
  const m = (await call("POST", `/api/s/groups/${G}/messages`, { text: "bad words here" }, { token: B })).data.id;
  assert.equal((await call("POST", "/api/s/report", { kind: "groupmsg", id: m, reason: "abuse" }, { token: B })).status, 404, "not own message");
  assert.equal((await call("POST", "/api/s/report", { kind: "groupmsg", id: m, reason: "abuse" }, { token: D })).status, 404, "not a member");
  assert.equal((await call("POST", "/api/s/report", { kind: "groupmsg", id: m, reason: "abuse" }, { token: C })).status, 200);
  assert.equal((await call("POST", "/api/s/report", { kind: "group", id: G, reason: "spam" }, { token: C })).status, 200);
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  const d = (await call("GET", "/api/admin/community", null, { token: own })).data;
  assert.ok(d.groups >= 1);
  const r = d.reports.find(x => x.kind === "groupmsg");
  assert.match(r.item.text, /bad words here/);
  assert.ok(d.reports.find(x => x.kind === "group").item.text.includes("Dadar queue team"));
  assert.equal((await call("POST", "/api/admin/community", { action: "groupmsg-delete", id: m }, { token: own })).status, 200);
  assert.ok(!(await call("GET", "/api/s/groups/" + G, null, { token: C })).data.messages.some(x => x.id === m));
  assert.equal((await call("POST", "/api/admin/community", { action: "group-close", id: G }, { token: own })).status, 200);
  assert.equal((await call("GET", "/api/s/groups/" + G, null, { token: C })).status, 403);
  assert.equal((await call("GET", "/api/admin/community", null, { token: own })).data.reports.filter(x => x.kind.startsWith("group")).length, 0);
  await call("POST", "/api/admin/community", { action: "group-open", id: G }, { token: own });
  assert.equal((await call("GET", "/api/s/groups/" + G, null, { token: C })).status, 200);
});

test("stories: followers see them, views counted, photo waits for owner, expire after 24 hours", async () => {
  // anita posts a text story; bhim and chitra follow anita; deepak does not
  const s = await call("POST", "/api/s/stories", { text: "Queue day at Thane station!", bg: 3 }, { token: A });
  assert.equal(s.status, 200); assert.equal(s.data.status, "ok");
  const mineBar = (await call("GET", "/api/s/stories", null, { token: A })).data.people;
  assert.equal(mineBar[0].me, true);
  const bar = (await call("GET", "/api/s/stories", null, { token: B })).data.people;
  assert.equal(bar[0].user.username, "anita"); assert.equal(bar[0].unseen, true);
  assert.equal((await call("GET", "/api/s/stories", null, { token: D })).data.people.length, 0);
  await call("POST", `/api/s/stories/${s.data.id}/view`, {}, { token: B });
  await call("POST", `/api/s/stories/${s.data.id}/view`, {}, { token: B });
  assert.equal((await call("GET", "/api/s/stories", null, { token: B })).data.people[0].unseen, false);
  const v = (await call("GET", `/api/s/stories/${s.data.id}/viewers`, null, { token: A })).data.viewers;
  assert.deepEqual(v.map(x => x.username), ["bhim"]);
  assert.equal((await call("GET", `/api/s/stories/${s.data.id}/viewers`, null, { token: B })).status, 404, "only the author sees viewers");
  // photo story waits for the owner's check (default setting)
  const ph = (await call("POST", "/api/s/upload", null, { token: A, raw: JPG })).data.id;
  const ps = await call("POST", "/api/s/stories", { photo: ph, text: "Gate 2" }, { token: A });
  assert.equal(ps.data.status, "pending");
  assert.equal((await call("GET", "/api/s/stories", null, { token: B })).data.people[0].stories.length, 1, "followers do not see it yet");
  const own = (await call("POST", "/api/admin/login", { password: "testpass123" })).data.token;
  const d = (await call("GET", "/api/admin/community", null, { token: own })).data;
  assert.equal(d.pendingStories[0].id, ps.data.id);
  await call("POST", "/api/admin/community", { action: "story-ok", id: ps.data.id }, { token: own });
  assert.equal((await call("GET", "/api/s/stories", null, { token: B })).data.people[0].stories.length, 2);
  // report a story; owner deletes it
  assert.equal((await call("POST", "/api/s/report", { kind: "story", id: ps.data.id, reason: "fake" }, { token: B })).status, 200);
  await call("POST", "/api/admin/community", { action: "story-delete", id: ps.data.id }, { token: own });
  assert.equal((await call("GET", "/api/s/stories", null, { token: B })).data.people[0].stories.length, 1);
  // author deletes own story
  assert.equal((await call("POST", `/api/s/stories/${s.data.id}/delete`, {}, { token: A })).status, 200);
  assert.equal((await call("GET", "/api/s/stories", null, { token: B })).data.people.length, 0);
  // older than 24 hours: not shown
  const s3 = (await call("POST", "/api/s/stories", { text: "old" }, { token: A })).data.id;
  require("../server/db").prepare("UPDATE s_stories SET expires_at = ? WHERE id = ?").run(Date.now() - 1, s3);
  assert.equal((await call("GET", "/api/s/stories", null, { token: B })).data.people.length, 0);
});

test("deleting an account tidies its groups", async () => {
  const E = await signup("esha"); await follow(E, "bhim");
  const g = (await call("POST", "/api/s/groups", { name: "Two of us", members: ["esha"] }, { token: B })).data.id;
  await call("POST", "/api/s/delete-account", { password: "password1" }, { token: B });
  const db = require("../server/db");
  assert.equal(db.prepare("SELECT role FROM s_group_members WHERE group_id = ?").get(g).role, "admin", "esha became admin");
  await call("POST", "/api/s/delete-account", { password: "password1" }, { token: E });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM s_groups WHERE id = ?").get(g).n, 0, "empty group removed");
});

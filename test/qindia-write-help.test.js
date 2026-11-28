// Writing help (sites/qindiaglobal/write-help.js): the simple helpers that run on every phone.
const test = require("node:test");
const assert = require("node:assert");
const W = require("../sites/qindiaglobal/write-help.js");

test("ideas come in the chosen language", () => {
  assert.strictEqual(W.ideas("en", 3).length, 3);
  assert.ok(W.ideas("hi", 3).every(t => /[ऀ-ॿ]/.test(t)));
  assert.ok(W.ideas("mr", 3).every(t => /[ऀ-ॿ]/.test(t)));
  assert.strictEqual(new Set(W.ideas("en", 5)).size, 5);
});

test("tidy fixes spacing and punctuation without changing words", () => {
  assert.strictEqual(W.tidy("  everyone   queued today !!!  it was great"), "Everyone queued today! It was great.");
  assert.strictEqual(W.tidy("i saw a queue,very nice"), "I saw a queue, very nice.");
  assert.strictEqual(W.tidy("see https://qindiaglobal.com/blog"), "See https://qindiaglobal.com/blog");
  assert.strictEqual(W.tidy("धक्का नहीं , कतार"), "धक्का नहीं, कतार।");
  assert.strictEqual(W.tidy("रांग लावा आणि सुरक्षित राहा"), "रांग लावा आणि सुरक्षित राहा.");
});

test("hashtags follow the words and skip ones already used", () => {
  const t = W.hashtags("Great queue at the metro station today #QIndia");
  assert.ok(!t.includes("#QIndia"));
  assert.ok(t.includes("#QueueUp") && t.includes("#MetroManners"));
  assert.ok(W.hashtags("बस में लाइन").includes("#BusQueue"));
  assert.ok(W.hashtags("").length > 0);
});

test("language guess and Google Translate link", () => {
  assert.strictEqual(W.guessLang("hello"), "en");
  assert.strictEqual(W.guessLang("लाइन में रहें"), "hi");
  assert.strictEqual(W.guessLang("रांगेत उभे राहा, आम्ही आहोत"), "mr");
  assert.ok(W.googleTranslate("a b", "hi").startsWith("https://translate.google.com/?sl=auto&tl=hi&op=translate&text=a%20b"));
});

const assert = require("node:assert");
const { hardenWebview, isAllowedUrl, PARTITION } = require("./browser-guest.cjs");

for (const u of ["http://localhost:3000", "https://example.com/a?b", "about:blank"]) assert.ok(isAllowedUrl(u), u);
for (const u of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "", "nope"]) assert.ok(!isAllowedUrl(u), u);

const run = (prefs, params) => { let blocked = false; hardenWebview({ preventDefault: () => { blocked = true; } }, prefs, params); return blocked; };

// 렌더러가 위험 설정을 줘도 덮어씀
const prefs = { preload: "/evil.js", preloadURL: "file:///evil.js", nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false };
const params = { src: "http://localhost:3000" };
assert.strictEqual(run(prefs, params), false, "정상 src 통과");
assert.strictEqual(prefs.preload, undefined); assert.strictEqual(prefs.preloadURL, undefined);
assert.deepStrictEqual([prefs.nodeIntegration, prefs.contextIsolation, prefs.sandbox, prefs.webSecurity], [false, true, true, true]);
assert.strictEqual(params.partition, PARTITION, "partition 강제");

// fail-closed
assert.strictEqual(run({}, { src: "file:///etc/passwd" }), true, "file: 거부");
assert.strictEqual(run({}, { src: "http://x", partition: "persist:other" }), true, "다른 partition 거부");
assert.strictEqual(run({}, {}), false, "src 없음 = about:blank 허용");
console.log("browser-guest ok");
// 단축키 조합(#1034 리뷰) — core chordFromEvent와 같은 문자열
const { chordOf } = require("./browser-guest.cjs");
assert.strictEqual(chordOf({ code: "KeyK", meta: true }, true), "Mod+K");
assert.strictEqual(chordOf({ code: "BracketRight", meta: true, shift: true }, true), "Mod+Shift+]");
assert.strictEqual(chordOf({ code: "Digit1", meta: true, alt: true }, true), "Mod+Alt+1");
assert.strictEqual(chordOf({ code: "KeyK", control: true }, false), "Mod+K");
assert.strictEqual(chordOf({ code: "KeyK", control: true }, true), "Ctrl+K");
assert.strictEqual(chordOf({ code: "Backslash", meta: true }, true), "Mod+\\");
assert.strictEqual(chordOf({ code: "KeyK" }, true), null);
console.log("browser-guest chord ok");

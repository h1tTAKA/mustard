const assert = require("node:assert");
const { hardenWebview, isAllowedUrl, PARTITION, setDefaultZoom, nextZoom, cleanUserAgent } = require("./browser-guest.cjs");

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
// #1209 페이지 줌 — Chrome 배율 단계, 끝에서 멈춤, ⌘0 = 기본 줌(목록에 없는 값이면 100%)
assert.strictEqual(nextZoom(1, 1), 1.1); assert.strictEqual(nextZoom(1, -1), 0.9); assert.strictEqual(nextZoom(1.05, 1), 1.1); assert.strictEqual(nextZoom(1.05, -1), 1);
assert.strictEqual(nextZoom(5, 1), 5); assert.strictEqual(nextZoom(0.25, -1), 0.25);
setDefaultZoom(1.25); assert.strictEqual(nextZoom(2, 0), 1.25);
{ const wp = {}; hardenWebview({ preventDefault() {} }, wp, { src: "about:blank" }); assert.strictEqual(wp.zoomFactor, 1.25, "새 탭 기본 줌"); }
setDefaultZoom(1.3); assert.strictEqual(nextZoom(2, 0), 1, "목록 밖 = 100%");
// #1209 브라우저 ID — 앱·Electron 토큰만 빠짐
assert.strictEqual(cleanUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Mustard/0.1.0 Chrome/140.0.0.0 Electron/43.0.0 Safari/537.36"),
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36");
console.log("browser-guest chord ok");

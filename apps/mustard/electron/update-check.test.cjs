// update-check 점검 — node electron/update-check.test.cjs
const assert = require("node:assert");
const { isNewer, check } = require("./update-check.cjs");

assert.ok(isNewer("0.1.0", "0.2.0") && isNewer("0.1.9", "0.1.10") && isNewer("1.0.0-beta.1", "1.0.0") && isNewer("0.1.0", "v1.0.0"));
assert.ok(!isNewer("0.2.0", "0.1.9") && !isNewer("1.0.0", "1.0.0") && !isNewer("1.0.0", "1.0.0-beta") && !isNewer("0.1.0", "nightly"));
const fake = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
(async () => {
  assert.deepStrictEqual(await check("0.1.0", "o/r", fake(404)), { ok: true, current: "0.1.0", latest: null, newer: false, url: null }, "릴리스 없음 = 최신");
  const r = await check("0.1.0", "o/r", fake(200, { tag_name: "v0.2.0", html_url: "https://github.com/o/r/releases/tag/v0.2.0" }));
  assert.ok(r.newer && r.latest === "0.2.0" && r.url.endsWith("v0.2.0"));
  assert.strictEqual((await check("0.1.0", "o/r", fake(200, { tag_name: "v0.2.0", html_url: "https://evil.example/x" }))).url, null, "우리 저장소 주소만");
  assert.strictEqual((await check("0.1.0", "o/r", fake(500))).ok, false);
  console.log("update-check.test ok");
})();

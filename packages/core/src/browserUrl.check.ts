// normalizeBrowserUrl self-check — 실행: node --experimental-strip-types packages/core/src/browserUrl.check.ts
import assert from "node:assert";
import { normalizeBrowserUrl as n, browserTarget as b } from "./browserUrl.ts";

assert.strictEqual(n("localhost:3000"), "http://localhost:3000/");
assert.strictEqual(n(":5173"), "http://localhost:5173/");
assert.strictEqual(n("127.0.0.1:8080/a?b=1"), "http://127.0.0.1:8080/a?b=1");
assert.strictEqual(n("example.com"), "https://example.com/");
assert.strictEqual(n("https://example.com/x"), "https://example.com/x");
assert.strictEqual(n("HTTP://Localhost:3000"), "http://localhost:3000/");
for (const bad of ["", "  ", "hello world", "javascript:alert(1)", "file:///etc/passwd", "foo"]) assert.strictEqual(n(bad), null, bad);
// #1209 검색
assert.strictEqual(b("hello world", "google"), "https://www.google.com/search?q=hello%20world");
assert.strictEqual(b("foo", "duckduckgo"), "https://duckduckgo.com/?q=foo");
assert.strictEqual(b("c++ & 한글", "kagi"), "https://kagi.com/search?q=c%2B%2B%20%26%20%ED%95%9C%EA%B8%80");
assert.strictEqual(b("x", "nope"), "https://www.google.com/search?q=x", "모르는 엔진 = google");
assert.strictEqual(b("x", "constructor"), "https://www.google.com/search?q=x", "Object 기본 키도 google");
assert.strictEqual(b("example.com", "bing"), "https://example.com/", "URL은 그대로");
for (const bad of ["", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x"]) assert.strictEqual(b(bad, "google"), null, bad);
// main(electron/browser-control.cjs)은 TS를 못 불러 같은 판정을 따로 들고 있음 — 둘이 어긋나지 않게 같은 입력으로 맞춰 봄(#1209 리뷰)
import { createRequire } from "node:module";
const { normalizeUrl: mainNormalize } = createRequire(import.meta.url)("../../../apps/mustard/electron/browser-control.cjs");
for (const s of ["localhost:3000", ":5173", "127.0.0.1:8080/a?b=1", "example.com", "https://example.com/x", "HTTP://Localhost:3000", "", "  ", "hello world", "javascript:alert(1)", "file:///etc/passwd", "foo", "ftp://x.com", "[::1]:3000"])
  assert.strictEqual(mainNormalize(s), n(s), `main 판정 어긋남: ${JSON.stringify(s)}`);
console.log("browser url ok");

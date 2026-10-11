// normalizeBrowserUrl self-check — 실행: node --experimental-strip-types src/lib/browser/url.check.ts
import assert from "node:assert";
import { normalizeBrowserUrl as n } from "./url.ts";

assert.strictEqual(n("localhost:3000"), "http://localhost:3000/");
assert.strictEqual(n(":5173"), "http://localhost:5173/");
assert.strictEqual(n("127.0.0.1:8080/a?b=1"), "http://127.0.0.1:8080/a?b=1");
assert.strictEqual(n("example.com"), "https://example.com/");
assert.strictEqual(n("https://example.com/x"), "https://example.com/x");
assert.strictEqual(n("HTTP://Localhost:3000"), "http://localhost:3000/");
for (const bad of ["", "  ", "hello world", "javascript:alert(1)", "file:///etc/passwd", "foo"]) assert.strictEqual(n(bad), null, bad);
console.log("browser url ok");

// main(browser-control.cjs)은 TS를 못 불러 주소 판정을 따로 들고 있음 — core와 어긋나지 않게 같은 입력으로 맞춰 봄(#1209 리뷰).
// apps 쪽에 둠: core는 nunopi 단독 레포로도 복사되는데 거기엔 apps/mustard가 없음.
// 실행: node --experimental-strip-types apps/mustard/electron/browser-url-parity.check.ts
import assert from "node:assert";
import { createRequire } from "node:module";
import { normalizeBrowserUrl } from "../../../packages/core/src/browserUrl.ts";

const { normalizeUrl } = createRequire(import.meta.url)("./browser-control.cjs");
for (const s of ["localhost:3000", ":5173", "127.0.0.1:8080/a?b=1", "example.com", "https://example.com/x", "HTTP://Localhost:3000", "", "  ", "hello world", "javascript:alert(1)", "file:///etc/passwd", "foo", "ftp://x.com", "[::1]:3000"])
  assert.strictEqual(normalizeUrl(s), normalizeBrowserUrl(s), `main 판정 어긋남: ${JSON.stringify(s)}`);
console.log("browser url parity ok");

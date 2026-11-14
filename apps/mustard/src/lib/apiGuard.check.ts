// apiGuard 점검(#1340) — node --experimental-strip-types apps/mustard/src/lib/apiGuard.check.ts
import assert from "node:assert/strict";
import { guardApi } from "./apiGuard.ts";
const ok = (h: Parameters<typeof guardApi>[0]) => guardApi(h).ok;
assert.ok(ok({ host: "127.0.0.1:59720", secFetchSite: "same-origin" })); // 앱 화면
assert.ok(ok({ host: "127.0.0.1:59720" })); // 로컬 프로세스(헤더 없음)
assert.ok(ok({ host: "localhost:3000", secFetchSite: "none" })); // 주소창 직접
assert.ok(ok({ host: "[::1]:59720", origin: "http://[::1]:59720" }));
assert.ok(!ok({ host: "evil.example:59720" })); // DNS 리바인딩
assert.ok(!ok({ host: "127.0.0.1:59720", secFetchSite: "cross-site" })); // 남의 웹페이지
assert.ok(!ok({ host: "127.0.0.1:59720", secFetchSite: "same-site" })); // 다른 포트 localhost 페이지
assert.ok(!ok({ host: "127.0.0.1:59720", origin: "http://127.0.0.1:3000" })); // 출처 헤더만 있는 옛 브라우저
assert.ok(!ok({ host: "127.0.0.1:59720", origin: "null" }));
assert.ok(!ok({ host: "" }));
console.log("apiGuard ok");

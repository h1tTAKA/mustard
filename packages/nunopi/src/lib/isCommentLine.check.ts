// isCommentLine self-check — 실행: node --experimental-strip-types src/lib/isCommentLine.check.ts
import assert from "node:assert";
import { isCommentOnlyLine } from "./isCommentLine.ts";

// 주석으로 판정해야 하는 것.
for (const c of ["// hi", "  // indented", "/* block", "*/", " * @param x", "*", "<!-- html -->", "--> end"]) {
  assert.ok(isCommentOnlyLine(c), `주석: ${JSON.stringify(c)}`);
}

// 코드로 판정해야 하는 것(주석 아님).
for (const code of [
  "const x = 1;",
  "return a * b;",       // * 이지만 곱셈
  "*gen() {}",           // 제너레이터 메서드(*ident) — 주석 아님
  "*(ptr) = 1;",         // *( — 주석 아님
  "#count = 0;",         // TS private 필드 — 주석 아님(# 제외)
  "x--;",                // 감소 — 주석 아님(-- 제외)
  "arr.map(x => x)",
  "",                    // 빈 줄 → false(호출부서 별도 처리)
]) {
  assert.ok(!isCommentOnlyLine(code), `코드: ${JSON.stringify(code)}`);
}

console.log("isCommentLine.check OK");

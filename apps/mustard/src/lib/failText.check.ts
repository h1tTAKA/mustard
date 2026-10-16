// failText 점검 — node --experimental-strip-types src/lib/failText.check.ts
import assert from "node:assert";
import { isFailedNote, RUNTIME_FAIL_PREFIXES } from "./failText.ts";

assert.deepStrictEqual(RUNTIME_FAIL_PREFIXES, ["런타임 실패:", "ランタイム失敗:", "Runtime failed:"]);
for (const t of ["런타임 실패: Max", "ランタイム失敗: x", "Runtime failed: y", "(빈 응답)", "(空の応答)", "(Empty response)", " (Error) "]) assert.ok(isFailedNote(t), t);
for (const t of ["(오류를 고침) 설명", "이 함수는 런타임 실패: 를 처리", "정상 설명"]) assert.ok(!isFailedNote(t), t);
console.log("failText.check ok");

// titleBreak 점검 — node --experimental-strip-types packages/nunopi/src/lib/titleBreak.check.ts
import assert from "node:assert/strict";
import { titleBreaks } from "./titleBreak.ts";

assert.deepEqual(titleBreaks("OutlinedButton.styleFrom"), ["Outlined", "Button.", "style", "From"], "점 뒤·대문자 앞");
assert.deepEqual(titleBreaks("ReorderableDragStartListener"), ["Reorderable", "Drag", "Start", "Listener"]);
assert.deepEqual(titleBreaks("snake_case/path-name"), ["snake_", "case/", "path-", "name"]);
assert.deepEqual(titleBreaks("HTTP"), ["HTTP"], "대문자 연속은 안 나눔");
assert.deepEqual(titleBreaks("재귀 함수"), ["재귀 함수"], "한글·띄어쓰기는 그대로(브라우저가 나눔)");
assert.equal(titleBreaks("a.b.c").join(""), "a.b.c", "합치면 원문");
console.log("titleBreak ok");

// hunkDiff 점검 — node --experimental-strip-types src/lib/hunkDiff.check.ts
import assert from "node:assert";
import { groupHunks, noteStoreKey, parseDiff } from "./hunkDiff.ts";

const diff = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -1,12 +1,12 @@",
  " a", "-b", "+B", " c", " d", " e", " f", " g", " h", "-i", "+I", " j"].join("\n");
const lines = parseDiff(diff);
assert.strictEqual(lines.filter((l) => l.kind === "add").length, 2);
const hunks = groupHunks(lines);
assert.strictEqual(hunks.length, 2, "컨텍스트 6줄 간격 → 구간 2개");
assert.ok(hunks[0].diffText.includes("- b") && hunks[0].diffText.includes("+ B"));
assert.deepStrictEqual([hunks[0].newFrom, hunks[0].newTo, hunks[1].newFrom, hunks[1].newTo], [2, 2, 9, 9], "새 파일 줄 범위");
const del = groupHunks(parseDiff(["@@ -1,4 +1,2 @@", " a", "-b", "-c", " d"].join("\n")));
assert.deepStrictEqual([del[0].newFrom, del[0].newTo], [2, 2], "삭제만 = 삭제 지점");
const close = groupHunks(parseDiff(["@@ -1,5 +1,5 @@", "-a", "+A", " x", "-b", "+B"].join("\n")));
assert.strictEqual(close.length, 1, "간격 3줄 이하 → 한 구간");
assert.strictEqual(noteStoreKey("/r", "x.ts", "abc"), "nunopi:hunk-notes:/r:abc:x.ts");
assert.strictEqual(noteStoreKey("/r", "x.ts", undefined, "staged"), "nunopi:hunk-notes:/r:wt:staged:x.ts", "워킹트리 키 기존과 동일");
console.log("hunkDiff ok");

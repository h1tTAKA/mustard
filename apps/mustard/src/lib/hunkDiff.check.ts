// hunkDiff 점검 — node --experimental-strip-types src/lib/hunkDiff.check.ts
import assert from "node:assert";
import { diffMark, diffSections, DIFF_SEP, groupHunks, legacyNoteKey, noteStoreKey, withLegacyAliases, parseDiff } from "./hunkDiff.ts";

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
assert.strictEqual(noteStoreKey("/r", "x.ts", "abc", undefined, "ja"), "nunopi:hunk-notes:/r:abc:x.ts@ja", "#1091 언어별 키");
const body = [diffMark(hunks[0]) + "설명 A", diffMark(hunks[1]) + "설명 B"].join(DIFF_SEP);
assert.deepStrictEqual(diffSections(body), [{ from: 2, to: 2, text: "설명 A" }, { from: 9, to: 9, text: "설명 B" }]);
assert.strictEqual(diffSections("옛 카드" + DIFF_SEP + "설명"), null, "표지 없음 = 옛 카드");
const withRule = [diffMark(hunks[0]) + "요약\n\n---\n\n## 코드 흐름\n본문", diffMark(hunks[1]) + "설명 B"].join(DIFF_SEP);
assert.deepStrictEqual(diffSections(withRule), [{ from: 2, to: 2, text: "요약\n\n---\n\n## 코드 흐름\n본문" }, { from: 9, to: 9, text: "설명 B" }], "설명 안 구분선(---)에서 안 잘림");
// #1127 리뷰: 안쪽 "-- x"·"++x" 줄은 머리 아님, "\ No newline"은 줄 번호 안 셈, 머리 쪽 Binary·mode 줄은 meta, 끝 빈 줄 없음
const tricky = parseDiff(["diff --git a/q.sql b/q.sql", "old mode 100644", "new mode 100755", "--- a/q.sql", "+++ b/q.sql", "@@ -1,3 +1,3 @@", " x", "--- old comment", "+++ added plus", "-tail", "\\ No newline at end of file", "+tail2", "\\ No newline at end of file", ""].join("\n"));
assert.deepStrictEqual(tricky.filter((l) => l.kind === "add").map((l) => [l.text, l.newN]), [["++ added plus", 2], ["tail2", 3]], "안쪽 +++/--- 줄과 No newline");
assert.deepStrictEqual(tricky.filter((l) => l.kind === "del").map((l) => l.text), ["-- old comment", "tail"]);
assert.ok(!tricky.some((l) => l.kind === "ctx" && l.text === ""), "끝 빈 줄 없음");
assert.strictEqual(parseDiff("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n").every((l) => l.kind === "meta"), true, "Binary는 meta");
// 옛 키(수정 전 parseDiff: 끝 빈 줄·\ No newline이 문맥 줄로 들어감) → 지금 키
const eofDiff = ["@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file", "+c", "\\ No newline at end of file", ""].join("\n");
const nowKey = groupHunks(parseDiff(eofDiff))[0].diffText;
const oldKey = ["  a", "- b", "  \\ No newline at end of file", "+ c", "  \\ No newline at end of file", "  "].join("\n");
assert.strictEqual(legacyNoteKey(oldKey), nowKey, "옛 노트 키 별칭");
assert.strictEqual(legacyNoteKey("  a\n- b\n+ c\n  d"), "  a\n- b\n+ c\n  d", "끝까지 안 닿은 구간은 그대로");
const raw = { [oldKey]: "old", [nowKey]: "real" }; const aliased = withLegacyAliases(raw);
assert.strictEqual(aliased[nowKey], "real", "진짜 키 우선"); assert.strictEqual(Object.keys(raw).length, 2, "원본 안 바꿈");
assert.strictEqual(withLegacyAliases({ [oldKey]: "old" })[nowKey], "old", "옛 키로 찾힘");
console.log("hunkDiff ok");

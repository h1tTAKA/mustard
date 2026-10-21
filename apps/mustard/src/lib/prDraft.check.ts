// prDraft 점검 — node --experimental-strip-types src/lib/prDraft.check.ts
import assert from "node:assert";
import { addDraft, removeDraft, reviewRequest, suggestionBlock } from "./prDraft.ts";

const H1 = "a".repeat(40), H2 = "b".repeat(40);
let l = addDraft([], { path: "src/a.ts", side: "RIGHT", line: 13, body: "rename b", head: H1 }, "1");
assert.strictEqual(l.length, 1);
assert.strictEqual(addDraft(l, { path: "src/a.ts", side: "RIGHT", line: 13, body: " rename b ", head: H1 }, "2").length, 1, "같은 자리·같은 글은 하나만");
l = addDraft(l, { path: "src/a.ts", side: "LEFT", line: 5, startLine: 3, body: "why removed?", head: H1 }, "3");
assert.strictEqual(l[1].startLine, 3, "범위");
assert.strictEqual(addDraft(l, { path: "x", side: "RIGHT", line: 4, startLine: 9, body: "bad range" }, "4").length, 2, "거꾸로 범위는 거절");
assert.strictEqual(addDraft(l, { path: "x", side: "RIGHT", line: 4, body: "   " }, "5").length, 2, "빈 글 거절");
assert.ok(!("startLine" in addDraft([], { path: "x", side: "RIGHT", line: 4, startLine: 4, body: "same line" }, "6")[0]), "시작=끝이면 한 줄");

assert.deepStrictEqual(reviewRequest(l, H2), { commitId: H1, comments: [
  { path: "src/a.ts", line: 13, side: "RIGHT", body: "rename b" },
  { path: "src/a.ts", line: 5, side: "LEFT", startLine: 3, body: "why removed?" }] }, "같은 head면 그 커밋");
assert.deepStrictEqual(reviewRequest([...l, { id: "9", path: "y", side: "RIGHT", line: 1, body: "z", head: H2 }], "c".repeat(40)), { mixed: true, comments: [] }, "커밋 섞이면 못 보냄");
assert.strictEqual(reviewRequest([{ id: "9", path: "y", side: "RIGHT", line: 1, body: "z" }], H2).commitId, H2, "커밋 모르면 지금 head");
assert.strictEqual(removeDraft(l, "1").length, 1);

assert.strictEqual(suggestionBlock(["const b = 2;"]), "```suggestion\nconst b = 2;\n```");
assert.ok(suggestionBlock(["x = `a ``` b`"]).startsWith("````suggestion"), "안의 ``` 보다 긴 울타리");
console.log("prDraft.check ok");

// prReview 점검 — node --experimental-strip-types src/lib/prReview.check.ts
import assert from "node:assert";
import { buildReviewPrompt, findingCommentBody, numberDiff, parseFindings } from "./prReview.ts";

const diff = ["diff --git a/x.js b/x.js", "--- a/x.js", "+++ b/x.js", "@@ -1,3 +1,4 @@", " a", "-b", "+c", "+d", " e"].join("\n");
const n = numberDiff(diff);
assert.deepStrictEqual([...n.lines], [1, 2, 3, 4], "문맥·추가 줄만 지적 가능");
assert.ok(n.text.includes("L2    + c") && n.text.includes("      - b") && !n.text.includes("+++"), n.text);

let i = 0; const id = () => `f${i++}`;
const valid = new Map([["x.js", n.lines]]);
const ans = 'Here:\n```json\n[{"file":"x.js","line":2,"severity":"high","title":"bug","body":"fix"},{"file":"x.js","line":99,"title":"out of diff"},{"file":"y.js","line":1,"title":"unknown file"},{"file":"x.js","line":"3","severity":"weird","title":"str line"},{"file":"x.js","line":1,"title":""}]\n```';
const fs = parseFindings(ans, valid, id) ?? [];
assert.deepStrictEqual(fs.map((f) => [f.line, f.severity, f.status]), [[2, "high", "open"], [3, "medium", "open"]], "diff 밖 줄·모르는 파일·빈 제목 버림, 심각도 기본 medium");
assert.deepStrictEqual(parseFindings("[]", valid, id), []);
assert.strictEqual(parseFindings("no json here", valid, id), null, "형식 위반은 null(문제 없음과 구분)");
assert.strictEqual(parseFindings("[{broken", valid, id), null);
assert.strictEqual(parseFindings('[{"file":"x.js","line":4,"title":"t","body":"b"}]', valid, id)?.length, 1, "펜스 없는 배열");
assert.strictEqual(parseFindings('Found [2 issues]: [{"file":"x.js","line":2,"title":"t"}]', valid, id)?.length, 1, "앞 설명의 괄호 건너뜀");
assert.strictEqual(parseFindings('See:\n```diff\n- a\n+ b\n```\n```json\n[{"file":"x.js","line":2,"title":"t"}]\n```', valid, id)?.length, 1, "JSON 아닌 펜스 뒤의 JSON 블록");
const cb = findingCommentBody({ title: "Leak", body: "see ![x](https://evil/p.png) and <img src=x> [link](https://a)" }, "높음");
assert.ok(cb.startsWith("**[높음] Leak**") && !cb.includes("evil") && !cb.includes("<img") && cb.includes("[link](https://a)") && cb.endsWith("Mustard agent review</sub>"), cb);
assert.ok(buildReviewPrompt("ja").includes("Japanese"));
console.log("prReview ok");

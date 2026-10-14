// catchupMarkdown 점검 — node --experimental-strip-types src/lib/catchupMarkdown.check.ts
import assert from "node:assert";
import { commitHashesIn, diffCardMarkdown, sessionCardMarkdown, withRelatedCards } from "./catchupMarkdown.ts";

const d = diffCardMarkdown({ path: "src/a.ts", hash: "abcdef1234", branch: "feat/x", subject: "fix a", ts: 0, expl: "",
  sections: [{ from: 4, to: 13, text: "요약\n\n---\n\n본문", code: "- a\n+ b" }, { from: 21, to: 21, text: "둘째" }] });
assert.ok(d.startsWith("## src/a.ts @abcdef1") && d.includes("- Branch: feat/x") && d.includes("### Lines 4–13") && d.includes("```diff\n- a\n+ b\n```") && d.includes("### Lines 21\n"));
const old = diffCardMarkdown({ path: "b.ts", hash: "1234567", branch: "", subject: "", ts: 0, expl: "옛 설명", sections: null, codes: ["+ x"] });
assert.ok(old.includes("```diff\n+ x\n```") && old.trim().endsWith("옛 설명") && !old.includes("Branch"), "옛 카드 = 코드 + 설명 통째");
const s = sessionCardMarkdown({ subject: "feat", hash: "abc1234", branch: "main", agent: "Claude Code", ts: 0, summary: "요약", messages: [{ role: "user", text: "해줘 ```js```", ts: 0 }, { role: "tool", text: "x".repeat(5000), ts: 0 }] });
assert.ok(s.includes("### Conversation") && s.includes("````text") && s.includes("x".repeat(5000)), "원본 전체 + 백틱보다 긴 펜스");
// #1081 관련 카드 보충
assert.deepStrictEqual(commitHashesIn("2시쯤 9f677d4 커밋과 [x](<catchup:session|0f9a13fabc>) 그리고 deadbeef1 이 있었고 1234567 은 숫자"), ["9f677d4", "deadbee"], "링크 단 해시·숫자만 제외");
const wr = withRelatedCards("답\n```nunopi-cards\n[]\n```", [{ key: "diff|9f677d4|a.ts", kind: "diff", target: "a.ts @9f677d4" }], "관련 카드");
assert.ok(wr.indexOf("관련 카드") < wr.indexOf("```nunopi-cards") && wr.includes("[a.ts @9f677d4](<catchup:diff|9f677d4|a.ts>)"), "카드 블록 앞에");
assert.strictEqual(withRelatedCards("답", [], "관련 카드"), "답");
console.log("catchupMarkdown ok");

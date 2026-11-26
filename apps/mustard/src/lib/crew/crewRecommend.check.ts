// crewRecommend 점검 — node --experimental-strip-types src/lib/crew/crewRecommend.check.ts
import assert from "node:assert";
import { langShares, parseRecommend, recommendPrompt, ruleRecommend } from "./crewRecommend.ts";

// 언어 비율: 카탈로그가 아는 코드 확장자만, 많은 순
const langs = langShares(["a.ts", "b.ts", "c.tsx", "README.md", "x.json", "Makefile", "d.go"]);
assert.deepStrictEqual(langs.map((l) => l.ext), ["ts", "tsx", "go"]);
assert.strictEqual(langs[0].share, 0.5);

// 규칙: 리뷰 + 보안 → 코드 리뷰어·언어 리뷰어·보안 (사람이 쓴 순서대로)
assert.deepStrictEqual(ruleRecommend("PR 올라오면 리뷰하고 보안도", langs), ["code-reviewer", "typescript-reviewer", "security-reviewer"]);
assert.deepStrictEqual(ruleRecommend("ビルドが壊れたら直して", [{ ext: "go", share: 1 }]).slice(0, 1), ["go-build-resolver"], "빌드 + 언어");
assert.deepStrictEqual(ruleRecommend("메일·일정 정리", []), ["chief-of-staff", "code-reviewer", "planner"], "모자라면 채움");
assert.strictEqual(ruleRecommend("아무 말", []).length, 3, "맞는 단어 없어도 3개");
const noise = ruleRecommend("write the latest explanation", []);
assert.ok(!noise.includes("tdd-guide") && !noise.includes("pr-test-analyzer") && noise.indexOf("planner") !== 0, "단어 일부(latest·explanation)에 안 걸림");

// AI 답 읽기: 모르는 id 버림, 겹침 없이, 모자라면 규칙으로
assert.deepStrictEqual(parseRecommend('Sure: ["go-reviewer","nope","go-reviewer"]', ["code-reviewer", "planner"]), ["go-reviewer", "code-reviewer", "planner"]);
assert.deepStrictEqual(parseRecommend("not planner, pick security-reviewer", ["a", "b", "c"]), ["a", "b", "c"], "배열 없으면 규칙 그대로");
assert.deepStrictEqual(parseRecommend("[broken", ["a", "b", "c"]), ["a", "b", "c"]);

assert.match(recommendPrompt("x", [], [{ id: "planner", desc: "Plans" }]), /- planner: Plans[\s\S]*JSON array/);
console.log("crewRecommend OK");

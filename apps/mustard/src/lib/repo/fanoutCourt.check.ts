// fanoutCourt 점검 — node --experimental-strip-types src/lib/repo/fanoutCourt.check.ts
import assert from "node:assert";
import { clipArg, defensePrompt, judgeCourtPrompt, jury, jurorPrompt, parseJudgment, parseVote, prosecutionPrompt, rebuttalPrompt, type Vote } from "./fanoutCourt.ts";

const a = { label: "A", diff: "diff --git a/x b/x\n+1\n", files: [{ path: "x", added: 1, removed: 0 }], truncated: false };
const b = { label: "B", diff: "", files: [], truncated: false };

// 투표 읽기: A·B만, "Candidate b"도 받음, 이유 없으면 빈 글
assert.deepStrictEqual(parseVote({ vote: "Candidate b", why: " ok " }), { vote: "B", why: "ok" });
assert.deepStrictEqual(parseVote({ vote: "a" }), { vote: "A", why: "" });
assert.strictEqual(parseVote({ vote: "C" }), null);
assert.strictEqual(parseVote(null), null);

// 배심 다수(동률·전원 실패면 A)
const v = (vote?: "A" | "B"): Vote => ({ lens: "user", provider: "claude-code", ...(vote ? { vote } : { error: "x" }) });
assert.deepStrictEqual(jury([v("B"), v("B"), v("A")]), { a: 1, b: 2, majority: "B" });
assert.deepStrictEqual(jury([v("A"), v("B"), v()]), { a: 1, b: 1, majority: "A" });
assert.deepStrictEqual(jury([v(), v(), v()]), { a: 0, b: 0, majority: "A" });

// 판결: 판사 답 우선, 못 읽으면 배심 다수
assert.deepStrictEqual(parseJudgment({ winner: "b", verdict: " v ", flip: " f " }, "A"), { winner: "B", verdict: "v", flip: "f" });
assert.strictEqual(parseJudgment({ winner: "?" }, "B").winner, "B");
assert.strictEqual(parseJudgment(null, "A").winner, "A");

// 변론 상한
assert.strictEqual(clipArg("x".repeat(9000)).length, 2500);

// 프롬프트: 주장·가린 이름·언어, 에이전트 이름 없음, 반박엔 상대 변론이 들어감, 배심엔 관점, 판사엔 표
const args = { prosecution: "P", defense: "D", rebutProsecution: "RP", rebutDefense: "RD" };
const all = [prosecutionPrompt("t", a, b, "Korean"), defensePrompt("t", a, b, "Korean"), rebuttalPrompt("defense", "t", a, b, "PROSECUTION-TEXT", "Korean"),
  jurorPrompt("maintainability", "t", a, b, args, "Korean"), judgeCourtPrompt("t", a, b, args, [{ lens: "user", provider: "codex", vote: "B", why: "w" }], "Korean")];
assert.ok(all.every((p) => p.includes("Claim: Candidate A fits the task better than Candidate B.") && p.includes("## Candidate A") && p.includes("## Candidate B") && p.includes("Korean")));
assert.ok(all.every((p) => !/claude|codex/i.test(p)));
assert.ok(all[0].includes("FALSE") && all[1].includes("TRUE"));
assert.ok(all[2].includes("The prosecution argued:") && all[2].includes("PROSECUTION-TEXT"));
assert.ok(all[3].includes("easy the change is to read") && all[3].includes("## Defense rebuttal\nRD"));
assert.ok(all[4].includes("- user juror: B — w"));

console.log("fanoutCourt ok");

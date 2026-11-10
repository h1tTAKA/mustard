// fanoutJudge 점검 — node --experimental-strip-types src/lib/repo/fanoutJudge.check.ts
import assert from "node:assert";
import { chairPrompt, isClose, judgePrompt, parseChair, parseRanking, shuffleOrder, tally, type Blinded } from "./fanoutJudge.ts";

// 섞기: 순열(빠짐·겹침 없음), rand가 같으면 같은 결과
const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
for (let n = 2; n <= 4; n++) assert.deepStrictEqual([...shuffleOrder(n)].sort(), Array.from({ length: n }, (_, i) => i));
assert.deepStrictEqual(shuffleOrder(3, seq([0, 0])), shuffleOrder(3, seq([0, 0])));
assert.notDeepStrictEqual(shuffleOrder(3, seq([0, 0])), [0, 1, 2]); // 실제로 섞임

// 순위 읽기: 모든 이름이 한 번씩일 때만, "Candidate B"·소문자도 받음, 이유는 아는 이름만
const L = ["A", "B", "C"];
assert.deepStrictEqual(parseRanking({ ranking: ["b", "Candidate A", "C"], reasons: { A: " ok ", Z: "x", B: 3 } }, L), { ranking: ["B", "A", "C"], reasons: { A: "ok" } });
assert.strictEqual(parseRanking({ ranking: ["A", "B"] }, L), null);        // 빠짐
assert.strictEqual(parseRanking({ ranking: ["A", "A", "B"] }, L), null);   // 겹침
assert.strictEqual(parseRanking({ ranking: ["A", "B", "D"] }, L), null);   // 모르는 이름
assert.strictEqual(parseRanking(null, L), null);

// 합산: 1위 3점·2위 2점·3위 1점, 동점이면 1위 표 많은 쪽
const s = tally([["A", "B", "C"], ["B", "A", "C"], ["A", "C", "B"]], L);
assert.deepStrictEqual(s.map((x) => [x.label, x.score, x.firsts]), [["A", 8, 2], ["B", 6, 1], ["C", 4, 0]]);
const tie = tally([["A", "C", "B"], ["B", "C", "A"], ["C", "A", "B"]], L); // A 3+1+2=6, B 1+3+1=5, C 2+2+3=7
assert.deepStrictEqual(tie.map((x) => x.label), ["C", "A", "B"]);
const tie2 = tally([["A", "B"], ["B", "A"]], ["A", "B"]); // 3:3, 1위 표 1:1 → 이름 순
assert.deepStrictEqual(tie2.map((x) => x.label), ["A", "B"]);

// 접전: 점수 차 ≤ 전체 10%
assert.strictEqual(isClose(s), false);                                                         // 8 vs 6, 전체 18 → 2 > 1.8
assert.strictEqual(isClose(tally([["A", "B"], ["B", "A"]], ["A", "B"])), true);
assert.strictEqual(isClose([{ label: "A", score: 0, firsts: 0 }]), false);

// 의장: 아는 승자만(아니면 점수 1위), 승자에겐 옮겨 붙일 점 없음, 이름당 2개
const c = parseChair({ winner: "Candidate b", why: "good", grafts: { A: ["x", "y", "z"], B: ["self"], C: [1, " "] } }, L, "A");
assert.deepStrictEqual(c, { winner: "B", why: "good", grafts: { A: ["x", "y"] } });
assert.strictEqual(parseChair({ winner: "Q" }, L, "C").winner, "C");
assert.strictEqual(parseChair(null, L, "A").winner, "A");

// 프롬프트: 가린 이름만, 에이전트 이름이 새지 않음, 큰 파일 표시
const b: Blinded[] = [{ label: "A", diff: "diff --git a/x b/x\n+1\n", files: [{ path: "x", added: 1, removed: 0 }], truncated: false },
  { label: "B", diff: "", files: [{ path: "big.js", added: 9000, removed: 0, big: true }], truncated: true }];
const p = judgePrompt("fix the bug", b, "Korean");
assert.ok(p.includes("### Candidate A") && p.includes("### Candidate B") && p.includes("[diff omitted: too large]") && p.includes("Write the reasons in Korean."));
assert.ok(!/claude|codex/i.test(p));
assert.ok(chairPrompt("t", b, [{ provider: "claude-code", ranking: ["B", "A"], reasons: { A: "r" } }, { provider: "codex", error: "x" }], tally([["B", "A"]], ["A", "B"]), "English").includes("Reviewer 1: B > A"));
assert.ok(!/claude|codex/i.test(chairPrompt("t", b, [{ provider: "claude-code", ranking: ["B", "A"] }], tally([["B", "A"]], ["A", "B"]), "English"))); // 심사 모델 이름도 안 보냄

console.log("fanoutJudge ok");

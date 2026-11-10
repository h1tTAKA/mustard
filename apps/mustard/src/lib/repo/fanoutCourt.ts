// 겨루기 재판(#1174) — 순수 부분(점검 가능). 판정에서 1·2위가 비슷할 때 두 후보만 놓고 다시 따짐.
// 주장 = "A가 B보다 이 작업에 더 맞다"(A·B는 무작위로 정함 — 판정 1위가 늘 A면 그쪽으로 기울 수 있어서).
// 검사(주장이 틀렸다) · 변호(주장이 맞다) → 서로 반박 한 번씩 → 배심 3명(관점이 다름)이 각자 투표 → 판사가 판결 + 뒤집힐 조건.
import type { Blinded } from "./fanoutJudge.ts";

export const LENSES = ["correctness", "maintainability", "user"] as const; // 배심 관점: 맞게 도나 · 고치기 쉬운가 · 쓰는 사람에게 맞나
export type Lens = (typeof LENSES)[number];
const LENS_TEXT: Record<Lens, string> = {
  correctness: "You care most about whether the change actually works and handles edge cases.",
  maintainability: "You care most about how easy the change is to read, extend and keep correct later.",
  user: "You care most about whether the change does what the person asking really wanted.",
};
const MAX_ARG = 2500; // 변론 하나 글자 상한(다음 단계 입력이 끝없이 커지지 않게)
export const clipArg = (s: string) => s.trim().slice(0, MAX_ARG);

const files = (b: Blinded) => b.files.map((f) => `- ${f.path} (+${f.added} −${f.removed})${f.big ? " [diff omitted: too large]" : ""}`).join("\n") || "- (no changes)";
const evidence = (task: string, a: Blinded, b: Blinded) => [
  "## Task", task, "",
  ...[a, b].map((x) => `## Candidate ${x.label}\nChanged files:\n${files(x)}\n\n\`\`\`diff\n${x.diff || "(empty)"}\n\`\`\``),
].join("\n");
const CLAIM = "Claim: Candidate A fits the task better than Candidate B.";

export const prosecutionPrompt = (task: string, a: Blinded, b: Blinded, language: string) => [
  "You are the prosecutor in a review trial between two coding agents' changes for the same task (anonymized).", CLAIM,
  "Argue that the claim is FALSE: build the strongest concrete case that B is the better change, or that A has a flaw serious enough to lose. Cite files and lines. No hedging.",
  "", evidence(task, a, b), "", `Answer in ${language}, at most 250 words, plain text.`,
].join("\n");
export const defensePrompt = (task: string, a: Blinded, b: Blinded, language: string) => [
  "You are the defense in a review trial between two coding agents' changes for the same task (anonymized).", CLAIM,
  "Argue that the claim is TRUE: build the strongest concrete case that A is the better change. Cite files and lines. No hedging.",
  "", evidence(task, a, b), "", `Answer in ${language}, at most 250 words, plain text.`,
].join("\n");
export const rebuttalPrompt = (side: "prosecution" | "defense", task: string, a: Blinded, b: Blinded, other: string, language: string) => [
  `You are the ${side} in a review trial (anonymized).`, CLAIM,
  `The ${side === "prosecution" ? "defense" : "prosecution"} argued:`, "---", other, "---",
  "Rebut their strongest points with evidence from the diffs. Concede what is true.",
  "", evidence(task, a, b), "", `Answer in ${language}, at most 150 words, plain text.`,
].join("\n");

export interface Arguments { prosecution: string; defense: string; rebutProsecution: string; rebutDefense: string }
const record = (g: Arguments) => [
  "## Prosecution (claim is false)", g.prosecution, "", "## Defense (claim is true)", g.defense, "",
  "## Prosecution rebuttal", g.rebutProsecution, "", "## Defense rebuttal", g.rebutDefense,
].join("\n");

export const jurorPrompt = (lens: Lens, task: string, a: Blinded, b: Blinded, g: Arguments, language: string) => [
  "You are a juror in a review trial between two coding agents' changes for the same task (anonymized). You decide on your own.", LENS_TEXT[lens], CLAIM,
  "", record(g), "", evidence(task, a, b), "",
  `Reply with JSON only: {"vote": "A" or "B" (which change is better), "why": "<one sentence>"}. Write "why" in ${language}.`,
].join("\n");

export interface Vote { lens: Lens; provider: string; vote?: "A" | "B"; why?: string; error?: string }
export const judgeCourtPrompt = (task: string, a: Blinded, b: Blinded, g: Arguments, votes: Vote[], language: string) => [
  "You are the judge in a review trial between two coding agents' changes for the same task (anonymized).", CLAIM,
  "Weigh the arguments, the jury and the diffs yourself. The jury advises; you decide.",
  "", record(g), "", "## Jury",
  ...votes.filter((v) => v.vote).map((v) => `- ${v.lens} juror: ${v.vote} — ${v.why ?? ""}`), "",
  evidence(task, a, b), "",
  `Reply with JSON only: {"winner": "A" or "B", "verdict": "<2-3 sentences>", "flip": "<what would have to be true or change for the other candidate to win>"}. Write "verdict" and "flip" in ${language}.`,
].join("\n");

const ab = (x: unknown) => { const s = typeof x === "string" ? x.trim().replace(/^Candidate\s+/i, "").toUpperCase() : ""; return s === "A" || s === "B" ? s : undefined; };
export function parseVote(j: Record<string, unknown> | null): { vote: "A" | "B"; why: string } | null {
  const vote = ab(j?.vote);
  return vote ? { vote, why: typeof j?.why === "string" ? j.why.trim().slice(0, 400) : "" } : null;
}
// 판사 답 → 승자(못 읽으면 배심 다수)
export function parseJudgment(j: Record<string, unknown> | null, fallback: "A" | "B"): { winner: "A" | "B"; verdict: string; flip: string } {
  return { winner: ab(j?.winner) ?? fallback, verdict: typeof j?.verdict === "string" ? j.verdict.trim().slice(0, 1200) : "", flip: typeof j?.flip === "string" ? j.flip.trim().slice(0, 800) : "" };
}
export function jury(votes: Vote[]): { a: number; b: number; majority: "A" | "B" } {
  const a = votes.filter((v) => v.vote === "A").length, b = votes.filter((v) => v.vote === "B").length;
  return { a, b, majority: b > a ? "B" : "A" };
}

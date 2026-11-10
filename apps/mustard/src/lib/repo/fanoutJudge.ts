// 겨루기 판정(#1174) — 순수 부분(점검 가능). 흐름:
// 후보 diff를 무작위 순서로 섞어 A·B·C…로 이름을 가림(어느 에이전트인지 숨겨 자기 편들기·순서 편향을 줄임)
// → 심사 모델 여럿이 각자 순위(JSON) → 순위 점수 합산(1위 N점 … 꼴찌 1점, 동점이면 1위 표 많은 쪽)
// → 의장이 추천 승자·이유·진 후보별 가져올 좋은 점을 정리. 가린 이름은 결과에서 다시 풂(order).

export const LETTERS = "ABCD";
// 모델 이름(#1313) — 후보는 터미널 실행 줄에 `--model <이름>`으로 그대로 들어가서 셸이 해석할 글자는 막음, 심사도 같은 규칙
export const MODEL = /^[\w.:/@-]{1,80}$/;
// 심사 모델 고르기(#1313) — 심사(claude-code·codex·opencode)마다 모델 이름. 없으면 그 AI 기본 모델. 의장·변론·판사는 Claude 칸을 따름
export const JUDGE_PROVIDERS = ["claude-code", "codex", "opencode"] as const;
export type JudgeModels = Partial<Record<(typeof JUDGE_PROVIDERS)[number], string>>;
export const pickModels = (x: unknown): JudgeModels => {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return Object.fromEntries(JUDGE_PROVIDERS.flatMap((p) => { const v = typeof o[p] === "string" ? (o[p] as string).trim() : ""; return v && MODEL.test(v) ? [[p, v]] : []; }));
};
export interface Blinded { label: string; diff: string; files: { path: string; added: number; removed: number; big?: boolean }[]; truncated: boolean }
export interface JudgeResult { provider: string; model?: string; ranking?: string[]; reasons?: Record<string, string>; error?: string }
export interface Score { label: string; score: number; firsts: number }
export interface Chair { winner: string; why: string; grafts: Record<string, string[]> }

// order[k] = k번째 이름(A·B…)이 가리키는 후보 번호. rand는 점검용으로 갈아끼움.
export function shuffleOrder(n: number, rand: () => number = Math.random): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const fileList = (b: Blinded) => b.files.map((f) => `- ${f.path} (+${f.added} −${f.removed})${f.big ? " [diff omitted: too large]" : ""}`).join("\n") || "- (no changes)";
const block = (b: Blinded) => `### Candidate ${b.label}\nChanged files:\n${fileList(b)}\n${b.truncated ? "(Some file diffs were omitted for size.)\n" : ""}\n\`\`\`diff\n${b.diff || "(empty)"}\n\`\`\``;

export function judgePrompt(task: string, cands: Blinded[], language: string): string {
  const labels = cands.map((c) => c.label);
  return [
    "Several coding agents were given the same task, each in its own copy of the repository. Their changes are below, anonymized and in random order.",
    "Rank them from best to worst for this task. Judge: does it do what the task asks, is it correct, does it stay in scope (no unrelated changes), is it simple and maintainable.",
    "An empty or unrelated change ranks last. Do not reward length.",
    "",
    "## Task", task, "",
    "## Candidates", ...cands.map(block), "",
    `Reply with JSON only: {"ranking": [${labels.map((l) => `"${l}"`).join(", ")}] (best first, every label exactly once), "reasons": {"<label>": "<one sentence>"}}.`,
    `Write the reasons in ${language}.`,
  ].join("\n");
}

// 심사 답 → 순위(모든 이름이 한 번씩일 때만, 아니면 null = 그 심사 버림)
export function parseRanking(j: Record<string, unknown> | null, labels: string[]): { ranking: string[]; reasons: Record<string, string> } | null {
  const r = Array.isArray(j?.ranking) ? j.ranking.map((x) => String(x).trim().replace(/^Candidate\s+/i, "").toUpperCase()) : [];
  if (r.length !== labels.length || new Set(r).size !== r.length || !r.every((x) => labels.includes(x))) return null;
  const reasons: Record<string, string> = {};
  const src = j?.reasons && typeof j.reasons === "object" ? (j.reasons as Record<string, unknown>) : {};
  for (const l of labels) { const v = src[l]; if (typeof v === "string" && v.trim()) reasons[l] = v.trim().slice(0, 400); }
  return { ranking: r, reasons };
}

// 순위 점수 합산 — 높은 점수 순, 동점이면 1위 표, 그래도 같으면 이름 순(안정)
export function tally(rankings: string[][], labels: string[]): Score[] {
  const n = labels.length;
  const m = new Map<string, Score>(labels.map((l) => [l, { label: l, score: 0, firsts: 0 }]));
  for (const r of rankings) r.forEach((l, i) => { const s = m.get(l); if (s) { s.score += n - i; if (i === 0) s.firsts++; } });
  return [...m.values()].sort((a, b) => b.score - a.score || b.firsts - a.firsts || a.label.localeCompare(b.label));
}
// 1·2위가 비슷함 = 점수 차가 전체 점수의 10% 이하 → 재판 제안
export function isClose(scores: Score[]): boolean {
  if (scores.length < 2) return false;
  const total = scores.reduce((s, x) => s + x.score, 0);
  return total > 0 && scores[0].score - scores[1].score <= total * 0.1;
}

export function chairPrompt(task: string, cands: Blinded[], judges: JudgeResult[], scores: Score[], language: string): string {
  const ok = judges.filter((j) => j.ranking);
  return [
    "You chair a review of several coding agents' attempts at the same task (anonymized). The reviewers ranked them; the combined scores are below.",
    "Pick the candidate to adopt, say why in two or three sentences, and for each other candidate list at most two concrete things worth porting into the winner (empty if nothing).",
    "",
    "## Task", task, "",
    "## Candidates", ...cands.map(block), "",
    "## Reviewers",
    ...ok.map((j, i) => `Reviewer ${i + 1}: ${j.ranking!.join(" > ")}\n${Object.entries(j.reasons ?? {}).map(([l, r]) => `  ${l}: ${r}`).join("\n")}`),
    "",
    "## Combined scores", ...scores.map((s) => `${s.label}: ${s.score} (first place ${s.firsts}x)`), "",
    `Reply with JSON only: {"winner": "<label>", "why": "<2-3 sentences>", "grafts": {"<other label>": ["<thing to port>"]}}.`,
    `Write "why" and the grafts in ${language}.`,
  ].join("\n");
}

// 의장 답 → 승자(아는 이름만, 아니면 점수 1위)·이유·옮겨 붙일 점(승자 말고, 이름당 2개)
export function parseChair(j: Record<string, unknown> | null, labels: string[], fallback: string): Chair {
  const w = typeof j?.winner === "string" ? j.winner.trim().replace(/^Candidate\s+/i, "").toUpperCase() : "";
  const winner = labels.includes(w) ? w : fallback;
  const why = typeof j?.why === "string" ? j.why.trim().slice(0, 1200) : "";
  const grafts: Record<string, string[]> = {};
  const src = j?.grafts && typeof j.grafts === "object" ? (j.grafts as Record<string, unknown>) : {};
  for (const l of labels) {
    if (l === winner || !Array.isArray(src[l])) continue;
    const xs = (src[l] as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 300)).slice(0, 2);
    if (xs.length) grafts[l] = xs;
  }
  return { winner, why, grafts };
}

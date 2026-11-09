// 겨루기 판정 실행(#1174) — 서버 전용. 심사 모델 = 이 PC에 깔리고 로그인된 것 중 최대 3개(Claude는 항상, Codex·OpenCode는 감지되면).
// 기존 SNA 한 번 묻기(pr-review 모드: 프롬프트 그대로 + 리뷰어 시스템)를 쓰고, 동시 실행 칸(4)은 SNA 대기열이 나눔.
// 오래 걸려서(심사 N + 의장 1) 요청은 바로 돌려주고 뒤에서 돎 — 진행 상태는 겨루기 기록의 verdict.state로(패널이 다시 읽음).
import { snaClaudeProvider, snaCodexProvider, snaOpenCodeProvider } from "@mustard/nunopi/server";
import { checkAgent } from "@/lib/crew/agentDetect";
import { readJson, withIdleTimeout } from "@/lib/crew/crewMeeting";
import { isFailedNote } from "@/lib/failText";
import { narrationLocale } from "@/lib/narrationConfig";
import { candidateDiff, getFanout, saveFanout } from "./fanout";
import { LETTERS, chairPrompt, isClose, judgePrompt, parseChair, parseRanking, shuffleOrder, tally, type Blinded, type JudgeResult, type Score } from "./fanoutJudge";

const MODELS = [
  { provider: "claude-code", api: snaClaudeProvider, pid: "claude-agent" },
  { provider: "codex", api: snaCodexProvider, pid: "codex-agent" },
  { provider: "opencode", api: snaOpenCodeProvider, pid: "opencode-agent" },
] as const;
type Model = (typeof MODELS)[number];
const LANG = { ko: "Korean", ja: "Japanese", en: "English" } as const;

export interface Verdict {
  state: "running" | "done" | "failed"; at: number; error?: string;
  order?: number[];                               // order[k] = 이름 LETTERS[k]가 가리키는 후보 번호
  judges?: JudgeResult[];
  scores?: (Score & { candidate: number })[];
  chair?: { winner: number; why: string; grafts: Record<number, string[]> }; // 후보 번호 기준(이름 풂)
  close?: boolean;                                // 1·2위가 비슷함 → 재판 제안
}

// 한 번 묻기 — 무진행 3분·전체 15분(diff가 커서 길게 생각할 수 있음). 실패 문구가 "성공처럼" 오면 실패로.
export async function askModel(m: Model, prompt: string): Promise<string> {
  const res = await withIdleTimeout((touch, signal) => m.api.analyze({ locale: narrationLocale(), providerId: m.pid, mode: "pr-review", code: prompt, messages: [{ role: "user", content: prompt }] } as Parameters<typeof m.api.analyze>[0],
    { signal, onStart: touch, onProgress: touch, onThinking: touch }), 180_000, 15 * 60_000);
  const text = (res?.summary ?? "").trim();
  if (!text || isFailedNote(text)) throw new Error(text.slice(0, 200) || "empty");
  return text;
}
export const claudeModel = MODELS[0];
// 심사 모델 — Claude + 감지 기록상 깔리고 로그인된 Codex·OpenCode
export const judgeModels = (): Model[] => MODELS.filter((m) => m.provider === "claude-code" || checkAgent(m.provider)?.kind === "ok").slice(0, 3);
export const language = () => LANG[narrationLocale()] ?? "English";

const running = new Set<string>(); // 같은 겨루기를 두 번 동시에 판정하지 않게(서버 메모리)

export function startJudge(root: string, id: string): Verdict {
  const f = getFanout(root, id);
  if (!f) throw new Error("not found");
  if (running.has(id)) return f.verdict as Verdict;
  const v: Verdict = { state: "running", at: Date.now() };
  saveFanout(root, { ...f, verdict: v });
  running.add(id);
  void judge(root, id).catch((e) => {
    const cur = getFanout(root, id);
    if (cur) saveFanout(root, { ...cur, verdict: { state: "failed", at: Date.now(), error: String((e as Error)?.message ?? e).slice(0, 300) } satisfies Verdict });
  }).finally(() => running.delete(id));
  return v;
}

async function judge(root: string, id: string) {
  const f = getFanout(root, id);
  if (!f) throw new Error("not found");
  const diffs = await Promise.all(f.candidates.map((c) => candidateDiff(c)));
  const order = shuffleOrder(f.candidates.length);
  const blinded: Blinded[] = order.map((ci, k) => ({ label: LETTERS[k], ...diffs[ci] }));
  const labels = blinded.map((b) => b.label);
  const lang = language();
  const prompt = judgePrompt(f.prompt, blinded, lang);
  const judges: JudgeResult[] = await Promise.all(judgeModels().map(async (m): Promise<JudgeResult> => {
    try {
      const r = parseRanking(readJson(await askModel(m, prompt)), labels);
      return r ? { provider: m.provider, ...r } : { provider: m.provider, error: "unreadable" };
    } catch (e) { return { provider: m.provider, error: String((e as Error)?.message ?? e).slice(0, 200) }; }
  }));
  const ok = judges.filter((j) => j.ranking);
  if (!ok.length) throw new Error(`no judge answered: ${judges.map((j) => `${j.provider}: ${j.error}`).join("; ")}`);
  const scores = tally(ok.map((j) => j.ranking!), labels);
  // 의장(Claude) — 실패해도 판정은 남김(점수 1위가 추천, 이유 없음)
  const chair = await askModel(claudeModel, chairPrompt(f.prompt, blinded, judges, scores, lang))
    .then((t) => parseChair(readJson(t), labels, scores[0].label), () => parseChair(null, labels, scores[0].label));
  const at = (l: string) => order[LETTERS.indexOf(l)];
  const v: Verdict = {
    state: "done", at: Date.now(), order, judges,
    scores: scores.map((s) => ({ ...s, candidate: at(s.label) })),
    chair: { winner: at(chair.winner), why: chair.why, grafts: Object.fromEntries(Object.entries(chair.grafts).map(([l, xs]) => [at(l), xs])) },
    close: isClose(scores),
  };
  const cur = getFanout(root, id);
  if (cur) saveFanout(root, { ...cur, verdict: v });
}

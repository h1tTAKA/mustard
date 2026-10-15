// 커밋 세션 카드(#1064) — 커밋을 만든 에이전트 세션을 찾아(서버) 요약하고 캐치업 카드(kind "session")로.
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { askAgent } from "@/lib/hunkNotes";
import type { SessionMsg } from "@/lib/agentSessionParse";

export const sessionItemKey = (hash: string) => `session|${hash}`;
export const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", antigravity: "Antigravity" };
const TOOL_CLIP = 300, INPUT_MAX = 14_000; // 요약 입력 — 도구 출력은 짧게, 대화는 그대로, 전체 상한(최근 쪽 유지)

const PROMPT = "아래는 AI 코딩 에이전트와 사용자의 대화 기록입니다(커밋 하나를 만든 구간). 이 작업을 개발 초보도 이해하게 요약해줘:\n"
  + "- 첫 줄: 무엇을 왜 했는지 한 문장.\n- 이어서 3~6개 글머리: 사용자 요청 → 에이전트가 한 일·결정·부딪힌 문제와 해결 순서대로.\n"
  + "사람 이름·감정 묘사·메타 발언 금지. 큰 제목(#) 쓰지 말고, 카드는 만들지 마세요.";

export function sessionDigest(msgs: SessionMsg[]): string {
  const lines = msgs.map((m) => (m.role === "user" ? "[사용자] " : m.role === "assistant" ? "[AI] " : "[도구] ") + (m.role === "tool" ? m.text.slice(0, TOOL_CLIP) : m.text));
  const all = lines.join("\n");
  return all.length > INPUT_MAX ? all.slice(-INPUT_MAX) : all;
}

export interface LinkedSession { agent: string; sessionId: string; branch?: string; messages: SessionMsg[]; closed?: boolean }

// 세션 찾기 → 요약 → 카드 항목. 세션 없으면(사람이 직접 커밋 등) "none".
// 턴이 아직 안 끝났으면 "wait"(마무리 말까지 담으려고 — 다음 주기에 다시). force면 안 끝났어도 만듦(오래 기다린 경우).
export async function buildSessionItem(root: string, hash: string, ts: number, subject: string, branch: string,
  providerId: AgentProviderKind, providerSettings: ProviderSettings, locale: string, force = false, merge = false) {
  const r = await fetch("/api/repo/session-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, hash, ts, merge }) });
  const j = await r.json().catch(() => null);
  const s = j?.session as LinkedSession | null | undefined;
  if (!s?.messages?.length) return "none" as const;
  if (s.closed === false && !force) return "wait" as const;
  let expl: string;
  try { expl = await askAgent(sessionDigest(s.messages), PROMPT, providerId, providerSettings, locale); }
  catch {
    if (!force) return "wait" as const; // #1093 요약 실패(런타임 상한 등) — 다음 주기에 다시
    expl = s.messages.find((m) => m.role === "user")?.text.slice(0, 400) || "(요약 실패)"; // 20분 넘게 실패 — 원본이라도 볼 수 있게 카드는 만듦
  }
  return {
    key: sessionItemKey(hash), kind: "session", target: `${subject || hash.slice(0, 7)} @${hash.slice(0, 7)}`,
    tool: [AGENT_LABEL[s.agent] ?? s.agent, s.branch || branch].filter(Boolean).join(" · ").slice(0, 200), ts: Date.now(), expl: expl.slice(0, 8000),
  };
}

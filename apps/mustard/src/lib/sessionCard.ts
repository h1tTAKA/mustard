// 커밋 세션 카드(#1064) — 커밋을 만든 에이전트 세션을 찾아(서버) 요약하고 캐치업 카드(kind "session")로.
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { askAgent } from "@/lib/hunkNotes";
import type { SessionMsg } from "@/lib/agentSessionParse";
import { translate } from "@mustard/core/messages";

export const sessionItemKey = (hash: string) => `session|${hash}`;
export const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", antigravity: "Antigravity", crew: "Crew" };
const TOOL_CLIP = 300, INPUT_MAX = 14_000; // 요약 입력 — 도구 출력은 짧게, 대화는 그대로, 전체 상한(최근 쪽 유지)

const PROMPT = "아래는 AI 코딩 에이전트와 사용자의 대화 기록입니다(커밋 하나를 만든 구간). 이 작업을 개발 초보도 이해하게 요약해줘:\n"
  + "- 첫 줄: 무엇을 왜 했는지 한 문장.\n- 이어서 3~6개 글머리: 사용자 요청 → 에이전트가 한 일·결정·부딪힌 문제와 해결 순서대로.\n"
  + "사람 이름·감정 묘사·메타 발언 금지. 큰 제목(#) 쓰지 말고, 카드는 만들지 마세요.";

// #1135 Crew 커밋 — 역할끼리 주고받은 대화방 글이 앞에. "누가 누구에게 무엇을 지시했나"부터 쓰게.
const CREW_PROMPT = "앞부분 [Crew 대화]는 역할 에이전트(@역할)끼리 주고받은 지시·인계·질문입니다. 첫 줄 다음에 \"@역할이 @역할에게 무엇을 지시·질문했고 어떻게 이어졌는지\" 흐름을 1~3줄로 먼저 쓰세요.\n";
export interface CrewTalk { from: string; kind: string; to: string[]; text: string }

export function sessionDigest(msgs: SessionMsg[], crew: CrewTalk[] = []): string {
  const talk = crew.map((c) => `@${c.from}${c.to.length ? ` → ${c.to.map((x) => `@${x}`).join(" ")}` : ""} (${c.kind}): ${c.text}`);
  const lines = msgs.map((m) => (m.role === "user" ? "[사용자] " : m.role === "assistant" ? "[AI] " : "[도구] ") + (m.role === "tool" ? m.text.slice(0, TOOL_CLIP) : m.text));
  // Crew 대화는 앞에 고정(상한 반), 에이전트 기록은 남은 만큼 최근 쪽. 구역 표지는 자르지 않음(리뷰)
  const head = talk.length ? `[Crew 대화]\n${talk.join("\n").slice(0, INPUT_MAX / 2)}\n[에이전트 기록]\n` : "";
  const all = lines.join("\n"), room = Math.max(0, INPUT_MAX - head.length);
  return head + (all.length > room ? all.slice(-room) : all);
}

export interface LinkedSession { agent: string; sessionId: string; branch?: string; messages: SessionMsg[]; closed?: boolean; crew?: CrewTalk[] }

// 세션 찾기 → 요약 → 카드 항목. 세션 없으면(사람이 직접 커밋 등) "none".
// 턴이 아직 안 끝났으면 "wait"(마무리 말까지 담으려고 — 다음 주기에 다시). force면 안 끝났어도 만듦(오래 기다린 경우).
export async function buildSessionItem(root: string, hash: string, ts: number, subject: string, branch: string,
  providerId: AgentProviderKind, providerSettings: ProviderSettings, locale: string, force = false, merge = false) {
  const r = await fetch("/api/repo/session-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, hash, ts, merge, branch }) });
  const j = await r.json().catch(() => null);
  // #1235 서버 오류·JSON 아님은 "세션 없음"이 아님 — 다음 주기에 다시(예전엔 none으로 버려 머지 카드가 영영 빠졌음). none은 서버가 ok로 null을 줄 때만.
  if (r.status >= 400 && r.status < 500) return "none" as const; // 요청 자체가 잘못됨(경로·hash 형식) — 다시 해도 같음(리뷰)
  if (!r.ok || j?.ok !== true) return "error" as const; // 서버 오류·JSON 아님 — 호출부가 몇 번만 다시
  const s = j.session as LinkedSession | null | undefined;
  if (!s?.messages?.length && !s?.crew?.length) return "none" as const;
  if (s.closed === false && !force) return "wait" as const;
  let expl: string;
  try { expl = await askAgent(sessionDigest(s.messages, s.crew), s.crew?.length ? CREW_PROMPT + PROMPT : PROMPT, providerId, providerSettings, locale); }
  catch {
    if (!force) return "wait" as const; // #1093 요약 실패(런타임 상한 등) — 다음 주기에 다시
    expl = s.messages.find((m) => m.role === "user")?.text.slice(0, 400) || translate(locale, "fallback.summaryFailed"); // 20분 넘게 실패 — 원본이라도 볼 수 있게 카드는 만듦
  }
  return {
    key: sessionItemKey(hash), kind: "session", target: `${subject || hash.slice(0, 7)} @${hash.slice(0, 7)}`,
    tool: [s.crew?.length && s.agent !== "crew" ? `Crew/${AGENT_LABEL[s.agent] ?? s.agent}` : AGENT_LABEL[s.agent] ?? s.agent, s.branch || branch].filter(Boolean).join(" · ").slice(0, 200), ts: ts > 0 ? Math.min(ts * 1000, Date.now()) : Date.now(), expl: expl.slice(0, 8000), // #1244 카드 시각 = 커밋(머지) 시각 — 늦게·되살려 만들어도 그 자리에(미래·0이면 지금, 리뷰)
  };
}

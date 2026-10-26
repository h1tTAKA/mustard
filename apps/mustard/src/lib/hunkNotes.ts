// diff 변경 구간 설명(#1054로 DiffPane에서 분리) — 화면(DiffPane)과 커밋 자동 설명이 같은 구간·프롬프트·저장소를 씀.
// 저장 = localStorage `nunopi:hunk-notes:{root}:{hash|wt:종류}:{file}` → { 구간 diffText: 설명 }.
import { parseCardSuggestions } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";

export * from "./hunkDiff";
import { withLegacyAliases } from "./hunkDiff";

export const HUNK_NOTES_EVENT = "nunopi:hunk-notes"; // detail = 저장 키 — 열려 있는 DiffPane이 바로 다시 읽게

// #1093 실패 문구가 설명으로 저장된 옛 값 — 없는 것으로(다시 설명).
import { isFailedNote } from "@/lib/failText";
export { isFailedNote };
// 저장된 그대로(별칭 없이) — 저장할 때 씀(별칭이 진짜 키로 굳지 않게, 리뷰).
function rawNotes(store: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(store); const all = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v === "string" && !isFailedNote(v)));
  } catch { return {}; }
}
export function loadNotes(store: string): Record<string, string> {
  // #1127 parseDiff 수정 전 키(끝 개행이 만든 빈 문맥 줄·"\ No newline" 줄 포함)도 새 키로 찾히게 별칭 — 이미 받은 설명을 다시 사지 않게.
  // 한계: 진짜 빈 문맥 줄로 끝나는 새 키에도 별칭이 생김(메모리에서만, 진짜 키가 항상 우선) — 같은 파일에 끝 빈 줄만 다른 구간이 있을 때만 엇갈림.
  // 옛 파서가 hunk 안 "----"·"-- x" 줄을 빼먹은 키는 못 맞춤 → 그 구간만 다시 설명(비용 한 번).
  return withLegacyAliases(rawNotes(store));
}
// 구간 하나 저장(읽고 합쳐 쓰기 — 화면과 자동 설명이 같은 키에 써도 서로 안 지움).
export function saveNote(store: string, diffText: string, text: string): void {
  try { localStorage.setItem(store, JSON.stringify({ ...rawNotes(store), [diffText]: text })); } catch { /* ignore */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HUNK_NOTES_EVENT, { detail: store }));
}

const PROMPT = "아래는 코드 변경(diff)입니다(- 삭제, + 추가). 다음을 쉬운 말로, 그러나 정확하게 설명해줘:\n1) 무엇을 바꿨는지 한 문장.\n2) 바뀐(+ 표시된) 코드가 실제로 하는 일을 한 줄씩 또는 흐름으로 풀어서 읽어줘.\n3) 왜 이렇게 바꿨는지(의도·이유).\n4) 어떤 효과·영향이 있는지.\n주니어 개발자도 이해할 만큼 쉽게. 짧고 명확하게. '답변' 같은 제목·머리말 없이 바로 내용부터 시작하고, 큰 제목(#, ##)은 쓰지 마세요. 카드는 만들지 마세요.";
type StreamEvent = { type: "progress"; line: string } | { type: "result"; response: { summary: string; warnings?: { code: string; message: string }[] } } | { type: "error"; message: string };

// 구간 하나 설명 — analyze mode:chat 재사용(서버 변경 0). 실패면 throw.
export const explainDiffText = (diffText: string, providerId: AgentProviderKind, providerSettings: ProviderSettings, locale: string) =>
  askAgent(diffText, PROMPT, providerId, providerSettings, locale);

// 자료(code) + 지시(prompt) → 답(카드 블록 제거). 커밋 세션 요약(#1064)도 같은 경로.
// mode "pr-review"(#1127)는 code에 지시까지 완성해 보냄(튜터 시스템프롬프트 대신 리뷰어용) — prompt는 대화 기록용으로만.
export async function askAgent(code: string, prompt: string, providerId: AgentProviderKind, providerSettings: ProviderSettings, locale: string, mode: "chat" | "pr-review" = "chat"): Promise<string> {
  const res = await fetch("/api/agent/analyze", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, request: { code, locale, providerId, mode, messages: [{ role: "user", content: prompt }], providerSettings } }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "", answer = "", failed = "";
  const take = (l: string) => {
    if (!l.trim()) return; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { return; }
    if (ev.type === "error") failed = ev.message || "error";
    if (ev.type !== "result") return;
    answer = ev.response.summary ?? "";
    // #1093 런타임 실패·연결 불가는 summary에 문구를 담아 "성공처럼" 옴 → 예외로(저장·캐시 안 되게, 호출부가 재시도)
    const w = ev.response.warnings?.find((x) => x.code === "PARSE_FAILED" || x.code === "PARTIAL_PARSE");
    if (w || isFailedNote(answer)) failed = w?.message || answer;
  };
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); const ls = buf.split("\n"); buf = ls.pop() ?? "";
    for (const l of ls) take(l);
  }
  if (buf.trim()) take(buf); // 개행 없이 끝난 마지막 이벤트(result) 유실 방지
  if (failed) throw new Error(failed);
  const text = parseCardSuggestions(answer).text || answer;
  if (!text.trim()) throw new Error("empty answer"); // 빈 답도 실패(저장하면 다시 안 물어봄)
  return text;
}

// 에이전트 훅 이벤트 공통(#764·#989) — status 라우트(화면 보고)와 hook 라우트(Claude 관리형 훅)가 공유.
import type { AgentState } from "@mustard/nunopi/agent";

// 코드 편집·실행 툴만 학습 신호로(#857). Read/Grep/Glob 등 탐색은 노이즈라 제외(그래프 툴이 커버).
export const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Update", "Bash"]);

// tool_input을 짧은 한 줄로 — Bash=command, Edit/Write/Read=file_path 등.
export function shortToolInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") return input.slice(0, 120);
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const cand = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.description;
    if (typeof cand === "string") return cand.slice(0, 120);
    try { return JSON.stringify(o).slice(0, 120); } catch { return undefined; }
  }
  return String(input).slice(0, 120);
}

// Claude 훅 이벤트 → 상태. 모르는 이벤트는 null(상태 변경 안 함).
// PostCompact(manual)은 done이지만 알림 없음(세션 경계) — silent. auto는 턴 안이라 무시.
export function hookState(event: string, payload: Record<string, unknown>): { state: AgentState; silent?: boolean } | null {
  switch (event) {
    case "UserPromptSubmit":
    case "PostToolUse": return { state: "working" };
    case "PermissionRequest": return { state: "waiting" };
    case "Stop":
    case "StopFailure": return { state: "done" };
    case "PostCompact": return payload.trigger === "manual" ? { state: "done", silent: true } : null;
    default: return null;
  }
}

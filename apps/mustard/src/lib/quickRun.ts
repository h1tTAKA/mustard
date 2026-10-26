// 빠른 명령 실행(#1194) — 셸 = 이 레포에서 지금 보는 터미널에 글(+Enter), 에이전트 = 이 레포 에이전트 터미널에 보냄(셸로는 안 감 — main이 판단).
import { quickShellInput, type QuickCommand } from "@mustard/core";
import { sendToAgent } from "@/lib/browser/sendToAgent";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";

// 이 레포 터미널 패널이 기억하는 "지금 보는 탭"(TerminalPane과 같은 키). 목록에 없는 id(닫힌 탭)는 안 씀.
function activeTerminal(cwd: string): string | null {
  try {
    const d = JSON.parse(localStorage.getItem(`nunopi:ws-terms:${cwd}`) || "null");
    const id = typeof d?.activeId === "string" ? d.activeId : null;
    return id && Array.isArray(d?.tabs) && d.tabs.some((x: { id?: unknown }) => x?.id === id) ? id : null;
  } catch { return null; }
}

export async function runQuickCommand(cwd: string, c: QuickCommand): Promise<{ ok: true } | { ok: false; reason: "no-terminal" | "no-agent" | "error" }> {
  if (c.kind === "agent") {
    const r = await sendToAgent(cwd, c.text);
    if (!r.ok) return { ok: false, reason: r.reason === "no-agent" ? "no-agent" : "error" };
    requestTerminalFocus(cwd, r.id);
    return { ok: true };
  }
  const id = activeTerminal(cwd);
  const term = window.nunopiDesktop?.terminal;
  if (!id || !term) return { ok: false, reason: "no-terminal" };
  term.input({ id, data: quickShellInput(c) });
  requestTerminalFocus(cwd, id);
  return { ok: true };
}

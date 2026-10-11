// 인앱 브라우저 피드백을 이 레포 에이전트 터미널로(#1037).
// 대상: 이 레포 터미널 탭 저장값(TerminalPane과 같은 키)의 활성 탭이 에이전트면 그것, 아니면 이 레포의 첫 에이전트 세션.
// 전송: bracketed paste(여러 줄이 한 번에 입력창으로) → 잠깐 뒤 Enter. 본문 제어문자는 formatPickFeedback이 이미 제거.
const norm = (p: string) => String(p || "").replace(/\/+$/, "");

export async function sendToAgent(repo: string, text: string): Promise<{ ok: true; id: string } | { ok: false; reason: "no-agent" | "no-api" }> {
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.terminal : undefined;
  if (!api) return { ok: false, reason: "no-api" };
  const root = norm(repo);
  const sessions = (await api.list()).filter((s) => s.agent && (norm(s.cwd) === root || norm(s.cwd).startsWith(root + "/")));
  let activeId: string | undefined;
  try { activeId = JSON.parse(localStorage.getItem(`nunopi:ws-terms:${repo}`) || "null")?.activeId; } catch { /* ignore */ }
  const target = sessions.find((s) => s.id === activeId) ?? sessions[0];
  if (!target) return { ok: false, reason: "no-agent" };
  api.input({ id: target.id, data: `\x1b[200~${text}\x1b[201~` });
  await new Promise((r) => setTimeout(r, 150)); // TUI가 붙여넣기를 다 받은 뒤 Enter(바로 보내면 Enter가 붙여넣기에 섞임)
  api.input({ id: target.id, data: "\r" });
  return { ok: true, id: target.id };
}

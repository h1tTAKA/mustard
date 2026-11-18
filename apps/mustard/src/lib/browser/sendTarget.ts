// #1372 인앱 브라우저 '에이전트로 보내기' 받을 곳 — 이 레포의 터미널 에이전트 탭 + 열린 채팅 탭.
// 하나면 바로, 여럿이면 고르게. 터미널 쪽 "셸이면 안 보냄"은 main이 보낼 때 다시 확인(목록은 보여 주기만).
export type SendTarget = { kind: "term"; id: string; name: string; agent: string | null } | { kind: "chat"; id: string; name: string; provider: string };

// 순수 조립(점검용) — 터미널은 탭 순서(이름 = 직접 붙인 이름 → 세션 제목, 없으면 ""), 채팅은 열린 순서(터미널로 넘긴 채팅은 못 받아서 뺌)
export function buildTargets(
  tabs: { id: string; customTitle?: string }[],
  live: { id: string; agent: string | null; title: string }[],
  chats: { id: string; title: string; provider: string; handedOff?: boolean }[],
): SendTarget[] {
  const byId = new Map(live.map((s) => [s.id, s]));
  const term: SendTarget[] = tabs.flatMap((t) => { const s = byId.get(t.id); return s ? [{ kind: "term" as const, id: t.id, name: t.customTitle || s.title || "", agent: s.agent }] : []; });
  return [...term, ...chats.filter((c) => !c.handedOff).map((c) => ({ kind: "chat" as const, id: c.id, name: c.title || "", provider: c.provider }))];
}

function termTabs(repo: string): { tabs: { id: string; customTitle?: string }[]; activeId?: string } {
  try {
    const d = JSON.parse(localStorage.getItem(`nunopi:ws-terms:${repo}`) || "null"); // TerminalPane과 같은 키
    const tabs = Array.isArray(d?.tabs) ? d.tabs.filter((x: { id?: unknown }) => typeof x?.id === "string") : [];
    return { tabs, activeId: typeof d?.activeId === "string" ? d.activeId : undefined };
  } catch { return { tabs: [] }; } // 못 읽으면 터미널은 없음(fail-closed)
}

// 받을 곳 목록 — 둘 다 못 읽으면 null(오류), 하나라도 읽으면 그만큼
export async function listSendTargets(repo: string): Promise<SendTarget[] | null> {
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.browser : undefined;
  const { tabs } = termTabs(repo);
  const [term, chat] = await Promise.all([
    api?.agentTargets ? api.agentTargets({ cwd: repo, ids: tabs.map((x) => x.id) }).catch(() => null) : Promise.resolve(null),
    fetch(`/api/chat/sessions?root=${encodeURIComponent(repo)}`).then((r) => r.json()).catch(() => null),
  ]);
  if (!term?.ok && !chat?.ok) return null;
  return buildTargets(tabs, term?.ok ? term.list : [], chat?.ok && Array.isArray(chat.chats) ? chat.chats : []);
}

// 고른 곳으로 — 터미널은 그 탭만(exact, 그새 사라졌으면 다른 탭으로 새지 않음), 채팅은 그 채팅에 메시지로
export async function sendToTarget(repo: string, t: SendTarget, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (t.kind === "chat") {
    try {
      const r = await (await fetch("/api/chat/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: repo, id: t.id, text, images: [] }) })).json();
      return r?.ok ? { ok: true } : { ok: false, reason: "error" };
    } catch { return { ok: false, reason: "error" }; }
  }
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.browser : undefined;
  if (!api) return { ok: false, reason: "no-api" };
  const r = await api.sendToAgent({ cwd: repo, preferId: t.id, ids: termTabs(repo).tabs.map((x) => x.id), text, exact: true });
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

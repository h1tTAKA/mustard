// 터미널 세션별 에이전트 상태(#1036) — WorkspaceTabs가 이미 레포마다 /api/agent/status를 폴링하므로 그 결과를 여기 모아
// 터미널 탭 아이콘이 같이 씀(연결을 더 열지 않음 — 같은 주소 동시 연결 한도 #1043).
import { useSyncExternalStore } from "react";

const byRepo = new Map<string, Map<string, string>>(); // repo → (sessionId → state)
let version = 0;
const subs = new Set<() => void>();

export function publishRepoSessions(repo: string, list: { sessionId: string; state: string }[] | null) {
  const next = new Map((list ?? []).map((s) => [s.sessionId, s.state] as const));
  const prev = byRepo.get(repo);
  if (prev && prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v)) return; // 그대로면 알림 안 함
  byRepo.set(repo, next);
  version++;
  for (const f of subs) f();
}
export function sessionState(sessionId: string): string | null {
  for (const m of byRepo.values()) { const s = m.get(sessionId); if (s) return s; }
  return null;
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
// 바뀔 때 다시 그리게 하는 훅(값은 sessionState·isUnread로 읽음). 돌려주는 값 = 바뀔 때마다 오르는 번호.
export function useAgentSessionStates() { return useSyncExternalStore(subscribe, () => version, () => 0); }

// #1217 안 본 사이 끝난(또는 물어보는) 세션 — 일하다 멈춘 순간 표시, 그 터미널 탭이 보이면 지움. 메모리만(앱 다시 켜면 다 본 것).
const unread = new Set<string>();
const bump = () => { version++; for (const f of subs) f(); };
export function markUnread(sessionId: string) { if (!unread.has(sessionId)) { unread.add(sessionId); bump(); } }
export function clearUnread(sessionId: string) { if (unread.delete(sessionId)) bump(); }
export const isUnread = (sessionId: string) => unread.has(sessionId);
// 레포 탭 점 — 그 레포에 지금 열린 세션 중 안 본 게 있으면
export function repoUnread(repo: string): boolean {
  const m = byRepo.get(repo);
  if (!m) return false;
  for (const id of m.keys()) if (unread.has(id)) return true;
  return false;
}

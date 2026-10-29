// #1225 레포 화면 갱신 규칙 — 파일 감시(FSEvents)가 조용히 멈춰도(실측: fseventsd 고장) 파일 목록이 스스로 회복하게.
// 안전망 폴링은 감시가 되든 안 되든 트리(가벼움)를 다시 읽고, 그래프(무거움, #838)는 감시가 없을 때만.
export const POLL_MS = { watching: 15000, fallback: 3000 } as const;
export function pollPlan(watchSupported: boolean) {
  return { status: true, tree: true, graph: !watchSupported };
}

// 파일 목록이 실제로 달라졌는지 — 같으면 교체하지 않아 재렌더·깜빡임 없음.
export function sameFiles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

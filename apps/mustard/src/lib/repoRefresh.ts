// #1225 레포 화면 갱신 규칙 — 파일 감시(FSEvents)가 조용히 멈춰도(실측: fseventsd 고장) 파일 목록이 스스로 회복하게.
// 안전망 폴링은 감시가 되든 안 되든 트리(가벼움)를 다시 읽고, 그래프(무거움, #838)는 감시가 없을 때만.
export const POLL_MS = { watching: 15000, fallback: 3000 } as const;
// 트리는 감시 중이면 4번에 한 번(1분) + git 상태가 바뀐 틱, 감시가 없으면 매 틱. 창이 안 보이면 건너뜀(리뷰: 큰 레포 스캔 비용).
export function pollPlan(watchSupported: boolean) {
  return { status: true, tree: true, treeEvery: watchSupported ? 4 : 1, graph: !watchSupported };
}
// 이번 틱에 트리를 다시 읽을지
export const treeDue = (plan: ReturnType<typeof pollPlan>, tick: number, statusChanged: boolean) => plan.tree && (statusChanged || tick % plan.treeEvery === 0);

// git 상태 맵이 같은지(같으면 그대로 둬서 바뀐 폴더 자동 펼침이 접어 둔 폴더를 다시 펴지 않게)
export function sameStatus(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

// 파일 목록이 실제로 달라졌는지 — 같으면 교체하지 않아 재렌더·깜빡임 없음.
export function sameFiles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

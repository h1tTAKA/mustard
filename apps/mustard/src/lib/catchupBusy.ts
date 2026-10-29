// #1240 캐치업 "만드는 중" 계수기 — 같은 창에서 여러 곳(캐치업 화면·커밋 자동 설명)이 각자 세고, 머리 줄이 모아서 보여줌.
// 종류: explain(해설·명령어 설명) / diff / session. 용어는 해설·명령어 답에서 같이 나와 따로 안 셈.
export type BusyKind = "explain" | "diff" | "session";
export type BusyCounts = Record<BusyKind, number>;
const ZERO: BusyCounts = { explain: 0, diff: 0, session: 0 };
const counts = new Map<string, BusyCounts>();
const subs = new Map<string, Set<() => void>>();

const bump = (root: string, kind: BusyKind, d: number) => {
  const cur = counts.get(root) ?? ZERO;
  counts.set(root, { ...cur, [kind]: Math.max(0, cur[kind] + d) }); // 새 객체 — 구독 쪽 스냅샷이 바뀜
  subs.get(root)?.forEach((f) => f());
};
// 시작하면 끝내는 함수를 돌려줌(두 번 불러도 한 번만 뺌 — finally·catch 겹쳐도 안전)
export function beginBusy(root: string, kind: BusyKind): () => void {
  bump(root, kind, 1);
  let done = false;
  return () => { if (done) return; done = true; bump(root, kind, -1); };
}
export const busyOf = (root: string): BusyCounts => counts.get(root) ?? ZERO;
export function subscribeBusy(root: string, f: () => void): () => void {
  let set = subs.get(root); if (!set) { set = new Set(); subs.set(root, set); }
  set.add(f);
  return () => { set!.delete(f); };
}

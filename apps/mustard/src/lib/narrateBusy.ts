// #1240 서버 실시간 해설 "만드는 중" 수 — narrate가 시작·끝에 셈(globalThis: dev 라우트 리로드에도 한 값).
// 캐치업 창은 /api/repo/learn/busy로 물어봄(서버 해설은 창이 닫혀도 돌아서 클라 계수기로는 모름).
const g = globalThis as unknown as { __mustardNarrating?: Map<string, number> };
const running: Map<string, number> = g.__mustardNarrating ?? (g.__mustardNarrating = new Map());

export function beginNarrate(root: string): () => void {
  running.set(root, (running.get(root) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return; done = true;
    const n = (running.get(root) ?? 1) - 1;
    if (n > 0) running.set(root, n); else running.delete(root);
  };
}
// 그 레포 안(같은 폴더·하위 폴더)에서 도는 해설만 — 홈처럼 위 폴더에서 돈 해설이 그 아래 모든 레포 창에 잡히지 않게(리뷰)
const norm = (p: string) => p.replace(/\/+$/, "");
export function narratingFor(root: string): number {
  const base = norm(root);
  let n = 0;
  for (const [r, c] of running) { const x = norm(r); if (x === base || x.startsWith(base + "/")) n += c; }
  return n;
}

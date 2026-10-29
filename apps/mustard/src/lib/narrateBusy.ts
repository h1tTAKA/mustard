// #1240 서버 실시간 해설 "만드는 중" 수 — narrate가 시작·끝에 셈(globalThis: dev 라우트 리로드에도 한 값).
// 캐치업 창은 /api/repo/learn/busy로 물어봄(서버 해설은 창이 닫혀도 돌아서 클라 계수기로는 모름).
import { matchesRoot } from "./mcpActivity.ts";

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
// 워크스페이스 root와 에이전트 cwd가 상하위여도 같은 레포로(해설 카드가 그 창에 뜨는 규칙과 같음)
export function narratingFor(root: string): number {
  let n = 0;
  for (const [r, c] of running) if (matchesRoot(r, root)) n += c;
  return n;
}

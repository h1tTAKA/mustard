// #1218 안 바뀐 구간 접기 — 바뀐 줄에서 ctx줄보다 먼 안 바뀐 줄이 MIN_RUN줄 이상 이어지면 한 묶음으로 접음.
// kinds = diff 줄 종류(meta·hunk 포함, 위치 그대로), keep(i) = 접으면 안 되는 줄, opened = 펼친 묶음 시작 위치.
// 돌려줌: hidden = 줄 위치 → 묶음 시작 위치, runLen = 묶음 시작 → 줄 수.
export const MIN_RUN = 4; // 이보다 짧으면 버튼 한 줄이 아끼는 게 없어 그대로 보임

export function foldRuns(kinds: string[], ctx: number, keep: (i: number) => boolean, opened: Set<number>) {
  const hidden = new Map<number, number>(), runLen = new Map<number, number>();
  const code = kinds.map((k, i) => (k === "add" || k === "del" || k === "ctx" ? i : -1)).filter((i) => i >= 0);
  const dist = code.map(() => Infinity); // 가장 가까운 바뀐 줄까지 코드줄 수
  let last = -Infinity;
  code.forEach((i, k) => { if (kinds[i] !== "ctx") last = k; dist[k] = k - last; });
  last = Infinity;
  for (let k = code.length - 1; k >= 0; k--) { if (kinds[code[k]] !== "ctx") last = k; dist[k] = Math.min(dist[k], last - k); }
  let run: number[] = [];
  const flush = () => { if (run.length >= MIN_RUN && !opened.has(run[0])) { for (const i of run) hidden.set(i, run[0]); runLen.set(run[0], run.length); } run = []; };
  code.forEach((i, k) => { if (dist[k] > ctx && !keep(i)) run.push(i); else flush(); });
  flush();
  return { hidden, runLen };
}

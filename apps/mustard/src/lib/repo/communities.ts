// 코드 그래프 덩어리(#1331) — 파일끼리 실제 연결(import + 심볼 호출·상속을 파일로 모은 것)로 모듈성 최적화(Louvain 1단계).
// 새 의존성 없이 결정적(파일 이름순, 동점이면 작은 라벨). 연결 없는 파일은 같은 폴더끼리 한 덩어리.
// 라벨 = 멤버가 가장 많이 든 폴더(뒤 두 조각). 크기 내림차순으로 id 0..k-1.
// ponytail: Louvain 집약 단계(덩어리끼리 다시 묶기)는 안 함 — 큰 레포에서 덩어리가 너무 잘면 그때 추가.
import type { Community, RepoEdge, RepoNode } from "./types";

const dirOf = (f: string) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "");

export function detectCommunities(nodes: RepoNode[], edges: RepoEdge[]): { communities: Community[]; byFile: Map<string, number> } {
  const files = nodes.filter((n) => n.kind === "file").map((n) => n.id).sort();
  const fileOf = new Map(nodes.map((n) => [n.id, n.file]));
  const adj = new Map<string, Map<string, number>>(files.map((f) => [f, new Map()]));
  for (const e of edges) {
    if (e.relation === "contains") continue;
    const a = fileOf.get(e.source), b = fileOf.get(e.target);
    if (!a || !b || a === b || !adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + 1);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + 1);
  }
  // 모듈성(modularity)을 키우는 쪽으로 한 파일씩 옮김(Louvain 1단계) — 허브 하나로 다 빨려 드는 라벨 전파보다 덩어리가 고름.
  const label = new Map(files.map((f, i) => [f, i]));
  const deg = new Map(files.map((f) => [f, [...adj.get(f)!.values()].reduce((a, b) => a + b, 0)]));
  const m2 = [...deg.values()].reduce((a, b) => a + b, 0) || 1; // 2m
  const tot = new Map<number, number>(); for (const f of files) tot.set(label.get(f)!, deg.get(f)!);
  for (let it = 0; it < 20; it++) {
    let moved = false;
    for (const f of files) {
      const nb = adj.get(f)!;
      if (!nb.size) continue;
      const cur = label.get(f)!, k = deg.get(f)!;
      const w = new Map<number, number>();
      for (const [g, x] of nb) { const l = label.get(g)!; w.set(l, (w.get(l) ?? 0) + x); }
      tot.set(cur, tot.get(cur)! - k); // 잠깐 빼고 어디가 제일 나은지
      let best = cur, bestG = (w.get(cur) ?? 0) - (tot.get(cur)! * k) / m2;
      for (const [l, x] of w) { const g = x - (tot.get(l)! * k) / m2; if (g > bestG + 1e-12 || (Math.abs(g - bestG) <= 1e-12 && l < best)) { best = l; bestG = g; } }
      tot.set(best, (tot.get(best) ?? 0) + k);
      if (best !== cur) { label.set(f, best); moved = true; }
    }
    if (!moved) break;
  }
  // 연결 없는 파일 → 폴더별 묶음(같은 폴더에 연결된 덩어리가 있으면 거기로)
  const groups = new Map<string, string[]>();
  const key = (f: string) => (adj.get(f)!.size ? `l${label.get(f)}` : `d${dirOf(f)}`);
  const dirMain = new Map<string, string>();
  for (const f of files) if (adj.get(f)!.size && !dirMain.has(dirOf(f))) dirMain.set(dirOf(f), key(f));
  for (const f of files) { const k = adj.get(f)!.size ? key(f) : dirMain.get(dirOf(f)) ?? key(f); const a = groups.get(k); if (a) a.push(f); else groups.set(k, [f]); }
  // 너무 큰 덩어리(전체의 40% 넘고 8개 넘음)는 폴더별로 나눔 — 작은 레포에서 다 한 덩어리가 되는 것 방지
  for (const [k, members] of [...groups]) {
    if (members.length <= 8 || members.length <= files.length * 0.4) continue;
    const byDir = new Map<string, string[]>();
    for (const f of members) { const d = dirOf(f); const a = byDir.get(d); if (a) a.push(f); else byDir.set(d, [f]); }
    if (byDir.size < 2) continue;
    groups.delete(k);
    for (const [d, fs] of byDir) groups.set(`${k}/${d}`, fs);
  }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  const byFile = new Map<string, number>();
  const used = new Map<string, number>();
  const communities: Community[] = sorted.map((members, id) => {
    for (const f of members) byFile.set(f, id);
    const cnt = new Map<string, number>();
    for (const f of members) { const d = dirOf(f).split("/").slice(-2).join("/") || "/"; cnt.set(d, (cnt.get(d) ?? 0) + 1); }
    let lab = [...cnt].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const n = (used.get(lab) ?? 0) + 1; used.set(lab, n);
    if (n > 1) lab = `${lab} ${n}`;
    return { id, label: lab, count: members.length };
  });
  return { communities, byFile };
}

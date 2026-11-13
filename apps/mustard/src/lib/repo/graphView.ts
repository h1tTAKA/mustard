// 코드 그래프 탐색 화면(#1322) 순수 계산 — 보기 깊이·검색·이웃·언어 집계. fs·React 없음(점검 쉬움).
import type { RepoGraph, RepoNode, RepoNodeKind, RepoRelation } from "./types";

// 보기 깊이 — 초보=파일만, 개발자=+클래스·컴포넌트, 숙련자=전부(함수·타입까지). 흐름 설명글 깊이와 같은 값.
export type ViewDepth = "beginner" | "dev" | "expert";
export const DEPTHS: ViewDepth[] = ["beginner", "dev", "expert"];
const KINDS: Record<ViewDepth, RepoNodeKind[]> = {
  beginner: ["file"],
  dev: ["file", "class", "component"],
  expert: ["file", "class", "component", "function", "type"],
};
export const visibleKinds = (d: ViewDepth): Set<RepoNodeKind> => new Set(KINDS[d]);

// 이름·파일·시그니처에서 찾기(대소문자 무시). 이름이 검색어로 시작하면 앞으로. 많으면 limit개만.
export function searchNodes(nodes: RepoNode[], q: string, limit = 30): RepoNode[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hit: { n: RepoNode; score: number }[] = [];
  for (const n of nodes) {
    const label = n.label.toLowerCase();
    const score = label.startsWith(s) ? 0 : label.includes(s) ? 1 : n.file.toLowerCase().includes(s) ? 2 : n.signature?.toLowerCase().includes(s) ? 3 : -1;
    if (score >= 0) hit.push({ n, score });
  }
  hit.sort((a, b) => a.score - b.score || a.n.label.length - b.n.label.length);
  return hit.slice(0, limit).map((h) => h.n);
}

// 노드 상세용 이웃 — 이 노드가 가리키는 것(out)·이 노드를 가리키는 것(in). contains(파일→심볼 소속)는 따로.
export type Link = { node: RepoNode; relation: RepoRelation };
export function neighbors(graph: RepoGraph, id: string): { out: Link[]; in: Link[]; contains: RepoNode[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: Link[] = [], inn: Link[] = [], contains: RepoNode[] = [];
  for (const e of graph.edges) {
    if (e.source === id) {
      const n = byId.get(e.target);
      if (!n) continue;
      if (e.relation === "contains") contains.push(n); else out.push({ node: n, relation: e.relation });
    } else if (e.target === id && e.relation !== "contains") {
      const n = byId.get(e.source);
      if (n) inn.push({ node: n, relation: e.relation });
    }
  }
  return { out, in: inn, contains };
}

// 언어(확장자) 집계 — 파일 노드만, 많은 순.
export function langStats(nodes: RepoNode[]): { ext: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "file") continue;
    const dot = n.file.lastIndexOf(".");
    const ext = dot > n.file.lastIndexOf("/") ? n.file.slice(dot + 1).toLowerCase() : "";
    if (ext) m.set(ext, (m.get(ext) ?? 0) + 1);
  }
  return [...m].map(([ext, count]) => ({ ext, count })).sort((a, b) => b.count - a.count);
}

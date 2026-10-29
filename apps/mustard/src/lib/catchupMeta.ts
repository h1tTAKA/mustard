// 캐치업 카드 메타(#1088 칩 필터, #1238 서버 필터·풀다운) — diff·세션 카드에서 해시·브랜치·에이전트를 뽑음. 화면·서버 공용(순수 함수).
// diff: key "diff|<hash>|<file>", tool "브랜치 · 커밋 제목"(옛 카드는 "diff"). 세션: key "session|<hash>", tool "에이전트 · 브랜치", target "제목 @hash7".
export type TagType = "agent" | "branch" | "hash";
type Card = { kind: string; key: string; tool: string; target?: string; ts?: number };

export function cardMeta(c: Card): { hash: string; branch: string; agent: string } | null {
  const cut = c.tool.indexOf(" · ");
  if (c.kind === "diff") { const h = c.key.split("|")[1] ?? ""; const info = c.tool !== "diff" ? c.tool : ""; return { hash: h.slice(0, 7), branch: cut >= 0 ? info.slice(0, cut) : info, agent: "" }; }
  if (c.kind === "session") return { hash: c.key.slice("session|".length, "session|".length + 7), agent: cut >= 0 ? c.tool.slice(0, cut) : c.tool, branch: cut >= 0 ? c.tool.slice(cut + 3) : "" };
  return null;
}

export function tagMatches(c: Card, type: TagType, value: string): boolean {
  const m = cardMeta(c);
  return !!m && !!value && (type === "hash" ? m.hash === value.slice(0, 7) : m[type] === value);
}

// 커밋 제목 — diff는 tool 뒤쪽, 세션은 target 앞쪽("제목 @hash7")
const subjectOf = (c: Card) => {
  if (c.kind === "diff") { const cut = c.tool.indexOf(" · "); return cut >= 0 ? c.tool.slice(cut + 3) : ""; }
  const m = /^(.*) @[0-9a-f]{4,40}$/i.exec(c.target ?? ""); return m ? m[1] : "";
};

export interface Facet { value: string; label: string; ts: number }
// 풀다운 값 — 최신 카드부터 받은 목록에서 종류마다 처음 본 값만(= 최신순), 종류마다 max개. 해시 label = 커밋 제목.
export function collectFacets(newestFirst: Card[], max = 50): Record<TagType, Facet[]> {
  const out: Record<TagType, Facet[]> = { branch: [], agent: [], hash: [] };
  const seen: Record<TagType, Set<string>> = { branch: new Set(), agent: new Set(), hash: new Set() };
  for (const c of newestFirst) {
    const m = cardMeta(c); if (!m) continue;
    for (const type of ["branch", "agent", "hash"] as const) {
      const v = m[type]; if (!v || seen[type].has(v) || out[type].length >= max) continue;
      seen[type].add(v); out[type].push({ value: v, label: type === "hash" ? subjectOf(c) : "", ts: c.ts ?? 0 });
    }
    if (out.branch.length >= max && out.agent.length >= max && out.hash.length >= max) break;
  }
  // 해시 label이 비었으면(옛 diff 카드) 같은 해시의 다른 카드 제목으로 채움
  for (const f of out.hash) if (!f.label) { const c = newestFirst.find((x) => cardMeta(x)?.hash === f.value && subjectOf(x)); if (c) f.label = subjectOf(c); }
  return out;
}

// #1383 깃 그래프 커밋 줄의 브랜치·태그 배지 고르기 — 배지가 여럿이면 커밋 메시지를 다 가려서(유저 지적).
// 같은 커밋을 가리키는 로컬 X와 origin/X는 하나로(로컬만 보이고 원격은 synced 표시), 현재 브랜치 먼저, 최대 max개 + 나머지는 +N.
const REMOTE = /^(origin|upstream)\//;
export function badgeRefs(refs: string[], current: string, max = 2): { shown: { ref: string; synced: boolean }[]; hidden: string[] } {
  const set = new Set(refs);
  const local = (r: string) => REMOTE.test(r) ? r.replace(REMOTE, "") : null; // origin/X → X (feature/x 같은 로컬 브랜치 이름의 /와 헷갈리지 않게 흔한 원격 이름만)
  const merged = refs.filter((r) => { const l = local(r); return !(l && set.has(l)); }) // origin/X — 로컬 X가 같은 커밋에 있으면 뺌
    .map((ref) => ({ ref, synced: refs.some((o) => local(o) === ref) }));
  merged.sort((a, b) => Number(b.ref === current) - Number(a.ref === current)); // 현재 브랜치 먼저(나머지 순서는 그대로)
  return { shown: merged.slice(0, max), hidden: merged.slice(max).map((x) => x.ref) };
}

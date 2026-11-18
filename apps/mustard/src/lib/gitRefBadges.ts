// #1383 깃 그래프 커밋 줄의 브랜치·태그 배지 고르기 — 배지가 여럿이면 커밋 메시지를 다 가려서(유저 지적).
// 같은 커밋을 가리키는 로컬 X와 origin/X는 하나로(로컬만 보이고 원격은 synced 표시), 현재 브랜치 먼저, 최대 max개 + 나머지는 +N.
const REMOTE = /^(origin|upstream)\//;
export function badgeRefs(refs: string[], current: string, max = 2): { shown: { ref: string; remotes: string[] }[]; hidden: string[] } {
  const set = new Set(refs);
  const local = (r: string) => { if (!REMOTE.test(r)) return null; const l = r.replace(REMOTE, ""); return /^v?\d+(\.\d+)+/.test(l) ? null : l; }; // origin/X → X (흔한 원격 이름만 — feature/x의 /와 안 헷갈리게, 버전 태그 모양(v1.2·1.0.0) 이름은 안 합침 — 2fa-login 같은 브랜치는 합침, 리뷰)
  const merged = refs.filter((r) => { const l = local(r); return !(l && set.has(l)); }) // origin/X — 로컬 X가 같은 커밋에 있으면 뺌
    .map((ref) => ({ ref, remotes: refs.filter((o) => local(o) === ref) })); // 합친 원격 이름(호버 제목·구름 표시)
  merged.sort((a, b) => Number(b.ref === current) - Number(a.ref === current)); // 현재 브랜치 먼저(나머지 순서는 그대로)
  return { shown: merged.slice(0, max), hidden: merged.slice(max).map((x) => x.ref) };
}

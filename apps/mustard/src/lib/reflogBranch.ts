// 커밋별 브랜치(#1068) — 순수 함수(check로 검증). git은 커밋에 브랜치를 안 남겨서, HEAD reflog로 "그 커밋을 만들 때 체크아웃돼 있던 브랜치"를 복원.
// 입력 = `git reflog --format=%H%x1f%gs` 줄들(최신순). 오래된 것부터 훑으며 브랜치 이동을 따라가고, 커밋·머지 항목 해시 → 그때 브랜치.
// 분리 HEAD(해시로 체크아웃, rebase 도중)면 "HEAD". 창 밖이라 시작 브랜치를 모르는 앞쪽 항목은 비움(호출부가 현재 브랜치로 대체).
export function branchesFromReflog(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let cur: string | null = null;
  for (const line of [...lines].reverse()) {
    const [hash, subject = ""] = line.split("\x1f");
    if (!hash) continue;
    const mv = /^checkout: moving from \S+ to (\S+)$/.exec(subject);
    if (mv) { cur = /^[0-9a-f]{7,40}$/i.test(mv[1]) ? "HEAD" : mv[1]; continue; }
    const ret = /returning to refs\/heads\/(\S+)$/.exec(subject); // rebase 끝 — 그 브랜치로 복귀
    if (ret) { cur = ret[1]; continue; }
    if (/^rebase( -i)? \((start|pick|squash|fixup|reword|edit)\)/.test(subject)) { cur = cur && "HEAD"; continue; }
    if (cur && /^(commit( \((amend|merge|initial)\))?|merge \S+|pull\b.*|cherry-pick|revert)/.test(subject) && !out.has(hash)) out.set(hash, cur);
  }
  return out;
}

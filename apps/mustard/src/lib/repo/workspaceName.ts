// 작업공간 이름·브랜치 규칙(#1170) — 서버(workspaces.ts)와 "새 작업공간" 창이 같이 씀(창에서 미리 보여 주는 이름 = 실제 만들 이름).

// 이름 slug — 소문자, [^a-z0-9._-] → -, .. → ., 앞뒤 - 정리, 48자
export function slugName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 48).replace(/[-.]+$/, "");
}
// 이슈 제목 → 이름("Issue #12: " 같은 앞머리 떼고 slug), 비면 issue-<N>
export const issueName = (n: number, title: string) => slugName(title.replace(/^\s*(issue|pr|pull request)?\s*#?\d+\s*[:\-–]\s*/i, "")) || `issue-${n}`;
// 브랜치 조각 — 글자·숫자·._- 말고는 -
export const sanitizeSegment = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|[-.]+$/g, "");
// 접두 정리 — "a/b//c" → "a/b/c"(조각마다 정리)
export const cleanPrefix = (p: string) => p.split("/").map(sanitizeSegment).filter(Boolean).join("/");
// 브랜치 = [접두/]이름
export const branchFor = (prefix: string, name: string) => { const p = cleanPrefix(prefix); return p ? `${p}/${name}` : name; };

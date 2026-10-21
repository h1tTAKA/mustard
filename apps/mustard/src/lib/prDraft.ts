// PR 보류 리뷰(#1145) — diff에서 "리뷰에 추가"한 줄 댓글을 PR별로 모아 두었다가, PR 상세에서 판정(Approve·Request changes·Comment)과 함께 한 리뷰로.
// GitHub의 서버 쪽 PENDING 리뷰는 안 씀(로컬 목록으로 충분). 저장 = localStorage, 같은 창 다른 화면은 이벤트로 동기화(prReview와 같은 방식).

export interface DraftComment {
  id: string;
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  startLine?: number; // 여러 줄 범위(같은 side)
  body: string;
  head?: string; // 그 diff의 커밋(줄 번호 기준)
}

export const PR_DRAFT_EVENT = "mustard:pr-draft";
export const prDraftKey = (root: string, pr: number) => `mustard:pr-draft:${root}:${pr}`;

const valid = (c: unknown): c is DraftComment => {
  const x = c as DraftComment;
  return !!x && typeof x.id === "string" && typeof x.path === "string" && !!x.path && (x.side === "LEFT" || x.side === "RIGHT")
    && Number.isInteger(x.line) && x.line > 0 && (x.startLine === undefined || (Number.isInteger(x.startLine) && x.startLine > 0 && x.startLine < x.line))
    && typeof x.body === "string" && !!x.body.trim();
};

export function loadDrafts(root: string, pr: number): DraftComment[] {
  try { const v = JSON.parse(localStorage.getItem(prDraftKey(root, pr)) || "[]"); return Array.isArray(v) ? v.filter(valid) : []; } catch { return []; }
}
export function saveDrafts(root: string, pr: number, list: DraftComment[]): boolean {
  try { if (list.length) localStorage.setItem(prDraftKey(root, pr), JSON.stringify(list)); else localStorage.removeItem(prDraftKey(root, pr)); } catch { return false; }
  window.dispatchEvent(new CustomEvent(PR_DRAFT_EVENT, { detail: prDraftKey(root, pr) }));
  return true;
}

// 순수 — 넣기(같은 자리·같은 글이면 하나만)·빼기
export function addDraft(list: DraftComment[], c: Omit<DraftComment, "id">, id: string): DraftComment[] {
  if (c.startLine !== undefined && c.startLine > c.line) return list; // 거꾸로 범위
  const d: DraftComment = { ...c, id };
  if (!d.startLine || d.startLine === d.line) delete d.startLine; // 시작 = 끝이면 한 줄
  if (!valid(d)) return list;
  if (list.some((x) => x.path === d.path && x.side === d.side && x.line === d.line && x.startLine === d.startLine && x.body.trim() === d.body.trim())) return list;
  return [...list, d].slice(0, 100); // GitHub 리뷰 하나에 줄 댓글 100개까지(창구 상한과 같게)
}
export const removeDraft = (list: DraftComment[], id: string) => list.filter((x) => x.id !== id);

// 리뷰 요청 — commit_id는 보류 댓글들이 본 diff의 커밋(모두 같을 때), 섞였거나 없으면 지금 head(fallback)
export function reviewRequest(list: DraftComment[], fallbackHead?: string): { commitId?: string; comments: { path: string; line: number; side: "LEFT" | "RIGHT"; startLine?: number; body: string }[] } {
  const heads = [...new Set(list.map((x) => x.head).filter((h): h is string => !!h && /^[0-9a-f]{40}$/.test(h)))];
  const commitId = heads.length === 1 && list.every((x) => x.head === heads[0]) ? heads[0] : fallbackHead;
  return { commitId, comments: list.map((x) => ({ path: x.path, line: x.line, side: x.side, ...(x.startLine ? { startLine: x.startLine } : {}), body: x.body })) };
}

// suggestion 블록 — 고른 줄 코드를 그대로 넣어 고치게(GitHub에서 "Commit suggestion" 한 번으로 반영). 안의 ``` 보다 긴 울타리.
export function suggestionBlock(lines: string[]): string {
  const code = lines.join("\n");
  const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${fence}suggestion\n${code}\n${fence}`;
}

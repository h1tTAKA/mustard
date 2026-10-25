// diff 줄 메모 → 에이전트(#1169) — 내 작업 폴더·커밋 diff의 줄에 메모를 달아 두었다가 한 묶음으로 이 레포 에이전트 터미널에 보냄.
// Orca(Annotate AI Diff)와 같은 규칙: 새 코드 쪽 줄만(범위 가능), 보낸 표시, 안 보낸 것만 다음 묶음. 보낼 글 형식도 Orca와 같게(에이전트와의 약속).
// 저장 = 레포별 localStorage, 같은 창 다른 화면은 이벤트로 동기화(#1145 prDraft와 같은 방식). PR diff 메모는 prDraft(GitHub 리뷰) 그대로.

export interface DiffNote {
  id: string;
  path: string;
  line: number;
  startLine?: number; // 범위(같은 쪽, < line)
  body: string;
  scope: string;      // "unstaged" | "staged" | "untracked" | "commit:<hash>" — 어느 diff에서 단 메모인지(화면·보낼 글)
  text?: string;      // 달 때 그 줄의 코드 — 지금 줄 내용이 다르면 "줄이 바뀜" 표시(리뷰)
  createdAt: number;
  sentAt?: number;    // 에이전트에 보낸 때
}

export const DIFF_NOTES_EVENT = "mustard:diff-notes";
export const diffNotesKey = (root: string) => `mustard:diff-notes:${root}`;
const MAX_NOTES = 200;

const valid = (n: unknown): n is DiffNote => {
  const x = n as DiffNote;
  return !!x && typeof x.id === "string" && typeof x.path === "string" && !!x.path && Number.isInteger(x.line) && x.line > 0
    && (x.startLine === undefined || (Number.isInteger(x.startLine) && x.startLine > 0 && x.startLine < x.line))
    && typeof x.body === "string" && !!x.body.trim() && typeof x.scope === "string" && typeof x.createdAt === "number"
    && (x.sentAt === undefined || typeof x.sentAt === "number") && (x.text === undefined || typeof x.text === "string");
};

export function loadNotes(root: string): DiffNote[] {
  try { const v = JSON.parse(localStorage.getItem(diffNotesKey(root)) || "[]"); return Array.isArray(v) ? v.filter(valid) : []; } catch { return []; }
}
export function saveNotes(root: string, list: DiffNote[]): boolean {
  try { if (list.length) localStorage.setItem(diffNotesKey(root), JSON.stringify(list)); else localStorage.removeItem(diffNotesKey(root)); } catch { return false; }
  window.dispatchEvent(new CustomEvent(DIFF_NOTES_EVENT, { detail: diffNotesKey(root) }));
  return true;
}

// 순수 — 넣기(같은 자리·같은 글이면 하나만, 시작=끝이면 한 줄)·지우기·보냄 표시·안 보낸 것
export function addNote(list: DiffNote[], n: Omit<DiffNote, "id" | "createdAt" | "sentAt">, id: string, now: number): DiffNote[] {
  if (n.startLine !== undefined && n.startLine > n.line) return list;
  const d: DiffNote = { ...n, body: n.body.trim(), id, createdAt: now };
  if (!d.startLine || d.startLine === d.line) delete d.startLine;
  if (!valid(d)) return list;
  if (list.some((x) => x.path === d.path && x.line === d.line && x.startLine === d.startLine && x.body === d.body && !x.sentAt)) return list;
  // 꽉 차면 보낸 것부터 버림, 전부 안 보낸 거면 거절(조용히 사라지지 않게, 리뷰)
  let base = list;
  while (base.length >= MAX_NOTES) { const i = base.findIndex((x) => x.sentAt); if (i < 0) return list; base = [...base.slice(0, i), ...base.slice(i + 1)]; }
  return [...base, d];
}
export const removeNote = (list: DiffNote[], id: string) => list.filter((x) => x.id !== id);
export const markSent = (list: DiffNote[], ids: Set<string>, now: number) => list.map((x) => (ids.has(x.id) ? { ...x, sentAt: now } : x));
export const unsent = (list: DiffNote[]) => list.filter((x) => !x.sentAt);
export const isFull = (list: DiffNote[]) => unsent(list).length >= MAX_NOTES;

// 보낼 글 — Orca diff-comments-format과 같은 형식(파일·줄·따옴표 안 메모, 메모 안 \·"·줄바꿈은 이스케이프 → 한 메모가 한 덩어리).
// 작업 폴더(unstaged·untracked) 메모는 Orca 형식 그대로, 그 밖(staged·커밋)은 파일 줄에 어느 diff 기준인지 붙임 — 줄 번호가 지금 작업 폴더와 다를 수 있어서(리뷰)
const scopeTag = (scope?: string) => (!scope || scope === "unstaged" || scope === "untracked" ? "" : scope === "staged" ? " (staged)" : scope.startsWith("commit:") ? ` (commit ${scope.slice(7, 14)})` : "");
export function formatNote(n: Pick<DiffNote, "path" | "line" | "startLine" | "body"> & { scope?: string }): string {
  const escaped = n.body.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  const where = n.startLine !== undefined && n.startLine !== n.line ? `Lines: ${n.startLine}-${n.line}` : `Line: ${n.line}`;
  return [`File: ${n.path}${scopeTag(n.scope)}`, where, `User comment: "${escaped}"`].join("\n");
}
export const formatNotes = (list: DiffNote[]) => list.map(formatNote).join("\n\n");

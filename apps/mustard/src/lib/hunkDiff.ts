// diff 파싱·구간 묶기·노트 저장 키(#1054) — 순수 함수(의존성 없음, check 스크립트로 검증).
export interface DLine { kind: "hunk" | "add" | "del" | "ctx" | "meta"; oldN: number | null; newN: number | null; text: string; ctxLabel?: string }
// 변경 구간(우리의 "hunk") — 연속 add/del 런. 사이 컨텍스트가 짧으면 한 구간으로 병합(주석 폭발 방지).
// -U100000이라 파일당 @@가 1개뿐 → 표준 hunk 대신 실제 바뀐 블록을 단위로.
export interface Hunk { id: number; startLine: number; endLine: number; diffText: string }
const MERGE_GAP = 3;   // 변경 사이 컨텍스트 줄이 이 이하면 같은 구간
const CTX_LINES = 3;   // diffText에 실을 앞뒤 컨텍스트 줄 수
const MAX_DIFF = 4000; // diffText 상한(토큰 방어)

export function parseDiff(diff: string): DLine[] {
  const out: DLine[] = [];
  let oldN = 0, newN = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
      if (m) { oldN = Number(m[1]); newN = Number(m[2]); }
      out.push({ kind: "hunk", oldN: null, newN: null, text: raw, ctxLabel: (m?.[3] ?? "").trim() });
    } else if (/^(\+\+\+|---|diff |index |new file|deleted file|similarity|rename )/.test(raw)) {
      out.push({ kind: "meta", oldN: null, newN: null, text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", oldN: null, newN: newN++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", oldN: oldN++, newN: null, text: raw.slice(1) });
    } else {
      out.push({ kind: "ctx", oldN: oldN++, newN: newN++, text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return out;
}

export function groupHunks(lines: DLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  let start = -1, lastChange = -1;
  const flush = () => {
    if (start < 0) return;
    const from = Math.max(0, start - CTX_LINES);
    const to = Math.min(lines.length - 1, lastChange + CTX_LINES);
    const diffText = lines.slice(from, to + 1)
      .filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx")
      .map((l) => (l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  ") + l.text)
      .join("\n").slice(0, MAX_DIFF);
    hunks.push({ id: hunks.length, startLine: start, endLine: lastChange, diffText });
    start = -1; lastChange = -1;
  };
  lines.forEach((l, i) => {
    if (l.kind !== "add" && l.kind !== "del") return;
    if (start >= 0 && i - lastChange - 1 > MERGE_GAP) flush(); // 컨텍스트 간격 크면 새 구간
    if (start < 0) start = i;
    lastChange = i;
  });
  flush();
  return hunks;
}

// 저장 키 — 커밋 diff는 hash, 워킹트리 diff는 "wt:종류". 구간 키 = 구간 내용(diffText) 자체(재오픈 매칭, 편집되면 자연 미스).
export const noteStoreKey = (root: string, file: string, hash?: string, worktree?: string) =>
  `nunopi:hunk-notes:${root}:${hash ?? (worktree ? "wt:" + worktree : "")}:${file}`;

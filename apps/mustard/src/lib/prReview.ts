// 에이전트 PR 리뷰 도우미(#1127) — 순수 부분: 줄 번호 붙인 diff·프롬프트·지적 파싱·저장.
// 에이전트는 지적(초안)만 만들고, 채택·게시는 사람이(게시는 다음 줄 댓글 이슈). 캐치업·AI 설명과 별도 저장소.
import { parseDiff } from "./hunkDiff.ts";

export type Severity = "high" | "medium" | "low";
export type FindingStatus = "open" | "adopted" | "discarded";
export interface Finding { id: string; file: string; line: number; severity: Severity; title: string; body: string; status: FindingStatus }
export interface PrReview { at: number; findings: Finding[]; skipped?: string[] }

// diff에 새 파일 줄 번호를 붙임 — 에이전트가 줄을 정확히 집게. lines = 지적 가능한 줄(추가·문맥, GitHub 댓글도 diff 안 줄만 가능).
export function numberDiff(diff: string): { text: string; lines: Set<number> } {
  const lines = new Set<number>();
  const out: string[] = [];
  for (const l of parseDiff(diff)) {
    if (l.kind === "meta") continue;
    if (l.kind === "hunk") { out.push(l.text); continue; }
    if (l.kind === "del") { out.push(`      - ${l.text}`); continue; }
    if (l.newN == null) continue;
    lines.add(l.newN);
    out.push(`L${String(l.newN).padEnd(4)} ${l.kind === "add" ? "+" : " "} ${l.text}`);
  }
  return { text: out.join("\n"), lines };
}

const LANG: Record<string, string> = { ko: "Korean", ja: "Japanese", en: "English" };
const FORMAT = `Output ONLY a JSON array, no prose. Each item: {"file": "<path exactly as given>", "line": <number from the L column>, "severity": "high"|"medium"|"low", "title": "<one line>", "body": "<why it is a problem and how to fix, markdown ok>"}.`;

export function buildReviewPrompt(locale: string): string {
  return `You are a senior code reviewer. Review the pull request diff below. Each file starts with "=== FILE: <path>". Lines are numbered with the new-file line number (L column); "-" lines were removed.
Report only real problems worth a review comment: bugs, security, data loss, broken edge cases, clear performance or maintainability issues. No praise, no style nits, no duplicates. At most 15 items; an empty array is fine.
Write title and body in ${LANG[locale] ?? "English"}.
${FORMAT}`;
}

export function buildRetryPrompt(f: Pick<Finding, "file" | "line" | "severity" | "title" | "body">, locale: string): string {
  return `You are a senior code reviewer. The reviewer did not like this previous review comment on the diff below:
${JSON.stringify({ file: f.file, line: f.line, severity: f.severity, title: f.title, body: f.body })}
Write ONE better comment about the same concern (or the most important real problem near it): more accurate, more specific, with a concrete fix. Use a line from the L column.
Write title and body in ${LANG[locale] ?? "English"}.
${FORMAT} The array must contain exactly one item.`;
}

const SEV = new Set<Severity>(["high", "medium", "low"]);
// 답에서 JSON 배열을 뽑아 검증 — 모르는 파일·diff 밖 줄·빈 내용은 버림.
export function parseFindings(text: string, valid: Map<string, Set<number>>, newId: () => string): Finding[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const src = fenced ?? text;
  // 앞 설명에 "[2건]" 같은 괄호가 있어도 — 여는 괄호마다 맨 끝 "]"까지 파싱 시도(리뷰)
  const b = src.lastIndexOf("]");
  let arr: unknown = null;
  for (let a = src.indexOf("["); a >= 0 && a < b; a = src.indexOf("[", a + 1)) {
    try { arr = JSON.parse(src.slice(a, b + 1)); break; } catch { /* 다음 괄호 */ }
  }
  if (!Array.isArray(arr)) return [];
  const out: Finding[] = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const file = typeof o.file === "string" ? o.file.trim() : "";
    const line = typeof o.line === "number" ? o.line : Number(o.line);
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const body = typeof o.body === "string" ? o.body.trim() : "";
    if (!valid.get(file)?.has(line) || !title) continue;
    const severity = SEV.has(o.severity as Severity) ? (o.severity as Severity) : "medium";
    out.push({ id: newId(), file, line, severity, title: title.slice(0, 200), body: body.slice(0, 4000), status: "open" });
  }
  return out;
}

// 저장 — 레포·PR별. 바뀌면 이벤트로 열린 화면(PR 상세·파일 목록·가운데 diff)이 다시 읽음.
export const PR_REVIEW_EVENT = "mustard:pr-review";
export const prReviewKey = (root: string, pr: number) => `mustard:pr-review:${root}:${pr}`;
export function loadPrReview(root: string, pr: number): PrReview | null {
  try {
    const v = JSON.parse(localStorage.getItem(prReviewKey(root, pr)) || "null") as PrReview | null;
    return v && Array.isArray(v.findings) ? v : null;
  } catch { return null; }
}
// 저장 실패(용량 등)면 false — 이벤트도 안 쏨(다시 읽은 화면이 옛 값으로 되돌아가 보이지 않게, 호출부가 오류 표시).
export function savePrReview(root: string, pr: number, v: PrReview): boolean {
  try { localStorage.setItem(prReviewKey(root, pr), JSON.stringify(v)); } catch { return false; }
  window.dispatchEvent(new CustomEvent(PR_REVIEW_EVENT, { detail: prReviewKey(root, pr) }));
  return true;
}

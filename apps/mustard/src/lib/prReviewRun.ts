// 에이전트 PR 리뷰 실행(#1127) — PR diff(gh, Electron) 모아 askAgent(앱에서 고른 프로바이더·구독)로 지적 받기.
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { askAgent } from "@/lib/hunkNotes";
import { buildRetryPrompt, buildReviewPrompt, loadPrReview, numberDiff, parseFindings, savePrReview, type Finding, type PrReview } from "@/lib/prReview";

const MAX_CHARS = 60_000; // 에이전트에 보낼 diff 상한 — 넘는 파일은 건너뛰고 "생략"으로 표시
const newId = () => Math.random().toString(36).slice(2, 10);

async function fileDiff(root: string, pr: number, path: string): Promise<string | null> {
  const r = await window.nunopiDesktop?.github?.prFileDiff?.(root, pr, path);
  return r?.ok && !r.data?.missing ? r.data?.diff ?? "" : null;
}

// 전체 리뷰 — 기존 지적 중 채택한 것은 남기고(대기 댓글), 나머지는 새 결과로.
export async function runPrReview(root: string, pr: number, providerId: AgentProviderKind, settings: ProviderSettings, locale: string, onProgress?: (done: number, total: number) => void): Promise<PrReview> {
  const files = await window.nunopiDesktop?.github?.prFiles?.(root, pr);
  if (!files?.ok || !files.data) throw new Error(files?.detail || "pr files");
  const parts: string[] = [], skipped: string[] = [], valid = new Map<string, Set<number>>();
  let size = 0, done = 0;
  for (const f of files.data.files) {
    onProgress?.(done++, files.data.files.length);
    if (f.changeType === "DELETED") continue; // 지울 파일엔 새 줄이 없음
    const d = await fileDiff(root, pr, f.path);
    if (d == null) { skipped.push(f.path); continue; }
    const { text, lines } = numberDiff(d);
    const chunk = `=== FILE: ${f.path}\n${text}\n`;
    if (size + chunk.length > MAX_CHARS) { skipped.push(f.path); continue; }
    size += chunk.length; parts.push(chunk); valid.set(f.path, lines);
  }
  onProgress?.(done, files.data.files.length);
  const answer = parts.length ? await askAgent(parts.join("\n"), buildReviewPrompt(locale), providerId, settings, locale) : "[]";
  const kept = (loadPrReview(root, pr)?.findings ?? []).filter((x) => x.status === "adopted");
  const review: PrReview = { at: Date.now(), findings: [...kept, ...parseFindings(answer, valid, newId)], ...(skipped.length ? { skipped } : {}) };
  savePrReview(root, pr, review);
  return review;
}

// 지적 하나만 다시 — 같은 자리를 새 지적으로 바꿈(마음에 들 때까지 반복). 못 받으면 throw(기존 지적 유지).
export async function retryFinding(root: string, pr: number, f: Finding, providerId: AgentProviderKind, settings: ProviderSettings, locale: string): Promise<PrReview> {
  const d = await fileDiff(root, pr, f.file);
  if (d == null) throw new Error("diff");
  const { text, lines } = numberDiff(d);
  const answer = await askAgent(`=== FILE: ${f.file}\n${text}`, buildRetryPrompt(f, locale), providerId, settings, locale);
  const [next] = parseFindings(answer, new Map([[f.file, lines]]), newId);
  if (!next) throw new Error("no finding");
  const cur = loadPrReview(root, pr) ?? { at: Date.now(), findings: [] };
  const review = { ...cur, findings: cur.findings.map((x) => (x.id === f.id ? next : x)) };
  savePrReview(root, pr, review);
  return review;
}

// 채택·버림·되돌리기
export function setFindingStatus(root: string, pr: number, id: string, status: Finding["status"]): PrReview | null {
  const cur = loadPrReview(root, pr);
  if (!cur) return null;
  const review = { ...cur, findings: cur.findings.map((x) => (x.id === id ? { ...x, status } : x)) };
  savePrReview(root, pr, review);
  return review;
}

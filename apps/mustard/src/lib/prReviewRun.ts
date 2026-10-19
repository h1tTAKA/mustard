// 에이전트 PR 리뷰 실행(#1127) — PR diff(gh, Electron) 모아 askAgent(앱에서 고른 프로바이더·구독)로 지적 받기.
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { desktopNotify } from "@mustard/core";
import { translate } from "@mustard/core/messages";
import { askAgent } from "@/lib/hunkNotes";
import { buildRetryPrompt, buildReviewPrompt, findingCommentBody, loadPrReview, numberDiff, parseFindings, prReviewKey, savePrReview, type Finding, type PrReview } from "@/lib/prReview";

const MAX_CHARS = 60_000; // 에이전트에 보낼 diff 상한 — 넘는 파일은 건너뛰고 "생략"으로 표시
const MAX_KEPT = 50;      // 다시 돌려도 남기는 채택 지적 상한
const inflight = new Map<string, Promise<PrReview>>(); // 레포·PR별 진행 중 전체 리뷰 — 같은 PR 중복 실행 막고, 다시 연 화면이 이어받음(리뷰)
export const prReviewInflight = (root: string, pr: number) => inflight.get(prReviewKey(root, pr));
const save = (root: string, pr: number, v: PrReview) => { if (!savePrReview(root, pr, v)) throw new Error("storage"); return v; };
const newId = () => Math.random().toString(36).slice(2, 10);

async function fileDiff(root: string, pr: number, path: string): Promise<string | null> {
  const r = await window.nunopiDesktop?.github?.prFileDiff?.(root, pr, path);
  return r?.ok && !r.data?.missing ? r.data?.diff ?? "" : null;
}

// 전체 리뷰 — 기존 지적 중 채택한 것은 남기고(대기 댓글), 나머지는 새 결과로.
export function runPrReview(root: string, pr: number, providerId: AgentProviderKind, settings: ProviderSettings, locale: string, onProgress?: (done: number, total: number) => void): Promise<PrReview> {
  const key = prReviewKey(root, pr);
  const cur = inflight.get(key);
  if (cur) return cur;
  // 끝나면 데스크톱 알림(다른 작업 중이어도) — 화면을 떠나도 울리게 실행 쪽에서. 누르면 그 레포로.
  const done = (title: string, body: string) => void desktopNotify({ title, body, suppressWhileFocused: false, target: { repoPath: root } }).catch(() => {});
  const p = runOnce(root, pr, providerId, settings, locale, onProgress)
    .then((r) => { done(translate(locale, "prReview.notifyDone", { pr }), translate(locale, "prReview.notifyBody", { n: r.findings.filter((f) => f.status === "open").length })); return r; },
      (e) => { done(translate(locale, "prReview.notifyFailed", { pr }), translate(locale, "prReview.notifyFailedBody")); throw e; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function runOnce(root: string, pr: number, providerId: AgentProviderKind, settings: ProviderSettings, locale: string, onProgress?: (done: number, total: number) => void): Promise<PrReview> {
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
  // diff 모으는 사이 push됐으면 head와 diff가 어긋남 → 다시 하게(리뷰)
  const again = await window.nunopiDesktop?.github?.prFiles?.(root, pr);
  if (!again?.ok) throw new Error(again?.detail || "pr files");
  if (files.data.head && again.data?.head && again.data.head !== files.data.head) throw new Error("head changed");
  const prompt = buildReviewPrompt(locale);
  const answer = parts.length ? await askAgent(`${prompt}\n\n${parts.join("\n")}`, prompt, providerId, settings, locale, "pr-review") : "[]";
  const found = parseFindings(answer, valid, newId);
  if (!found) throw new Error(`unreadable: ${answer.slice(0, 120)}`); // 형식 안 지킨 답 — "문제 없음"으로 덮지 않음
  // 채택한 지적은 남김 — 단 지금 diff에 그 줄이 아직 있을 때만(코드가 바뀌어 사라진 줄은 버림)
  const kept = (loadPrReview(root, pr)?.findings ?? []).filter((x) => x.status === "adopted" && valid.get(x.file)?.has(x.line)).slice(0, MAX_KEPT);
  return save(root, pr, { at: Date.now(), findings: [...kept, ...found], ...(skipped.length ? { skipped } : {}), ...(files.data.head ? { head: files.data.head } : {}) });
}

// 지적 하나만 다시 — 같은 자리를 새 지적으로 바꿈(마음에 들 때까지 반복). 못 받으면 throw(기존 지적 유지).
export async function retryFinding(root: string, pr: number, f: Finding, providerId: AgentProviderKind, settings: ProviderSettings, locale: string): Promise<PrReview> {
  // PR이 리뷰 뒤 push됐으면 줄 번호 기준이 달라짐 → 전체 리뷰를 다시(목록 조회가 diff 캐시도 비움)
  const files = await window.nunopiDesktop?.github?.prFiles?.(root, pr);
  const head0 = loadPrReview(root, pr)?.head;
  if (!files?.ok) throw new Error(files?.detail || "pr files"); // 지금 head를 모르면 줄 기준을 못 맞춤 → 다시 리뷰 안 함
  if (head0 && files.data?.head && files.data.head !== head0) throw new Error("head changed");
  const d = await fileDiff(root, pr, f.file);
  if (d == null) throw new Error("diff");
  const { text, lines } = numberDiff(d);
  const prompt = buildRetryPrompt(f, locale);
  const answer = await askAgent(`${prompt}\n\n=== FILE: ${f.file}\n${text}`, prompt, providerId, settings, locale, "pr-review");
  const [next] = parseFindings(answer, new Map([[f.file, lines]]), newId) ?? [];
  if (!next) throw new Error("no finding");
  // 그사이 전체 리뷰로 바뀌었으면 자리가 없음 → 오류. 그사이 채택·버림했으면 그 상태 유지(새 내용만 바꿈).
  const cur = loadPrReview(root, pr);
  const old = cur?.findings.find((x) => x.id === f.id);
  if (!cur || !old) throw new Error("gone");
  return save(root, pr, { ...cur, findings: cur.findings.map((x) => (x.id === f.id ? { ...next, id: f.id, status: old.status } : x)) });
}

// 채택 = GitHub PR 그 파일·줄에 리뷰 댓글로 올림(#1127, 유저 요청). 올라가야 채택 상태로 저장(링크 포함). 실패면 throw(그대로 열림).
// 같은 지적 두 번 올리기 방지(리뷰): 올리는 중(탭·diff 어디서 눌러도 하나) + 올렸는데 저장 못 한 것(다시 누르면 저장만 재시도).
const posting = new Set<string>();
const postedUrl = new Map<string, string>();
export async function postFinding(root: string, pr: number, f: Finding, locale: string): Promise<PrReview | null> {
  const cur0 = loadPrReview(root, pr);
  const cur0f = cur0?.findings.find((x) => x.id === f.id);
  if (!cur0f) throw new Error("gone"); // 목록에서 사라진 지적(다시 리뷰로 바뀜 등) — 안 올리고 알림
  if (posting.has(f.id) || cur0f.status !== "open") return cur0; // 올리는 중·이미 처리됨
  posting.add(f.id);
  try {
    let url = postedUrl.get(f.id);
    if (url == null) {
      const post = window.nunopiDesktop?.github?.prLineComment;
      if (!post) throw new Error("desktop only");
      const r = await post(root, pr, f.file, f.line, findingCommentBody(f, translate(locale, `prReview.sev.${f.severity}`)), cur0?.head);
      if (!r.ok) throw new Error(r.detail || "post failed");
      url = r.data?.url ?? "";
      postedUrl.set(f.id, url);
    }
    // 올라갔는데 저장 못 함(그사이 목록이 바뀜·저장 실패) — "못 올림"이 아니라 "올렸지만 목록엔 못 남김"으로 알림(대화 탭에 보임)
    const cur = loadPrReview(root, pr);
    if (!cur?.findings.some((x) => x.id === f.id)) { postedUrl.delete(f.id); throw new Error("posted-unsaved"); }
    let next: PrReview;
    try { next = save(root, pr, { ...cur, findings: cur.findings.map((x) => (x.id === f.id ? { ...x, status: "adopted", ...(url ? { url } : {}) } : x)) }); }
    catch { throw new Error("posted-unsaved"); } // postedUrl 남김 → 다시 누르면 저장만 재시도
    postedUrl.delete(f.id);
    return next;
  } finally { posting.delete(f.id); }
}

// 남은 지적 전부를 GitHub 리뷰 1건으로 한 번에(#1127, 유저 요청). 리뷰한 커밋 기준 — 모르면(옛 저장분) 다시 리뷰 필요.
export async function postAllFindings(root: string, pr: number, locale: string): Promise<PrReview> {
  const cur = loadPrReview(root, pr);
  const todo = (cur?.findings ?? []).filter((x) => x.status === "open" && !posting.has(x.id)).slice(0, 100); // GitHub 리뷰 1건 상한
  if (!cur || !todo.length) throw new Error("gone");
  if (!cur.head) throw new Error("head changed");
  const submit = window.nunopiDesktop?.github?.prReviewSubmit;
  if (!submit) throw new Error("desktop only");
  for (const x of todo) posting.add(x.id);
  try {
    // 이미 올렸는데 저장 못 한 것(postedUrl)은 다시 안 올림(리뷰: 다시 누르면 GitHub에 두 번 달리던 것) — 나머지만 제출
    const fresh = todo.filter((x) => !postedUrl.has(x.id));
    if (fresh.length) {
      const r = await submit(root, pr, cur.head, fresh.map((x) => ({ path: x.file, line: x.line, body: findingCommentBody(x, translate(locale, `prReview.sev.${x.severity}`)) })));
      if (!r.ok) throw new Error(r.detail || "post failed");
      for (const x of fresh) postedUrl.set(x.id, r.data?.url ?? "");
    }
    const now = loadPrReview(root, pr);
    if (!now) throw new Error("posted-unsaved");
    let next: PrReview;
    try { next = save(root, pr, { ...now, findings: now.findings.map((x) => { const u = postedUrl.get(x.id); return u != null && todo.some((y) => y.id === x.id) ? { ...x, status: "adopted", ...(u ? { url: u } : {}) } : x; }) }); }
    catch { throw new Error("posted-unsaved"); }
    for (const x of todo) postedUrl.delete(x.id);
    return next;
  } finally { for (const x of todo) posting.delete(x.id); }
}

// 버림·되돌리기
export function setFindingStatus(root: string, pr: number, id: string, status: Finding["status"]): PrReview | null {
  const cur = loadPrReview(root, pr);
  if (!cur) return null;
  const review = { ...cur, findings: cur.findings.map((x) => (x.id === id ? { ...x, status } : x)) };
  return savePrReview(root, pr, review) ? review : null;
}

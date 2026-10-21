"use client";
// PR 변경 파일(#1123) — VS Code GitHub PR 확장의 "Files changed"처럼: 폴더별 파일·변경 종류·+/−·봤음 체크(GitHub에 저장).
// 파일 클릭 → 가운데 diff 탭(onOpenFile). 봤음은 낙관적으로 바로 반영하고 실패하면 되돌림.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconFolder, IconRobot, IconMessage } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { loadPrReview, prReviewKey, PR_REVIEW_EVENT, type Finding } from "@/lib/prReview";
import { loadDrafts, prDraftKey, PR_DRAFT_EVENT } from "@/lib/prDraft";

type PrFile = { path: string; additions: number; deletions: number; changeType: string; viewed: boolean };
type Load = { loading: boolean; prId?: string; files?: PrFile[]; truncated?: boolean; error?: string };

// 변경 종류 → 한 글자 배지(VS Code·git 표기). RENAMED/COPIED 등은 R/C.
const CHANGE: Record<string, { ch: string; cls: string }> = {
  ADDED: { ch: "A", cls: "text-emerald-600 dark:text-emerald-400" },
  MODIFIED: { ch: "M", cls: "text-amber-600 dark:text-amber-400" },
  DELETED: { ch: "D", cls: "text-rose-500 dark:text-rose-400" },
  RENAMED: { ch: "R", cls: "text-sky-600 dark:text-sky-400" },
  COPIED: { ch: "C", cls: "text-sky-600 dark:text-sky-400" },
  CHANGED: { ch: "M", cls: "text-amber-600 dark:text-amber-400" },
};

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export default function PrFiles({ root, number, reloadKey, onOpenFile, onCount }: { root: string; number: number; reloadKey: number; onOpenFile?: (file: string) => void; onCount?: (n: number) => void }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ loading: true });
  const [busy, setBusy] = useState<Set<string>>(new Set()); // 봤음 저장 중인 파일
  const [err, setErr] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  // #1127 에이전트 리뷰 — 파일별 남은(열린) 지적 수 배지
  const [findings, setFindings] = useState<Finding[]>(() => loadPrReview(root, number)?.findings ?? []);
  useEffect(() => {
    const key = prReviewKey(root, number);
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setFindings(loadPrReview(root, number)?.findings ?? []); };
    window.addEventListener(PR_REVIEW_EVENT, on);
    return () => window.removeEventListener(PR_REVIEW_EVENT, on);
  }, [root, number]);
  // #1145 파일별 줄 댓글 스레드 수(GitHub, 해결된 것 포함·답글 제외) + 보류 댓글 수. 댓글 달기·리뷰 보내기(이벤트)·새로고침마다 다시.
  const [threadPaths, setThreadPaths] = useState<string[]>([]);
  const [draftPaths, setDraftPaths] = useState<string[]>(() => loadDrafts(root, number).map((d) => d.path));
  const [cmtTick, setCmtTick] = useState(0);
  const fromEvent = useRef(false); // 이번 조회가 이벤트 때문이면 0.3초 모음(새로고침·처음은 바로, 리뷰)
  useEffect(() => {
    const keys = [prReviewKey(root, number), prDraftKey(root, number)];
    const on = (e: Event) => { if (keys.includes((e as CustomEvent<string>).detail)) { setDraftPaths(loadDrafts(root, number).map((d) => d.path)); fromEvent.current = true; setCmtTick((n) => n + 1); } };
    window.addEventListener(PR_REVIEW_EVENT, on); window.addEventListener(PR_DRAFT_EVENT, on);
    return () => { window.removeEventListener(PR_REVIEW_EVENT, on); window.removeEventListener(PR_DRAFT_EVENT, on); };
  }, [root, number]);
  useEffect(() => {
    let alive = true;
    setDraftPaths(loadDrafts(root, number).map((d) => d.path)); // eslint-disable-line react-hooks/set-state-in-effect -- PR 바뀌면 그 PR 보류분
    // 이벤트로 다시 부를 땐 0.3초 모아서 한 번(지적 여러 개 연달아 채택해도 gh 조회 한 번, 리뷰)
    const timer = setTimeout(() => {
      void window.nunopiDesktop?.github?.prLineComments?.(root, number).then((r) => { if (alive && r.ok && r.data) setThreadPaths(r.data.filter((c) => c.inReplyTo == null).map((c) => c.path)); }).catch(() => {});
    }, fromEvent.current ? 300 : 0);
    fromEvent.current = false;
    return () => { alive = false; clearTimeout(timer); };
  }, [root, number, reloadKey, cmtTick]);
  const onCountRef = useRef(onCount);
  useEffect(() => { onCountRef.current = onCount; }, [onCount]);

  useEffect(() => {
    const get = window.nunopiDesktop?.github?.prFiles;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)/로딩 표시(PR·새로고침마다 재조회)
    if (!get) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const myId = ++reqIdRef.current;
    setLoad((p) => ({ ...p, loading: true }));
    void get(root, number).then((r) => {
      if (myId !== reqIdRef.current) return;
      if (r.ok && r.data) { setLoad({ loading: false, prId: r.data.prId, files: r.data.files, truncated: r.data.truncated }); onCountRef.current?.(r.data.files.length); }
      else setLoad({ loading: false, error: r.detail || t("github.error") });
    }).catch(() => { if (myId === reqIdRef.current) setLoad({ loading: false, error: t("github.error") }); });
  }, [root, number, reloadKey, t]);

  const toggleViewed = async (f: PrFile) => {
    const save = window.nunopiDesktop?.github?.prFileViewed;
    if (!save || !load.prId || busy.has(f.path)) return;
    const next = !f.viewed;
    const set = (v: boolean) => setLoad((p) => ({ ...p, files: p.files?.map((x) => (x.path === f.path ? { ...x, viewed: v } : x)) }));
    set(next); setErr(null);
    setBusy((b) => new Set(b).add(f.path));
    const r = await save(root, load.prId, f.path, next).catch(() => ({ ok: false, detail: undefined as string | undefined }));
    setBusy((b) => { const n = new Set(b); n.delete(f.path); return n; });
    if (!r.ok) { set(!next); setErr(r.detail || t("github.error")); }
  };

  if (load.loading && !load.files) return <div className="flex items-center gap-2 p-4 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>;
  if (!load.files) return <div className="flex items-start gap-2 p-4 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span className="break-words">{load.error || t("github.error")}</span></div>;
  const files = load.files;
  if (!files.length) return <p className="p-4 text-[12px] italic text-zinc-400 dark:text-zinc-500">{t("github.filesEmpty")}</p>;

  const viewed = files.filter((f) => f.viewed).length;
  const openCount = new Map<string, number>();
  for (const f of findings) if (f.status === "open") openCount.set(f.file, (openCount.get(f.file) ?? 0) + 1);
  const tally = (list: string[]) => { const m = new Map<string, number>(); for (const p of list) m.set(p, (m.get(p) ?? 0) + 1); return m; };
  const threadCount = tally(threadPaths), draftCount = tally(draftPaths);
  // 폴더별 묶음(경로 순) — 같은 폴더 파일을 한 덩어리로.
  const groups: { dir: string; items: PrFile[] }[] = [];
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const dir = dirOf(f.path);
    const g = groups[groups.length - 1];
    if (g && g.dir === dir) g.items.push(f); else groups.push({ dir, items: [f] });
  }

  return (
    <div className="flex flex-col">
      {/* 진행 — n/m 봤음 + 막대 */}
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-zinc-100 bg-white px-3 py-2 dark:border-zinc-800/60 dark:bg-[var(--s-pane)]">
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{t("github.viewedProgress", { n: viewed, total: files.length })}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-mustard-500 transition-[width]" style={{ width: `${(viewed / files.length) * 100}%` }} />
        </div>
      </div>
      {load.truncated && <p className="px-3 pt-2 text-[10.5px] text-amber-600 dark:text-amber-500">{t("github.filesTruncated", { n: files.length })}</p>}
      {err && <p className="px-3 pt-2 text-[10px] text-rose-500">{err}</p>}
      <div className="py-1">
        {groups.map((g) => (
          <div key={g.dir || "."}>
            {g.dir && (
              <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                <IconFolder size={12} stroke={2} className="shrink-0" aria-hidden />
                <span className="truncate font-mono">{g.dir}</span>
              </div>
            )}
            {g.items.map((f) => {
              const c = CHANGE[f.changeType] ?? CHANGE.MODIFIED;
              return (
                <div key={f.path} className={`group flex items-center gap-2 py-1 pl-6 pr-3 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/60 ${f.viewed ? "opacity-60" : ""}`}>
                  <button type="button" onClick={() => onOpenFile?.(f.path)} disabled={!onOpenFile} title={f.path}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
                    <span className={`w-3 shrink-0 text-center font-mono text-[10px] font-bold ${c.cls}`}>{c.ch}</span>
                    <span className={`truncate text-[12px] text-zinc-700 dark:text-zinc-200 ${f.viewed ? "line-through decoration-zinc-400/60" : ""}`}>{baseOf(f.path)}</span>
                    {openCount.get(f.path) ? <span title={t("github.tabAgentReview")} className="inline-flex shrink-0 items-center gap-0.5 rounded bg-mustard-500/15 px-1 text-[9.5px] font-semibold tabular-nums text-mustard-700 dark:text-mustard-400"><IconRobot size={10} stroke={2} aria-hidden />{openCount.get(f.path)}</span> : null}
                    {threadCount.get(f.path) ? <span title={t("github.reviewComments")} className="inline-flex shrink-0 items-center gap-0.5 rounded bg-zinc-500/15 px-1 text-[9.5px] font-semibold tabular-nums text-zinc-600 dark:text-zinc-300"><IconMessage size={10} stroke={2} aria-hidden />{threadCount.get(f.path)}</span> : null}
                    {draftCount.get(f.path) ? <span title={t("github.draftPending")} className="inline-flex shrink-0 items-center gap-0.5 rounded border border-dashed border-mustard-500/50 px-1 text-[9.5px] font-semibold tabular-nums text-mustard-700 dark:text-mustard-400"><IconMessage size={10} stroke={2} aria-hidden />{draftCount.get(f.path)}</span> : null}
                    <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
                      {f.additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span>}
                      {f.deletions > 0 && <span className="ml-1 text-rose-500 dark:text-rose-400">−{f.deletions}</span>}
                    </span>
                  </button>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500" title={t("github.viewed")}>
                    <input type="checkbox" checked={f.viewed} disabled={busy.has(f.path)} onChange={() => void toggleViewed(f)} className="accent-mustard-500" />
                    <span className="hidden group-hover:inline">{t("github.viewed")}</span>
                  </label>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

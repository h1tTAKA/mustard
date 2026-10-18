"use client";
// PR 에이전트 리뷰 탭(#1127) — 에이전트가 PR diff를 읽고 지적(초안)을 만들면, 사람이 [댓글로 채택]·[다시 리뷰]·[버림].
// 채택은 대기 목록까지(GitHub 게시는 줄 댓글 이슈). 에이전트는 GitHub에 직접 쓰지 않음. 캐치업·AI 설명과 별도 저장소.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconRobot, IconRefresh, IconCheck, IconX, IconArrowBackUp, IconMessagePlus, IconFile } from "@tabler/icons-react";
import { useT, useLocale, Markdown } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { relTime } from "@/lib/relTime";
import { loadPrReview, prReviewKey, PR_REVIEW_EVENT, type Finding, type PrReview } from "@/lib/prReview";
import { runPrReview, retryFinding, setFindingStatus } from "@/lib/prReviewRun";

const SEV_CLS: Record<Finding["severity"], string> = {
  high: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

export default function PrAgentReview({ root, number, providerId, providerSettings, onOpenFile }: { root: string; number: number; providerId: AgentProviderKind; providerSettings: ProviderSettings; onOpenFile?: (file: string) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [rev, setRev] = useState<PrReview | null>(() => loadPrReview(root, number));
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set()); // 다시 리뷰 중인 지적
  const [err, setErr] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // 다른 화면(파일 목록·가운데 diff)이나 다른 실행이 바꾸면 다시 읽음
  useEffect(() => {
    const key = prReviewKey(root, number);
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setRev(loadPrReview(root, number)); };
    window.addEventListener(PR_REVIEW_EVENT, on);
    return () => window.removeEventListener(PR_REVIEW_EVENT, on);
  }, [root, number]);

  const run = async () => {
    if (running) return;
    setRunning({ done: 0, total: 0 }); setErr(null);
    try {
      const r = await runPrReview(root, number, providerId, providerSettings, locale, (done, total) => { if (mounted.current) setRunning({ done, total }); });
      if (mounted.current) setRev(r);
    } catch (e) {
      if (mounted.current) setErr(t("prReview.failed", { msg: String((e as Error)?.message || e) }));
    } finally { if (mounted.current) setRunning(null); }
  };
  const retry = async (f: Finding) => {
    if (busy.has(f.id)) return;
    setBusy((b) => new Set(b).add(f.id)); setErr(null);
    try { const r = await retryFinding(root, number, f, providerId, providerSettings, locale); if (mounted.current) setRev(r); }
    catch { if (mounted.current) setErr(t("prReview.retryFailed")); }
    finally { if (mounted.current) setBusy((b) => { const n = new Set(b); n.delete(f.id); return n; }); }
  };
  const mark = (f: Finding, status: Finding["status"]) => { const r = setFindingStatus(root, number, f.id, status); if (r) setRev(r); };

  const findings = rev?.findings ?? [];
  const open = findings.filter((f) => f.status === "open");
  const adopted = findings.filter((f) => f.status === "adopted");
  const discarded = findings.filter((f) => f.status === "discarded");
  // 파일별 묶음(경로 → 줄 순)
  const groups = [...new Set(open.map((f) => f.file))].sort().map((file) => ({ file, items: open.filter((f) => f.file === file).sort((a, b) => a.line - b.line) }));

  const loc = (f: Finding) => (
    <button type="button" onClick={() => onOpenFile?.(f.file)} disabled={!onOpenFile} title={f.file}
      className="truncate font-mono text-[10.5px] text-zinc-400 hover:text-zinc-600 disabled:cursor-default dark:text-zinc-500 dark:hover:text-zinc-300">
      {f.file.slice(f.file.lastIndexOf("/") + 1)}:{f.line}
    </button>
  );
  const btn = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium transition disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* 실행 줄 */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void run()} disabled={!!running}
          className="inline-flex items-center gap-1.5 rounded-md bg-mustard-500 px-2.5 py-1 text-[11.5px] font-semibold text-brown-900 transition hover:bg-mustard-400 disabled:opacity-60">
          {running ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : rev ? <IconRefresh size={13} stroke={2} aria-hidden /> : <IconRobot size={13} stroke={2} aria-hidden />}
          {rev ? t("prReview.rerun") : t("prReview.run")}
        </button>
        {running ? (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{running.total && running.done < running.total ? t("prReview.collecting", { done: running.done, total: running.total }) : t("prReview.reviewing")}</span>
        ) : rev && <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{t("prReview.lastRun", { when: relTime(new Date(rev.at).toISOString()) })}</span>}
      </div>
      {!rev && !running && <p className="text-[11.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("prReview.intro")}</p>}
      {err && <p className="break-words text-[11px] text-rose-500">{err}</p>}
      {rev?.skipped?.length ? <p className="text-[10.5px] text-amber-600 dark:text-amber-500">{t("prReview.skipped", { n: rev.skipped.length })}</p> : null}

      {/* 대기 중 댓글(채택) */}
      {adopted.length > 0 && (
        <section className="rounded-lg border border-mustard-500/30 bg-mustard-500/5 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-mustard-700 dark:text-mustard-400"><IconMessagePlus size={13} stroke={2} aria-hidden />{t("prReview.pending", { n: adopted.length })}</div>
          <p className="mb-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">{t("prReview.pendingNote")}</p>
          {adopted.map((f) => (
            <div key={f.id} className="flex items-center gap-2 py-0.5">
              {loc(f)}
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-700 dark:text-zinc-200">{f.title}</span>
              <button type="button" onClick={() => mark(f, "open")} className={`${btn} shrink-0 text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60`}><IconArrowBackUp size={11} aria-hidden />{t("prReview.unadopt")}</button>
            </div>
          ))}
        </section>
      )}

      {/* 지적 목록 */}
      {rev && !running && open.length === 0 && adopted.length === 0 && <p className="text-[11.5px] italic text-zinc-400 dark:text-zinc-500">{t("prReview.none")}</p>}
      {groups.map((g) => (
        <section key={g.file}>
          <button type="button" onClick={() => onOpenFile?.(g.file)} disabled={!onOpenFile}
            className="mb-1 flex max-w-full items-center gap-1 text-[10.5px] text-zinc-400 hover:text-zinc-600 disabled:cursor-default dark:text-zinc-500 dark:hover:text-zinc-300">
            <IconFile size={12} stroke={2} className="shrink-0" aria-hidden /><span className="truncate font-mono">{g.file}</span>
          </button>
          <div className="flex flex-col gap-1.5">
            {g.items.map((f) => (
              <article key={f.id} className={`rounded-lg border border-zinc-200 p-2 dark:border-zinc-800 ${busy.has(f.id) ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`shrink-0 rounded px-1 py-px text-[9.5px] font-semibold uppercase ${SEV_CLS[f.severity]}`}>{t(`prReview.sev.${f.severity}`)}</span>
                  {loc(f)}
                </div>
                <div className="mt-1 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">{f.title}</div>
                {f.body && <div className="prose prose-sm mt-0.5 max-w-none text-[11.5px] leading-relaxed text-zinc-600 dark:prose-invert dark:text-zinc-300 prose-p:my-1"><Markdown>{f.body}</Markdown></div>}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button type="button" onClick={() => mark(f, "adopted")} disabled={busy.has(f.id)} className={`${btn} bg-mustard-500/15 text-mustard-700 hover:bg-mustard-500/25 dark:text-mustard-400`}><IconCheck size={11} aria-hidden />{t("prReview.adopt")}</button>
                  <button type="button" onClick={() => void retry(f)} disabled={busy.has(f.id)} className={`${btn} text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`}>
                    {busy.has(f.id) ? <IconLoader2 size={11} className="animate-spin" aria-hidden /> : <IconRefresh size={11} aria-hidden />}{t("prReview.retry")}
                  </button>
                  <button type="button" onClick={() => mark(f, "discarded")} disabled={busy.has(f.id)} className={`${btn} text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300`}><IconX size={11} aria-hidden />{t("prReview.discard")}</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {/* 버린 지적 — 접어 둠, 되돌리기 가능 */}
      {discarded.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowDiscarded((v) => !v)} className="text-[10.5px] text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            {showDiscarded ? "▾" : "▸"} {t("prReview.discarded", { n: discarded.length })}
          </button>
          {showDiscarded && discarded.map((f) => (
            <div key={f.id} className="flex items-center gap-2 py-0.5 opacity-60">
              {loc(f)}
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500 line-through">{f.title}</span>
              <button type="button" onClick={() => mark(f, "open")} className={`${btn} shrink-0 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800`}><IconArrowBackUp size={11} aria-hidden />{t("prReview.undo")}</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

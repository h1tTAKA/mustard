"use client";
// GitHub 패널 PR 목록(#814) — gh pr list(브릿지) → 필터 + 행(상태·번호·제목·체크요약·작성자·시각).
// IssueList와 동형(무한 스크롤·dwell 툴팁·reqId stale 가드). 행에 statusCheckRollup 요약.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconPlus } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { relTime } from "@/lib/relTime";
import { ChecksSummary } from "@/components/workspace/github/ChecksView";
import PrCompose from "@/components/workspace/github/PrCompose";

type Filter = "open" | "closed" | "all";
type Load = { loading: boolean; rows?: GhPr[]; error?: string; hasMore?: boolean };
const HOVER_DELAY_MS = 450;

function prColor(pr: GhPr): string {
  const st = pr.state.toUpperCase();
  if (pr.isDraft && st === "OPEN") return "bg-zinc-400";
  if (st === "MERGED") return "bg-purple-500";
  if (st === "CLOSED") return "bg-rose-500";
  return "bg-emerald-500"; // OPEN
}

export default function PrList({ root, reloadKey, host = "github", onOpen }: { root: string; reloadKey: number; host?: "github" | "gitlab" | "other"; onOpen: (n: number) => void }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("open");
  const [limit, setLimit] = useState(50);
  const [load, setLoad] = useState<Load>({ loading: true });
  const [composing, setComposing] = useState(false); // #944 PR 생성 폼
  const [localReload, setLocalReload] = useState(0);  // #944 생성 후 목록 갱신
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const reqIdRef = useRef(0);

  const [hover, setHover] = useState<{ text: string; left: number; top: number; above: boolean } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = useCallback(() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } setHover(null); }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const onRowEnter = useCallback((e: React.MouseEvent<HTMLElement>, text: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    const POP_W = 320;
    const above = r.top > window.innerHeight / 2;
    const payload = { text, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)), top: above ? r.top - 4 : r.bottom + 4, above };
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(payload), HOVER_DELAY_MS);
  }, []);

  useEffect(() => {
    const nd = window.nunopiDesktop;
    // #964 host별 — gitlab이면 glabMrList(GhPr 정규화), else github.prList.
    const list = host === "gitlab" ? nd?.integrations?.glabMrList : nd?.github?.prList;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)/로딩 표시(root/filter/limit/reload 변경마다 재조회)
    if (!list) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const myId = ++reqIdRef.current;
    setLoad((p) => ({ loading: true, rows: p.rows, hasMore: p.hasMore }));
    (async () => {
      const r = await list(root, filter, limit);
      if (!mountedRef.current || myId !== reqIdRef.current) return;
      if (r.ok) setLoad({ loading: false, rows: r.data, hasMore: r.data.length >= limit && limit < 1000 });
      else setLoad({ loading: false, error: r.detail || t("github.error") });
    })();
  }, [root, filter, limit, reloadKey, localReload, host, t]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const moreRef = useRef({ loading: true, hasMore: false });
  useEffect(() => { moreRef.current = { loading: load.loading, hasMore: !!load.hasMore }; }, [load]);
  const sentinelCb = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) return;
    observerRef.current = new IntersectionObserver((ents) => {
      if (ents[0]?.isIntersecting && !moreRef.current.loading && moreRef.current.hasMore) setLimit((l) => l + 50);
    }, { root: scrollRef.current });
    observerRef.current.observe(el);
  }, []);

  const FILTERS: Filter[] = ["open", "closed", "all"];
  if (composing) {
    return <PrCompose root={root} onCancel={() => setComposing(false)}
      onCreated={(n) => { setComposing(false); setLocalReload((x) => x + 1); onOpen(n); }} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800/60">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => { setFilter(f); setLimit(50); setLoad({ loading: true }); }} aria-pressed={filter === f}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${filter === f ? "bg-mustard-500/15 text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
            {t(f === "open" ? "github.filterOpen" : f === "closed" ? "github.filterClosed" : "github.filterAll")}
          </button>
        ))}
        {host === "github" ? (
          <button type="button" onClick={() => setComposing(true)} title={t("github.createPr")} aria-label={t("github.createPr")}
            className="ml-auto rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconPlus size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {load.loading && !load.rows?.length ? (
          <div className="flex items-center gap-2 p-4 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>
        ) : load.error && !load.rows?.length ? (
          <div className="flex items-start gap-2 p-4 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span className="min-w-0 break-words">{load.error}
            {/* #1131 일시 실패(앱 막 켰을 때 등)는 다시 부르면 대개 됨 — 안내 + 누르면 다시 조회 */}
            <button type="button" onClick={() => setLocalReload((x) => x + 1)} className="mt-1 block text-[11px] text-mustard-700 underline-offset-2 hover:underline dark:text-mustard-400">{t("github.retryHint")}</button></span></div>
        ) : !load.rows?.length ? (
          <p className="p-4 text-[12px] text-zinc-400 dark:text-zinc-500">{t("github.empty")}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {load.rows.map((pr) => (
              <li key={pr.number}>
                <button type="button" onClick={() => onOpen(pr.number)}
                  onMouseEnter={(e) => onRowEnter(e, `#${pr.number} ${pr.title}`)} onMouseLeave={clearHover}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${prColor(pr)}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{pr.number}</span>
                      <span className="min-w-0 truncate text-[12px] text-zinc-700 dark:text-zinc-200">{pr.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                      <ChecksSummary rollup={pr.statusCheckRollup} />
                      <span className="truncate">{pr.author?.login}{pr.createdAt ? ` · ${relTime(pr.createdAt)}` : ""}{pr.isDraft && pr.state.toUpperCase() === "OPEN" ? ` · ${t("github.draft")}` : ""}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!!load.rows?.length && load.hasMore && (
          <div ref={sentinelCb} className="flex items-center justify-center gap-1.5 py-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            <IconLoader2 size={13} className="animate-spin" aria-hidden /> {t("github.loadingMore")}
          </div>
        )}
      </div>
      {hover && (
        <div role="tooltip" aria-hidden
          style={{ position: "fixed", left: hover.left, top: hover.top, transform: hover.above ? "translateY(-100%)" : undefined, maxWidth: 320, zIndex: 50 }}
          className="pointer-events-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] leading-relaxed text-zinc-700 shadow-xl dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {hover.text}
        </div>
      )}
    </div>
  );
}

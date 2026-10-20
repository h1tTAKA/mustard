"use client";
// GitHub 패널 이슈 목록(#813) — gh issue list(브릿지 #810) → 필터(open/closed/all) + 행 목록.
// 행 클릭 시 onOpen(number)로 상세(IssueDetail)로. reloadKey 변하면 재조회(패널 새로고침 연동).
import { useCallback, useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconPlus } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { relTime } from "@/lib/relTime";
import IssueCompose from "@/components/workspace/github/IssueCompose";

type Filter = "open" | "closed" | "all";
type Load = { loading: boolean; rows?: GhIssue[]; error?: string; hasMore?: boolean };
const HOVER_DELAY_MS = 450; // 훑을 땐 안 뜨고 잠깐 머물면 뜸(커밋 그래프式, native title보다 빠르게)

function StateDot({ state }: { state: string }) {
  const open = state.toUpperCase() === "OPEN";
  return <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${open ? "bg-emerald-500" : "bg-purple-500"}`} aria-hidden />;
}

export default function IssueList({ root, reloadKey, host = "github", onOpen }: { root: string; reloadKey: number; host?: "github" | "gitlab" | "other"; onOpen: (n: number) => void }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("open");
  const [limit, setLimit] = useState(50); // 더 보기 페이지네이션(#813)
  const [load, setLoad] = useState<Load>({ loading: true });
  const [composing, setComposing] = useState(false); // #945 이슈 생성 폼
  const [localReload, setLocalReload] = useState(0);  // #945 생성 후 목록 갱신
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const reqIdRef = useRef(0); // 요청 세대 — 늦게 온 옛 fetch가 최신 결과 덮어쓰지 않게(IPC라 abort 불가, 리뷰 🟡)

  // 제목 호버 툴팁(#813) — dwell 지연 후 전체 제목 표시(fixed 위치, 리스트 overflow 잘림 회피). GitGraph 방식.
  const [hover, setHover] = useState<{ text: string; left: number; top: number; above: boolean } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = useCallback(() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } setHover(null); }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const onRowEnter = useCallback((e: React.MouseEvent<HTMLElement>, text: string) => {
    const r = e.currentTarget.getBoundingClientRect(); // 좌표 지금 캡처(지연 콜백서 currentTarget null)
    const POP_W = 320;
    const above = r.top > window.innerHeight / 2;
    const payload = { text, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)), top: above ? r.top - 4 : r.bottom + 4, above };
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(payload), HOVER_DELAY_MS);
  }, []);

  useEffect(() => {
    const nd = window.nunopiDesktop;
    // #964 host별 — gitlab이면 glabIssueList(GhIssue 정규화), else github.issueList.
    const list = host === "gitlab" ? nd?.integrations?.glabIssueList : nd?.github?.issueList;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)/로딩 표시(root/filter/reload 변경마다 재조회)
    if (!list) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const myId = ++reqIdRef.current; // 이 fetch의 세대
    setLoad((p) => ({ loading: true, rows: p.rows, hasMore: p.hasMore })); // 기존 rows·hasMore 유지(append 중 리스트·스피너 안 사라지게)
    (async () => {
      const r = await list(root, filter, limit);
      if (!mountedRef.current || myId !== reqIdRef.current) return; // 언마운트/stale 결과 드롭
      // hasMore: 요청한 limit만큼 꽉 채워 왔으면 더 있을 수 있음(rows.length는 로딩 중 옛값이라 조건에 못 씀).
      if (r.ok) setLoad({ loading: false, rows: r.data, hasMore: r.data.length >= limit && limit < 1000 });
      else setLoad({ loading: false, error: r.detail || t("github.error") });
    })();
  }, [root, filter, limit, reloadKey, localReload, host, t]);

  // 무한 스크롤(#813) — 하단 sentinel이 보이면 limit +50. 로딩 중/더 없음이면 스킵(최신 상태는 ref로 읽음).
  // sentinel은 rows 로드 후에야 렌더되므로 콜백 ref로 부착(마운트 시엔 없어서 useEffect론 못 잡음).
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
    return <IssueCompose root={root} onCancel={() => setComposing(false)}
      onCreated={(n) => { setComposing(false); setLocalReload((x) => x + 1); onOpen(n); }} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 필터 탭 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800/60">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => { setFilter(f); setLimit(50); setLoad({ loading: true }); }} aria-pressed={filter === f}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${filter === f ? "bg-mustard-500/15 text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
            {t(f === "open" ? "github.filterOpen" : f === "closed" ? "github.filterClosed" : "github.filterAll")}
          </button>
        ))}
        {host === "github" ? (
        <button type="button" onClick={() => setComposing(true)} title={t("github.createIssue")} aria-label={t("github.createIssue")}
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
            {load.rows.map((it) => (
              <li key={it.number}>
                <button type="button" onClick={() => onOpen(it.number)}
                  onMouseEnter={(e) => onRowEnter(e, `#${it.number} ${it.title}`)} onMouseLeave={clearHover}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <StateDot state={it.state} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{it.number}</span>
                      <span className="min-w-0 truncate text-[12px] text-zinc-700 dark:text-zinc-200">{it.title}</span>
                    </span>
                    {/* 작성자 · 올라온 시각(#813) — 목록 불친절 완화 */}
                    <span className="mt-0.5 block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                      {it.author?.login}{it.createdAt ? ` · ${relTime(it.createdAt)}` : ""}
                    </span>
                    {it.labels.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {it.labels.map((l) => (
                          <span key={l.name} className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] text-zinc-500 dark:text-zinc-400" style={{ backgroundColor: `#${l.color}22` }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `#${l.color}` }} aria-hidden />{l.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* 무한 스크롤 sentinel(#813) — 보이면 다음 페이지 로드. 로딩 중엔 rows<limit이라 hasMore로 판정(안 사라지게). */}
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

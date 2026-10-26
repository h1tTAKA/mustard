"use client";
// 트래커 이슈 목록(#1172) — Linear·Jira. 기본 = 나에게 배정된 안 끝난 것, 검색어 = 그 트래커 검색(Jira는 KEY-123이면 그 이슈).
// 모양은 GitHub 이슈 목록과 같게(행: 상태 점·키·제목·상태·담당·시각).
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconSearch } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { relTime } from "@/lib/relTime";

type Load = { loading: boolean; rows?: TrackerIssue[]; error?: string; reconnect?: boolean };
// 상태 묶음 → 점 색(Linear 타입 / Jira 상태 묶음)
export function trackerDot(stateType: string) {
  return stateType === "started" || stateType === "indeterminate" ? "bg-amber-400"
    : stateType === "completed" || stateType === "done" ? "bg-purple-500"
    : stateType === "canceled" ? "bg-zinc-400" : "bg-emerald-500";
}

export default function TrackerIssueList({ provider, reloadKey, onOpen }: { provider: TrackerProvider; reloadKey: number; onOpen: (issue: TrackerIssue) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // 입력 멈춘 뒤(0.4초) 검색
  const [load, setLoad] = useState<Load>({ loading: true });
  const [retry, setRetry] = useState(0);
  const reqId = useRef(0);
  useEffect(() => { const h = setTimeout(() => setQuery(q.trim()), 400); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    const list = window.nunopiDesktop?.trackers?.list;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)·로딩 표시
    if (!list) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const my = ++reqId.current;
    setLoad((p) => ({ loading: true, rows: p.rows }));
    void list(provider, query).then((r) => {
      if (my !== reqId.current) return; // 늦게 온 옛 결과는 버림
      if (r.ok) setLoad({ loading: false, rows: r.data });
      else setLoad({ loading: false, error: t(r.state === "not-connected" || r.state === "not-authed" ? "trackers.needConnect" : `trackers.err.${["forbidden", "offline", "rate-limited"].includes(r.state) ? r.state : "error"}`), reconnect: r.state === "not-connected" || r.state === "not-authed" });
    }).catch(() => { if (my === reqId.current) setLoad({ loading: false, error: t("trackers.err.error") }); });
  }, [provider, query, reloadKey, retry, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <label className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-3 py-1 dark:border-zinc-800/60">
        <IconSearch size={12} className="shrink-0 text-zinc-400" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(provider === "jira" ? "trackers.searchJira" : "trackers.search")} aria-label={t("trackers.search")}
          className="min-w-0 flex-1 bg-transparent py-0.5 text-[11px] text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-200" />
        {load.loading && load.rows && <IconLoader2 size={12} className="shrink-0 animate-spin text-zinc-400" aria-hidden />}
      </label>
      <div className="min-h-0 flex-1 overflow-auto">
        {load.loading && !load.rows ? (
          <div className="flex items-center gap-2 p-4 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>
        ) : load.error && !load.rows?.length ? (
          <div className="flex items-start gap-2 p-4 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
            <span className="min-w-0 break-words">{load.error}
              {!load.reconnect && <button type="button" onClick={() => setRetry((x) => x + 1)} className="mt-1 block text-[11px] text-mustard-700 underline-offset-2 hover:underline dark:text-mustard-400">{t("github.retryHint")}</button>}
            </span></div>
        ) : !load.rows?.length ? (
          <p className="p-4 text-[12px] text-zinc-400 dark:text-zinc-500">{query ? t("trackers.noMatch") : t("trackers.empty")}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {load.rows.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => onOpen(it)} title={`${it.key} ${it.title}`}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${trackerDot(it.stateType)}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{it.key}</span>
                      <span className="min-w-0 truncate text-[12px] text-zinc-700 dark:text-zinc-200">{it.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                      {it.state}{it.assignee ? ` · ${it.assignee}` : ""}{it.updatedAt ? ` · ${relTime(it.updatedAt)}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

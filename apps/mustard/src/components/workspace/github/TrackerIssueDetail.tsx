"use client";
// 트래커 이슈 상세(#1172) — 키·제목·상태(바꾸기)·브라우저로 열기·본문·댓글. 에이전트·작업공간·Crew 행동은 아래 actions 자리(#1172 커밋 4).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowLeft, IconExternalLink, IconLoader2, IconAlertTriangle } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import { relTime } from "@/lib/relTime";
import { trackerDot } from "@/components/workspace/github/TrackerIssueList";

export default function TrackerIssueDetail({ provider, initial, reloadKey, onBack, actions }: { provider: TrackerProvider; initial: TrackerIssue; reloadKey: number; onBack: () => void; actions?: (issue: TrackerIssue) => ReactNode }) {
  const t = useT();
  const toast = useToast();
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.trackers : undefined;
  const [issue, setIssue] = useState<TrackerIssue>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<{ id: string; name: string; type: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!api) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때·새로고침 때 다시 불러옴
    setLoading(true);
    void api.view(provider, provider === "jira" ? initial.key : initial.id).then((r) => {
      if (!alive.current) return;
      if (r.ok) { setIssue(r.data); setError(null); } else setError(t(r.state === "not-authed" || r.state === "not-connected" ? "trackers.needConnect" : `trackers.err.${["forbidden", "offline", "rate-limited"].includes(r.state) ? r.state : "error"}`));
    }).finally(() => { if (alive.current) setLoading(false); });
    setStates(null); // 상태 후보는 이슈마다(Jira는 지금 가능한 전환)
  }, [api, provider, initial.id, initial.key, reloadKey, local, t]);
  const loadStates = () => { if (!api || states) return; void api.states(provider, issue).then((r) => { if (alive.current) setStates(r.ok ? r.data : []); }); };
  const change = async (stateId: string) => {
    if (!api || !stateId) return;
    setBusy(true);
    try {
      const r = await api.setState(provider, issue, stateId);
      if (r.ok) { toast(t("trackers.stateChanged"), "success"); setLocal((x) => x + 1); }
      else toast(t(`trackers.err.${["forbidden", "offline", "rate-limited"].includes(r.state) ? r.state : "error"}`), "error");
    } finally { if (alive.current) setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <button type="button" onClick={onBack} aria-label={t("github.back")} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconArrowLeft size={14} aria-hidden /></button>
        <span className="font-mono text-[11px] text-zinc-400">{issue.key}</span>
        {loading && <IconLoader2 size={12} className="animate-spin text-zinc-400" aria-hidden />}
        <a href={issue.url} target="_blank" rel="noreferrer" title={t("trackers.openInBrowser")} aria-label={t("trackers.openInBrowser")} className="ml-auto rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconExternalLink size={14} aria-hidden /></a>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <h3 className="text-[13px] font-semibold leading-snug text-zinc-800 dark:text-zinc-100">{issue.title}</h3>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className={`h-2 w-2 rounded-full ${trackerDot(issue.stateType)}`} aria-hidden />
          {/* 상태 바꾸기 — 누를 때 후보를 불러옴(Jira = 지금 가능한 전환) */}
          <select value="" onFocus={loadStates} onMouseDown={loadStates} onChange={(e) => void change(e.target.value)} disabled={busy} aria-label={t("trackers.changeState")}
            className="rounded-md border border-zinc-200 bg-transparent px-1.5 py-0.5 text-[11px] text-zinc-700 outline-none dark:border-zinc-700 dark:text-zinc-200">
            <option value="">{issue.state}</option>
            {states === null ? <option value="" disabled>…</option> : states.filter((s) => s.name !== issue.state).map((s) => <option key={s.id} value={s.id}>→ {s.name}</option>)}
          </select>
          {issue.assignee && <span>· {issue.assignee}</span>}
          {issue.updatedAt && <span>· {relTime(issue.updatedAt)}</span>}
        </div>
        {actions?.(issue)}
        {error && <p className="flex items-start gap-1.5 text-[12px] text-zinc-500"><IconAlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />{error}</p>}
        {issue.body ? <div className="whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-2.5 text-[12px] leading-relaxed text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200">{issue.body}</div>
          : !loading && <p className="text-[12px] text-zinc-400">{t("trackers.noBody")}</p>}
        {(issue.comments?.length ?? 0) > 0 && (
          <ul className="space-y-2">
            {issue.comments!.map((c, i) => (
              <li key={i} className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
                <p className="mb-1 text-[10px] text-zinc-400">{c.author}{c.at ? ` · ${relTime(c.at)}` : ""}</p>
                <p className="whitespace-pre-wrap break-words text-[12px] text-zinc-700 dark:text-zinc-200">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

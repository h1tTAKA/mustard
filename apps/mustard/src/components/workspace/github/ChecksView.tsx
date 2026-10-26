"use client";
// CI 체크 뷰(#812, 서브3 재사용) — statusCheckRollup 정규화 결과를 통과/실패/진행 아이콘 목록으로.
// 항목 클릭 시 상세(상태·시작/완료 시각·체크#·작업흐름#·주석) 펼침. 주석은 펼칠 때 lazy 조회.
import { useEffect, useState } from "react";
import { IconCircleCheck, IconCircleX, IconLoader2, IconCircle, IconExternalLink, IconChevronRight } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { normalizeChecks, summarize, type Check, type CheckState } from "@/components/workspace/github/checks";
import { fmtDateTime } from "@/lib/relTime";

function StateIcon({ state, size = 13 }: { state: CheckState; size?: number }) {
  if (state === "success") return <IconCircleCheck size={size} stroke={2} className="text-emerald-500" aria-hidden />;
  if (state === "failure") return <IconCircleX size={size} stroke={2} className="text-rose-500" aria-hidden />;
  if (state === "pending") return <IconLoader2 size={size} className="animate-spin text-amber-500" aria-hidden />;
  return <IconCircle size={size} stroke={2} className="text-zinc-400" aria-hidden />;
}

export function ChecksSummary({ rollup }: { rollup: GhCheckRaw[] | undefined }) {
  const s = summarize(normalizeChecks(rollup));
  if (!s.total) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px]">
      {s.fail > 0 ? <StateIcon state="failure" size={11} /> : s.pending > 0 ? <StateIcon state="pending" size={11} /> : <StateIcon state="success" size={11} />}
      <span className="text-zinc-400 dark:text-zinc-500">{s.pass}/{s.total}</span>
    </span>
  );
}

const ANN_COLOR: Record<string, string> = { failure: "text-rose-500", warning: "text-amber-500", notice: "text-sky-500" };

function stepState(s: GhJobStep): CheckState {
  if ((s.status || "").toLowerCase() !== "completed") return "pending";
  const c = (s.conclusion || "").toLowerCase();
  if (c === "success") return "success";
  if (["failure", "timed_out", "cancelled", "action_required"].includes(c)) return "failure";
  return "neutral"; // skipped, neutral
}

// 체크 하나의 펼친 상세 — 상태·시각·id·주석(lazy).
function CheckDetail({ root, check }: { root: string; check: Check }) {
  const t = useT();
  const [ann, setAnn] = useState<{ loading: boolean; rows?: GhAnnotation[] }>({ loading: !!check.checkRunId });
  const [steps, setSteps] = useState<{ loading: boolean; rows?: GhJobStep[] }>({ loading: !!check.checkRunId });
  useEffect(() => {
    const id = check.checkRunId;
    const gh = window.nunopiDesktop?.github;
    if (!id || !gh) return;
    let cancelled = false; // 각 effect 실행마다 독립 플래그(checkRunId 변경 시 옛 async 드롭)
    void (async () => {
      if (gh.checkAnnotations) { const r = await gh.checkAnnotations(root, id); if (!cancelled) setAnn({ loading: false, rows: r.ok ? r.data : [] }); }
      if (gh.jobSteps) { const r = await gh.jobSteps(root, id); if (!cancelled) setSteps({ loading: false, rows: r.ok ? (r.data.steps ?? []) : [] }); } // 작업 스텝(#812)
    })();
    return () => { cancelled = true; };
  }, [root, check.checkRunId]);
  const stateText = check.state === "success" ? "Successful" : check.state === "failure" ? "Failed" : check.state === "pending" ? "In progress" : "—";
  return (
    <div className="mb-1.5 ml-5 flex flex-col gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{t("github.status")}: {stateText}</span>
        {check.startedAt && <span>{t("github.startedAt")} {fmtDateTime(check.startedAt)}</span>}
        {check.completedAt && <span>{t("github.completedAt")} {fmtDateTime(check.completedAt)}</span>}
        {check.checkRunId && <span>{t("github.checkId")} #{check.checkRunId}</span>}
        {check.runId && <span>{t("github.workflowRun")} #{check.runId}</span>}
      </div>
      {check.description && <span className="break-words text-zinc-500 dark:text-zinc-400">{check.description}</span>}
      {/* 주석(annotations) */}
      {check.checkRunId && (ann.loading ? (
        <span className="inline-flex items-center gap-1"><IconLoader2 size={10} className="animate-spin" aria-hidden /> {t("github.annotations")}…</span>
      ) : ann.rows && ann.rows.length > 0 ? (
        <div className="mt-0.5 flex flex-col gap-1 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700">
          <span className="text-zinc-400 dark:text-zinc-500">{t("github.annotations")}</span>
          {ann.rows.map((a, i) => (
            <div key={i} className="break-words">
              <span className={ANN_COLOR[a.annotation_level || ""] || "text-zinc-400"}>{a.annotation_level}</span>
              {a.path && <span className="text-zinc-400 dark:text-zinc-500"> {a.path}{a.start_line ? `:${a.start_line}` : ""}</span>}
              <div className="text-zinc-500 dark:text-zinc-400">{a.title ? `${a.title} — ` : ""}{a.message}</div>
            </div>
          ))}
        </div>
      ) : null)}
      {/* 작업(job) 스텝 흐름 — Set up job … Complete job */}
      {check.checkRunId && !steps.loading && steps.rows && steps.rows.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-0.5 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700">
          <span className="text-zinc-400 dark:text-zinc-500">{t("github.jobs")}</span>
          {steps.rows.map((st, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <StateIcon state={stepState(st)} size={11} />
              <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">{st.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChecksView({ root, rollup }: { root: string; rollup: GhCheckRaw[] | undefined }) {
  const t = useT();
  const checks = normalizeChecks(rollup);
  const [open, setOpen] = useState<number | null>(null);
  if (!checks.length) return null;
  return (
    <ul className="flex flex-col">
      {checks.map((c, i) => {
        const expanded = open === i;
        return (
          <li key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/40">
            <div className="flex items-center gap-1.5 py-1 text-[11px]">
              <button type="button" onClick={() => setOpen(expanded ? null : i)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={expanded}>
                <IconChevronRight size={11} stroke={2.5} className={`shrink-0 text-zinc-400 transition ${expanded ? "rotate-90" : ""}`} aria-hidden />
                <StateIcon state={c.state} />
                <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{c.name}</span>
              </button>
              {c.url && <a href={c.url} target="_blank" rel="noreferrer" title={t("github.fullDetails")} className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" aria-label={t("github.fullDetails")}><IconExternalLink size={12} stroke={2} aria-hidden /></a>}
            </div>
            {expanded && <CheckDetail root={root} check={c} />}
          </li>
        );
      })}
    </ul>
  );
}

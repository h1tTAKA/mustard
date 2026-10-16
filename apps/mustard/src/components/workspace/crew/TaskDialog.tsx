"use client";
// Crew 작업 만들기·편집 창(#1098) — 앱 확인 창(ConfirmDialog)과 같은 결: 큰 제목 입력 + 설명 + 속성 칩(담당 역할·칸).
// ⌘/Ctrl+Enter 저장, Esc 닫기(열린 선택 메뉴가 있으면 메뉴부터).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown, IconGitBranch, IconPlayerPlayFilled, IconPlayerStopFilled, IconShieldQuestion, IconTrash } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { CREW_STATUSES, type CrewStatus, type CrewTask } from "@/lib/crew/crewTypes";
import type { CrewRole } from "@/lib/crew/crewRoleDefaults";
import type { CrewRun } from "@/lib/crew/crewRunner";
import { PROVIDER_LABEL, RoleIcon, STATUS_DOT, elapsed, isActiveRun, roleDesc, roleName } from "./crewUi";

export interface TaskDraft { title: string; body: string; role: string; status: CrewStatus }

export default function TaskDialog({ initial, status, roles, run, onSave, onClose, onDelete, onRun, onStop, onPermission }: {
  initial?: CrewTask; status: CrewStatus; roles: CrewRole[]; run?: CrewRun; onSave: (v: TaskDraft) => void | Promise<void>; onClose: () => void; onDelete?: () => void;
  onRun?: () => void; onStop?: () => void; onPermission?: (approved: boolean) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [role, setRole] = useState(initial?.role ?? ""); // "" = 자동 배정
  const [col, setCol] = useState<CrewStatus>(status);
  const [menu, setMenu] = useState<"role" | "col" | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try { await onSave({ title: title.trim(), body, role, status: col }); } finally { setBusy(false); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (menu) setMenu(null); else onClose(); }
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const chip = "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-[12px] text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-200 dark:hover:border-white/20 dark:hover:bg-white/5";
  const item = "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-white/5";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={initial ? t("crew.editTask") : t("crew.newTask")}
        className="relative w-full max-w-lg overflow-visible rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        <div className="px-5 pt-4 text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500">{t("crew.title")} · {initial ? t("crew.editTask") : t("crew.newTask")}</div>
        <div className="px-5 pb-3 pt-2">
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("crew.taskTitle")}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); bodyRef.current?.focus(); } }} // Enter = 설명으로
            className="w-full bg-transparent text-[17px] font-semibold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-50 dark:placeholder:text-zinc-600" />
          <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("crew.taskBody")} rows={initial ? 8 : 5}
            className="nunopi-scroll mt-2 w-full resize-none bg-transparent text-[13px] leading-relaxed text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-300 dark:placeholder:text-zinc-600" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">
          {/* 담당 역할 */}
          <div className="relative">
            <button type="button" className={chip} onClick={() => setMenu(menu === "role" ? null : "role")} aria-haspopup="listbox" aria-expanded={menu === "role"} title={t("crew.fieldRole")}>
              <RoleIcon role={role || undefined} size={13} className="text-mustard-600 dark:text-mustard-400" />
              <span className="text-zinc-400 dark:text-zinc-500">{t("crew.fieldRole")}</span>
              <span className="font-medium">{roleName(t, roles, role || undefined)}</span>
              <IconChevronDown size={12} stroke={2} className="text-zinc-400" aria-hidden />
            </button>
            {menu === "role" && (
              <div role="listbox" className="nunopi-scroll absolute left-0 top-full z-10 mt-1 max-h-80 w-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1c24]">
                {["", ...roles.map((x) => x.id)].map((r) => (
                  <button key={r || "none"} type="button" role="option" aria-selected={role === r} className={item} onClick={() => { setRole(r); setMenu(null); }}>
                    <RoleIcon role={r || undefined} size={14} className="mt-0.5 text-zinc-500 dark:text-zinc-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r || undefined)}</span>
                      <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{roleDesc(t, roles, r || undefined)}</span>
                    </span>
                    {role === r && <IconCheck size={14} stroke={2.2} className="mt-0.5 shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 칸 */}
          <div className="relative">
            <button type="button" className={chip} onClick={() => setMenu(menu === "col" ? null : "col")} aria-haspopup="listbox" aria-expanded={menu === "col"} title={t("crew.fieldColumn")}>
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[col]}`} aria-hidden />
              <span className="font-medium">{t(`crew.col.${col}`)}</span>
              <IconChevronDown size={12} stroke={2} className="text-zinc-400" aria-hidden />
            </button>
            {menu === "col" && (
              <div role="listbox" className="absolute left-0 top-full z-10 mt-1 w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1c24]">
                {CREW_STATUSES.map((s) => (
                  <button key={s} type="button" role="option" aria-selected={col === s} className={`${item} items-center`} onClick={() => { setCol(s); setMenu(null); }}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s]}`} aria-hidden />
                    <span className="flex-1 text-[12.5px] text-zinc-800 dark:text-zinc-100">{t(`crew.col.${s}`)}</span>
                    {col === s && <IconCheck size={14} stroke={2.2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {initial && (
          <RunPanel run={run} onRun={onRun} onStop={onStop} onPermission={onPermission} dirty={(initial.role ?? "") !== role} />
        )}

        <div className="flex items-center gap-2 rounded-b-2xl border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
          {onDelete ? (
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">
              <IconTrash size={14} stroke={2} aria-hidden />{t("crew.delete")}
            </button>
          ) : <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("crew.shortcutHint")}</span>}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.cancel")}</button>
          <button type="button" onClick={() => void save()} disabled={!title.trim() || busy}
            className="rounded-lg bg-mustard-500 px-3.5 py-2 text-[13px] font-semibold text-brown-900 shadow-sm transition hover:bg-mustard-400 disabled:opacity-40">
            {initial ? t("crew.save") : t("crew.create")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 실행 구역(편집 창) — 실행/중지, 상태·마지막 활동·경과·도구 수·브랜치, 권한 요청(허락/거절), 마지막 요약.
function RunPanel({ run, onRun, onStop, onPermission, dirty }: { run?: CrewRun; onRun?: () => void; onStop?: () => void; onPermission?: (approved: boolean) => void; dirty: boolean }) {
  const t = useT();
  const active = isActiveRun(run);
  const [, tick] = useState(0);
  useEffect(() => { if (!active) return; const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, [active]); // 경과 시간 갱신
  const tone = !run ? "text-zinc-500" : run.state === "failed" || run.state === "stopped" ? "text-rose-600 dark:text-rose-400" : run.state === "needs-permission" ? "text-amber-600 dark:text-amber-400" : run.state === "done" ? "text-emerald-600 dark:text-emerald-400" : "text-mustard-700 dark:text-mustard-400";
  const req = run?.permission?.request ?? {};
  const reqTool = String(req.tool_name ?? req.toolName ?? req.tool ?? "");
  const reqInput = req.input ?? req.tool_input ?? req;
  return (
    <div className="mx-5 mb-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("crew.runSection")}</span>
        {run && <span className={`flex items-center gap-1 text-[12px] font-medium ${tone}`}>
          {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
          {t(`crew.state.${run.state}`)}
        </span>}
        {run && <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{PROVIDER_LABEL[run.provider] ?? run.provider} · {elapsed(run.startedAt, run.endedAt)}{run.toolCount ? ` · ${t("crew.tools", { n: run.toolCount })}` : ""}</span>}
        <span className="flex-1" />
        {active ? (
          <button type="button" onClick={onStop} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-700 transition hover:border-rose-300 hover:text-rose-600 dark:border-white/10 dark:text-zinc-200 dark:hover:border-rose-500/40 dark:hover:text-rose-400">
            <IconPlayerStopFilled size={11} aria-hidden />{t("crew.stop")}
          </button>
        ) : (
          <button type="button" onClick={onRun} disabled={dirty} title={dirty ? t("crew.save") : undefined}
            className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
            <IconPlayerPlayFilled size={11} aria-hidden />{t("crew.run")}
          </button>
        )}
      </div>
      {!run && <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("crew.runIdle")}</p>}
      {run?.lastActivity && active && <p className="mt-1.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{run.lastActivity}</p>}
      {run?.branch && <p className="mt-1 flex items-center gap-1 font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500"><IconGitBranch size={11} aria-hidden />{run.branch}</p>}
      {run?.state === "needs-permission" && (
        <div className="mt-2.5 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 dark:border-amber-500/30 dark:bg-amber-500/[0.07]">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-800 dark:text-amber-300"><IconShieldQuestion size={14} aria-hidden />{t("crew.permissionAsk")}{reqTool && <code className="rounded bg-amber-100 px-1 text-[11px] dark:bg-amber-500/15">{reqTool}</code>}</div>
          <pre className="nunopi-scroll mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-1.5 font-mono text-[10.5px] text-zinc-700 dark:bg-black/20 dark:text-zinc-300">{JSON.stringify(reqInput, null, 1).slice(0, 1500)}</pre>
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={() => onPermission?.(false)} className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-amber-100 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.deny")}</button>
            <button type="button" onClick={() => onPermission?.(true)} className="rounded-lg bg-amber-500 px-2.5 py-1 text-[12px] font-semibold text-white transition hover:bg-amber-600">{t("crew.approve")}</button>
          </div>
        </div>
      )}
      {run?.error && !active && <p className="mt-1.5 text-[11.5px] text-rose-600 dark:text-rose-400">{run.error}</p>}
      {run?.summary && !active && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">{t("crew.summary")}</summary>
          <p className="nunopi-scroll mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">{run.summary}</p>
        </details>
      )}
    </div>
  );
}

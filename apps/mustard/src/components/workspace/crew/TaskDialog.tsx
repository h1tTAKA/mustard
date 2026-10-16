"use client";
// Crew 작업 만들기·편집 창(#1098) — 앱 확인 창(ConfirmDialog)과 같은 결: 큰 제목 입력 + 설명 + 속성 칩(담당 역할·칸).
// ⌘/Ctrl+Enter 저장, Esc 닫기(열린 선택 메뉴가 있으면 메뉴부터).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown, IconTrash } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { CREW_ROLES, CREW_STATUSES, type CrewStatus, type CrewTask } from "@/lib/crew/crewTypes";
import { RoleIcon, STATUS_DOT } from "./crewUi";

export interface TaskDraft { title: string; body: string; role: string; status: CrewStatus }

export default function TaskDialog({ initial, status, onSave, onClose, onDelete }: {
  initial?: CrewTask; status: CrewStatus; onSave: (v: TaskDraft) => void | Promise<void>; onClose: () => void; onDelete?: () => void;
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
              <span className="font-medium">{t(`crew.role.${role || "none"}`)}</span>
              <IconChevronDown size={12} stroke={2} className="text-zinc-400" aria-hidden />
            </button>
            {menu === "role" && (
              <div role="listbox" className="nunopi-scroll absolute left-0 top-full z-10 mt-1 max-h-80 w-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1c24]">
                {["", ...CREW_ROLES].map((r) => (
                  <button key={r || "none"} type="button" role="option" aria-selected={role === r} className={item} onClick={() => { setRole(r); setMenu(null); }}>
                    <RoleIcon role={r || undefined} size={14} className="mt-0.5 text-zinc-500 dark:text-zinc-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">{t(`crew.role.${r || "none"}`)}</span>
                      <span className="block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{t(`crew.roleDesc.${r || "none"}`)}</span>
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

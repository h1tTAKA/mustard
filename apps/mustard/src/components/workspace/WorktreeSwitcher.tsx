"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconGitFork, IconChevronDown, IconCheck, IconPlus, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { openNewWorkspace } from "@/lib/repo/workspaceEvents";

// 레포 탭 안 작업 폴더 전환(#1170, 유저 결정) — worktree를 따로 탭으로 열지 않고, 레포 탭 하나에서 메인 ↔ worktree를 바꿔 봄.
// 활성 레포 탭 알약 안의 작은 칩 "⑂ 이름 ▾" → 목록(메인·사람용 worktree, Crew 것은 뺌) + "새 작업공간…".
type Wt = { path: string; branch: string | null; head: string; detached: boolean };
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export default function WorktreeSwitcher({ root, current, onPick }: { root: string; current?: string; onPick: (path?: string) => void }) {
  const t = useT();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [list, setList] = useState<Wt[] | null>(null);

  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.min(r.left, window.innerWidth - 272), top: r.bottom + 6 });
    setList(null);
    void fetch("/api/repo/git-worktree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) })
      .then((x) => x.json()).then((d) => setList(d.ok ? (d.worktrees ?? []).filter((w: Wt, i: number) => i === 0 || !w.path.includes("/.nunopi/worktrees/")) : []))
      .catch(() => setList([]));
  };
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const id = setTimeout(() => { window.addEventListener("mousedown", close); window.addEventListener("resize", close); }, 0);
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(id); window.removeEventListener("mousedown", close); window.removeEventListener("resize", close); window.removeEventListener("keydown", onKey); };
  }, [pos]);

  const label = current ? base(current) : t("wt.main");
  return (
    <>
      <button ref={btn} type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (pos) setPos(null); else open(); }}
        title={t("wt.switchTitle")} aria-label={t("wt.switchTitle")} aria-expanded={!!pos}
        className={`ml-0.5 inline-flex max-w-[10rem] shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-[11px] font-medium transition hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 ${current ? "text-mustard-700 dark:text-mustard-400" : "text-zinc-500 dark:text-zinc-400"}`}>
        <IconGitFork size={12} stroke={2} className="shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        <IconChevronDown size={11} stroke={2.5} className="shrink-0" aria-hidden />
      </button>
      {pos && createPortal(
        <div role="menu" aria-label={t("wt.switchTitle")} onMouseDown={(e) => e.stopPropagation()} style={{ left: pos.left, top: pos.top }}
          className="fixed z-50 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[var(--s-menu)] dark:ring-white/5">
          <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{t("wt.folders")}</div>
          {list === null ? (
            <div className="flex items-center gap-1.5 px-2.5 py-2 text-[12px] text-zinc-400"><IconLoader2 size={13} className="animate-spin" aria-hidden /></div>
          ) : list.map((w, i) => {
            const isMain = i === 0, on = isMain ? !current : current === w.path;
            return (
              <button key={w.path} type="button" role="menuitem" title={w.path} onClick={() => { onPick(isMain ? undefined : w.path); setPos(null); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.08]">
                <IconGitFork size={14} stroke={1.75} className={`shrink-0 ${on ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{isMain ? t("wt.main") : base(w.path)}</span>
                  <span className="ml-1.5 font-mono text-[11px] text-zinc-400">{w.detached ? w.head : w.branch}</span>
                </span>
                {on && <IconCheck size={13} stroke={2.5} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
              </button>
            );
          })}
          <div className="my-1 h-px bg-zinc-100 dark:bg-white/5" />
          <button type="button" role="menuitem" onClick={() => { setPos(null); openNewWorkspace(root); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.08]">
            <IconPlus size={14} stroke={1.75} className="shrink-0 text-zinc-400" aria-hidden />{t("newWs.title")}…
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

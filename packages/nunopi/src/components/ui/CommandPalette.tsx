"use client";

// 명령 팔레트(#878) — ⌘K로 뜨는 필터형 명령 리스트. 범용: commands 배열만 받아 렌더·필터·실행.
// 앱 지식(뷰이동·탭열기)은 caller가 run 클로저로 주입 → 이 컴포넌트는 "명령이 뭘 하는지" 모름.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { useT } from "@mustard/core";
export type Command = { id: string; label: string; section?: string; icon?: ReactNode; shortcut?: string; run: () => void }; // shortcut: 표시용(⌘,) — #1029

export default function CommandPalette({ open, commands, onClose }: { open: boolean; commands: Command[]; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 열릴 때 검색어·선택 초기화 + 입력창 포커스.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 열릴 때 1회 초기화(open 토글에만 반응)
    setQ(""); setSel(0);
    const id = setTimeout(() => inputRef.current?.focus(), 0); // 렌더 후 포커스
    return () => clearTimeout(id);
  }, [open]);

  // 부분일치(소문자) 필터. 검색어 없으면 전체.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? commands.filter((c) => c.label.toLowerCase().includes(s)) : commands;
  }, [q, commands]);

  if (!open) return null;

  // 필터가 줄어 sel이 범위를 넘으면 마지막 항목으로 클램프(선택 안 보이는 문제 방지).
  const cur = filtered.length ? Math.min(sel, filtered.length - 1) : 0;
  const run = (c?: Command) => { if (!c) return; onClose(); c.run(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => (filtered.length ? (Math.min(i, filtered.length - 1) + 1) % filtered.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => (filtered.length ? (Math.min(i, filtered.length - 1) - 1 + filtered.length) % filtered.length : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(filtered[cur]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={onClose} />
      <div role="dialog" aria-modal="true"
        className="relative z-[71] w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[var(--s-menu)] dark:ring-white/5">
        <div className="flex items-center gap-2 border-b border-zinc-200/70 px-3 dark:border-white/10">
          <IconSearch size={16} className="shrink-0 text-zinc-400" aria-hidden />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
            placeholder={t("palette.placeholder")} aria-label={t("palette.placeholder")}
            className="w-full bg-transparent py-3 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-[13px] text-zinc-400 dark:text-zinc-500">{t("palette.empty")}</li>
          ) : filtered.map((c, i) => {
            const showSection = !!c.section && (i === 0 || filtered[i - 1].section !== c.section); // 섹션 바뀔 때만 헤더
            return (
              <li key={c.id}>
                {showSection ? <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{c.section}</div> : null}
                <button type="button" onMouseEnter={() => setSel(i)} onClick={() => run(c)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] transition ${i === cur ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"}`}>
                  {c.icon ? <span className="flex w-4 shrink-0 items-center justify-center text-zinc-400">{c.icon}</span> : null}
                  <span className="min-w-0">{c.label}</span>
                  {c.shortcut ? <span aria-hidden className="ml-auto shrink-0 pl-3 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{c.shortcut}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

"use client";
// 봇 홈 왼쪽 칸(#1397) — 검색 · 봇 목록(정렬·새 봇) · 프로젝트(열린 레포 탭 → 누르면 레포 모드로).
import { useMemo, useState } from "react";
import { IconSearch, IconPlus, IconArrowsSort, IconChevronDown, IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import RepoAvatar from "@/components/workspace/RepoAvatar";
import { relTime } from "@/lib/relTime";
import BotAvatar from "./BotAvatar";
import { botDesc, botName, type Bot } from "./useBots";

const SORT_KEY = "nunopi:bots-sort";
type Sort = "recent" | "name";
const ICON_BTN = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export type BotProject = { key: string; path: string };

export default function BotSidebar({ bots, error, selected, onSelect, onNew, onRetry, projects, onOpenProject }: {
  bots: Bot[] | null; error: boolean; selected: string | null;
  onSelect: (id: string) => void; onNew: () => void; onRetry: () => void;
  projects: BotProject[]; onOpenProject: (key: string) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>(() => { try { return localStorage.getItem(SORT_KEY) === "name" ? "name" : "recent"; } catch { return "recent"; } });
  const [botsOpen, setBotsOpen] = useState(true), [projOpen, setProjOpen] = useState(true);
  const flipSort = () => setSort((s) => { const n = s === "recent" ? "name" : "recent"; try { localStorage.setItem(SORT_KEY, n); } catch { /* ignore */ } return n; });

  const rows = useMemo(() => {
    const list = (bots ?? []).map((b) => ({ b, name: botName(t, b), desc: botDesc(t, b) }));
    const needle = q.trim().toLowerCase();
    const hit = needle ? list.filter((r) => `${r.name}\n${r.desc}`.toLowerCase().includes(needle)) : list;
    // 서버가 새 봇 위로 줌(recent). 이름순만 여기서.
    return sort === "name" ? [...hit].sort((a, z) => a.name.localeCompare(z.name)) : hit;
  }, [bots, q, sort, t]);

  const section = (label: string, open: boolean, toggle: () => void, extra?: React.ReactNode) => (
    <div className="flex items-center gap-0.5 px-3 pb-1 pt-3.5">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 text-[12px] font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
        <IconChevronDown size={12} stroke={2.2} className={`shrink-0 transition ${open ? "" : "-rotate-90"}`} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      {extra}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2.5 pt-3">
        <label className="flex h-8 items-center gap-2 rounded-lg bg-zinc-200/60 px-2.5 text-zinc-500 focus-within:ring-2 focus-within:ring-mustard-400/40 dark:bg-zinc-800/70 dark:text-zinc-400">
          <IconSearch size={15} stroke={2} className="shrink-0" aria-hidden />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bots.search")} aria-label={t("bots.search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500" />
        </label>
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        {section(t("bots.section"), botsOpen, () => setBotsOpen((o) => !o), <>
          <button type="button" onClick={flipSort} className={ICON_BTN} title={t(sort === "recent" ? "bots.sortRecent" : "bots.sortName")} aria-label={`${t("bots.sortLabel")}: ${t(sort === "recent" ? "bots.sortRecent" : "bots.sortName")}`}>
            <IconArrowsSort size={14} stroke={2} aria-hidden />
          </button>
          <button type="button" onClick={onNew} className={ICON_BTN} title={t("bots.new")} aria-label={t("bots.new")}>
            <IconPlus size={14} stroke={2} aria-hidden />
          </button>
        </>)}
        {botsOpen && (
          <div className="flex flex-col gap-px px-1.5">
            {error && (
              // 다시 읽기 실패해도 받아 둔 목록은 그대로 두고 위에 알림만(리뷰)
              <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-rose-500/10 px-2.5 py-2 text-[12px] text-rose-700 dark:text-rose-300">
                <IconAlertTriangle size={14} stroke={2} className="shrink-0" aria-hidden />
                <span className="flex-1">{t("bots.loadFailed")}</span>
                <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline-offset-2 hover:underline">{t("bots.retry")}</button>
              </div>
            )}
            {!bots ? null : bots.length === 0 ? (
              // 첫 실행 — 가운데 추천 화면과 짝(무엇을 하는 칸인지 한 줄)
              <div className="mx-1 flex flex-col gap-1 rounded-xl bg-white px-3 py-3 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800/50 dark:ring-zinc-700/60">
                <div className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{t("bots.emptyCard.title")}</div>
                <div className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("bots.emptyCard.desc")}</div>
              </div>
            ) : rows.length === 0 && q.trim() ? (
              <p className="px-2.5 py-2 text-[12px] text-zinc-400 dark:text-zinc-500">{t("bots.noMatch")}</p>
            ) : rows.map(({ b, name, desc }) => {
              const on = b.id === selected;
              return (
                <button key={b.id} type="button" onClick={() => onSelect(b.id)} aria-current={on ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${on ? "bg-white shadow-sm ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"}`}>
                  <BotAvatar name={name} color={b.color} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{name}</span>
                    <span className="block truncate text-[12px] text-zinc-500 dark:text-zinc-400">{desc}</span>
                  </span>
                  <span className="shrink-0 self-start pt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{relTime(new Date(b.createdAt).toISOString())}</span>
                </button>
              );
            })}
          </div>
        )}
        {projects.length > 0 && <>
          {section(t("bots.projects"), projOpen, () => setProjOpen((o) => !o))}
          {projOpen && (
            <div className="flex flex-col gap-px px-1.5">
              {projects.map((p) => (
                <button key={p.key} type="button" onClick={() => onOpenProject(p.key)} title={p.path}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60">
                  <RepoAvatar path={p.path} size={18} iconClassName="shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{basename(p.path)}</span>
                </button>
              ))}
            </div>
          )}
        </>}
      </div>
      {bots && bots.length > 0 && (
        <div className="shrink-0 border-t border-zinc-200 px-3 py-2 text-[11.5px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">{t("bots.count", { n: bots.length })}</div>
      )}
    </div>
  );
}

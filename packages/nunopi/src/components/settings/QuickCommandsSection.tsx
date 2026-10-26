"use client";
// 빠른 명령(#1194) — ⌘K 팔레트에서 실행할 셸 명령·에이전트 프롬프트 목록. 추가·수정은 그 자리 펼침 폼, 범위 = 모든 레포 / 열린 레포 하나.
import { useMemo, useState } from "react";
import { IconPlus, IconPencil, IconTrash, IconTerminal2, IconSparkles, IconBolt } from "@tabler/icons-react";
import { useT, useQuickCommands, saveQuickCommands, QUICK_NAME_MAX, QUICK_TEXT_MAX, type QuickCommand } from "@mustard/core";

const card = "rounded-2xl border border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/40";
const ghost = "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
const primary = "inline-flex shrink-0 items-center gap-1 rounded-lg bg-mustard-500 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-mustard-600 disabled:opacity-50";
const field = "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// 범위 후보 = 지금 열린 레포 탭들(메인 폴더 경로)
function openRepos(): string[] {
  try {
    const tabs = JSON.parse(localStorage.getItem("nunopi:ws-tabs") || "[]");
    return Array.isArray(tabs) ? [...new Set(tabs.filter((x) => x?.type === "repo" && typeof x.path === "string").map((x) => x.path as string))] : [];
  } catch { return []; }
}

type Draft = Omit<QuickCommand, "id"> & { id?: string };
const EMPTY: Draft = { name: "", kind: "shell", text: "", enter: true };

function Editor({ draft, repos, onSave, onCancel }: { draft: Draft; repos: string[]; onSave: (d: Draft) => void; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(draft);
  const ok = d.name.trim() && d.text.trim();
  const scopes = d.repo && !repos.includes(d.repo) ? [...repos, d.repo] : repos;
  return (
    <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800/70 dark:bg-zinc-900/60">
      <div className="flex gap-2">
        <input value={d.name} maxLength={QUICK_NAME_MAX} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t("quick.namePh")} aria-label={t("quick.name")} autoFocus className={field} />
        <div className="inline-flex shrink-0 rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
          {(["shell", "agent"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setD({ ...d, kind: k })}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${d.kind === k ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
              {t(`quick.kind.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <textarea value={d.text} maxLength={QUICK_TEXT_MAX} rows={3} onChange={(e) => setD({ ...d, text: e.target.value })}
        placeholder={t(d.kind === "shell" ? "quick.shellPh" : "quick.agentPh")} aria-label={t("quick.text")} className={`${field} resize-y font-mono text-[12px]`} />
      <div className="flex flex-wrap items-center gap-3">
        <select value={d.repo ?? ""} onChange={(e) => setD({ ...d, repo: e.target.value || undefined })} aria-label={t("quick.scope")}
          className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[12px] text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          <option value="">{t("quick.allRepos")}</option>
          {scopes.map((r) => <option key={r} value={r}>{t("quick.onlyRepo", { name: base(r) })}</option>)}
        </select>
        {d.kind === "shell" && (
          <label className="flex items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={d.enter} onChange={(e) => setD({ ...d, enter: e.target.checked })} className="accent-mustard-500" />{t("quick.enter")}
          </label>
        )}
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={onCancel} className={ghost}>{t("quick.cancel")}</button>
          <button type="button" disabled={!ok} onClick={() => onSave(d)} className={primary}>{t("quick.save")}</button>
        </span>
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t(d.kind === "shell" ? "quick.shellHint" : "quick.agentHint")}</p>
    </div>
  );
}

export default function QuickCommandsSection() {
  const t = useT();
  const list = useQuickCommands();
  const repos = useMemo(() => (typeof window === "undefined" ? [] : openRepos()), []);
  const [editing, setEditing] = useState<Draft | null>(null); // id 있으면 수정, 없으면 새로
  const save = (d: Draft) => {
    const item: QuickCommand = { id: d.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`), name: d.name.trim(), kind: d.kind, text: d.text, enter: d.kind === "shell" ? d.enter : false, ...(d.repo ? { repo: d.repo } : {}) };
    saveQuickCommands(d.id ? list.map((c) => (c.id === d.id ? item : c)) : [...list, item]);
    setEditing(null);
  };
  const examples: Draft[] = [
    { name: t("quick.ex.dev"), kind: "shell", text: "npm run dev", enter: true },
    { name: t("quick.ex.checks"), kind: "shell", text: "gh pr checks", enter: true },
    { name: t("quick.ex.fixTests"), kind: "agent", text: t("quick.ex.fixTestsText"), enter: false },
  ];

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mustard-500/10 text-mustard-600 dark:text-mustard-400"><IconBolt size={16} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{t("quick.title")}</p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("quick.desc")}</p>
          </div>
          {!editing && <button type="button" onClick={() => setEditing({ ...EMPTY })} className={primary}><IconPlus size={13} aria-hidden />{t("quick.add")}</button>}
        </div>
        {editing && !editing.id && <Editor key={editing.name} draft={editing} repos={repos} onSave={save} onCancel={() => setEditing(null)} />}
        {list.length === 0 && !editing ? (
          <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800/70">
            <p className="mb-2 text-[12px] text-zinc-500 dark:text-zinc-400">{t("quick.empty")}</p>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button key={ex.name} type="button" onClick={() => setEditing(ex)}
                  className="flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-0.5 text-[12px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-200">
                  <IconPlus size={11} aria-hidden />{ex.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800/70 dark:border-zinc-800/70">
            {list.map((c) => (
              <li key={c.id}>
                {editing?.id === c.id ? <Editor draft={editing} repos={repos} onSave={save} onCancel={() => setEditing(null)} /> : (
                  <div className="group flex items-center gap-3 px-4 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {c.kind === "shell" ? <IconTerminal2 size={14} aria-hidden /> : <IconSparkles size={14} aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[13px] text-zinc-800 dark:text-zinc-100">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{c.repo ? base(c.repo) : t("quick.allRepos")}</span>
                      </p>
                      <p className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{c.text.split("\n")[0]}{c.kind === "shell" && !c.enter ? " ⋯" : ""}</p>
                    </div>
                    <span className="flex shrink-0 gap-0.5 opacity-60 transition group-hover:opacity-100">
                      <button type="button" onClick={() => setEditing({ ...c })} className={ghost} aria-label={t("quick.edit", { name: c.name })}><IconPencil size={13} aria-hidden /></button>
                      <button type="button" onClick={() => saveQuickCommands(list.filter((x) => x.id !== c.id))} className={ghost} aria-label={t("quick.delete", { name: c.name })}><IconTrash size={13} aria-hidden /></button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="px-1 text-[11px] text-zinc-400 dark:text-zinc-500">{t("quick.howTo")}</p>
    </div>
  );
}

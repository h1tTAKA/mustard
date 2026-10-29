"use client";
// 설정 > 터미널 > 테마(#1215) — 다크 모드용·라이트 모드용을 카드로 고름(카드 = 그 테마 배경 위 프롬프트 한 줄 + 색 8개).
// 목록 = Mustard 내장 3개 + iTerm2-Color-Schemes 878개(public/terminal-themes.json, 이 화면에서만 불러옴 — 없으면 내장만).
import { useEffect, useMemo, useState } from "react";
import { IconSearch, IconCheck } from "@tabler/icons-react";
import { useT, useSetting, setSetting, TKEYS, getTerminalThemePref, resolveTermThemes, unpackTheme, isLightColor, BUILTIN_TERMINAL_THEMES, ANSI_KEYS, type TermTheme } from "@mustard/core";
import { Segmented, SettingRow } from "./settingsControls";

const PAGE = 48;
let catalog: Promise<TermTheme[]> | null = null; // 한 번만 불러옴
function loadCatalog(): Promise<TermTheme[]> {
  catalog ??= fetch("/terminal-themes.json")
    .then((r) => (r.ok ? r.json() : { themes: [] }))
    .then((d: { themes?: unknown[] }) => (Array.isArray(d.themes) ? d.themes.flatMap((p) => { const t = unpackTheme(p); return t ? [t] : []; }) : []))
    .catch(() => []);
  return catalog;
}

function ThemeCard({ theme, selected, onPick }: { theme: TermTheme; selected: boolean; onPick: () => void }) {
  const c = theme.colors;
  return (
    <button type="button" onClick={onPick} aria-pressed={selected} title={theme.name}
      className={`group min-w-0 rounded-xl p-1 text-left transition ${selected ? "ring-2 ring-mustard-600 dark:ring-mustard-400" : "ring-1 ring-zinc-200 hover:ring-zinc-400 dark:ring-zinc-800 dark:hover:ring-zinc-600"}`}>
      <span className="block rounded-lg px-2 py-1.5 font-mono text-[11px] leading-4" style={{ background: c.background, color: c.foreground }}>
        <span style={{ color: c.green }}>$</span> ls <span style={{ color: c.blue }}>src</span>
        <span className="ml-0.5 inline-block h-3 w-1.5 align-middle" style={{ background: c.cursor }} />
        <span className="mt-1 flex gap-0.5" aria-hidden>
          {ANSI_KEYS.slice(0, 8).map((k) => <span key={k} className="size-2 rounded-full" style={{ background: c[k] }} />)}
        </span>
      </span>
      <span className="mt-1 flex items-center gap-1 px-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
        <span className="truncate">{theme.name}</span>
        {selected && <IconCheck size={12} stroke={2.5} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
      </span>
    </button>
  );
}

export default function TerminalThemeSection() {
  const t = useT();
  const storedDark = useSetting<unknown>(TKEYS.themeDark, undefined);
  const storedLight = useSetting<unknown>(TKEYS.themeLight, undefined);
  const storedSep = useSetting<unknown>(TKEYS.themeSeparateLight, undefined);
  const choice = resolveTermThemes(storedDark, storedLight, storedSep, getTerminalThemePref());
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const target = choice.separate ? mode : "dark";
  const current = choice[target];
  const [all, setAll] = useState<TermTheme[]>([...BUILTIN_TERMINAL_THEMES]);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { let live = true; void loadCatalog().then((list) => { if (live) setAll([...BUILTIN_TERMINAL_THEMES, ...list]); }); return () => { live = false; }; }, []);
  useEffect(() => setShown(PAGE), [q, target]);
  // 검색 중이면 전부에서, 아니면 이 모드에 맞는 밝기만(다크용 = 어두운 배경)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((th) => (s ? th.name.toLowerCase().includes(s) : isLightColor(th.colors.background) === (target === "light")));
  }, [all, q, target]);
  const pick = (th: TermTheme) => setSetting(target === "dark" ? TKEYS.themeDark : TKEYS.themeLight, { name: th.name, colors: th.colors });

  return (
    <div className="space-y-3">
      <SettingRow title={t("settings.terminalTheme")} desc={t("settings.termTheme.desc", { name: current.name })}>
        {choice.separate && <Segmented options={["dark", "light"] as const} value={mode} label={t("settings.terminalTheme")} render={(m) => t(`settings.termTheme.${m}`)} onChange={setMode} />}
      </SettingRow>
      <SettingRow title={t("settings.termTheme.separate")} desc={t("settings.termTheme.separateDesc")}>
        <button type="button" role="switch" aria-checked={choice.separate} aria-label={t("settings.termTheme.separate")}
          onClick={() => { setSetting(TKEYS.themeDark, choice.dark); setSetting(TKEYS.themeLight, choice.light); setSetting(TKEYS.themeSeparateLight, !choice.separate); }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${choice.separate ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${choice.separate ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </SettingRow>
      <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
        <IconSearch size={14} className="shrink-0 text-zinc-400" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("settings.termTheme.search", { n: all.length })} aria-label={t("settings.termTheme.search", { n: all.length })}
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50" />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.slice(0, shown).map((th) => <ThemeCard key={th.name} theme={th} selected={th.name === current.name} onPick={() => pick(th)} />)}
      </div>
      {list.length === 0 && <p className="text-center text-xs text-zinc-400">{t("settings.termTheme.none")}</p>}
      {list.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)}
          className="w-full rounded-lg py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          {t("settings.termTheme.more", { n: list.length - shown })}
        </button>
      )}
    </div>
  );
}

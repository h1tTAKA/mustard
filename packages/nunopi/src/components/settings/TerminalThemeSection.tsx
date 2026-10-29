"use client";
// 설정 > 터미널 > 테마(#1215) — 다크 모드용·라이트 모드용을 카드로 고름(카드 = 그 테마 배경 위 프롬프트 한 줄 + 색 8개).
// 목록 = 가져온 테마(맨 앞) + Mustard 내장 3개 + iTerm2-Color-Schemes 878개(public/terminal-themes.json, 이 화면에서만 불러옴 — 없으면 내장만).
// 가져오기 = Ghostty·iTerm2·JSON·Warp YAML 파일(256KB까지), 내보내기 = 지금 테마 JSON.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch, IconCheck, IconUpload, IconDownload, IconX, IconRotate } from "@tabler/icons-react";
import { useT, useToast, useSetting, setSetting, getSetting, TKEYS, getTerminalThemePref, resolveTermThemes, unpackTheme, isLightColor, readStoredTheme, parseThemeFile, addCustomThemes, readOverrides, BUILTIN_TERMINAL_THEMES, ANSI_KEYS, BASE_KEYS, THEME_FILE_MAX, type TermTheme, type TermColorKey } from "@mustard/core";
import { Segmented, SettingRow } from "./settingsControls";

const PAGE = 48;
let catalog: Promise<TermTheme[]> | null = null; // 한 번만 불러옴
function loadCatalog(): Promise<TermTheme[]> {
  catalog ??= fetch("/terminal-themes.json")
    .then((r) => (r.ok ? r.json() : { themes: [] }))
    .then((d: { themes?: unknown[] }) => (Array.isArray(d.themes) ? d.themes.flatMap((p) => { const t = unpackTheme(p); return t ? [t] : []; }) : []))
    .catch(() => { catalog = null; return []; }); // 실패는 기억하지 않음 — 다음에 다시 시도(리뷰)
  return catalog;
}

function ThemeCard({ theme, selected, onPick, onRemove, removeLabel }: { theme: TermTheme; selected: boolean; onPick: () => void; onRemove?: () => void; removeLabel?: string }) {
  const c = theme.colors;
  return (
    <div className="group relative min-w-0">
    {onRemove && (
      <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel}
        className="absolute -right-1.5 -top-1.5 z-10 grid size-5 place-items-center rounded-full bg-zinc-200 text-zinc-600 opacity-0 shadow transition hover:bg-zinc-300 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 dark:bg-zinc-700 dark:text-zinc-200">
        <IconX size={11} stroke={2.5} aria-hidden />
      </button>
    )}
    <button type="button" onClick={onPick} aria-pressed={selected} title={theme.name}
      className={`w-full min-w-0 rounded-xl p-1 text-left transition ${selected ? "ring-2 ring-mustard-600 dark:ring-mustard-400" : "ring-1 ring-zinc-200 hover:ring-zinc-400 dark:ring-zinc-800 dark:hover:ring-zinc-600"}`}>
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
    </div>
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
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const storedCustom = useSetting<unknown>(TKEYS.customThemes, undefined);
  const storedOverDark = useSetting<unknown>(TKEYS.colorOverridesDark, undefined);
  const storedOverLight = useSetting<unknown>(TKEYS.colorOverridesLight, undefined);
  const custom = useMemo(() => (Array.isArray(storedCustom) ? storedCustom.flatMap((v) => { const th = readStoredTheme(v); return th ? [th] : []; }) : []), [storedCustom]);
  const [all, setAll] = useState<TermTheme[]>([...BUILTIN_TERMINAL_THEMES]);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { let live = true; void loadCatalog().then((list) => { if (live) setAll([...BUILTIN_TERMINAL_THEMES, ...list]); }); return () => { live = false; }; }, []);
  useEffect(() => setShown(PAGE), [q, target]);
  // 검색 중이면 전부에서, 아니면 이 모드에 맞는 밝기만(다크용 = 어두운 배경)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const mine = custom.filter((th) => !s || th.name.toLowerCase().includes(s)); // 가져온 테마는 밝기 상관없이 맨 앞
    return { mineCount: mine.length, items: [...mine, ...all.filter((th) => (s ? th.name.toLowerCase().includes(s) : isLightColor(th.colors.background) === (target === "light")))] };
  }, [all, custom, q, target]);
  const importFiles = async (files: FileList | null) => {
    const got: TermTheme[] = [];
    for (const f of Array.from(files ?? [])) {
      if (f.size > THEME_FILE_MAX) { toast(t("settings.termTheme.tooBig", { name: f.name }), "error"); continue; }
      got.push(...parseThemeFile(f.name, await f.text(), isLightColor));
    }
    if (fileRef.current) fileRef.current.value = "";
    if (!got.length) { toast(t("settings.termTheme.importNone"), "error"); return; }
    setSetting(TKEYS.customThemes, addCustomThemes(storedCustom, got));
    pick(got[0]);
    setQ("");
    toast(t("settings.termTheme.imported", { n: got.length, name: got[0].name }));
  };
  const exportCurrent = () => {
    const colors = { ...current.colors, ...readOverrides(target === "dark" ? storedOverDark : storedOverLight) }; // 화면에 보이는 그대로(덮어쓰기 포함, 리뷰)
    const url = URL.createObjectURL(new Blob([JSON.stringify({ name: current.name, colors }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${current.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[.-]+/, "") || "theme"}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const removeCustom = (name: string) => setSetting(TKEYS.customThemes, custom.filter((th) => th.name !== name));
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
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
        <button type="button" onClick={() => fileRef.current?.click()} title={t("settings.termTheme.importHint")}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"><IconUpload size={13} stroke={2} aria-hidden />{t("settings.termTheme.import")}</button>
        <button type="button" onClick={exportCurrent}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"><IconDownload size={13} stroke={2} aria-hidden />{t("settings.termTheme.export")}</button>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("settings.termTheme.importHint")}</span>
      </div>
      <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
        <IconSearch size={14} className="shrink-0 text-zinc-400" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("settings.termTheme.search", { n: all.length })} aria-label={t("settings.termTheme.search", { n: all.length })}
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50" />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.items.slice(0, shown).map((th, i) => {
          const mine = i < list.mineCount;
          return <ThemeCard key={`${mine ? "c" : "b"}:${th.name}`} theme={th} selected={th.name === current.name} onPick={() => pick(th)} onRemove={mine ? () => removeCustom(th.name) : undefined} removeLabel={t("settings.termTheme.remove", { name: th.name })} />;
        })}
      </div>
      {list.items.length === 0 && <p className="text-center text-xs text-zinc-400">{t("settings.termTheme.none")}</p>}
      {list.items.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)}
          className="w-full rounded-lg py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          {t("settings.termTheme.more", { n: list.items.length - shown })}
        </button>
      )}
      <ColorOverrides theme={current} slot={target} />
    </div>
  );
}

// 색 하나씩 덮어쓰기(#1215) — 지금 탭(다크용·라이트용) 테마 위에. 테마를 바꿔도 남고, 하나씩·전부 되돌리기.
const GROUPS: { k: string; keys: readonly TermColorKey[] }[] = [{ k: "base", keys: BASE_KEYS }, { k: "normal", keys: ANSI_KEYS.slice(0, 8) }, { k: "bright", keys: ANSI_KEYS.slice(8) }];
function ColorOverrides({ theme, slot }: { theme: TermTheme; slot: "dark" | "light" }) {
  const t = useT();
  const key = slot === "dark" ? TKEYS.colorOverridesDark : TKEYS.colorOverridesLight;
  const over = readOverrides(useSetting<unknown>(key, undefined));
  const count = Object.keys(over).length;
  const set = (k: TermColorKey, v: string | null) => { const next = { ...readOverrides(getSetting<unknown>(key, undefined)) }; if (v) next[k] = v; else delete next[k]; setSetting(key, next); };
  // 색 고르기 창을 끄는 동안 값이 연달아 오므로, 화면은 바로 바꾸고 저장은 멈춘 뒤 한 번(리뷰)
  const [draft, setDraft] = useState<Partial<Record<TermColorKey, string>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Partial<Record<TermColorKey, string>>>({});
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const drag = (k: TermColorKey, v: string) => {
    pending.current = { ...pending.current, [k]: v };
    setDraft(pending.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const d = pending.current;
      pending.current = {};
      for (const [dk, dv] of Object.entries(d)) set(dk as TermColorKey, dv);
      setDraft({});
    }, 150);
  };
  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <span>{t("settings.termTheme.overrides")}{count > 0 && <span className="ml-1.5 text-xs font-normal text-zinc-400">{t("settings.termTheme.overridesCount", { n: count })}</span>}</span>
        {count > 0 && <button type="button" onClick={(e) => { e.preventDefault(); setSetting(key, {}); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-normal text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconRotate size={12} stroke={2} aria-hidden />{t("settings.termTheme.overridesReset")}</button>}
      </summary>
      <div className="space-y-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.termTheme.overridesDesc", { name: theme.name })}</p>
        {GROUPS.map((g) => (
          <div key={g.k} className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t(`settings.termTheme.group.${g.k}`)}</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
              {g.keys.map((k) => {
                const v = draft[k] ?? over[k] ?? theme.colors[k] ?? theme.colors.foreground;
                const label = t(`settings.termTheme.color.${k}`);
                return (
                  <label key={k} className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    <input type="color" value={v} onChange={(e) => drag(k, e.target.value)} aria-label={label} className="size-6 shrink-0 cursor-pointer rounded border border-zinc-200 bg-transparent p-0 dark:border-zinc-700" />
                    <span className={`truncate ${over[k] ? "font-semibold" : ""}`}>{label}</span>
                    {over[k] && <button type="button" onClick={(e) => { e.preventDefault(); set(k, null); }} aria-label={t("settings.termTheme.overrideUndo", { name: label })} className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><IconRotate size={11} stroke={2} aria-hidden /></button>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

"use client";
// 설정 > 단축키(#1027) — 레지스트리(@mustard/core shortcuts) 목록 + 키 녹화로 변경 + 충돌 경고 + 기본값·끄기.
// 녹화 중엔 setShortcutRecording(true)로 앱 단축키 실행을 멈추고, 이 창이 keydown을 capture로 먼저 받아 가로챔.
import { useEffect, useMemo, useState } from "react";
import { IconKeyboard, IconRotate } from "@tabler/icons-react";
import {
  useT, useSetting, setSetting, SHORTCUTS, SHORTCUT_OVERRIDES_KEY, bindingsOf, chordFromEvent, findConflicts, formatChord,
  setShortcutRecording, type ShortcutDef, type ShortcutGroup, type ShortcutOverrides,
} from "@mustard/core";

const GROUPS: ShortcutGroup[] = ["general", "tabs", "repos", "panels", "terminal", "view"];
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export default function ShortcutsSection() {
  const t = useT();
  const overrides = useSetting<ShortcutOverrides>(SHORTCUT_OVERRIDES_KEY, {});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "changed" | "conflict">("all"); // #1200 전체 / 바꾼 것 / 충돌
  const [recording, setRecording] = useState<string | null>(null); // 녹화 중인 동작 id
  const mac = isMac();
  const label = (d: ShortcutDef) => t(d.labelKey, { n: d.arg ?? 0 });
  const conflicts = useMemo(() => findConflicts(overrides), [overrides]);

  const save = (id: string, chords: string[] | null) => {
    const next = { ...overrides };
    if (chords === null) delete next[id]; else next[id] = chords; // null = 기본값으로
    setSetting(SHORTCUT_OVERRIDES_KEY, next);
  };

  // 녹화 — 다음 키 조합을 그 동작의 단축키로. Esc 취소. 수식키 없는 키는 무시(입력·셸과 충돌).
  useEffect(() => {
    if (!recording) return;
    setShortcutRecording(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setRecording(null); return; }
      const chord = chordFromEvent(e, mac);
      if (!chord) return; // 수식키만/모르는 키 → 계속 대기
      save(recording, [chord]);
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); setShortcutRecording(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 녹화 시작/종료에만
  }, [recording]);

  const ql = q.trim().toLowerCase();
  const changedIds = new Set(Object.keys(overrides)), clashIds = new Set(conflicts.flatMap((c) => c.ids));
  const counts = { all: SHORTCUTS.length, changed: SHORTCUTS.filter((d) => changedIds.has(d.id)).length, conflict: SHORTCUTS.filter((d) => clashIds.has(d.id)).length };
  const visible = SHORTCUTS.filter((d) => (filter === "all" || (filter === "changed" ? changedIds : clashIds).has(d.id)) && (!ql || label(d).toLowerCase().includes(ql) || bindingsOf(d, overrides).some((c) => formatChord(c, mac).toLowerCase().includes(ql))));
  const nameOf = (id: string) => { const d = SHORTCUTS.find((x) => x.id === id); return d ? label(d) : id; };
  const btn = "rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

  return (
    <section id="set-shortcuts" className="scroll-mt-4 space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.shortcutsDesc")}</p>
      <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("settings.shortcutsSearch")}
        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
      <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900" role="radiogroup" aria-label={t("settings.shortcutsFilter")}>
        {(["all", "changed", "conflict"] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${filter === f ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
            {t(`settings.shortcutsFilter.${f}`)} <span className={`tabular-nums ${f === "conflict" && counts.conflict ? "text-amber-600 dark:text-amber-500" : "text-zinc-400"}`}>{counts[f]}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 && <p className="px-2 py-3 text-[12px] text-zinc-400 dark:text-zinc-500">{t("settings.shortcutsEmpty")}</p>}
      {GROUPS.map((g) => {
        const rows = visible.filter((d) => d.group === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="space-y-1">
            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t(`shortcut.group.${g}`)}</div>
            {rows.map((d) => {
              const chords = bindingsOf(d, overrides);
              const custom = d.id in overrides;
              const off = custom && overrides[d.id].length === 0;
              const clash = conflicts.find((c) => c.ids.includes(d.id));
              return (
                <div key={d.id} className="group rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-300">{label(d)}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {custom && <button type="button" onClick={() => save(d.id, null)} className={btn} title={t("settings.shortcutsReset")} aria-label={t("settings.shortcutsReset")}><IconRotate size={12} stroke={2} aria-hidden /></button>}
                      {!off && <button type="button" onClick={() => save(d.id, [])} className={`${btn} opacity-0 group-hover:opacity-100 focus:opacity-100`}>{t("settings.shortcutsDisable")}</button>}
                      <button type="button" onClick={() => setRecording(recording === d.id ? null : d.id)} aria-label={t("settings.shortcutsRecordFor", { action: label(d) })}
                        className={`inline-flex min-w-[64px] items-center justify-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[12px] ${recording === d.id ? "border-mustard-500 text-mustard-700 dark:text-mustard-400" : "border-zinc-200 text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-200"}`}>
                        {recording === d.id ? <><IconKeyboard size={12} stroke={2} aria-hidden /> {t("settings.shortcutsPress")}</>
                          : chords.length ? chords.map((c) => formatChord(c, mac)).join("  ") : <span className="text-zinc-400">{t("settings.shortcutsNone")}</span>}
                      </button>
                    </div>
                  </div>
                  {clash && <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-500">{t("settings.shortcutsConflict", { chord: formatChord(clash.chord, mac), other: clash.ids.filter((x) => x !== d.id).map(nameOf).join(", ") })}</p>}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

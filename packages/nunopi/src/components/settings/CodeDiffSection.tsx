"use client";
// 설정 > 코드·diff(#1218) — diff 보기·접기·줄바꿈·공백·코드 글꼴·gitignore 파일. 기본값 = 그 전 화면 그대로.
import { useState } from "react";
import { useT, useSetting, setSetting, EKEYS, EDITOR_DEFAULTS, type DiffView } from "@mustard/core";
import { SettingRow, Segmented, Stepper } from "./settingsControls";
import { listMonospaceFonts } from "./localFonts";

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function CodeDiffSection() {
  const t = useT();
  const view = useSetting<DiffView>(EKEYS.diffView, EDITOR_DEFAULTS.diffView);
  const fold = useSetting<boolean>(EKEYS.diffFold, EDITOR_DEFAULTS.diffFold);
  const ctx = useSetting<number>(EKEYS.diffFoldContext, EDITOR_DEFAULTS.diffFoldContext);
  const wrap = useSetting<boolean>(EKEYS.wordWrap, EDITOR_DEFAULTS.wordWrap);
  const ws = useSetting<boolean>(EKEYS.showWhitespace, EDITOR_DEFAULTS.showWhitespace);
  const family = useSetting<string>(EKEYS.fontFamily, EDITOR_DEFAULTS.fontFamily);
  const size = useSetting<number>(EKEYS.fontSize, EDITOR_DEFAULTS.fontSize);
  const ignored = useSetting<boolean>(EKEYS.showIgnored, EDITOR_DEFAULTS.showIgnored);
  const [fontList, setFontList] = useState<string[]>([]);
  return (
    <section id="set-code" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <SettingRow title={t("codeDiff.diffView")} desc={t("codeDiff.diffViewDesc")}>
        <Segmented options={["unified", "split"] as const} value={view} label={t("codeDiff.diffView")} render={(o) => t(`codeDiff.diffView.${o}`)} onChange={(o) => setSetting(EKEYS.diffView, o)} />
      </SettingRow>
      <SettingRow title={t("codeDiff.fold")} desc={t("codeDiff.foldDesc")}>
        <Switch on={fold} label={t("codeDiff.fold")} onChange={(v) => setSetting(EKEYS.diffFold, v)} />
      </SettingRow>
      {fold && (
        <SettingRow title={t("codeDiff.foldContext")}>
          <Stepper value={ctx} min={1} max={20} step={1} label={t("codeDiff.foldContext")} format={(v) => String(v)} onChange={(v) => setSetting(EKEYS.diffFoldContext, v)} />
        </SettingRow>
      )}
      <SettingRow title={t("codeDiff.wordWrap")} desc={t("codeDiff.wordWrapDesc")}>
        <Switch on={wrap} label={t("codeDiff.wordWrap")} onChange={(v) => setSetting(EKEYS.wordWrap, v)} />
      </SettingRow>
      <SettingRow title={t("codeDiff.showWhitespace")} desc={t("codeDiff.showWhitespaceDesc")}>
        <Switch on={ws} label={t("codeDiff.showWhitespace")} onChange={(v) => setSetting(EKEYS.showWhitespace, v)} />
      </SettingRow>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("codeDiff.fontFamily")}</span>
        <input type="text" value={family} onChange={(e) => setSetting(EKEYS.fontFamily, e.target.value)} placeholder="SF Mono, JetBrains Mono, monospace" list="mustard-code-fonts" spellCheck={false}
          onFocus={() => { if (!fontList.length) void listMonospaceFonts().then(setFontList); }}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
        {/* 터미널 글꼴 칸과 같게 — 마지막 쉼표 뒤만 채움 */}
        <datalist id="mustard-code-fonts">{fontList.map((f) => { const head = family.slice(0, family.lastIndexOf(",") + 1).replace(/,\s*$/, ", "); return <option key={f} value={`${head}${/^[\w -]+$/.test(f) && !/^\d/.test(f) ? f : `"${f.replace(/"/g, "")}"`}`} />; })}</datalist>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("codeDiff.fontFamilyDesc")}</p>
      </label>
      <SettingRow title={t("codeDiff.fontSize")} desc={t("codeDiff.fontSizeDesc")}>
        <Stepper value={size} min={9} max={24} step={1} label={t("codeDiff.fontSize")} format={(v) => `${v}px`} onChange={(v) => setSetting(EKEYS.fontSize, v)} />
      </SettingRow>
      <SettingRow title={t("codeDiff.showIgnored")} desc={t("codeDiff.showIgnoredDesc")}>
        <Switch on={ignored} label={t("codeDiff.showIgnored")} onChange={(v) => setSetting(EKEYS.showIgnored, v)} />
      </SettingRow>
    </section>
  );
}

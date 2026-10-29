"use client";
// 설정 > 터미널 > 렌더링(#1214) — GPU 자동/켜짐/끄기(새 탭부터), 최소 색상 대비 자동/끄기/직접, 글자 굵기 2개, 여백 가로·세로, 커서 투명도, 타이핑 중 마우스 숨기기(열린 탭 바로).
import { useT, useSetting, setSetting, TKEYS, TERMINAL_DEFAULTS, readGpuMode, GPU_MODES, readFontWeight, readPadding } from "@mustard/core";
import { Segmented, SettingRow, Stepper } from "./settingsControls";

const CONTRAST_MODES = ["auto", "off", "custom"] as const;

export default function TerminalRenderSection() {
  const t = useT();
  const gpu = readGpuMode(useSetting<unknown>(TKEYS.gpuMode, undefined), useSetting<unknown>(TKEYS.gpu, undefined));
  const contrast = useSetting<"auto" | number>(TKEYS.minContrast, TERMINAL_DEFAULTS.minContrast);
  const weight = readFontWeight(useSetting<unknown>(TKEYS.fontWeight, undefined), TERMINAL_DEFAULTS.fontWeight);
  const weightBold = readFontWeight(useSetting<unknown>(TKEYS.fontWeightBold, undefined), TERMINAL_DEFAULTS.fontWeightBold);
  const padX = readPadding(useSetting<unknown>(TKEYS.paddingX, undefined), TERMINAL_DEFAULTS.paddingX);
  const padY = readPadding(useSetting<unknown>(TKEYS.paddingY, undefined), TERMINAL_DEFAULTS.paddingY);
  const cursorOpacity = useSetting<number>(TKEYS.cursorOpacity, TERMINAL_DEFAULTS.cursorOpacity);
  const hideMouse = useSetting<boolean>(TKEYS.hideMouseWhileTyping, TERMINAL_DEFAULTS.hideMouseWhileTyping);
  const rows = [
    { k: "fontWeight", key: TKEYS.fontWeight, v: weight, min: 100, max: 900, step: 100, fmt: (v: number) => String(v) },
    { k: "fontWeightBold", key: TKEYS.fontWeightBold, v: weightBold, min: 100, max: 900, step: 100, fmt: (v: number) => String(v) },
    { k: "paddingX", key: TKEYS.paddingX, v: padX, min: 0, max: 40, step: 2, fmt: (v: number) => `${v}px` },
    { k: "paddingY", key: TKEYS.paddingY, v: padY, min: 0, max: 40, step: 2, fmt: (v: number) => `${v}px` },
    { k: "cursorOpacity", key: TKEYS.cursorOpacity, v: typeof cursorOpacity === "number" && Number.isFinite(cursorOpacity) ? Math.min(1, Math.max(0.1, cursorOpacity)) : 1, min: 0.1, max: 1, step: 0.1, fmt: (v: number) => `${Math.round(v * 100)}%` },
  ] as const;
  const cMode = typeof contrast !== "number" ? "auto" : contrast <= 1 ? "off" : "custom";
  return (
    <>
      <SettingRow title={t("settings.terminalGpu")} desc={t("settings.gpuDesc")}>
        <Segmented options={GPU_MODES} value={gpu} label={t("settings.terminalGpu")} render={(m) => t(`settings.gpuMode.${m}`)} onChange={(m) => setSetting(TKEYS.gpuMode, m)} />
      </SettingRow>
      <div className="space-y-2">
        <SettingRow title={t("settings.minContrast")} desc={t("settings.minContrastDesc")}>
          <Segmented options={CONTRAST_MODES} value={cMode} label={t("settings.minContrast")} render={(m) => t(`settings.minContrastMode.${m}`)}
            onChange={(m) => setSetting(TKEYS.minContrast, m === "auto" ? "auto" : m === "off" ? 1 : 4.5)} />
        </SettingRow>
        {cMode === "custom" && typeof contrast === "number" && (
          <div className="flex justify-end">
            <Stepper value={Math.min(21, Math.max(1.5, contrast))} min={1.5} max={21} step={0.5} label={t("settings.minContrast")} format={(v) => `${v}:1`} onChange={(v) => setSetting(TKEYS.minContrast, v)} />
          </div>
        )}
      </div>
      {/* 글자 굵기·여백 — 스크롤 속도처럼 줄마다 − 값 + */}
      <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0"><span className="block text-sm text-zinc-700 dark:text-zinc-300">{t(`settings.render.${r.k}`)}</span><span className="block text-xs text-zinc-400 dark:text-zinc-500">{t(`settings.render.${r.k}Desc`)}</span></span>
            <Stepper value={r.v} min={r.min} max={r.max} step={r.step} label={t(`settings.render.${r.k}`)} format={r.fmt} onChange={(v) => setSetting(r.key, v)} />
          </div>
        ))}
      </div>
      <SettingRow title={t("settings.render.hideMouse")} desc={t("settings.render.hideMouseDesc")}>
        <button type="button" role="switch" aria-checked={hideMouse} aria-label={t("settings.render.hideMouse")}
          onClick={() => setSetting(TKEYS.hideMouseWhileTyping, !hideMouse)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${hideMouse ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${hideMouse ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </SettingRow>
    </>
  );
}

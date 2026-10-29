"use client";
// 설정 > 터미널 > 렌더링(#1214) — GPU 자동/켜짐/끄기(새 탭부터), 최소 색상 대비 자동/끄기/직접(열린 탭 바로).
import { useT, useSetting, setSetting, TKEYS, TERMINAL_DEFAULTS, readGpuMode, GPU_MODES } from "@mustard/core";
import { Segmented, SettingRow, Stepper } from "./settingsControls";

const CONTRAST_MODES = ["auto", "off", "custom"] as const;

export default function TerminalRenderSection() {
  const t = useT();
  const gpu = readGpuMode(useSetting<unknown>(TKEYS.gpuMode, undefined), useSetting<unknown>(TKEYS.gpu, undefined));
  const contrast = useSetting<"auto" | number>(TKEYS.minContrast, TERMINAL_DEFAULTS.minContrast);
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
            <Stepper value={contrast} min={1.5} max={21} step={0.5} label={t("settings.minContrast")} format={(v) => `${v}:1`} onChange={(v) => setSetting(TKEYS.minContrast, v)} />
          </div>
        )}
      </div>
    </>
  );
}

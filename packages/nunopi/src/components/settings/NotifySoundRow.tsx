"use client";
// 설정 > 알림 > 소리(#1217) — OS 기본 / 없음 / 맥 시스템 소리 고르기 + 미리 듣기 + 크기. 옛 "무음" 스위치를 흡수(켜져 있었으면 "없음"으로 보임).
import { IconPlayerPlay } from "@tabler/icons-react";
import { useT, useSetting, setSetting, NKEYS, NOTIF_SOUNDS, notifSound } from "@mustard/core";
import { SettingRow, Stepper } from "./settingsControls";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const select = "min-w-0 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const preview = (name: string, volume: number) => (window.nunopiDesktop as unknown as { notifySound?: (n: string, v: number) => Promise<unknown> } | undefined)?.notifySound?.(name, volume);

export default function NotifySoundRow() {
  const t = useT();
  useSetting<unknown>(NKEYS.sound, undefined); useSetting<unknown>(NKEYS.silent, undefined); useSetting<unknown>(NKEYS.volume, undefined); // 바뀌면 다시 그림
  const { sound, volume } = notifSound();
  const named = sound !== "default" && sound !== "none";
  const pick = (v: string) => { setSetting(NKEYS.sound, v); if (v !== "default" && v !== "none") void preview(v, volume); };
  return (
    <>
      <SettingRow title={t("settings.notifSound")} desc={t("settings.notifSoundDesc")}>
        <div className="flex shrink-0 items-center gap-1.5">
          <select value={sound} onChange={(e) => pick(e.target.value)} aria-label={t("settings.notifSound")} className={select}>
            <option value="default">{t("settings.notifSound.default")}</option>
            <option value="none">{t("settings.notifSound.none")}</option>
            {isMac && NOTIF_SOUNDS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {named && (
            <button type="button" onClick={() => void preview(sound, volume)} title={t("settings.notifSoundPreview")} aria-label={t("settings.notifSoundPreview")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <IconPlayerPlay size={13} stroke={2} aria-hidden />
            </button>
          )}
        </div>
      </SettingRow>
      {named && (
        <SettingRow title={t("settings.notifVolume")}>
          <Stepper value={volume} min={0} max={100} step={10} label={t("settings.notifVolume")} format={(v) => `${v}%`} onChange={(v) => { setSetting(NKEYS.volume, v); void preview(sound, v); }} />
        </SettingRow>
      )}
    </>
  );
}

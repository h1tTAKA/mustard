"use client";

// 데스크톱 알림 wrapper(#939) — 마스터 스위치 게이트 + silent 주입.
// 호출부는 window.nunopiDesktop.notify 대신 이걸 쓴다(테스트 버튼은 마스터 우회 위해 직접 호출 유지).
import { getSetting, NKEYS, NOTIF_DEFAULTS, NOTIF_SOUNDS } from "./settings";

// target(#989): 클릭 시 이동할 레포·터미널 세션.
export type NotifyPayload = { title: string; body?: string; suppressWhileFocused?: boolean; silent?: boolean; sound?: string; volume?: number; target?: { repoPath: string; sessionId?: string } };
type NotifyResult = { ok: boolean; reason?: string };
type DesktopNotify = { nunopiDesktop?: { notify?: (p: NotifyPayload) => Promise<NotifyResult> } };

// #1217 지금 알림 소리 — 저장값이 이상하면 옛 무음 스위치로(켜져 있으면 "none", 아니면 OS 기본)
export function notifSound(): { sound: string; volume: number } {
  const s = getSetting<unknown>(NKEYS.sound, undefined);
  const sound = typeof s === "string" && (s === "default" || s === "none" || (NOTIF_SOUNDS as readonly string[]).includes(s)) ? s : getSetting<boolean>(NKEYS.silent, NOTIF_DEFAULTS.silent) ? "none" : "default";
  const v = Number(getSetting<unknown>(NKEYS.volume, NOTIF_DEFAULTS.volume));
  return { sound, volume: Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : NOTIF_DEFAULTS.volume };
}

export async function desktopNotify(payload: NotifyPayload): Promise<NotifyResult> {
  // 마스터 꺼져 있으면 아예 안 보냄.
  if (!getSetting<boolean>(NKEYS.master, NOTIF_DEFAULTS.master)) return { ok: false, reason: "disabled" };
  if (typeof window === "undefined") return { ok: false, reason: "no-window" };
  const nd = (window as unknown as DesktopNotify).nunopiDesktop;
  if (!nd?.notify) return { ok: false, reason: "no-desktop" };
  // silent 미지정 시 설정의 소리(#1217) — 무음이면 silent, 고른 소리면 main이 재생
  const { sound, volume } = notifSound();
  return nd.notify({ ...payload, silent: payload.silent ?? sound === "none", sound, volume });
}

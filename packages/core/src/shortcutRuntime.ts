"use client";
// 단축키 실행기(#1027) — 앱 전체 keydown(capture) 하나 → 조합 → 레지스트리 동작 → 등록된 핸들러.
// 핸들러는 각 화면(레포 탭·터미널 탭·패널·팔레트)이 useShortcut으로 등록. 여러 개면 나중 등록 우선, false를 돌려주면
// "내 일 아님"(비활성 레포 등)으로 다음 핸들러에 넘김. 처리되면 preventDefault+stopPropagation → 터미널(xterm)·셸로 안 감.
// 글자 크기·앱 확대는 화면 상관없이 여기서 직접 처리(설정 저장 + 적용).
import { useEffect, useRef } from "react";
import { getSetting, setSetting, useSetting, TKEYS, TERMINAL_DEFAULTS, APKEYS, APPEARANCE_DEFAULTS } from "./settings";
import { applyUiZoom } from "./appearance";
import { SHORTCUTS, bindingsOf, chordFromEvent, formatChord, matchShortcut, terminalKeepsChord, type ShortcutDef, type ShortcutOverrides } from "./shortcuts";

export const SHORTCUT_OVERRIDES_KEY = "shortcuts.overrides";
export type ShortcutHandler = (def: ShortcutDef) => boolean | void;

const handlers = new Map<string, ShortcutHandler[]>();
let recording = false; // 설정 화면에서 키 녹화 중이면 단축키 실행 안 함
export function setShortcutRecording(on: boolean) { recording = on; }

export function registerShortcut(ids: string[], h: ShortcutHandler): () => void {
  for (const id of ids) handlers.set(id, [...(handlers.get(id) ?? []), h]);
  return () => { for (const id of ids) handlers.set(id, (handlers.get(id) ?? []).filter((x) => x !== h)); };
}

// 컴포넌트용 — 최신 핸들러를 ref로 들고 한 번만 등록(렌더마다 재등록 X).
export function useShortcut(ids: string[], handler: ShortcutHandler) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  const key = ids.join("|");
  useEffect(() => registerShortcut(key.split("|"), (d) => ref.current(d)), [key]);
}

// 힌트(#1029) — 팔레트·툴팁에 붙일 유효 단축키(사용자 덮어쓰기 반영) 첫 조합. 없거나 껐으면 "". 설정 바뀌면 즉시 반영.
function hintOf(id: string, overrides: ShortcutOverrides): string {
  const def = SHORTCUTS.find((d) => d.id === id);
  const first = def ? bindingsOf(def, overrides)[0] : undefined;
  return first ? formatChord(first, isMac()) : "";
}
export function useShortcutHint(id: string): string {
  return hintOf(id, useSetting<ShortcutOverrides>(SHORTCUT_OVERRIDES_KEY, {}));
}
// 렌더 밖(이펙트·목록 생성)용 — 그 순간의 설정으로.
export const shortcutHint = (id: string) => hintOf(id, getSetting<ShortcutOverrides>(SHORTCUT_OVERRIDES_KEY, {}));
export const withShortcutHint = (label: string, hint: string) => (hint ? `${label} (${hint})` : label);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function builtin(def: ShortcutDef): boolean {
  const font = (n: number) => setSetting(TKEYS.fontSize, clamp(n, 8, 32));
  // 앱 확대 범위·단위는 설정 화면(0.8~1.4, 0.1 단위)과 같게.
  const zoom = (f: number) => { const z = Math.round(clamp(f, 0.8, 1.4) * 10) / 10; setSetting(APKEYS.uiZoom, z); applyUiZoom(z); };
  const curFont = getSetting<number>(TKEYS.fontSize, TERMINAL_DEFAULTS.fontSize);
  const curZoom = getSetting<number>(APKEYS.uiZoom, APPEARANCE_DEFAULTS.uiZoom);
  switch (def.id) {
    case "term.fontUp": font(curFont + 1); return true;
    case "term.fontDown": font(curFont - 1); return true;
    case "term.fontReset": font(TERMINAL_DEFAULTS.fontSize); return true;
    case "ui.zoomIn": zoom(curZoom + 0.1); return true;
    case "ui.zoomOut": zoom(curZoom - 0.1); return true;
    case "ui.zoomReset": zoom(APPEARANCE_DEFAULTS.uiZoom); return true;
  }
  return false;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

let installed = 0;
function onKey(e: KeyboardEvent) {
  if (recording || e.isComposing) return; // 한글 조합 중 키는 건드리지 않음
  const chord = chordFromEvent(e, isMac());
  if (!chord) return;
  const inTerminal = !!(e.target as Element | null)?.closest?.(".xterm");
  if (inTerminal && getSetting<string>(TKEYS.shortcutPriority, TERMINAL_DEFAULTS.shortcutPriority) === "terminal" && terminalKeepsChord(chord, isMac())) return; // #1224 터미널 먼저
  const def = matchShortcut(chord, inTerminal, getSetting<ShortcutOverrides>(SHORTCUT_OVERRIDES_KEY, {}));
  if (!def) return;
  let handled = builtin(def);
  if (!handled) {
    const list = handlers.get(def.id) ?? [];
    for (let i = list.length - 1; i >= 0; i--) { if (list[i](def) !== false) { handled = true; break; } }
  }
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

// 앱 루트에서 한 번 — 여러 번 불려도 리스너는 하나(참조 카운트).
export function installShortcutDispatcher(): () => void {
  if (typeof window === "undefined") return () => {};
  if (installed++ === 0) window.addEventListener("keydown", onKey, true);
  return () => { if (--installed === 0) window.removeEventListener("keydown", onKey, true); };
}

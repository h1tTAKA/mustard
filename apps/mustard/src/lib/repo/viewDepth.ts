"use client";
// 흐름 설명 보기 깊이(#1322) — "이 아키텍처 이해하기" 설명을 초보/개발자/숙련자로. 보는 사람 각자 설정이라 localStorage.
// 같은 창 안 다른 컴포넌트에도 바로 퍼지게 커스텀 이벤트로 알림.
import { useCallback, useSyncExternalStore } from "react";
export type ViewDepth = "beginner" | "dev" | "expert";
export const DEPTHS: ViewDepth[] = ["beginner", "dev", "expert"];

const KEY = "mustard:viewDepth", EV = "mustard:viewDepth";
// 안 골랐으면 null → 초보(지금까지 보던 기본 설명). 리뷰: 기본값이 기존 화면을 바꾸지 않게.
const read = (): ViewDepth | null => {
  try { const v = localStorage.getItem(KEY); if (v && (DEPTHS as string[]).includes(v)) return v as ViewDepth; } catch { /* 저장소 막힘 → 기본 */ }
  return null;
};
const subscribe = (cb: () => void) => {
  window.addEventListener(EV, cb); window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EV, cb); window.removeEventListener("storage", cb); };
};

export function useViewDepth(): [ViewDepth | null, (d: ViewDepth) => void] {
  const depth = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((d: ViewDepth) => {
    try { localStorage.setItem(KEY, d); } catch { /* 저장 못 해도 이번 화면엔 반영 안 됨 — 무시 */ }
    window.dispatchEvent(new Event(EV));
  }, []);
  return [depth, set];
}

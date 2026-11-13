"use client";
// 보기 깊이 공통 설정(#1322) — 그래프 모달·흐름 패널이 같은 값을 봄. 보는 사람 각자 설정이라 localStorage.
// 같은 창 안 다른 컴포넌트에도 바로 퍼지게 커스텀 이벤트로 알림.
import { useCallback, useSyncExternalStore } from "react";
import { DEPTHS, type ViewDepth } from "./graphView";

const KEY = "mustard:viewDepth", EV = "mustard:viewDepth";
const read = (): ViewDepth => {
  try { const v = localStorage.getItem(KEY); if (v && (DEPTHS as string[]).includes(v)) return v as ViewDepth; } catch { /* 저장소 막힘 → 기본 */ }
  return "dev";
};
const subscribe = (cb: () => void) => {
  window.addEventListener(EV, cb); window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EV, cb); window.removeEventListener("storage", cb); };
};

export function useViewDepth(): [ViewDepth, (d: ViewDepth) => void] {
  const depth = useSyncExternalStore(subscribe, read, () => "dev" as ViewDepth);
  const set = useCallback((d: ViewDepth) => {
    try { localStorage.setItem(KEY, d); } catch { /* 저장 못 해도 이번 화면엔 반영 안 됨 — 무시 */ }
    window.dispatchEvent(new Event(EV));
  }, []);
  return [depth, set];
}

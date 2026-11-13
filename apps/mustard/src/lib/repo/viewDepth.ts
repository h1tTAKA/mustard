"use client";
// 보기 깊이 공통 설정(#1322) — 그래프 모달·흐름 패널이 같은 값을 봄. 보는 사람 각자 설정이라 localStorage.
// 같은 창 안 다른 컴포넌트에도 바로 퍼지게 커스텀 이벤트로 알림.
import { useCallback, useSyncExternalStore } from "react";
import { DEPTHS, type ViewDepth } from "./graphView";

const KEY = "mustard:viewDepth", EV = "mustard:viewDepth";
// 안 골랐으면 null — 화면마다 예전 모습을 기본으로(그래프=전부 보임, 흐름 설명=초보용 기본). 리뷰: 기본값이 기존 화면을 바꾸지 않게.
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

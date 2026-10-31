"use client";
// #1218 코드 글꼴 설정 — 파일 보기·diff·캐치업 diff 공용. 비우면 --font-mono, delta = 그 화면의 원래 크기 차이(diff −1, 캐치업 −1.5).
import type { CSSProperties } from "react";
import { useSetting, EKEYS, EDITOR_DEFAULTS } from "@mustard/core";

export function useCodeFont(delta = 0): CSSProperties {
  const family = useSetting<string>(EKEYS.fontFamily, EDITOR_DEFAULTS.fontFamily);
  const size = useSetting<number>(EKEYS.fontSize, EDITOR_DEFAULTS.fontSize);
  // 없는 글꼴·오타면 뒤의 기본 고정폭으로, CSS 문법에 안 맞는 값(따옴표 없는 숫자 시작 이름 등)은 통째로 무시돼 UI 글꼴이 되니 기본만(리뷰)
  const f = family.trim(), ok = !!f && typeof CSS !== "undefined" && CSS.supports("font-family", `${f}, monospace`); // 뒤에 붙인 채로 검사 — inherit 같은 전역 키워드도 거름(리뷰)
  return { fontFamily: ok ? `${f}, var(--font-mono)` : "var(--font-mono)", fontSize: size + delta };
}

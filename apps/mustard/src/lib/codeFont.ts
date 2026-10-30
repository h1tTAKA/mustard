"use client";
// #1218 코드 글꼴 설정 — 파일 보기·diff·캐치업 diff 공용. 비우면 --font-mono, delta = 그 화면의 원래 크기 차이(diff −1, 캐치업 −1.5).
import type { CSSProperties } from "react";
import { useSetting, EKEYS, EDITOR_DEFAULTS } from "@mustard/core";

export function useCodeFont(delta = 0): CSSProperties {
  const family = useSetting<string>(EKEYS.fontFamily, EDITOR_DEFAULTS.fontFamily);
  const size = useSetting<number>(EKEYS.fontSize, EDITOR_DEFAULTS.fontSize);
  return { fontFamily: family.trim() || "var(--font-mono)", fontSize: size + delta };
}

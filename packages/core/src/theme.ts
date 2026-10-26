// 멀티 테마(#914) — orca식 토큰 블록 방식. 각 테마는 name + base(light/dark)를 가진다.
// base=dark면 <html>.dark 세팅(기존 dark: 유틸·.dark .nunopi-* 규칙 그대로 작동),
// data-theme=<id>가 globals.css의 [data-theme] 블록을 골라 팔레트(zinc/white/bg/fg)를 재색조.
// Dark/Light는 기존 두 팔레트라 CSS 블록 없이 .dark 유무로만 갈린다.

export type ThemeId =
  | "dark"
  | "light"
  | "sepia"
  | "midnight"
  | "nord"
  | "solarized-light"
  | "solarized-dark";

export const THEME_KEY = "nunopi:theme";

export interface ThemeMeta {
  id: ThemeId;
  labelKey: string; // i18n 키
  base: "light" | "dark";
}

// 피커·검증에 쓰는 순서 있는 목록.
export const THEMES: ThemeMeta[] = [
  { id: "dark", labelKey: "theme.dark", base: "dark" },
  { id: "light", labelKey: "theme.light", base: "light" },
  { id: "sepia", labelKey: "theme.sepia", base: "light" },
  { id: "midnight", labelKey: "theme.midnight", base: "dark" },
  { id: "nord", labelKey: "theme.nord", base: "dark" },
  { id: "solarized-light", labelKey: "theme.solarizedLight", base: "light" },
  { id: "solarized-dark", labelKey: "theme.solarizedDark", base: "dark" },
];

export function isThemeId(v: string | null | undefined): v is ThemeId {
  return !!v && THEMES.some((t) => t.id === v);
}

export function themeBase(id: ThemeId): "light" | "dark" {
  return THEMES.find((t) => t.id === id)?.base ?? "dark";
}

// <html>에 data-theme 세팅 + base에 맞춰 .dark 토글. 클라이언트 전용(함수 안에서만 document 접근).
export function applyTheme(id: ThemeId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.setAttribute("data-theme", id);
  el.classList.toggle("dark", themeBase(id) === "dark");
}

export function getStoredTheme(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (isThemeId(v)) return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function setStoredTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* ignore */
  }
}

// ── 터미널 테마(#914·#922) — 앱 테마와 분리 가능하되 기본은 auto(앱 .dark 따라감).
// dark/light로 고정도 가능(설정). 터미널 색은 앱 토큰이 아닌 자체 고정 팔레트(차콜/Tango).
export type TerminalThemePref = "dark" | "gray" | "light" | "auto";
export const TERMINAL_THEME_KEY = "nunopi:terminal-theme";
export const TERMINAL_THEME_EVENT = "nunopi:terminal-theme-change"; // 설정 변경 → 열린 터미널에 브로드캐스트

export function getTerminalThemePref(): TerminalThemePref {
  try {
    const v = localStorage.getItem(TERMINAL_THEME_KEY);
    if (v === "dark" || v === "gray" || v === "light" || v === "auto") return v;
  } catch {
    /* ignore */
  }
  return "auto"; // 기본=앱 테마 따라감(#922). 라이트 앱 → 라이트 터미널(Tango).
}

export function setTerminalThemePref(p: TerminalThemePref): void {
  try {
    localStorage.setItem(TERMINAL_THEME_KEY, p);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TERMINAL_THEME_EVENT));
}

export function isTerminalDark(pref: TerminalThemePref): boolean {
  if (pref === "auto") return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return pref === "dark" || pref === "gray"; // #956 gray도 어두운 테마
}

// FOUC 방지용 인라인 스크립트(layout <head>에 dangerouslySetInnerHTML로 삽입).
// 하이드레이션 전에 저장된 테마를 <html>에 반영 — 깜빡임 없음.
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var dark=["dark","midnight","nord","solarized-dark"];var e=document.documentElement;if(t){e.setAttribute("data-theme",t);e.classList.toggle("dark",dark.indexOf(t)>=0);}else{e.setAttribute("data-theme","dark");e.classList.add("dark");}}catch(_){}})();`;

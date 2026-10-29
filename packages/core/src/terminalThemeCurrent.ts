// #1215 지금 터미널 테마 — 설정(다크용·라이트용·따로 쓸지, 없으면 옛 #914 값) + 앱이 다크인지.
import { getSetting, TKEYS } from "./settings";
import { getTerminalThemePref } from "./theme";
import { isLightColor } from "./terminalRender";
import { pickTermSlot, pickTermTheme, readOverrides, resolveTermThemes, type TermColors, type TermTheme, type TermThemeChoice } from "./terminalThemes";

export const terminalThemeChoice = (): TermThemeChoice =>
  resolveTermThemes(getSetting<unknown>(TKEYS.themeDark, undefined), getSetting<unknown>(TKEYS.themeLight, undefined), getSetting<unknown>(TKEYS.themeSeparateLight, undefined), getTerminalThemePref());

const appDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
// 고른 테마 + 그 모드의 색 덮어쓰기(#1215)
export function currentTerminalTheme(): TermTheme {
  const c = terminalThemeChoice(), dark = appDark();
  const th = pickTermTheme(c, dark);
  const over = readOverrides(getSetting<unknown>(pickTermSlot(c, dark) === "dark" ? TKEYS.colorOverridesDark : TKEYS.colorOverridesLight, undefined));
  return { name: th.name, colors: { ...th.colors, ...over } as TermColors };
}
// 터미널이 어두운지 — 테마 배경 밝기로(CLI에 넘기는 COLORFGBG 힌트 등)
export const isCurrentTerminalDark = (): boolean => !isLightColor(currentTerminalTheme().colors.background);

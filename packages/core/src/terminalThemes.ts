// #1215 터미널 테마 — 색 묶음 형식, Mustard 내장 3개, Ghostty 테마 파일 읽기, 목록 JSON 풀기.
// 다른 파일을 import하지 않음(점검·생성 스크립트가 strip-types로 바로 읽음).

export const ANSI_KEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;
export const BASE_KEYS = ["background", "foreground", "cursor", "cursorAccent", "selectionBackground", "selectionForeground"] as const;
export const COLOR_KEYS = [...BASE_KEYS, ...ANSI_KEYS] as const;
export type TermColorKey = (typeof COLOR_KEYS)[number];
export type TermColors = Record<Exclude<TermColorKey, "selectionForeground">, string> & { selectionForeground?: string };
export type TermTheme = { name: string; colors: TermColors };

// 터미널 팔레트(#914·#956) — 다크=near-black 배경(앱 다크와 통일), 그레이=차콜, 라이트=Tango 라이트. ANSI 16색은 다크/그레이 공유.
const ANSI_DARK = {
  black: "#1d1f21", red: "#cc6666", green: "#b5bd68", yellow: "#f0c674", blue: "#81a2be", magenta: "#b294bb", cyan: "#8abeb7", white: "#c5c8c6",
  brightBlack: "#666666", brightRed: "#d54e53", brightGreen: "#b9ca4a", brightYellow: "#e7c547", brightBlue: "#7aa6da", brightMagenta: "#c397d8", brightCyan: "#70c0b1", brightWhite: "#eaeaea",
};
export const MUSTARD_DARK: TermTheme = { name: "Mustard Dark", colors: { background: "#0a0a0a", foreground: "#ffffff", cursor: "#ffffff", cursorAccent: "#0a0a0a", selectionBackground: "#333333", ...ANSI_DARK } };
export const MUSTARD_GRAY: TermTheme = { name: "Mustard Gray", colors: { background: "#282c34", foreground: "#ffffff", cursor: "#ffffff", cursorAccent: "#282c34", selectionBackground: "#3e4451", ...ANSI_DARK } };
export const MUSTARD_LIGHT: TermTheme = {
  name: "Mustard Light",
  colors: {
    background: "#ffffff", foreground: "#2e3434", cursor: "#2e3434", cursorAccent: "#ffffff", selectionBackground: "#accef7",
    black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#8e7700", blue: "#3465a4", magenta: "#75507b", cyan: "#05727e", white: "#6a6a6a",
    brightBlack: "#555753", brightRed: "#ef2929", brightGreen: "#1b7a1b", brightYellow: "#6d5a00", brightBlue: "#204a87", brightMagenta: "#ad7fa8", brightCyan: "#034b50", brightWhite: "#3d3d3d",
  },
};
export const BUILTIN_TERMINAL_THEMES: readonly TermTheme[] = [MUSTARD_DARK, MUSTARD_GRAY, MUSTARD_LIGHT];

// #rgb·#rrggbb(# 생략 가능) → #rrggbb 소문자. 아니면 null.
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  return `#${(m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]).toLowerCase()}`;
}

// 일부 색만 있는 테마를 완성 — 배경·글자색은 필수, ANSI는 1개 이상. 빈 칸은 배경 밝기에 맞는 Mustard 테마로 채움.
export function completeColors(part: Partial<Record<TermColorKey, string>>, isLight: (hex: string) => boolean): TermColors | null {
  const bg = normalizeHex(part.background), fg = normalizeHex(part.foreground);
  if (!bg || !fg || !ANSI_KEYS.some((k) => normalizeHex(part[k]))) return null;
  const base = (isLight(bg) ? MUSTARD_LIGHT : MUSTARD_DARK).colors;
  const out = { ...base } as TermColors;
  for (const k of COLOR_KEYS) { const c = normalizeHex(part[k]); if (c) out[k] = c; }
  out.background = bg; out.foreground = fg;
  if (!normalizeHex(part.cursor)) out.cursor = fg;
  if (!normalizeHex(part.cursorAccent)) out.cursorAccent = bg;
  return out;
}

// Ghostty 테마 파일(`palette = N=#hex`, `background = #hex` …) → 색 일부.
const GHOSTTY_KEYS: Record<string, TermColorKey> = { background: "background", foreground: "foreground", "cursor-color": "cursor", "cursor-text": "cursorAccent", "selection-background": "selectionBackground", "selection-foreground": "selectionForeground" };
export function parseGhosttyTheme(text: string): Partial<Record<TermColorKey, string>> {
  const out: Partial<Record<TermColorKey, string>> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim(), val = line.slice(eq + 1).trim();
    if (key === "palette") {
      const m = /^(\d+)\s*=\s*(\S+)$/.exec(val);
      const i = m ? Number(m[1]) : -1;
      if (i >= 0 && i < 16) { const c = normalizeHex(m![2]); if (c) out[ANSI_KEYS[i]] = c; }
    } else if (GHOSTTY_KEYS[key]) { const c = normalizeHex(val); if (c) out[GHOSTTY_KEYS[key]] = c; }
  }
  return out;
}

// 목록 JSON 한 줄 = [이름, ...COLOR_KEYS 순서의 색(선택 글자색은 "" 가능)] — 객체보다 작게.
export type PackedTheme = [string, ...string[]];
export const packTheme = (t: TermTheme): PackedTheme => [t.name, ...COLOR_KEYS.map((k) => t.colors[k] ?? "")];
export function unpackTheme(p: unknown): TermTheme | null {
  if (!Array.isArray(p) || typeof p[0] !== "string" || p.length !== COLOR_KEYS.length + 1) return null;
  const colors = {} as TermColors;
  for (const [i, k] of COLOR_KEYS.entries()) {
    const c = normalizeHex(p[i + 1]);
    if (c) colors[k] = c;
    else if (k !== "selectionForeground") return null;
  }
  return { name: p[0], colors };
}

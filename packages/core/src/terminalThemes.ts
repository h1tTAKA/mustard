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

// 설정에 저장된 테마(이름 + 색) 읽기 — 필수 색이 다 hex일 때만, 아니면 null.
export function readStoredTheme(v: unknown): TermTheme | null {
  if (!v || typeof v !== "object") return null;
  const { name, colors } = v as { name?: unknown; colors?: Record<string, unknown> };
  if (typeof name !== "string" || !colors || typeof colors !== "object") return null;
  return unpackTheme([name, ...COLOR_KEYS.map((k) => (typeof colors[k] === "string" ? colors[k] : ""))]);
}

// 다크 모드용·라이트 모드용 테마 + "라이트 모드에도 다크용 쓰기". 새 설정이 없으면 옛 값(#914 dark·gray·light·auto)에서.
export type TermThemeChoice = { dark: TermTheme; light: TermTheme; separate: boolean };
export function resolveTermThemes(storedDark: unknown, storedLight: unknown, storedSeparate: unknown, legacyPref: string): TermThemeChoice {
  const legacy = legacyPref === "gray" ? MUSTARD_GRAY : legacyPref === "light" ? MUSTARD_LIGHT : MUSTARD_DARK;
  return {
    dark: readStoredTheme(storedDark) ?? legacy,
    light: readStoredTheme(storedLight) ?? MUSTARD_LIGHT,
    separate: typeof storedSeparate === "boolean" ? storedSeparate : legacyPref === "auto" || !["dark", "gray", "light"].includes(legacyPref),
  };
}
export const pickTermTheme = (c: TermThemeChoice, appDark: boolean): TermTheme => (appDark || !c.separate ? c.dark : c.light); // 고르는 규칙은 pickTermSlot과 같음

// ── #1215 가져오기 — Ghostty 테마 파일, iTerm2 .itermcolors, JSON(우리 형식·Windows Terminal), Warp YAML. 의존성 없이.
export const THEME_FILE_MAX = 256 * 1024;
export const CUSTOM_THEMES_MAX = 100;
type Part = Partial<Record<TermColorKey, string>>;
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
const byte = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0");

// iTerm2: plist의 "Ansi 0 Color" 등 → Red/Green/Blue Component(0~1)
const ITERM_KEYS: Record<string, TermColorKey> = { "Background Color": "background", "Foreground Color": "foreground", "Cursor Color": "cursor", "Cursor Text Color": "cursorAccent", "Selection Color": "selectionBackground", "Selected Text Color": "selectionForeground" };
export function parseItermColors(text: string): Part {
  const out: Part = {};
  const re = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  for (let m; (m = re.exec(text)); ) {
    const ansi = /^Ansi (\d+) Color$/.exec(m[1]);
    const key = ansi ? (Number(ansi[1]) < 16 ? ANSI_KEYS[Number(ansi[1])] : undefined) : ITERM_KEYS[m[1]];
    if (!key) continue;
    const comp = (c: string) => { const v = new RegExp(`<key>${c} Component</key>\\s*<(?:real|integer)>([^<]+)</`).exec(m![2]); return v ? Number(v[1]) : NaN; };
    const [r, g, b] = [comp("Red"), comp("Green"), comp("Blue")];
    if ([r, g, b].every(Number.isFinite)) out[key] = `#${byte(r)}${byte(g)}${byte(b)}`;
  }
  return out;
}

// Warp YAML(name, background, foreground, accent, terminal_colors.normal/bright.*) — 이 모양만 읽는 작은 파서. 그라데이션이면 첫 색.
const WARP_ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
export function parseWarpYaml(text: string): { name?: string; colors: Part } {
  const colors: Part = {};
  let name: string | undefined;
  const stack: { indent: number; key: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const indent = m[1].length, key = m[2], val = m[3].replace(/\s+#.*$/, "").replace(/^['"]|['"]$/g, "").trim();
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = [...stack.map((s) => s.key), key];
    if (!val) { stack.push({ indent, key }); continue; }
    if (path.length === 1 && key === "name") name = clean(val);
    const hex = normalizeHex(val);
    if (!hex) continue;
    const top = path[0];
    if ((top === "background" || top === "foreground") && !colors[top]) colors[top] = hex; // 값 또는 그라데이션의 첫 색
    else if (top === "accent" && path.length === 1) colors.cursor ??= hex;
    else if (top === "cursor" && path.length === 1) colors.cursor = hex;
    else if (top === "terminal_colors" && path.length === 3 && (WARP_ANSI as readonly string[]).includes(key)) {
      const i = WARP_ANSI.indexOf(key as (typeof WARP_ANSI)[number]) + (path[1] === "bright" ? 8 : 0);
      if (path[1] === "normal" || path[1] === "bright") colors[ANSI_KEYS[i]] = hex;
    }
  }
  return { name, colors };
}

// JSON — 우리 형식 {name, colors:{…}} 또는 그 배열, Windows Terminal 색 묶음({name, background, purple…}).
const WT_KEYS: Record<string, TermColorKey> = { cursorColor: "cursor", selectionBackground: "selectionBackground", purple: "magenta", brightPurple: "brightMagenta" };
function jsonPart(o: Record<string, unknown>): Part {
  const src = (o.colors && typeof o.colors === "object" ? o.colors : o) as Record<string, unknown>;
  const out: Part = {};
  for (const [k, v] of Object.entries(src)) {
    const key = (COLOR_KEYS as readonly string[]).includes(k) ? (k as TermColorKey) : WT_KEYS[k];
    const c = key ? normalizeHex(v) : null;
    if (key && c) out[key] = c;
  }
  return out;
}

// 파일 하나 → 테마 목록. 형식은 내용으로 판단, 이름은 파일 안 이름 > 파일 이름.
export function parseThemeFile(fileName: string, text: string, isLight: (hex: string) => boolean): TermTheme[] {
  if (text.length > THEME_FILE_MAX) return [];
  const base = clean(fileName.replace(/\.(itermcolors|json|ya?ml|conf|txt)$/i, "")) || "Imported";
  const make = (name: string, part: Part): TermTheme[] => { const colors = completeColors(part, isLight); return colors ? [{ name: clean(name) || base, colors }] : []; };
  const t = text.trimStart();
  if (t.startsWith("<?xml") || t.startsWith("<plist") || /\.itermcolors$/i.test(fileName)) return make(base, parseItermColors(text));
  if (t.startsWith("{") || t.startsWith("[")) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return []; }
    const items = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { themes?: unknown }).themes) ? (data as { themes: unknown[] }).themes : [data];
    return items.slice(0, CUSTOM_THEMES_MAX).flatMap((o, i) => (o && typeof o === "object" ? make(typeof (o as { name?: unknown }).name === "string" ? (o as { name: string }).name : items.length > 1 ? `${base} ${i + 1}` : base, jsonPart(o as Record<string, unknown>)) : []));
  }
  if (/^\s*terminal_colors\s*:/m.test(text)) { const w = parseWarpYaml(text); return make(w.name ?? base, w.colors); }
  return make(base, parseGhosttyTheme(text));
}

// 사용자 테마 목록에 넣기 — 같은 이름은 바꿔 끼움, 최대 개수.
export function addCustomThemes(list: unknown, add: TermTheme[]): TermTheme[] {
  const cur = Array.isArray(list) ? list.flatMap((v) => { const t = readStoredTheme(v); return t ? [t] : []; }) : [];
  const names = new Set(add.map((t) => t.name));
  return [...add, ...cur.filter((t) => !names.has(t.name))].slice(0, CUSTOM_THEMES_MAX);
}

// ── #1215 색 하나씩 덮어쓰기 — 모드별(다크용·라이트용). hex만 남기고, 테마 위에 덮음.
export type TermColorOverrides = Partial<Record<TermColorKey, string>>;
export function readOverrides(v: unknown): TermColorOverrides {
  const out: TermColorOverrides = {};
  if (!v || typeof v !== "object") return out;
  for (const k of COLOR_KEYS) { const c = normalizeHex((v as Record<string, unknown>)[k]); if (c) out[k] = c; }
  return out;
}
export const pickTermSlot = (c: TermThemeChoice, appDark: boolean): "dark" | "light" => (appDark || !c.separate ? "dark" : "light");

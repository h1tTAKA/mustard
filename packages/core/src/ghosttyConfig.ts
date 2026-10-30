// #1224 Ghostty 설정 파일 → 우리 터미널 설정. 순수 모듈(import 없음, 점검이 strip-types로 바로 읽음).
// 설정 값은 TERMINAL_DEFAULTS 필드 이름으로 돌려줌(화면이 TKEYS로 저장). 색 줄은 그대로 모아 parseGhosttyTheme에 넘김.
// 안 옮기는 것: background-opacity·background-blur(BACKLOG), keybind(형식이 다름), config-file(다른 파일 읽기), 나머지 모르는 키.

export type GhosttyImport = {
  settings: Record<string, string | number | boolean>;
  theme?: { dark: string; light?: string };
  colorLines: string;
  used: string[];
  skipped: string[];
};

const COLOR_KEYS = new Set(["background", "foreground", "palette", "cursor-color", "cursor-text", "selection-background", "selection-foreground"]);
const unquote = (v: string) => (/^".*"$/.test(v) ? v.slice(1, -1) : v);
const bool = (v: string): boolean | null => (v === "true" ? true : v === "false" ? false : null);
const cssFamily = (f: string) => (/^[\w -]+$/.test(f) && !/^\d/.test(f) ? f : `"${f.replace(/"/g, "")}"`);

export function parseGhosttyConfig(text: string): GhosttyImport {
  const settings: GhosttyImport["settings"] = {};
  const used = new Set<string>(), skipped = new Set<string>();
  const colors: string[] = [];
  let fonts: string[] | null = null;
  let theme: GhosttyImport["theme"];
  const take = (key: string, field: string, v: string | number | boolean | null) => {
    if (v === null) { skipped.add(key); return; }
    settings[field] = v; used.add(key);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim(), v = unquote(line.slice(eq + 1).trim());
    if (COLOR_KEYS.has(key)) { colors.push(line); used.add(key); continue; }
    switch (key) {
      case "font-family": fonts = v ? [...(fonts ?? []), v] : []; break; // 여러 줄 = 대체 글꼴, 빈 값 = 목록 비우기
      case "font-size": { const n = Number(v); take(key, "fontSize", Number.isFinite(n) && n > 0 ? Math.min(28, Math.max(9, Math.round(n))) : null); break; } // 설정 칸 범위 9~28
      case "cursor-style": take(key, "cursorStyle", v === "block_hollow" ? "block" : ["block", "bar", "underline"].includes(v) ? v : null); break;
      case "cursor-style-blink": take(key, "cursorBlink", bool(v)); break;
      case "copy-on-select": take(key, "copyOnSelect", v === "clipboard" ? true : bool(v)); break;
      case "mouse-hide-while-typing": take(key, "hideMouseWhileTyping", bool(v)); break;
      case "focus-follows-mouse": take(key, "focusFollowsMouse", bool(v)); break;
      case "macos-option-as-alt": take(key, "macOptionAsAlt", v === "true" ? "both" : v === "false" ? "off" : v === "left" || v === "right" ? v : null); break;
      case "window-padding-x": case "window-padding-y": { const n = Number(v.split(",")[0]); take(key, key.endsWith("x") ? "paddingX" : "paddingY", Number.isFinite(n) && n >= 0 ? Math.min(40, Math.round(n)) : null); break; }
      case "theme": {
        const parts = Object.fromEntries(v.split(",").map((p) => { const i = p.indexOf(":"); return i < 0 ? ["", p.trim()] : [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
        if (parts.dark || parts.light) theme = { dark: parts.dark || parts.light, light: parts.light || parts.dark };
        else if (parts[""]) theme = { dark: parts[""] };
        if (theme) used.add(key); else skipped.add(key);
        break;
      }
      default: skipped.add(key);
    }
  }
  if (fonts?.length) { settings.fontFamily = [...fonts.map(cssFamily), "monospace"].join(", "); used.add("font-family"); } // 비우기만 있으면 가져온 것 없음(리뷰)
  return { settings, theme, colorLines: colors.join("\n"), used: [...used], skipped: [...skipped] };
}

// 단축키 레지스트리(#1027) — 순수 모듈(import 없음, check 가능). 기본값은 Orca·Ghostty/iTerm2·IDE 관례를 따름(유저 결정).
// 원칙: ⌃+글자·⌥ 단독은 셸·에이전트 TUI 몫이라 기본값에 안 씀, 앱 동작은 ⌘(Mod) 조합.
// 조합 문자열: "Mod+Shift+]"처럼 수식키(Mod·Ctrl·Alt·Shift) + 키 토큰. Mod = mac ⌘ / 그 외 Ctrl.
// 키 토큰은 e.code(물리 키)에서 뽑음 — ⌥·⇧가 e.key를 바꿔도(⌥] → ‘) 같은 키로 인식, 한글 자판에서도 동작.

export type ShortcutScope = "global" | "terminal" | "outsideTerminal"; // terminal = xterm 포커스일 때만, outsideTerminal = 그 밖에서만
export type ShortcutGroup = "general" | "tabs" | "repos" | "panels" | "terminal" | "view";
export interface ShortcutDef { id: string; group: ShortcutGroup; labelKey: string; defaults: string[]; scope: ShortcutScope; arg?: number }

const goto = (prefix: string, group: ShortcutGroup, mod: string, labelKey: string): ShortcutDef[] =>
  Array.from({ length: 9 }, (_, i) => ({ id: `${prefix}${i + 1}`, group, labelKey, defaults: [`${mod}+${i + 1}`], scope: "global" as const, arg: i + 1 }));

export const SHORTCUTS: ShortcutDef[] = [
  { id: "palette", group: "general", labelKey: "shortcut.palette", defaults: ["Mod+K", "Mod+Shift+P"], scope: "global" },
  { id: "settings", group: "general", labelKey: "shortcut.settings", defaults: ["Mod+,"], scope: "global" },
  { id: "term.new", group: "tabs", labelKey: "shortcut.termNew", defaults: ["Mod+T"], scope: "global" },
  { id: "term.newAgent", group: "tabs", labelKey: "shortcut.termNewAgent", defaults: ["Mod+Alt+T"], scope: "global" },
  { id: "term.close", group: "tabs", labelKey: "shortcut.termClose", defaults: ["Mod+W"], scope: "global" },
  { id: "term.next", group: "tabs", labelKey: "shortcut.termNext", defaults: ["Mod+Shift+]"], scope: "global" },
  { id: "term.prev", group: "tabs", labelKey: "shortcut.termPrev", defaults: ["Mod+Shift+["], scope: "global" },
  ...goto("term.goto", "tabs", "Mod", "shortcut.termGoto"), // term.goto9 = 마지막 탭(Ghostty·Warp 관례)
  { id: "repo.next", group: "repos", labelKey: "shortcut.repoNext", defaults: ["Mod+Alt+]"], scope: "global" },
  { id: "repo.prev", group: "repos", labelKey: "shortcut.repoPrev", defaults: ["Mod+Alt+["], scope: "global" },
  ...goto("repo.goto", "repos", "Mod+Alt", "shortcut.repoGoto"),
  { id: "view.left", group: "panels", labelKey: "shortcut.viewLeft", defaults: ["Mod+B"], scope: "global" },
  { id: "view.right", group: "panels", labelKey: "shortcut.viewRight", defaults: ["Mod+L"], scope: "global" },
  { id: "view.git", group: "panels", labelKey: "shortcut.viewGit", defaults: ["Mod+Shift+G"], scope: "global" },
  { id: "term.clear", group: "terminal", labelKey: "shortcut.termClear", defaults: ["Mod+K"], scope: "terminal" },
  { id: "term.fontUp", group: "terminal", labelKey: "shortcut.termFontUp", defaults: ["Mod+="], scope: "global" },
  { id: "term.fontDown", group: "terminal", labelKey: "shortcut.termFontDown", defaults: ["Mod+-"], scope: "global" },
  { id: "term.fontReset", group: "terminal", labelKey: "shortcut.termFontReset", defaults: ["Mod+0"], scope: "global" },
  { id: "ui.zoomIn", group: "view", labelKey: "shortcut.zoomIn", defaults: ["Mod+Alt+="], scope: "global" },
  { id: "ui.zoomOut", group: "view", labelKey: "shortcut.zoomOut", defaults: ["Mod+Alt+-"], scope: "global" },
  { id: "ui.zoomReset", group: "view", labelKey: "shortcut.zoomReset", defaults: ["Mod+Alt+0"], scope: "global" },
];
// 팔레트 ⌘K는 터미널 포커스면 화면 지우기(term.clear)가 이김 — 같은 조합이 terminal 범위에 있으면 terminal 우선(matchShortcut).

export type ShortcutOverrides = Record<string, string[]>; // id → 조합들([] = 끔)

const MODS = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const CODE_TOKEN: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", Comma: ",", Period: ".", Slash: "/", Semicolon: ";",
  Quote: "'", Backquote: "`", Backslash: "\\", Enter: "Enter", Tab: "Tab", Space: "Space", Backspace: "Backspace", Escape: "Escape",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", NumpadAdd: "=", NumpadSubtract: "-",
};
function tokenOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return CODE_TOKEN[code] ?? null;
}

// 문자열 정규화 — 수식키 순서 고정, 키 토큰 대문자. 잘못된 문자열이면 null.
export function normalizeChord(s: string): string | null {
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (s.trim().endsWith("++")) parts.push("="); // "Mod++" 관용 표기 = ⌘=
  const mods = new Set<string>();
  let key: string | null = null;
  for (const p of parts) {
    const m = MODS.find((x) => x.toLowerCase() === p.toLowerCase()) ?? (/^(cmd|meta|command)$/i.test(p) ? "Mod" : /^(option|opt)$/i.test(p) ? "Alt" : null);
    if (m) mods.add(m);
    else if (key === null) key = p.length === 1 ? p.toUpperCase() : p;
    else return null;
  }
  if (!key || !mods.size) return null; // 수식키 없는 단축키는 받지 않음(입력·셸과 충돌)
  return [...MODS.filter((m) => mods.has(m)), key].join("+");
}

export interface KeyLike { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }
// 키 이벤트 → 조합 문자열. mac은 ⌘=Mod·⌃=Ctrl, 그 외는 Ctrl=Mod. 수식키만 눌렸거나 모르는 키면 null.
export function chordFromEvent(e: KeyLike, isMac: boolean): string | null {
  const key = tokenOf(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("Mod");
  if (isMac && e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return mods.length ? [...mods, key].join("+") : null;
}

export function bindingsOf(def: ShortcutDef, overrides: ShortcutOverrides): string[] {
  const raw = overrides[def.id] ?? def.defaults;
  return raw.map(normalizeChord).filter((c): c is string => !!c);
}

// 터미널 밖에서 앱이 가져가는 조합 전부(#1034) — 인앱 브라우저가 포커스일 때 main이 이 조합만 페이지 대신 앱으로 보냄.
export function appChords(overrides: ShortcutOverrides = {}): string[] {
  return [...new Set(SHORTCUTS.filter((d) => d.scope !== "terminal").flatMap((d) => bindingsOf(d, overrides)))];
}

// 조합 + 문맥 → 동작. 터미널 포커스면 terminal 범위 우선(⌘K = 화면 지우기), 아니면 terminal 범위는 무시.
export function matchShortcut(chord: string, inTerminal: boolean, overrides: ShortcutOverrides = {}): ShortcutDef | null {
  let fallback: ShortcutDef | null = null;
  for (const d of SHORTCUTS) {
    if (!bindingsOf(d, overrides).includes(chord)) continue;
    if (d.scope === "terminal") { if (inTerminal) return d; continue; }
    if (d.scope === "outsideTerminal" && inTerminal) continue;
    fallback ??= d;
  }
  return fallback;
}

// 충돌 — 같은 조합이 겹치는 범위의 두 동작 이상에 걸림. 기본값끼리(⌘K 팔레트↔화면 지우기처럼 의도된 것)는 경고 안 함(Orca 방식).
export function findConflicts(overrides: ShortcutOverrides): { chord: string; ids: string[] }[] {
  // terminal↔outsideTerminal만 서로 배타(동시에 성립 불가). terminal↔global은 터미널에서 global을 가리므로 충돌로 봄.
  const overlap = (a: ShortcutScope, b: ShortcutScope) => !((a === "terminal" && b === "outsideTerminal") || (a === "outsideTerminal" && b === "terminal"));
  const out: { chord: string; ids: string[] }[] = [];
  const byChord = new Map<string, ShortcutDef[]>();
  for (const d of SHORTCUTS) for (const c of bindingsOf(d, overrides)) byChord.set(c, [...(byChord.get(c) ?? []), d]);
  for (const [chord, defs] of byChord) {
    const clash = defs.filter((d) => defs.some((o) => o !== d && overlap(d.scope, o.scope)));
    if (clash.length > 1 && clash.some((d) => d.id in overrides)) out.push({ chord, ids: clash.map((d) => d.id) });
  }
  return out;
}

// 표시용 — mac 기호(⌘⌥⇧⌃), 그 외 Ctrl+Alt+Shift.
export function formatChord(chord: string, isMac: boolean): string {
  const parts = chord.split("+");
  const key = parts.pop()!;
  const k = { Up: "↑", Down: "↓", Left: "←", Right: "→", Enter: "↩", Backspace: "⌫", Escape: "Esc", Tab: "⇥", Space: "Space" }[key] ?? key;
  if (!isMac) return [...parts.map((p) => (p === "Mod" ? "Ctrl" : p)), k].join("+");
  const sym: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
  return ["Ctrl", "Alt", "Shift", "Mod"].filter((m) => parts.includes(m)).map((m) => sym[m]).join("") + k;
}

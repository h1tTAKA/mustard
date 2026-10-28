// #1213 터미널 키보드 — 맥 Option을 Alt로 — 자동(입력 소스가 US·ABC면 양쪽, 아니면 끄기) / 양쪽 / 왼쪽만 / 오른쪽만 / 끄기.
export type MacOptionAsAlt = "auto" | "both" | "left" | "right" | "off";
export const MAC_OPTION_AS_ALT: readonly MacOptionAsAlt[] = ["auto", "both", "left", "right", "off"];

// US·ABC 배열만 Option 조합 글자(å·∑ 등)를 거의 안 씀 → Alt로. 한국어·일본어·US 확장 등은 ⌥로 글자를 치므로 그대로. 모름(null)도 그대로.
export function isUsInputSource(id: string | null | undefined): boolean {
  const s = (id ?? "").toLowerCase();
  return s === "com.apple.keylayout.us" || s === "com.apple.keylayout.abc";
}

export function effectiveMacOptionAsAlt(setting: MacOptionAsAlt, inputSourceId: string | null | undefined): Exclude<MacOptionAsAlt, "auto"> {
  if (setting !== "auto") return setting;
  return isUsInputSource(inputSourceId) ? "both" : "off";
}

// 저장값 읽기 — 새 키가 없으면 옛 스위치(켜짐 = 양쪽)에서 옮김, 이상한 값은 자동.
export function readMacOptionAsAlt(stored: unknown, legacyOn: unknown): MacOptionAsAlt {
  if (typeof stored === "string" && (MAC_OPTION_AS_ALT as readonly string[]).includes(stored)) return stored as MacOptionAsAlt;
  return legacyOn === true ? "both" : "auto";
}

// 한쪽 ⌥만 Alt일 때 보낼 글자 — 그 키를 Option 없이 친 글자(물리 위치 기준, US 배열).
// ponytail: US 배열 고정, 다른 배열의 왼쪽/오른쪽 모드가 필요해지면 navigator.keyboard.getLayoutMap()으로.
const PUNCT: Record<string, string> = { Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`" };
export function altCharForCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return PUNCT[code] ?? null;
}

// JIS 키보드 ¥ 키 → \ — 물리 ¥ 키(IntlYen)를 수식키 없이 눌렀을 때만. keydown은 \ 입력, 같이 오는 keypress·keyup은 삼켜 ¥가 안 들어가게.
// IME 조합 중(229)은 그대로.
export type YenKeyEvent = { type: string; code: string; key: string; keyCode: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };
export function jisYenInput(e: YenKeyEvent, enabled: boolean): "input" | "suppress" | null {
  if (!enabled || e.keyCode === 229 || e.code !== "IntlYen" || e.key !== "¥" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (e.type === "keydown") return "input";
  return e.type === "keypress" || e.type === "keyup" ? "suppress" : null;
}

// 셸 인자 — 한 줄에 인자 하나(따옴표 해석 없음, 그대로 넘김). 빈 줄은 뺌.
export const parseShellArgs = (text: string): string[] => text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);

// 더블클릭 단어 구분 기호 기본값(xterm 기본과 같음) — 설정이 비면 이걸.
export const DEFAULT_WORD_SEPARATOR = " ()[]{}',\"`";

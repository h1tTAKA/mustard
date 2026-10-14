// 실시간 해설 켜짐 여부(#1062) — 설정(렌더러 localStorage)을 서버가 직접 못 읽어서 캐치업이 POST로 알려줌.
// 메모리 값(앱 재시작 시 기본 켜짐 → 캐치업이 뜨면서 다시 알림). globalThis = dev 라우트 리로드에도 유지.
const g = globalThis as unknown as { __mustardNarrationOn?: boolean; __mustardNarrationProvider?: string };
export const isNarrationOn = () => g.__mustardNarrationOn !== false;
export const setNarrationOn = (on: boolean) => { g.__mustardNarrationOn = on; };
// 해설 AI(#1062) — 실시간 해설은 SNA(Claude/Codex)만 지원 → codex-agent면 Codex, 그 외 Claude.
export const narrationProvider = () => g.__mustardNarrationProvider ?? "";
export const setNarrationProvider = (p: string) => { g.__mustardNarrationProvider = p; };
const gm = globalThis as unknown as { __mustardNarrationModel?: string };
export const narrationModel = () => gm.__mustardNarrationModel ?? "";
export const setNarrationModel = (m: string) => { gm.__mustardNarrationModel = m; };
// 해설 언어(#1091) — 앱 언어 설정(ko/ja/en). 캐치업이 config POST로 알려줌, 그 전엔 ko.
const gl = globalThis as unknown as { __mustardNarrationLocale?: "ko" | "ja" | "en" };
export const narrationLocale = () => gl.__mustardNarrationLocale ?? "ko";
export const setNarrationLocale = (l: "ko" | "ja" | "en") => { gl.__mustardNarrationLocale = l; };

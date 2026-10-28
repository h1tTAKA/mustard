// 인앱 브라우저 주소창 입력 → 이동할 URL(#1034). core에 둠 — 앱(주소창·홈 페이지)과 설정 화면(홈 페이지 검사)이 같은 판정을 쓰게(#1209 리뷰). 못 알아들으면 null(이동 안 함).
// localhost·IP·포트만(":3000") → http, 그 외 도메인 → https. 검색어는 아래 browserTarget이 검색 URL로(#1209).
export function normalizeBrowserUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^:\d{1,5}$/.test(s)) return `http://localhost${s}/`;
  if (/^https?:\/\//i.test(s)) { try { return new URL(s).href; } catch { return null; } }
  if (/\s/.test(s) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null; // 공백 or file:/javascript: 등 다른 scheme
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?([/?#]|$)/i.test(s);
  if (!local && !s.includes(".")) return null;
  try { return new URL(`${local ? "http" : "https"}://${s}`).href; } catch { return null; }
}

// #1209 검색 엔진 — URL이 아닌 입력은 이 엔진으로 검색
export const SEARCH_ENGINES = { google: "https://www.google.com/search?q=", duckduckgo: "https://duckduckgo.com/?q=", bing: "https://www.bing.com/search?q=", kagi: "https://kagi.com/search?q=" } as const;
export type SearchEngine = keyof typeof SEARCH_ENGINES;
// 주소창 입력 → URL. URL이면 그대로, 아니면 검색. javascript:·file: 같은 다른 scheme은 여전히 null(검색으로도 안 보냄).
export function browserTarget(input: string, engine: string): string | null {
  const u = normalizeBrowserUrl(input);
  if (u) return u;
  const s = input.trim();
  if (!s || /^[a-z][a-z0-9+.-]*:(?!\d)\S/i.test(s)) return null;
  const base = Object.hasOwn(SEARCH_ENGINES, engine) ? SEARCH_ENGINES[engine as SearchEngine] : SEARCH_ENGINES.google; // 손으로 고친 값(__proto__ 등) 막기(리뷰)
  return base + encodeURIComponent(s);
}

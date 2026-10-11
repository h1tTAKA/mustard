// 인앱 브라우저 주소창 입력 → 이동할 URL(#1034). 못 알아들으면 null(이동 안 함).
// localhost·IP·포트만(":3000") → http, 그 외 도메인 → https. 검색어(공백·점 없음)는 지원 안 함.
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

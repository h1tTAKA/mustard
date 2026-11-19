// #1388 토큰 카드의 소속(언어·라이브러리·프레임워크 — 예: Positioned → Flutter). 카드 키 → 이름("" = 물어봤는데 모름/일반).
// 북마크 원본과 따로 저장 — 카드 데이터 모양을 안 바꾸고, 채우기(앱의 해설 AI)·보여 주기(누노피 카드 앞면)가 이 키만 같이 씀.
export const CARD_ECO_KEY = "nunopi:card-eco";
export function loadCardEco(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(CARD_ECO_KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, string> : {}; } catch { return {}; }
}

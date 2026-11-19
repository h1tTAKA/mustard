// 암기모드(플래시카드 SRS) 공통 타입.
// SRS = Spaced Repetition System. 북마크한 용어를 에빙하우스 망각곡선 기반
// 간격 반복(Leitner)으로 복습한다.

// 카드 출처 — 3개 북마크 store에 대응(관련개념은 저장 시 term에 병합됨).
export type SrsSource = "token" | "concept" | "term";

// 3단계 채점: 다시(강등) / 애매(유지) / 완벽(승급).
export type Grade = "again" | "hard" | "good";

// 덱 = 카드 묶음(북마크 출처 그룹). code=토큰+개념, text=글용어, all=전체.
export type Deck = "code" | "text" | "all";

// 카드 제시 순서 — 최신순(습득 최신 먼저)/과거순/무작위.
export type CardOrder = "newest" | "oldest" | "random";

// 카드 한 장의 복습 진도. 북마크 원본과 분리 저장(nunopi:srs-state).
export interface SrsState {
  box: number; // 1..5 (Leitner 박스)
  nextReviewAt: string; // ISO — 이 날(로컬 자정) 이후 복습 대상
  lastReviewedAt: string | null;
  streak: number; // 연속 "완벽" 횟수(통계용)
  reviews?: number; // 총 채점 횟수(카드 정보 패널용, 옵셔널 — 기존 데이터 하위호환)
  grades?: { again: number; hard: number; good: number }; // 채점별 누적
  lastGrade?: Grade; // 마지막 채점 등급(분류 필터용, 없으면 미분류)
}

// 수집기가 북마크 store + srs-state를 조인해 만든 복습 카드.
export interface Card {
  key: string; // `${source}:${term}` — srs-state 맵의 키
  source: SrsSource;
  front: string; // 앞면(용어)
  back: string; // 뒷면(설명)
  bookmarkedAt?: string; // 습득(북마크) 날짜 ISO — 정보 패널용
  sourceTitle?: string; // 담은 분석의 제목(출처) — 정보 패널용
  sourceId?: string; // 담은 분석의 히스토리 id — 출처로 이동용
  sourceKind?: "analysis" | "card" | "ask" | "workspace"; // 출처 종류(없으면 analysis) — 출처이동 분기용(#750 workspace)
  sourceSessionId?: string; // analysis 출처의 챗 세션 id / ask 질문 세션 id
  originCardKey?: string; // card 출처(챗에서 생성)의 생성처 카드 key
  sourceSubId?: string; // ask 출처의 질문(서브세션) id
  sourceRoot?: string; // workspace 출처의 레포 절대경로 — 세션 카드 목록 레포별 격리용(#762)
  eco?: string; // #1388 토큰 카드의 소속 언어·라이브러리·프레임워크(예: "Flutter"), 모르면 없음
  state: SrsState;
}

// 덱 → 포함 출처.
export const DECK_SOURCES: Record<Deck, SrsSource[]> = {
  code: ["token", "concept"],
  text: ["term"],
  all: ["token", "concept", "term"],
};

// 카드 수집기 — 북마크 store(token/concept/term)를 읽어 SRS 카드로 변환하고
// srs-state를 조인한다. 북마크는 언제든 추가/삭제되므로 카드 목록은 저장하지 않고
// 매번 store에서 파생한다(srs-state만 영속).

import {
  loadTokenDetails,
  loadConceptDetails,
  loadTermDetails,
  loadCardEco,
} from "@mustard/core";
import { initialState } from "./schedule";
import { loadSrsState } from "./store";
import type { Card, SrsSource } from "@mustard/core";

function cardKey(source: SrsSource, term: string): string {
  return `${source}:${term}`;
}

// 한 출처의 북마크 → 카드(앞=용어, 뒤=설명). 설명 없으면 빈 문자열.
// state 제외한 카드 본문 — collectCards가 srs-state를 조인한다.
function collectSource(source: SrsSource): Omit<Card, "state">[] {
  if (source === "token") {
    return Object.values(loadTokenDetails()).map((t) => ({
      key: cardKey("token", t.token),
      source,
      front: t.token,
      back: t.description ?? "",
      bookmarkedAt: t.bookmarkedAt,
      sourceTitle: t.sourceTitle,
      sourceId: t.sourceId,
      sourceKind: t.sourceKind,
      sourceSessionId: t.sourceSessionId,
      originCardKey: t.originCardKey,
      sourceSubId: t.sourceSubId,
      sourceRoot: t.sourceRoot,
    }));
  }
  if (source === "concept") {
    return Object.values(loadConceptDetails()).map((c) => ({
      key: cardKey("concept", c.title),
      source,
      front: c.title,
      back: c.description ?? "",
      bookmarkedAt: c.bookmarkedAt,
      sourceTitle: c.sourceTitle,
      sourceId: c.sourceId,
      sourceKind: c.sourceKind,
      sourceSessionId: c.sourceSessionId,
      originCardKey: c.originCardKey,
      sourceSubId: c.sourceSubId,
      sourceRoot: c.sourceRoot,
    }));
  }
  // term — 글 IT용어 + 관련개념(asTerm 병합).
  return Object.values(loadTermDetails()).map((t) => ({
    key: cardKey("term", t.term),
    source,
    front: t.term,
    back: t.explanation ?? "",
    bookmarkedAt: t.bookmarkedAt,
    sourceTitle: t.sourceTitle,
    sourceId: t.sourceId,
    sourceKind: t.sourceKind,
    sourceSessionId: t.sourceSessionId,
    originCardKey: t.originCardKey,
    sourceSubId: t.sourceSubId,
    sourceRoot: t.sourceRoot,
  }));
}

// 주어진 출처들의 카드 목록 + srs-state 조인(없으면 box1 기본).
export function collectCards(sources: SrsSource[], now: Date): Card[] {
  const states = loadSrsState();
  const eco = loadCardEco(); // #1388 토큰 카드 소속(없으면 안 붙임)
  const cards: Card[] = [];
  for (const source of sources) {
    for (const base of collectSource(source)) {
      const e = source === "token" ? eco[base.key] : undefined;
      cards.push({ ...base, ...(e ? { eco: e } : {}), state: states[base.key] ?? initialState(now) });
    }
  }
  return cards;
}

// 커스텀 덱용 — 전체 카드 중 주어진 key에 속한 것만(존재하는 것만, 삭제된 key는 스킵).
// 순서는 keys 순서를 따른다(커스텀 덱 큐레이션 순서 보존).
export function collectCardsByKeys(keys: string[], now: Date): Card[] {
  const all = collectCards(["token", "concept", "term"], now);
  const byKey = new Map(all.map((c) => [c.key, c]));
  return keys.map((k) => byKey.get(k)).filter((c): c is Card => !!c);
}

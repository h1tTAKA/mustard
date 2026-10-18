import { translate, allLocaleValues } from "@mustard/core/messages";
// 커스텀 덱 — 유저(또는 에이전트)가 큐레이션한 카드 key 목록. 고정 덱(code/text/all)과 별개 축.
// 카드는 key로만 참조(내용은 collectCards에서 파생). 삭제된 카드 key는 세션/카운트 시 스킵.
const KEY = "nunopi:mem-custom-decks";
// 커스텀 덱 목록 변경 알림 — DeckSelect 등이 재로드하도록.
export const CUSTOM_DECKS_CHANGED_EVENT = "nunopi:custom-decks-changed";

export interface CustomDeck {
  id: string;
  name: string;
  cardKeys: string[];
  goal?: string; // 에이전트 생성 시 유저 목표 프롬프트(참고)
  createdAt: string;
}

export function loadCustomDecks(): CustomDeck[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as CustomDeck[]) : [];
    if (!Array.isArray(arr)) return [];
    // #1125 이름 없이 만든 덱의 기본 이름("덱" 등, 만들 때 언어로 굳음)은 지금 언어로 — 읽는 한 곳에서 처리(표시처 6곳 공통).
    const defaults = new Set(allLocaleValues("deck.defaultName"));
    const cur = translate(localStorage.getItem("nunopi:locale") ?? "ko", "deck.defaultName");
    return arr.map((d) => (d && defaults.has(d.name) ? { ...d, name: cur } : d));
  } catch {
    return [];
  }
}

function saveAll(list: CustomDeck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CUSTOM_DECKS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `deck-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

export function addCustomDeck(name: string, cardKeys: string[], goal?: string): CustomDeck {
  const deck: CustomDeck = {
    id: newId(),
    name: name.trim() || translate(typeof localStorage !== "undefined" ? (localStorage.getItem("nunopi:locale") ?? "ko") : "ko", "deck.defaultName"), // #1095 앱 언어
    cardKeys: [...new Set(cardKeys)], // 중복 제거
    goal,
    createdAt: new Date().toISOString(),
  };
  saveAll([...loadCustomDecks(), deck]);
  return deck;
}

export function removeCustomDeck(id: string): void {
  saveAll(loadCustomDecks().filter((d) => d.id !== id));
}

// 덱 cardKeys에서 주어진 key들을 제거(카드 원본·SRS 상태 불변). 제거 개수 반환. 대상 없으면 0.
export function removeCardsFromDeck(id: string, cardKeys: string[]): number {
  const toRemove = new Set(cardKeys);
  const decks = loadCustomDecks();
  const deck = decks.find((d) => d.id === id);
  if (!deck) return 0;
  const next = deck.cardKeys.filter((k) => !toRemove.has(k));
  const removed = deck.cardKeys.length - next.length;
  if (removed > 0) saveAll(decks.map((d) => (d.id === id ? { ...d, cardKeys: next } : d)));
  return removed;
}

// 기존 덱에 카드 key들을 합친다. 이미 있는 카드는 제외하고, {추가/중복} 개수를 반환.
// 대상 없으면 {added:0, skipped:0}.
export function addCardsToDeck(id: string, cardKeys: string[]): { added: number; skipped: number } {
  const decks = loadCustomDecks();
  const deck = decks.find((d) => d.id === id);
  if (!deck) return { added: 0, skipped: 0 };
  const existing = new Set(deck.cardKeys);
  const unique = [...new Set(cardKeys)]; // 선택 자체 중복 방어
  const fresh = unique.filter((k) => !existing.has(k));
  if (fresh.length > 0) {
    saveAll(decks.map((d) => (d.id === id ? { ...d, cardKeys: [...d.cardKeys, ...fresh] } : d)));
  }
  return { added: fresh.length, skipped: unique.length - fresh.length };
}

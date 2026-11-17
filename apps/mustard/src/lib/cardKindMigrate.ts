// #1369 캐치업 용어 칩으로 IT용어 카드에 잘못 들어간 코드 이름 → 토큰 카드로 한 번 옮김.
// 카드 키(`term:X` → `token:X`)를 쓰는 곳(복습 진도·카드 설명·카드 대화·덱·다른 카드의 originCardKey)도 같이.
// 진행 중 복습 세션(nunopi:mem-session)은 이어하기 때 없는 카드를 건너뛰므로 안 건드림.
// 저장 키 이름은 packages/core bookmarkDetails·packages/nunopi srs 쪽과 같아야 함(여기서 직접 읽고 씀 — node 점검 가능하게).
import { cardKindOf } from "./catchupTerms.ts";

type Store = Pick<Storage, "getItem" | "setItem">;
type Rec = Record<string, Record<string, unknown>>;
const K = {
  token: "nunopi:bookmark-token-details", term: "nunopi:bookmark-term-details", concept: "nunopi:bookmark-concept-details",
  srs: "nunopi:srs-state", explain: "nunopi:card-explain", chat: "nunopi:card-chat", decks: "nunopi:mem-custom-decks",
  done: "nunopi:migrated-term-token-1369",
};
const read = <T,>(s: Store, k: string, d: T): T => { try { const v = s.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const norm = (x: string) => x.trim().toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, ""); // core normalizeCardFront와 같음

// 반환: 옮긴 카드 수(이미 했으면 0). 실패해도 앱은 계속(다음 시작에 다시 시도).
export function migrateCatchupTermCards(s: Store): number {
  if (s.getItem(K.done)) return 0;
  const terms = read<Rec>(s, K.term, {}), tokens = read<Rec>(s, K.token, {});
  const tokenNorm = new Set(Object.keys(tokens).map(norm));
  const moves: [string, string][] = []; // [옛 term 키, 새 token 키]
  for (const [k, v] of Object.entries(terms)) {
    const src = String(v.sourceSessionId ?? "");
    if (v.sourceKind !== "workspace" || !src.startsWith("catchup:")) continue; // 캐치업에서 만든 카드만 — 분석·질문에서 담은 IT용어는 그대로
    if (cardKindOf(k.replace(/`/g, ""), String(v.explanation ?? "")) !== "token") continue; // 백틱 떼고 새 규칙으로(`정적 파일(…)`처럼 한글 든 건 IT용어 유지)
    const name = k.replace(/`/g, "").trim();
    if (!tokenNorm.has(norm(name))) {
      const rest = Object.fromEntries(Object.entries(v).filter(([f]) => !["term", "explanation", "conceptIds", "id"].includes(f))); // 출처·저장 시각 등은 그대로
      tokens[name] = { ...rest, id: `chat:${name}`, token: name, category: "keyword", label: name, description: String(v.explanation ?? ""), lines: [] };
      tokenNorm.add(norm(name));
    } // 같은 이름 토큰 카드가 이미 있으면 IT용어 쪽만 정리(중복)
    delete terms[k];
    moves.push([`term:${k}`, `token:${name}`]);
  }
  if (moves.length) {
    s.setItem(K.token, JSON.stringify(tokens));
    s.setItem(K.term, JSON.stringify(terms));
    const re = new Map(moves);
    for (const key of [K.srs, K.explain]) { // 키 → 값 맵: 새 키에 이미 있으면 그쪽 유지
      const m = read<Record<string, unknown>>(s, key, {});
      let ch = false;
      for (const [a, b] of re) if (a in m) { if (!(b in m)) m[b] = m[a]; delete m[a]; ch = true; }
      if (ch) s.setItem(key, JSON.stringify(m));
    }
    const chat = read<Record<string, unknown[]>>(s, K.chat, {}); let chCh = false; // 카드 대화: 합침
    for (const [a, b] of re) if (Array.isArray(chat[a])) { chat[b] = [...(Array.isArray(chat[b]) ? chat[b] : []), ...chat[a]]; delete chat[a]; chCh = true; }
    if (chCh) s.setItem(K.chat, JSON.stringify(chat));
    const decks = read<{ cardKeys?: string[] }[]>(s, K.decks, []); let dCh = false;
    for (const d of Array.isArray(decks) ? decks : []) if (Array.isArray(d.cardKeys) && d.cardKeys.some((x) => re.has(x))) { d.cardKeys = [...new Set(d.cardKeys.map((x) => re.get(x) ?? x))]; dCh = true; }
    if (dCh) s.setItem(K.decks, JSON.stringify(decks));
    for (const key of [K.token, K.term, K.concept]) { // 이 카드에서 만든 카드들의 출처 키
      const m = read<Rec>(s, key, {}); let ch = false;
      for (const v of Object.values(m)) { const o = typeof v.originCardKey === "string" ? re.get(v.originCardKey) : undefined; if (o) { v.originCardKey = o; ch = true; } }
      if (ch) s.setItem(key, JSON.stringify(m));
    }
  }
  s.setItem(K.done, new Date().toISOString());
  return moves.length;
}

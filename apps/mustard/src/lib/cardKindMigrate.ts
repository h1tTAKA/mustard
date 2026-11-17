// #1369 캐치업 용어 칩으로 IT용어 카드에 잘못 들어간 코드 이름 → 토큰 카드로 한 번 옮김.
// 카드 키(`term:X` → `token:X`)를 쓰는 곳(복습 진도·카드 설명·카드 대화·덱·다른 카드의 originCardKey)도 같이.
// 진행 중 복습 세션(nunopi:mem-session)은 이어하기 때 없는 카드를 건너뛰므로 안 건드림.
// 저장 키 이름은 packages/core bookmarkDetails·packages/nunopi srs 쪽과 같아야 함(여기서 직접 읽고 씀 — node 점검 가능하게).
import { cardKindOf } from "./catchupTerms.ts";

type Store = Pick<Storage, "getItem" | "setItem">;
type Rec = Record<string, Record<string, unknown>>;
const K = {
  token: "nunopi:bookmark-token-details", term: "nunopi:bookmark-term-details", concept: "nunopi:bookmark-concept-details",
  starTok: "nunopi:bookmark-tokens", starTerm: "nunopi:bookmark-terms", // 별 표시(이름 문자열 배열, LearningPanel)
  srs: "nunopi:srs-state", explain: "nunopi:card-explain", chat: "nunopi:card-chat", decks: "nunopi:mem-custom-decks",
  done: "nunopi:migrated-term-token-1369",
};
const read = <T,>(s: Store, k: string, d: T): T => { try { const v = s.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const norm = (x: string) => x.trim().toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, ""); // core normalizeCardFront와 같음

// 반환: 옮긴 카드 수(이미 했으면 0). 실패해도 앱은 계속(다음 시작에 다시 시도).
export function migrateCatchupTermCards(s: Store): number {
  if (s.getItem(K.done)) return 0;
  const terms = read<Rec>(s, K.term, {}), tokens = read<Rec>(s, K.token, {});
  const termKeys0 = Object.keys(terms); // 별 표시 저장이 없으면 LearningPanel은 IT용어 카드 전부를 별 켠 것으로 봄 — 옮기기 전 키로 그 기본값 재현(리뷰)
  const tokenKey = new Map(Object.keys(tokens).map((k) => [norm(k), k])); // 정규화 이름 → 실제 토큰 키(대소문자 다른 기존 카드에 맞춰 붙이려고, 리뷰)
  const moves: [string, string][] = []; // [옛 term 키, 새 token 키]
  const movedNames: [string, string][] = []; // [옛 term 이름, 새 token 이름] — 별 표시용
  for (const [k, v] of Object.entries(terms)) {
    const src = String(v.sourceSessionId ?? "");
    if (v.sourceKind !== "workspace" || !src.startsWith("catchup:")) continue; // 캐치업에서 만든 카드만 — 분석·질문에서 담은 IT용어는 그대로
    if (cardKindOf(k, String(v.explanation ?? "")) !== "token") continue; // 칩과 같은 규칙(백틱 영문 이름은 토큰, `정적 파일(…)`처럼 한글 든 건 IT용어)
    const name = k.replace(/`/g, "").trim();
    let to = tokenKey.get(norm(name));
    if (!to) { // 같은 이름 토큰 카드가 이미 있으면 그 카드에 붙이고 IT용어 쪽만 정리(중복)
      const rest = Object.fromEntries(Object.entries(v).filter(([f]) => !["term", "explanation", "conceptIds", "id"].includes(f))); // 출처·저장 시각 등은 그대로
      tokens[name] = { ...rest, id: `chat:${name}`, token: name, category: "keyword", label: name, description: String(v.explanation ?? ""), lines: [] };
      tokenKey.set(norm(name), (to = name));
    }
    delete terms[k];
    moves.push([`term:${k}`, `token:${to}`]);
    movedNames.push([k, to]);
  }
  if (moves.length) {
    // 쓰는 순서: 토큰 카드 → 키 옮기기 → IT용어 카드 지우기(맨 끝). 중간에 실패해도 다음 시작에 IT용어 카드가 남아 있어 처음부터 다시(키 옮기기는 여러 번 해도 같음, 리뷰)
    s.setItem(K.token, JSON.stringify(tokens));
    const re = new Map(moves);
    for (const key of [K.srs, K.explain]) { // 키 → 값 맵: 새 키에 이미 있으면 그쪽 유지
      const m = read<Record<string, unknown>>(s, key, {});
      let ch = false;
      for (const [a, b] of re) if (a in m) { if (!(b in m)) m[b] = m[a]; delete m[a]; ch = true; }
      if (ch) s.setItem(key, JSON.stringify(m));
    }
    const chat = read<Record<string, unknown[]>>(s, K.chat, {}); let chCh = false; // 카드 대화: 합침(옛 형식 메시지 배열은 세션 하나로 감싸서 — cardChat loadCardSessions와 같은 꼴)
    const asSessions = (v: unknown): unknown[] => !Array.isArray(v) || !v.length ? [] : v[0] && typeof v[0] === "object" && "messages" in v[0] ? v : [{ id: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, createdAt: new Date().toISOString(), messages: v }];
    for (const [a, b] of re) if (Array.isArray(chat[a])) { chat[b] = [...asSessions(chat[b]), ...asSessions(chat[a])]; delete chat[a]; chCh = true; }
    if (chCh) s.setItem(K.chat, JSON.stringify(chat));
    const decks = read<{ cardKeys?: string[] }[]>(s, K.decks, []); let dCh = false;
    for (const d of Array.isArray(decks) ? decks : []) if (Array.isArray(d.cardKeys) && d.cardKeys.some((x) => re.has(x))) { d.cardKeys = [...new Set(d.cardKeys.map((x) => re.get(x) ?? x))]; dCh = true; }
    if (dCh) s.setItem(K.decks, JSON.stringify(decks));
    for (const key of [K.token, K.term, K.concept]) { // 이 카드에서 만든 카드들의 출처 키
      const m = key === K.term ? terms : read<Rec>(s, key, {}); let ch = key === K.term;
      for (const v of Object.values(m)) { const o = typeof v.originCardKey === "string" ? re.get(v.originCardKey) : undefined; if (o) { v.originCardKey = o; ch = true; } }
      if (ch && key !== K.term) s.setItem(key, JSON.stringify(m));
    }
    const starTerm = s.getItem(K.starTerm) === null ? termKeys0 : read<string[]>(s, K.starTerm, []), starTok = read<string[]>(s, K.starTok, []); // 별 표시도 같이(리뷰)
    if (Array.isArray(starTerm) && Array.isArray(starTok) && movedNames.some(([a]) => starTerm.includes(a))) {
      for (const [a, b] of movedNames) if (starTerm.includes(a) && !starTok.includes(b)) starTok.push(b);
      s.setItem(K.starTok, JSON.stringify(starTok));
      s.setItem(K.starTerm, JSON.stringify(starTerm.filter((x) => !movedNames.some(([a]) => a === x))));
    }
    s.setItem(K.term, JSON.stringify(terms)); // 맨 끝
  }
  s.setItem(K.done, new Date().toISOString());
  return moves.length;
}

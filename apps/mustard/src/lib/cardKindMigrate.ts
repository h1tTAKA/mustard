// #1369 IT용어 카드에 잘못 들어간 카드 → 토큰 카드(코드 이름) 또는 개념 카드(프로그래밍 개념). 둘 다 '프로그래밍/개념' 덱.
// 카드 키(`term:X` → `token:X`·`concept:X`)를 쓰는 곳(복습 진도·카드 설명·카드 대화·덱·다른 카드의 originCardKey·별 표시)도 같이.
// 진행 중 복습 세션(nunopi:mem-session)은 이어하기 때 없는 카드를 건너뛰므로 안 건드림.
// 저장 키 이름은 packages/core bookmarkDetails·packages/nunopi srs 쪽과 같아야 함(여기서 직접 읽고 씀 — node 점검 가능하게).
import { cardKindOf, type CardKind } from "./catchupTerms.ts";

type Store = Pick<Storage, "getItem" | "setItem">;
type Rec = Record<string, Record<string, unknown>>;
const K = {
  token: "nunopi:bookmark-token-details", term: "nunopi:bookmark-term-details", concept: "nunopi:bookmark-concept-details",
  starTok: "nunopi:bookmark-tokens", starTerm: "nunopi:bookmark-terms", starConcept: "nunopi:bookmark-concepts", // 별 표시(이름 문자열 배열, LearningPanel). 저장이 없으면 IT용어·개념은 "전부 별", 토큰은 "없음"으로 봄
  srs: "nunopi:srs-state", explain: "nunopi:card-explain", chat: "nunopi:card-chat", decks: "nunopi:mem-custom-decks",
  done: "nunopi:migrated-term-token-1369", doneAI: "nunopi:migrated-term-kind-ai-1369", checkedAI: "nunopi:term-kind-ai-kept", missAI: "nunopi:term-kind-ai-miss", // AI가 IT라고 답한 카드(다음에 다시 안 물음) / 답이 빠진 횟수
};
const read = <T,>(s: Store, k: string, d: T): T => { try { const v = s.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const norm = (x: string) => x.trim().toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, ""); // core normalizeCardFront와 같음

// IT용어 카드(키 → 갈 곳)를 옮김. 반환: 옮긴 수. 쓰는 순서: 새 카드 → 키 옮기기 → IT용어 카드 지우기(맨 끝) — 중간에 실패해도 다음에 처음부터(키 옮기기는 여러 번 해도 같음, 리뷰)
export function moveTermCards(s: Store, picks: Map<string, "token" | "concept">): number {
  const terms = read<Rec>(s, K.term, {}), tokens = read<Rec>(s, K.token, {}), concepts = read<Rec>(s, K.concept, {});
  const termKeys0 = Object.keys(terms), conceptKeys0 = Object.keys(concepts); // 별 표시 저장이 없으면 LearningPanel은 IT용어·개념 카드 전부를 별 켠 것으로 봄 — 옮기기 전 키로 그 기본값 재현(리뷰)
  const has = new Map<string, string>([...Object.keys(concepts).map((k) => [norm(k), `concept:${k}`] as const), ...Object.keys(tokens).map((k) => [norm(k), `token:${k}`] as const)]); // 프로그래밍 덱에 이미 같은 이름이 있으면 그 카드에 붙임(대소문자 달라도, 리뷰)
  const moves: [string, string][] = []; // [옛 카드 키, 새 카드 키]
  const starMoves: [string, string][] = []; // [옛 IT용어 이름, 새 카드 키] — 별도 토큰·개념 별 저장소로
  for (const [k, to] of picks) {
    const v = terms[k];
    if (!v) continue;
    const name = k.replace(/`/g, "").trim();
    let key = has.get(norm(name));
    if (!key) {
      const rest = Object.fromEntries(Object.entries(v).filter(([f]) => !["term", "explanation", "conceptIds", "id"].includes(f))); // 출처·저장 시각 등은 그대로
      const desc = String(v.explanation ?? "");
      if (to === "token") tokens[name] = { ...rest, id: `chat:${name}`, token: name, category: "keyword", label: name, description: desc, lines: [] };
      else concepts[name] = { ...rest, conceptId: `chat:${name}`, title: name, description: desc };
      key = `${to}:${name}`; has.set(norm(name), key);
    }
    delete terms[k];
    moves.push([`term:${k}`, key]);
    starMoves.push([k, key]);
  }
  if (!moves.length) return 0;
  s.setItem(K.token, JSON.stringify(tokens));
  s.setItem(K.concept, JSON.stringify(concepts));
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
  for (const key of [K.token, K.concept, K.term]) { // 이 카드에서 만든 카드들의 출처 키
    const m = key === K.term ? terms : read<Rec>(s, key, {}); let ch = false;
    for (const v of Object.values(m)) { const o = typeof v.originCardKey === "string" ? re.get(v.originCardKey) : undefined; if (o) { v.originCardKey = o; ch = true; } }
    if (ch && key !== K.term) s.setItem(key, JSON.stringify(m));
  }
  const starTerm = s.getItem(K.starTerm) === null ? termKeys0 : read<string[]>(s, K.starTerm, []); // 별 표시도 같이(리뷰)
  const starred = starMoves.filter(([a]) => Array.isArray(starTerm) && starTerm.includes(a));
  if (Array.isArray(starTerm) && starMoves.length) {
    const tok = read<string[]>(s, K.starTok, []);
    const con = s.getItem(K.starConcept) === null ? conceptKeys0 : read<string[]>(s, K.starConcept, []); // 개념 별 저장이 없으면 기존 개념 전부 별 — 그 상태를 적어 두고 옮긴 것만 더함(안 그러면 별 없던 카드가 별로 보임)
    for (const [, b] of starred) { const [src, name] = [b.slice(0, b.indexOf(":")), b.slice(b.indexOf(":") + 1)]; const arr = src === "token" ? tok : con; if (Array.isArray(arr) && !arr.includes(name)) arr.push(name); }
    if (Array.isArray(tok) && starred.some(([, b]) => b.startsWith("token:"))) s.setItem(K.starTok, JSON.stringify(tok));
    if (Array.isArray(con) && (s.getItem(K.starConcept) === null ? starMoves.some(([, b]) => b.startsWith("concept:")) : starred.some(([, b]) => b.startsWith("concept:")))) s.setItem(K.starConcept, JSON.stringify(con));
    if (starred.length) s.setItem(K.starTerm, JSON.stringify(starTerm.filter((x) => !re.has(`term:${x}`))));
  }
  s.setItem(K.term, JSON.stringify(terms)); // 맨 끝
  return moves.length;
}

// 1차(이름·뜻 규칙): 캐치업 칩에서 만든 IT용어 카드 중 코드 이름 → 토큰. 반환: 옮긴 카드 수(이미 했으면 0).
export function migrateCatchupTermCards(s: Store): number {
  if (s.getItem(K.done)) return 0;
  const picks = new Map<string, "token">();
  for (const [k, v] of Object.entries(read<Rec>(s, K.term, {}))) {
    if (v.sourceKind !== "workspace" || !String(v.sourceSessionId ?? "").startsWith("catchup:")) continue; // 캐치업에서 만든 카드만
    if (cardKindOf(k, String(v.explanation ?? "")) === "token") picks.set(k, "token"); // 칩과 같은 규칙(백틱 영문 이름은 토큰)
  }
  const n = moveTermCards(s, picks);
  s.setItem(K.done, new Date().toISOString());
  return n;
}

// 2차(AI): 대화로 만든 IT용어 카드(캐치업·작업 채팅·질문 — 분석 화면 '글' 모드에서 담은 건 빼고)를 해설 AI가 코드·개념·IT로 다시 나눔.
// 코드 → 토큰, 개념 → 개념 카드, IT → 그대로(기억해 두고 다시 안 물음). 80장씩 묻고, 실패하거나 답이 빠지면 완료 표시 없이 끝(다음 시작에 남은 것만 다시).
export async function reclassifyTermCards(s: Store, classify: (items: { name: string; def: string }[]) => Promise<(CardKind | null | undefined)[]>): Promise<number> {
  if (s.getItem(K.doneAI)) return 0;
  return reclassifyOnce(s, classify); // 창 여러 개 동시 실행은 호출부가 Web Locks로 막음(저장소 시각 잠금은 창이 갑자기 닫히면 10분 묶여서 뺌, 리뷰)
}
async function reclassifyOnce(s: Store, classify: (items: { name: string; def: string }[]) => Promise<(CardKind | null | undefined)[]>): Promise<number> {
  const kept = new Set(read<string[]>(s, K.checkedAI, []));
  const all = Object.entries(read<Rec>(s, K.term, {})).filter(([k, v]) => (v.sourceKind === "workspace" || v.sourceKind === "ask") && !kept.has(k)); // workspace = 캐치업 칩·작업 채팅, ask = 질문 화면. 분석 화면('글' 모드, sourceKind analysis)에서 담은 건 그 화면의 분류라 빼기
  const miss = read<Record<string, number>>(s, K.missAI, {});
  let moved = 0, missed = false;
  for (let i = 0; i < all.length; i += 80) {
    const chunk = all.slice(i, i + 80);
    const kinds = await classify(chunk.map(([k, v]) => ({ name: k, def: String(v.explanation ?? "") })));
    const picks = new Map<string, "token" | "concept">();
    chunk.forEach(([k], j) => {
      const kd = kinds[j];
      if (kd === "token" || kd === "concept") picks.set(k, kd);
      else if (kd === "term") kept.add(k);
      else if ((miss[k] = (miss[k] ?? 0) + 1) >= 3) kept.add(k); // 세 번 물어도 답이 없으면 IT용어로 둠 — 앱 켤 때마다 AI를 부르지 않게(리뷰)
      else missed = true;
    });
    s.setItem(K.missAI, JSON.stringify(miss));
    moved += moveTermCards(s, picks);
    s.setItem(K.checkedAI, JSON.stringify([...kept]));
  }
  if (!missed) s.setItem(K.doneAI, new Date().toISOString()); // 답이 빠진 카드가 있으면 완료 표시 없이 — 다음 시작에 그것만 다시(리뷰)
  return moved;
}

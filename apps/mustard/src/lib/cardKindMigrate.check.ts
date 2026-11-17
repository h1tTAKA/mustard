// cardKindMigrate 점검 — node --experimental-strip-types src/lib/cardKindMigrate.check.ts
import assert from "node:assert";
import { migrateCatchupTermCards } from "./cardKindMigrate.ts";

const mem = (init: Record<string, unknown>) => { const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)])); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), get: (k: string) => JSON.parse(m.get(k) ?? "null") }; };
const ws = { sourceKind: "workspace", sourceSessionId: "catchup:terms", sourceRoot: "/r", bookmarkedAt: "2026-11-17T00:00:00Z" };
const s = mem({
  "nunopi:bookmark-term-details": {
    dispose: { id: "chat:dispose", term: "dispose", explanation: "화면이 사라질 때 자원을 정리하는 메서드", conceptIds: [], bookmarkable: true, ...ws },
    "`useCallback`": { id: "chat:`useCallback`", term: "`useCallback`", explanation: "함수를 같은 참조로 유지하는 훅", conceptIds: [], bookmarkable: true, ...ws },
    PageView: { id: "chat:PageView", term: "PageView", explanation: "페이지를 넘기는 위젯", conceptIds: [], bookmarkable: true, ...ws }, // 토큰 카드 이미 있음 → 중복 정리
    viewport: { id: "chat:viewport", term: "viewport", explanation: "브라우저 화면 크기", conceptIds: [], bookmarkable: true, ...ws }, // IT용어 유지
    split: { id: "chat:split", term: "split", explanation: "문자열을 나누는 함수", conceptIds: [], bookmarkable: true, sourceKind: "analysis" }, // 캐치업 아님 → 유지
  },
  "nunopi:bookmark-token-details": { PageView: { id: "chat:PageView", token: "PageView", description: "기존", lines: [] } },
  "nunopi:bookmark-concept-details": { x: { title: "x", originCardKey: "term:dispose" } },
  "nunopi:srs-state": { "term:dispose": { box: 3 }, "term:PageView": { box: 1 }, "token:PageView": { box: 4 }, "term:viewport": { box: 2 } },
  "nunopi:card-explain": { "term:`useCallback`": "설명" },
  "nunopi:card-chat": { "term:dispose": [{ id: "a" }], "token:dispose": [{ id: "b" }] },
  "nunopi:mem-custom-decks": [{ id: "d", cardKeys: ["term:dispose", "token:dispose", "term:viewport"] }],
});
assert.equal(migrateCatchupTermCards(s), 3);
const tok = s.get("nunopi:bookmark-token-details"), term = s.get("nunopi:bookmark-term-details");
assert.deepEqual(Object.keys(term).sort(), ["split", "viewport"]);
assert.equal(tok.dispose.description, "화면이 사라질 때 자원을 정리하는 메서드");
assert.equal(tok.dispose.sourceSessionId, "catchup:terms"); // 출처 보존
assert.equal(tok.dispose.bookmarkedAt, "2026-11-17T00:00:00Z"); // 저장 시각 보존
assert.equal(tok.useCallback.token, "useCallback"); // 백틱 뗌
assert.equal(tok.PageView.description, "기존"); // 기존 토큰 카드 유지
assert.deepEqual(s.get("nunopi:srs-state"), { "token:dispose": { box: 3 }, "token:PageView": { box: 4 }, "term:viewport": { box: 2 } });
assert.deepEqual(s.get("nunopi:card-explain"), { "token:useCallback": "설명" });
assert.deepEqual(s.get("nunopi:card-chat"), { "token:dispose": [{ id: "b" }, { id: "a" }] });
assert.deepEqual(s.get("nunopi:mem-custom-decks")[0].cardKeys, ["token:dispose", "term:viewport"]);
assert.equal(s.get("nunopi:bookmark-concept-details").x.originCardKey, "token:dispose");
assert.equal(migrateCatchupTermCards(s), 0, "두 번째는 안 함");
assert.equal(migrateCatchupTermCards(mem({})), 0, "빈 저장소");
console.log("cardKindMigrate ok");

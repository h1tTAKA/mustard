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
  "nunopi:card-chat": { "term:dispose": [{ id: "a", messages: [] }], "token:dispose": [{ id: "b", messages: [] }] },
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
assert.deepEqual(s.get("nunopi:card-chat"), { "token:dispose": [{ id: "b", messages: [] }, { id: "a", messages: [] }] });
assert.deepEqual(s.get("nunopi:mem-custom-decks")[0].cardKeys, ["token:dispose", "term:viewport"]);
assert.equal(s.get("nunopi:bookmark-concept-details").x.originCardKey, "token:dispose");
assert.equal(migrateCatchupTermCards(s), 0, "두 번째는 안 함");
assert.equal(migrateCatchupTermCards(mem({})), 0, "빈 저장소");

// 리뷰: 대소문자 다른 기존 토큰 카드엔 그 실제 키로 붙임 / 옛 형식 대화는 세션으로 감쌈 / 별 표시도 옮김
const s2 = mem({
  "nunopi:bookmark-term-details": { dispose: { term: "dispose", explanation: "자원을 정리하는 메서드", ...ws } },
  "nunopi:bookmark-token-details": { Dispose: { token: "Dispose", description: "기존", lines: [] } },
  "nunopi:srs-state": { "term:dispose": { box: 2 } },
  "nunopi:card-chat": { "term:dispose": [{ role: "user", content: "질문" }], "token:Dispose": [{ id: "b", messages: [] }] },
  "nunopi:bookmark-terms": ["dispose", "viewport"], "nunopi:bookmark-tokens": [],
});
assert.equal(migrateCatchupTermCards(s2), 1);
assert.deepEqual(Object.keys(s2.get("nunopi:bookmark-token-details")), ["Dispose"]);
assert.deepEqual(s2.get("nunopi:srs-state"), { "token:Dispose": { box: 2 } });
const ch = s2.get("nunopi:card-chat")["token:Dispose"];
assert.equal(ch.length, 2); assert.deepEqual(ch[1].messages, [{ role: "user", content: "질문" }]);
assert.deepEqual(s2.get("nunopi:bookmark-tokens"), ["Dispose"]); assert.deepEqual(s2.get("nunopi:bookmark-terms"), ["viewport"]);

// 리뷰: 중간에 저장이 실패하면 IT용어 카드가 남아 다음 시작에 키 옮기기까지 다시
const s3 = mem({ "nunopi:bookmark-term-details": { dispose: { term: "dispose", explanation: "자원을 정리하는 메서드", ...ws } }, "nunopi:srs-state": { "term:dispose": { box: 5 } } });
const real = s3.setItem; let fail = true;
s3.setItem = (k: string, v: string) => { if (fail && k === "nunopi:srs-state") throw new Error("quota"); real(k, v); };
assert.throws(() => migrateCatchupTermCards(s3));
assert.ok(s3.get("nunopi:bookmark-term-details").dispose, "IT용어 카드 아직 있음");
fail = false;
assert.equal(migrateCatchupTermCards(s3), 1);
assert.deepEqual(s3.get("nunopi:srs-state"), { "token:dispose": { box: 5 } });
console.log("cardKindMigrate ok");

// cardKindMigrate 점검 — node --experimental-strip-types src/lib/cardKindMigrate.check.ts
import assert from "node:assert";
import { migrateCatchupTermCards, reclassifyTermCards } from "./cardKindMigrate.ts";

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

// 리뷰: 별 표시 저장이 없으면(=IT용어 전부 별) 옮긴 카드도 별 유지
const s4 = mem({ "nunopi:bookmark-term-details": { dispose: { term: "dispose", explanation: "자원을 정리하는 메서드", ...ws }, viewport: { term: "viewport", explanation: "화면 크기", ...ws } } });
migrateCatchupTermCards(s4);
assert.deepEqual(s4.get("nunopi:bookmark-tokens"), ["dispose"]); assert.deepEqual(s4.get("nunopi:bookmark-terms"), ["viewport"]);

// 2차(AI): 코드 → 토큰, 개념 → 개념 카드, IT·모름 → 그대로. 분석 화면에서 담은 건 안 물음. 실패하면 완료 표시 없음.
const s5 = mem({
  "nunopi:bookmark-term-details": {
    split: { term: "split", explanation: "문자열을 나누는 함수", ...ws },
    "재귀(recursion)": { term: "재귀(recursion)", explanation: "자기를 부르는 구조", sourceKind: "ask" },
    TTS: { term: "TTS", explanation: "글을 소리로", ...ws },
    Closure: { term: "Closure", explanation: "함수와 변수를 묶은 것", ...ws }, // 개념 카드 이미 있음(대소문자 다름)
    글분석: { term: "글분석", explanation: "x", sourceKind: "analysis" },
  },
  "nunopi:bookmark-concept-details": { closure: { conceptId: "c", title: "closure", description: "기존" } },
  "nunopi:srs-state": { "term:재귀(recursion)": { box: 2 }, "term:Closure": { box: 1 } },
});
let asked: string[] = [];
const fake = async (items: { name: string }[]) => { asked = items.map((x) => x.name); return items.map((x) => (x.name === "split" ? "token" : x.name === "TTS" ? "term" : "concept")) as ("token" | "concept" | "term")[]; };
assert.equal(await reclassifyTermCards(s5, fake), 3);
assert.deepEqual(asked.sort(), ["Closure", "TTS", "split", "재귀(recursion)"]);
assert.deepEqual(Object.keys(s5.get("nunopi:bookmark-term-details")).sort(), ["TTS", "글분석"]);
assert.equal(s5.get("nunopi:bookmark-token-details").split.description, "문자열을 나누는 함수");
const cs = s5.get("nunopi:bookmark-concept-details");
assert.equal(cs["재귀(recursion)"].title, "재귀(recursion)"); assert.equal(cs["재귀(recursion)"].description, "자기를 부르는 구조"); assert.equal(cs.closure.description, "기존");
assert.deepEqual(s5.get("nunopi:srs-state"), { "concept:재귀(recursion)": { box: 2 }, "concept:closure": { box: 1 } });
assert.equal(await reclassifyTermCards(s5, fake), 0, "두 번째는 안 함");
const s6 = mem({ "nunopi:bookmark-term-details": { split: { term: "split", explanation: "함수", ...ws } } });
await assert.rejects(reclassifyTermCards(s6, async () => { throw new Error("AI 없음"); }));
assert.equal(s6.getItem("nunopi:migrated-term-kind-ai-1369"), null, "실패하면 다음에 다시");
// 리뷰: 개념으로 옮긴 카드의 별 — 개념 별 저장이 없으면 기존 개념 전부 별인 상태를 적어 두고 별 있던 것만 더함
const s7 = mem({
  "nunopi:bookmark-term-details": { 재귀: { term: "재귀", explanation: "x", ...ws }, 상태: { term: "상태", explanation: "y", ...ws } },
  "nunopi:bookmark-concept-details": { 클로저: { title: "클로저" } },
  "nunopi:bookmark-terms": ["재귀"],
});
assert.equal(await reclassifyTermCards(s7, async (it) => it.map(() => "concept" as const)), 2);
assert.deepEqual(s7.get("nunopi:bookmark-concepts"), ["클로저", "재귀"]); // 상태(별 없던 것)는 별 없음
assert.deepEqual(s7.get("nunopi:bookmark-terms"), []);
// 리뷰: 다른 창이 하는 중이면 안 함
const s8 = mem({ "nunopi:bookmark-term-details": { 재귀: { term: "재귀", explanation: "x", ...ws } }, "nunopi:migrating-term-kind-ai": Date.now() });
assert.equal(await reclassifyTermCards(s8, async () => ["concept"]), 0);
console.log("cardKindMigrate ok");

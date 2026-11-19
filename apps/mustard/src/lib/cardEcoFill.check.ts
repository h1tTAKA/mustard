// cardEcoFill 점검 — node --experimental-strip-types src/lib/cardEcoFill.check.ts
import assert from "node:assert/strict";
import { fillCardEco } from "./cardEcoFill.ts";

const mem = (init: Record<string, unknown>) => { const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)])); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const s = mem({ "nunopi:bookmark-token-details": { Positioned: { token: "Positioned", description: "Stack 안 위치" }, useState: { token: "useState", description: "상태 훅" }, foo: { token: "foo", description: "" } }, "nunopi:card-eco": { "token:useState": "React" } });
let asked: string[] = [];
const n = await fillCardEco(s, async (items) => { asked = items.map((x) => x.name); return ["Flutter", undefined]; });
assert.deepEqual(asked, ["Positioned", "foo"], "이미 있는 건 안 물음");
assert.equal(n, 1);
assert.deepEqual(JSON.parse(s.m.get("nunopi:card-eco")!), { "token:useState": "React", "token:Positioned": "Flutter" }, "답 빠진 foo는 비워 둠(다음에 다시)");
const n2 = await fillCardEco(s, async () => [undefined]);
assert.equal(n2, 1, "두 번째로 빠지면 모름으로 저장");
assert.equal(JSON.parse(s.m.get("nunopi:card-eco")!)["token:foo"], "", "foo = 모름 — 더 안 물음");
assert.equal(await fillCardEco(mem({}), async () => { throw new Error("no"); }), 0, "토큰 없으면 안 물음");
console.log("cardEcoFill ok");

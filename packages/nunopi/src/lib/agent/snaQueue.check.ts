// snaQueue 점검(#1162) — node --experimental-strip-types packages/nunopi/src/lib/agent/snaQueue.check.ts
import assert from "node:assert";
import { abortable, acquireSnaSlot, SNA_SLOTS, snaQ } from "./snaQueue.ts";

const order: string[] = [];
const held = await Promise.all(Array.from({ length: SNA_SLOTS }, () => acquireSnaSlot())); // 칸을 다 채움(캐치업 자동 설명들)
const wait = (name: string, priority = false) => acquireSnaSlot(undefined, priority).then((rel) => { order.push(name); return rel; });
const a = wait("auto-1"), b = wait("auto-2"), c = wait("crew", true); // 크루 답은 나중에 왔어도
held[0](); const r1 = await Promise.race([a, b, c]); // 한 칸 비면
assert.deepStrictEqual(order, ["crew"], "우선순위가 줄 맨 앞");
held[1](); held[2](); await Promise.all([a, b]);
assert.deepStrictEqual(order, ["crew", "auto-1", "auto-2"], "나머지는 온 순서");
r1(); held[3](); (await a)(); (await b)();
assert.strictEqual(snaQ.busy, 0, "다 돌려줌");
// 취소하면 줄에서 빠짐
const all = await Promise.all(Array.from({ length: SNA_SLOTS }, () => acquireSnaSlot()));
const ac = new AbortController();
const cancelled = acquireSnaSlot(ac.signal, true).then(() => "got", (e) => String(e.message));
ac.abort();
assert.strictEqual(await cancelled, "Analysis cancelled.");
assert.strictEqual(snaQ.waiters.length, 0, "취소된 대기자 정리");
all.forEach((r) => r());
// #1162 abortable — 멈춘 스트림도 취소하면 바로 던짐(다음 이벤트 안 기다림)
const stuck = (async function* () { yield 1; await new Promise(() => {}); })();
const ac2 = new AbortController(), got: number[] = [];
const t0 = Date.now();
setTimeout(() => ac2.abort(), 30);
await assert.rejects((async () => { for await (const v of abortable(stuck, ac2.signal)) got.push(v); })(), /cancelled/);
assert.deepStrictEqual(got, [1]); assert.ok(Date.now() - t0 < 500, "바로 끊김");
const all3: number[] = [];
for await (const v of abortable((async function* () { yield 1; yield 2; yield 3; })(), new AbortController().signal)) all3.push(v);
assert.deepStrictEqual(all3, [1, 2, 3], "취소 안 하면 그대로");
console.log("snaQueue.check ok");

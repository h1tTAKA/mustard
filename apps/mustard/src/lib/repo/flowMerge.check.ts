// flowMerge.ts self-check(#1320) — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/flowMerge.check.ts
import assert from "node:assert";
import { applyFlowDiff, mergeFlow, tourOrder } from "./flowMerge.ts";

const flow = [
  { layer: "진입", nodes: [{ name: "Page", file: "a.tsx", next: ["Api"] }, { name: "Old", file: "gone.ts", next: ["Api"] }] },
  { layer: "처리", nodes: [{ name: "Api", file: "b.ts", next: ["Db"] }, { name: "Db", file: "c.ts" }] },
];

// 지운 파일 노드 삭제 + 그 노드를 가리키던 next 정리, LLM 결과 없음(구조 변화 0일 때와 같음).
const r1 = applyFlowDiff(flow, [], ["gone.ts"], []);
assert.deepStrictEqual(r1[0].nodes.map((n) => n.name), ["Page"]);
assert.strictEqual(r1[1].nodes.length, 2, "다른 파일 노드 그대로");

// 바뀐 파일(b.ts) 노드는 LLM 것으로 교체, LLM이 언급 안 한 바뀐 파일(c.ts)은 그대로.
const r2 = applyFlowDiff(flow, [{ layer: "처리", nodes: [{ name: "Api2", file: "b.ts", next: ["Db"] }] }], [], ["b.ts", "c.ts"]);
assert.deepStrictEqual(r2[1].nodes.map((n) => n.name), ["Db", "Api2"]);
assert.deepStrictEqual(r2[0].nodes.find((n) => n.name === "Page")!.next, [], "사라진 Api를 가리키던 next 정리");

// 안 바뀐 파일에 LLM이 노드를 줘도 기존 노드 교체 안 함 — 새 이름만 추가.
const r3 = applyFlowDiff(flow, [{ layer: "데이터", nodes: [{ name: "Cache", file: "c.ts" }] }], [], ["b.ts"]);
assert.ok(r3.some((s) => s.layer === "데이터" && s.nodes[0].name === "Cache"), "새 레이어로 추가");
assert.ok(r3[1].nodes.some((n) => n.name === "Db"), "c.ts 기존 노드 유지");

// 레이어가 비면 사라짐.
const r4 = applyFlowDiff([{ layer: "x", nodes: [{ name: "Z", file: "gone.ts" }] }, ...flow], [], ["gone.ts"], []);
assert.ok(!r4.some((s) => s.layer === "x"));

// 옛 mergeFlow — 이름 중복 제외.
assert.strictEqual(mergeFlow(flow, [{ layer: "진입", nodes: [{ name: "page" }] }])[0].nodes.length, 2);

// 둘러보기 — 레이어 순, 레이어 안은 next 따라(C → A), 순환(X↔Y)은 원래 순서, 중복 이름 한 번
assert.deepEqual(tourOrder([
  { layer: "진입", nodes: [{ name: "A" }, { name: "C", next: ["a"] }] },
  { layer: "처리", nodes: [{ name: "X", next: ["Y"] }, { name: "Y", next: ["X"] }, { name: "c" }] },
]), ["C", "A", "X", "Y"]);
assert.deepEqual(tourOrder([]), []);
console.log("flowMerge.check OK");

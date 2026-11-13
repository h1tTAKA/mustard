// graphView.ts self-check(#1322) — 앱 미import. 실행: node --experimental-strip-types src/lib/repo/graphView.check.ts
import assert from "node:assert";
import { visibleKinds, searchNodes, neighbors, langStats, shortestPath, impactOf } from "./graphView.ts";
import type { RepoGraph } from "./types.ts";

const g: RepoGraph = {
  root: "/r",
  nodes: [
    { id: "a.ts", label: "a.ts", file: "a.ts", kind: "file" },
    { id: "b.tsx", label: "b.tsx", file: "b.tsx", kind: "file" },
    { id: "a.ts#load", label: "load", file: "a.ts", kind: "function", signature: "(id: string)" },
    { id: "b.tsx#Loader", label: "Loader", file: "b.tsx", kind: "component" },
  ],
  edges: [
    { source: "b.tsx", target: "a.ts", relation: "imports" },
    { source: "a.ts", target: "a.ts#load", relation: "contains" },
    { source: "b.tsx#Loader", target: "a.ts#load", relation: "calls" },
  ],
  stats: { files: 2, edges: 3, scanned: 2, capped: false },
};

assert.deepEqual([...visibleKinds("beginner")], ["file"]);
assert.ok(visibleKinds("dev").has("component") && !visibleKinds("dev").has("function"));
assert.ok(visibleKinds("expert").has("function"));

// 이름 시작 > 이름 포함 > 파일 > 시그니처
assert.deepEqual(searchNodes(g.nodes, "load").map((n) => n.id), ["a.ts#load", "b.tsx#Loader"]);
assert.deepEqual(searchNodes(g.nodes, "B.TSX").map((n) => n.id), ["b.tsx", "b.tsx#Loader"]);
assert.deepEqual(searchNodes(g.nodes, "id: string").map((n) => n.id), ["a.ts#load"]);
assert.deepEqual(searchNodes(g.nodes, "  "), []);

const na = neighbors(g, "a.ts");
assert.deepEqual(na.in.map((l) => l.node.id), ["b.tsx"]);
assert.deepEqual(na.out, []);
assert.deepEqual(na.contains.map((n) => n.id), ["a.ts#load"]);
assert.deepEqual(neighbors(g, "a.ts#load").in.map((l) => `${l.node.id}:${l.relation}`), ["b.tsx#Loader:calls"]); // contains는 in에 안 들어감

assert.deepEqual(langStats(g.nodes), [{ ext: "ts", count: 1 }, { ext: "tsx", count: 1 }]);
// 경로 — 화살표 반대로도: b.tsx → a.ts(imports), a.ts → load(contains), Loader → load(calls)
assert.deepEqual(shortestPath(g.edges, "b.tsx", "a.ts#load"), ["b.tsx", "a.ts", "a.ts#load"]);
assert.deepEqual(shortestPath(g.edges, "b.tsx#Loader", "b.tsx"), ["b.tsx#Loader", "a.ts#load", "a.ts", "b.tsx"]);
assert.deepEqual(shortestPath(g.edges, "a.ts", "a.ts"), ["a.ts"]);
assert.equal(shortestPath(g.edges, "b.tsx#Loader", "b.tsx", new Set(["b.tsx#Loader", "b.tsx", "a.ts"])), null); // 보이는 노드만 지남 → 끊김
assert.equal(shortestPath(g.edges, "a.ts", "nope"), null);
// 영향 — b.tsx 바뀜 → b.tsx·Loader가 changed, imports·calls로 붙은 a.ts·load가 affected
const im = impactOf(g, ["b.tsx"]);
assert.deepEqual([...im.changed].sort(), ["b.tsx", "b.tsx#Loader"]);
assert.deepEqual([...im.affected].sort(), ["a.ts", "a.ts#load"]);
assert.equal(impactOf(g, ["gone.ts"]).changed.size, 0);
console.log("graphView.check OK");

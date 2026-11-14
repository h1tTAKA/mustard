// communities 점검(#1331) — node --experimental-strip-types apps/mustard/src/lib/repo/communities.check.ts
import assert from "node:assert/strict";
import { detectCommunities } from "./communities.ts";
import type { RepoEdge, RepoNode } from "./types";

const f = (id: string): RepoNode => ({ id, label: id, file: id, kind: "file" });
// 두 무리(a*·b*) + 다리 하나 + 연결 없는 파일 2개(같은 폴더)
const files = ["a/1.ts", "a/2.ts", "a/3.ts", "b/1.ts", "b/2.ts", "b/3.ts", "c/x.ts", "c/y.ts"];
const e = (s: string, t: string): RepoEdge => ({ source: s, target: t, relation: "imports" });
const edges = [e("a/1.ts", "a/2.ts"), e("a/2.ts", "a/3.ts"), e("a/1.ts", "a/3.ts"), e("b/1.ts", "b/2.ts"), e("b/2.ts", "b/3.ts"), e("b/1.ts", "b/3.ts"), e("a/3.ts", "b/1.ts")];
const { communities, byFile } = detectCommunities(files.map(f), edges);
assert.equal(byFile.get("a/1.ts"), byFile.get("a/3.ts"));
assert.notEqual(byFile.get("a/1.ts"), byFile.get("b/1.ts")); // 다리 하나로 합쳐지지 않음
assert.equal(byFile.get("c/x.ts"), byFile.get("c/y.ts")); // 연결 없는 같은 폴더끼리
assert.deepEqual(communities.map((c) => c.label).sort(), ["a", "b", "c"]);
assert.equal(communities.reduce((n, c) => n + c.count, 0), files.length);
console.log("communities ok");

// node --experimental-strip-types src/lib/diffFold.check.ts
import assert from "node:assert/strict";
import { foldRuns } from "./diffFold.ts";

const c = (n: number) => Array(n).fill("ctx");
// meta + 10 ctx + add + 10 ctx, ctx 3 → 앞 7줄(1~7)·뒤 7줄 접힘
const kinds = ["meta", ...c(10), "add", ...c(10)];
const r = foldRuns(kinds, 3, () => false, new Set());
assert.equal(r.runLen.get(1), 7); assert.equal(r.hidden.get(7), 1); assert.equal(r.hidden.has(8), false); // 8~10은 바뀐 줄 3줄 안
assert.equal(r.runLen.get(15), 7); assert.equal(r.hidden.has(14), false);
// 펼친 묶음은 안 접음
assert.equal(foldRuns(kinds, 3, () => false, new Set([1])).hidden.has(1), false);
// keep 줄이 묶음을 가름 → 짧은 쪽(3줄)은 안 접음
const k = foldRuns(kinds, 3, (i) => i === 4, new Set());
assert.equal(k.hidden.has(2), false); assert.equal(k.runLen.get(5), undefined); // 5~7 = 3줄
// 바뀐 줄 없음(전부 ctx) → 전부 한 묶음
assert.equal(foldRuns(c(5), 3, () => false, new Set()).runLen.get(0), 5);
console.log("diffFold ok");

// reflogBranch 점검 — node --experimental-strip-types src/lib/reflogBranch.check.ts
import assert from "node:assert";
import { branchesFromReflog } from "./reflogBranch.ts";

const L = (h: string, s: string) => `${h}\x1f${s}`;
const m = branchesFromReflog([ // 최신순
  L("e5", "commit: on main again"),
  L("d4", "checkout: moving from feature/a to main"),
  L("c3", "commit: second on a"),
  L("b2", "commit: first on a"),
  L("a1", "checkout: moving from main to feature/a"),
  L("z0", "commit: before window"),
]);
assert.strictEqual(m.get("b2"), "feature/a");
assert.strictEqual(m.get("c3"), "feature/a");
assert.strictEqual(m.get("e5"), "main", "다시 main으로 돌아온 뒤 커밋");
assert.strictEqual(m.has("z0"), false, "첫 이동 전(시작 브랜치 모름) = 비움");
const d = branchesFromReflog([L("f1", "commit: detached"), L("ab12cd3", "checkout: moving from main to ab12cd3")]);
assert.strictEqual(d.get("f1"), "HEAD", "해시 체크아웃 = 분리 HEAD");
const r = branchesFromReflog([
  L("g2", "commit: after rebase"),
  L("g1", "rebase (finish): returning to refs/heads/feature/b"),
  L("p1", "rebase (pick): x"),
  L("s0", "rebase (start): checkout main"),
  L("q0", "checkout: moving from main to feature/b"),
]);
assert.strictEqual(r.get("g2"), "feature/b", "rebase 끝나면 그 브랜치");
const mg = branchesFromReflog([L("m1", "merge feature/a: Merge made by the 'ort' strategy."), L("k0", "checkout: moving from feature/a to main")]);
assert.strictEqual(mg.get("m1"), "main", "머지 커밋");
console.log("reflogBranch ok");

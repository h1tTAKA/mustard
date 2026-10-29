// repoRefresh 점검(#1225) — node --experimental-strip-types apps/mustard/src/lib/repoRefresh.check.ts
// 회귀 방어: 감시(FSEvents)가 멈춰도 안전망 폴링이 파일 목록을 다시 읽어야 함(#838에서 빠졌던 것).
import assert from "node:assert";
import { pollPlan, sameFiles } from "./repoRefresh.ts";

assert.strictEqual(pollPlan(true).tree, true, "감시 중이어도 폴링이 트리를 다시 읽음");
assert.strictEqual(pollPlan(false).tree, true);
assert.strictEqual(pollPlan(true).graph, false, "그래프는 감시 중엔 fs 이벤트 때만(#838)");
assert.strictEqual(pollPlan(false).graph, true, "감시가 없으면 폴링이 그래프도");
assert.ok(sameFiles(["a", "b"], ["a", "b"]));
assert.ok(!sameFiles(["a"], ["a", "b"]), "새 파일");
assert.ok(!sameFiles(["a", "b"], ["a", "c"]), "이름 바뀜");
console.log("repoRefresh ok");

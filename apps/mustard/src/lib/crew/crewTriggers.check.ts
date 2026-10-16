// crewTriggers 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewTriggers.check.ts
import assert from "node:assert";
import { applyTriggerOp, freshIds, readTriggers, scheduleDue, writeTriggers } from "./crewTriggers.ts";

assert.ok(process.env.MUSTARD_CREW_DIR, "임시 디렉터리 필수");
const root = "/tmp/repo-trig";
assert.deepStrictEqual(readTriggers(root), []);
let l = applyTriggerOp(root, { op: "save", trigger: { kind: "ci-failed", pipeline: ["bug-fixer", "test-engineer", "Bad!"] } });
assert.deepStrictEqual([l.length, l[0].enabled, l[0].pipeline, !!l[0].primed], [1, true, ["bug-fixer", "test-engineer"], false], "기본 켜짐·역할 검증");
assert.throws(() => applyTriggerOp(root, { op: "save", trigger: { kind: "issue-label", pipeline: [] } }), /label required/);
assert.throws(() => applyTriggerOp(root, { op: "save", trigger: { kind: "schedule", pipeline: [], title: "x" } }), /schedule time required/);
assert.throws(() => applyTriggerOp(root, { op: "save", trigger: { kind: "schedule", pipeline: [], at: "09:00" } }), /title required/);
l = applyTriggerOp(root, { op: "save", trigger: { kind: "issue-label", pipeline: [], label: "crew" } });
const lab = l.find((t) => t.kind === "issue-label")!;
// 본 것·primed 기록 후 라벨 바꾸면 처음부터
writeTriggers(root, readTriggers(root).map((t) => (t.id === lab.id ? { ...t, seen: ["1", "2"], primed: true } : t))); // 실행기가 기록하는 것(API로는 못 바꿈)
l = applyTriggerOp(root, { op: "save", trigger: { ...lab, enabled: false, seen: [] } });
assert.deepStrictEqual([l.find((t) => t.id === lab.id)!.seen, l.find((t) => t.id === lab.id)!.enabled], [["1", "2"], false], "본 것은 API로 못 지움, 끄기는 됨");
l = applyTriggerOp(root, { op: "save", trigger: { ...lab, label: "agent" } });
assert.deepStrictEqual([l.find((t) => t.id === lab.id)!.seen, !!l.find((t) => t.id === lab.id)!.primed], [[], false], "조건 바뀌면 처음부터");
assert.throws(() => applyTriggerOp(root, { op: "save", trigger: { kind: "schedule", pipeline: [], at: "25:00", title: "x" } }), /schedule time required/, "잘못된 시각");
l = applyTriggerOp(root, { op: "delete", id: lab.id });
assert.ok(!l.some((t) => t.id === lab.id), "삭제");

// 예약 판단
const day = new Date(2026, 9, 16, 0, 0).getTime(), H = 3_600_000;
assert.strictEqual(scheduleDue({ at: "09:00", createdAt: day }, day + 8 * H), false, "아직 시각 전");
assert.strictEqual(scheduleDue({ at: "09:00", createdAt: day }, day + 9 * H + 1), true, "시각 지남");
assert.strictEqual(scheduleDue({ at: "09:00", createdAt: day, lastFired: day + 9 * H + 5 }, day + 15 * H), false, "오늘 이미 함");
assert.strictEqual(scheduleDue({ at: "09:00", createdAt: day + 10 * H }, day + 11 * H), false, "만든 게 시각 뒤면 내일부터");
assert.strictEqual(scheduleDue({ at: "09:00", createdAt: day, lastFired: day + 9 * H }, day + 24 * H + 9 * H + 1), true, "다음 날");
assert.strictEqual(scheduleDue({ everyHours: 3, createdAt: day }, day + 2 * H), false);
assert.strictEqual(scheduleDue({ everyHours: 3, createdAt: day, lastFired: day + H }, day + 4 * H), true, "N시간마다");
assert.deepStrictEqual(freshIds(["1", "3"], ["1", "2", "3", "4"]), ["2", "4"]);
console.log("crewTriggers.check ok");

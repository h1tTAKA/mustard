// crewFlow 점검 — node --experimental-strip-types src/lib/crew/crewFlow.check.ts
import assert from "node:assert";
import { decideGate, next, parseHandoff, pipelineOf, MAX_CONSULTS, MAX_REVIEWS, MAX_TEST_LOOPS } from "./crewFlow.ts";
import type { CrewTask } from "./crewTypes.ts";

const known = new Set(["scope-planner", "screen-designer", "data-architect", "app-builder", "test-engineer", "bug-fixer", "release-checker", "doc-writer"]);
const T = (p: Partial<CrewTask> = {}): CrewTask => ({ id: "t", title: "x", body: "", status: "running", order: 0, createdAt: 0, updatedAt: 0, ...p });
const done = (x: Record<string, unknown> = {}) => parseHandoff(JSON.stringify({ status: "done", ...x }));

// 봉투
assert.deepStrictEqual(parseHandoff(null, "끝"), { status: "done", summary: "끝" }, "없으면 done");
assert.strictEqual(parseHandoff("{oops").status, "done", "깨지면 done");
assert.strictEqual(parseHandoff('{"status":"weird"}').status, "done");
assert.deepStrictEqual(pipelineOf(T()), ["scope-planner"], "자동 배정 = 기획자부터");
assert.deepStrictEqual(pipelineOf(T({ role: "bug-fixer" })), ["bug-fixer"]);

// 자동 배정: 기획자가 역할을 정함 → spec 관문
let r = next(T(), done({ roles: ["app-builder", "nope", "test-engineer", "app-builder"], summary: "spec" }), known);
assert.strictEqual(r.status, "needs-you");
assert.deepStrictEqual(r.patch.pipeline, ["scope-planner", "app-builder", "test-engineer"], "모르는 역할·중복 제거");
assert.deepStrictEqual([r.patch.stage, r.patch.gate?.kind, r.patch.gate?.stage], [1, "spec", 0], "단계는 미리 다음으로, 반려 땐 0");
// spec 승인 → Ready
let t = T({ ...r.patch, status: "needs-you" } as Partial<CrewTask>);
assert.deepStrictEqual(decideGate(t, "approve"), { status: "ready", patch: { gate: undefined } });
// spec 반려 → 코멘트와 기획자 재실행
assert.deepStrictEqual(decideGate(t, "reject", "로그인만 범위로"), { status: "ready", patch: { gate: undefined, stage: 0, note: "로그인만 범위로", fails: 0 } });
assert.throws(() => decideGate(t, "reject", " "), /comment required/);

// 개발 → 테스트(다음 단계 Ready)
t = T({ pipeline: ["scope-planner", "app-builder", "test-engineer"], stage: 1 });
r = next(t, done(), known);
assert.deepStrictEqual([r.status, r.patch.stage], ["ready", 2]);
// 테스트 실패 → 수정·테스트 끼움
t = T({ pipeline: ["scope-planner", "app-builder", "test-engineer"], stage: 2 });
r = next(t, done({ testsPassed: false }), known);
assert.deepStrictEqual([r.status, r.patch.stage, r.patch.loops], ["ready", 3, 1]);
assert.deepStrictEqual(r.patch.pipeline, ["scope-planner", "app-builder", "test-engineer", "bug-fixer", "test-engineer"]);
// 상한 넘으면 막힘
r = next(T({ pipeline: ["test-engineer"], stage: 0, loops: MAX_TEST_LOOPS }), done({ testsPassed: false }), known);
assert.deepStrictEqual([r.status, r.patch.gate?.kind], ["blocked", "blocked"]);
// 마지막 단계 끝 → 머지 관문(Review), 승인 → Done
r = next(T({ pipeline: ["bug-fixer"], stage: 0 }), done({ summary: "고침" }), known);
assert.deepStrictEqual([r.status, r.patch.gate?.kind, r.patch.gate?.text], ["review", "merge", "고침"]);
assert.strictEqual(decideGate(T({ gate: { kind: "merge", stage: 0 } }), "approve").status, "done");
// 파괴적 schema → 관문
r = next(T({ pipeline: ["data-architect", "app-builder"], stage: 0 }), done({ destructive: true }), known);
assert.deepStrictEqual([r.status, r.patch.gate?.kind, r.patch.stage], ["needs-you", "schema", 1]);
r = next(T({ pipeline: ["data-architect", "app-builder"], stage: 0 }), done({ destructive: false }), known);
assert.strictEqual(r.status, "ready", "비파괴면 관문 없음");
// 사람이 정한 파이프라인은 기획자가 못 바꿈
r = next(T({ pipeline: ["scope-planner", "doc-writer"], stage: 0 }), done({ roles: ["app-builder"] }), known);
assert.deepStrictEqual(r.patch.pipeline, ["scope-planner", "doc-writer"]);

// 되묻기 → 답과 함께 같은 단계
r = next(T({ pipeline: ["app-builder"], stage: 0 }), parseHandoff('{"status":"needs_input","question":"DB는?"}'), known);
assert.deepStrictEqual([r.status, r.patch.gate?.kind, r.patch.gate?.text], ["needs-you", "question", "DB는?"]);
t = T({ gate: r.patch.gate });
assert.throws(() => decideGate(t, "approve"), /answer required/);
assert.deepStrictEqual(decideGate(t, "answer", "SQLite").patch.note, "SQLite");

// 실패 차단기
r = next(T({ pipeline: ["app-builder"], fails: 1 }), parseHandoff('{"status":"failed","summary":"빌드 깨짐"}'), known);
assert.deepStrictEqual([r.status, r.patch.fails], ["ready", 2], "재시도");
r = next(T({ pipeline: ["app-builder"], fails: 2 }), parseHandoff('{"status":"failed"}'), known);
assert.deepStrictEqual([r.status, r.patch.gate?.kind], ["blocked", "blocked"], "3번째 실패 = 막힘");
assert.deepStrictEqual(decideGate(T({ gate: { kind: "blocked", stage: 0 }, fails: 3 }), "approve").patch, { gate: undefined, fails: 0, loops: 0, stage: 0 }, "막힘 해제");

// #1108 동료에게 묻기
const ask = parseHandoff('{"status":"needs_input","ask":{"to":"data-architect","question":"users 테이블에 컬럼 추가해도 돼?"}}');
r = next(T({ pipeline: ["app-builder", "test-engineer"], stage: 0 }), ask, known);
assert.deepStrictEqual([r.status, r.patch.stage, r.patch.consults], ["ready", 1, 1], "상대에게 넘김");
assert.deepStrictEqual(r.patch.pipeline, ["app-builder", "data-architect", "app-builder", "test-engineer"], "[상대, 나] 끼움");
assert.deepStrictEqual(r.patch.consult, { stage: 1, from: "app-builder", question: "users 테이블에 컬럼 추가해도 돼?" });
// 답하기 단계 끝 → 묻던 역할로, 답을 메모로
t = T({ ...r.patch } as Partial<CrewTask>);
r = next(t, done({ message: "nullable로 추가하면 안전해요" }), known);
assert.deepStrictEqual([r.status, r.patch.stage, r.patch.consult], ["ready", 2, undefined]);
assert.ok(r.patch.note?.includes("nullable로 추가하면 안전해요") && r.patch.note.includes("data-architect"), "답이 메모로");
// 상한 넘으면 사람에게
r = next(T({ pipeline: ["app-builder"], stage: 0, consults: MAX_CONSULTS }), ask, known);
assert.deepStrictEqual([r.status, r.patch.gate?.kind], ["needs-you", "question"], "상한 → 사람");
// 자기 자신·모르는 역할에게 묻기는 사람에게
r = next(T({ pipeline: ["app-builder"], stage: 0 }), parseHandoff('{"status":"needs_input","ask":{"to":"app-builder","question":"?"}}'), known);
assert.strictEqual(r.status, "needs-you");

// #1108 리뷰 변경 요청 왕복
const cr = (to?: string) => parseHandoff(JSON.stringify({ status: "changes_requested", message: "에러 처리 빠짐", ...(to ? { to } : {}) }));
r = next(T({ pipeline: ["scope-planner", "app-builder", "release-checker"], stage: 2 }), cr(), known);
assert.deepStrictEqual([r.status, r.patch.stage, r.patch.reviews], ["ready", 3, 1]);
assert.deepStrictEqual(r.patch.pipeline, ["scope-planner", "app-builder", "release-checker", "app-builder", "release-checker"], "to 없으면 직전 다른 역할(기획자 제외)");
assert.ok(r.patch.note?.includes("에러 처리 빠짐"));
r = next(T({ pipeline: ["app-builder", "test-engineer", "release-checker"], stage: 2 }), cr("test-engineer"), known);
assert.deepStrictEqual(r.patch.pipeline?.slice(3), ["test-engineer", "release-checker"], "지정한 역할에게");
r = next(T({ pipeline: ["app-builder", "release-checker"], stage: 1, reviews: MAX_REVIEWS }), cr(), known);
assert.deepStrictEqual([r.status, r.patch.gate?.kind], ["review", "merge"], "왕복 상한 → 머지 관문에 지적 첨부");
assert.ok(r.patch.gate?.text?.includes("에러 처리 빠짐"));

console.log("crewFlow.check ok");

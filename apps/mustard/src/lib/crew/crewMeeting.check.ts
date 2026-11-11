// crewMeeting 점검 — node --experimental-strip-types src/lib/crew/crewMeeting.check.ts
import assert from "node:assert";
import { callsEveryone, courtSeats, juryVote, pickParticipants, planFromWrapUp, readAnswer, readJson, withIdleTimeout } from "./crewMeeting.ts";

const known = new Set(["scope-planner", "screen-designer", "data-architect", "app-builder", "test-engineer", "bug-fixer", "release-checker", "doc-writer"]);

assert.deepStrictEqual(readJson('Sure.\n```json\n{"intent":"work","reply":"ok"}\n```'), { intent: "work", reply: "ok" }, "울타리·앞말 붙어도");
assert.strictEqual(readJson("no json here"), null);
assert.strictEqual(readJson("[1,2]"), null, "배열은 아님");
assert.deepStrictEqual(readJson('Use {x} like this: {"intent":"work","reply":"a } b"} — thanks {y}'), { intent: "work", reply: "a } b" }, "앞뒤 {}·문자열 안 } 무시");
assert.deepStrictEqual(readAnswer('{"intent":"work","reply":"Let us plan it."}'), { intent: "work", reply: "Let us plan it." });
assert.deepStrictEqual(readAnswer("Yes, it's done."), { intent: "question", reply: "Yes, it's done." }, "JSON 아니면 글 전체 = 질문 답");
assert.deepStrictEqual(readAnswer('{"intent":"nope","reply":"x"}').intent, "question", "모르는 intent = 질문");

assert.deepStrictEqual(pickParticipants(["@app-builder", "test-engineer", "app-builder", "scope-planner", "hacker"], known, "scope-planner"), ["app-builder", "test-engineer"], "아는 역할·중복·진행자 제외");
assert.deepStrictEqual(pickParticipants("x", known, "scope-planner"), ["app-builder", "test-engineer"], "없으면 기본");
assert.strictEqual(pickParticipants([...known], known, "scope-planner", 3).length, 3, "최대");

assert.deepStrictEqual(planFromWrapUp({ title: "  Clear completed  ", body: "Add a button.", pipeline: ["app-builder", "@test-engineer", "nope", "app-builder"] }, "req", known),
  { title: "Clear completed", body: "Add a button.", pipeline: ["app-builder", "test-engineer"] });
assert.deepStrictEqual(planFromWrapUp(null, "\n  add dark mode\nplease", known), { title: "add dark mode", body: "\n  add dark mode\nplease", pipeline: [] }, "마무리 못 읽으면 사람 글로");

assert.ok(callsEveryone("@all what do you think?") && callsEveryone("hey @Everyone") && !callsEveryone("mail@all.com") && !callsEveryone("@allison"));
// #1162 무진행 타이머
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
assert.strictEqual(await withIdleTimeout(async (touch) => { for (let i = 0; i < 5; i++) { await tick(30); touch(); } return "done"; }, 60, 1000), "done", "진행 중이면 idle보다 오래 걸려도 기다림");
await assert.rejects(withIdleTimeout((touch) => { touch(); return new Promise(() => {}); }, 50, 1000), /timeout/, "시작 뒤 움직임 없으면 idle에 끊김");
assert.strictEqual(await withIdleTimeout(async (touch) => { await tick(120); touch(); return "late"; }, 50, 1000), "late", "시작 전(줄 서기)은 idle 안 셈");
await assert.rejects(withIdleTimeout(() => new Promise(() => {}), 50, 150), /timeout/, "끝내 시작 못 하면 전체 상한");
await assert.rejects(withIdleTimeout(async (touch, signal) => { while (!signal.aborted) { await tick(10); touch(); } }, 50, 120), /timeout/, "계속 움직여도 전체 상한");
let aborted = false;
await assert.rejects(withIdleTimeout((_t, signal) => new Promise((_r, rej) => signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); })), 30, 1000));
assert.ok(aborted, "끊을 때 작업도 abort");
await assert.rejects(withIdleTimeout(async () => { throw new Error("boom"); }, 50, 100), /boom/, "작업 오류는 그대로");
// 지침·지적 = instruction(카드 아님), 모르는 값은 질문
assert.strictEqual(readAnswer('{"intent":"instruction","reply":"앞으로 커밋은 일본어로 쓸게요."}').intent, "instruction");
assert.strictEqual(readAnswer('{"intent":"order","reply":"x"}').intent, "question");
assert.strictEqual(readAnswer('{"intent":"question","audience":"@Test-Engineer","reply":"x"}').audience, "test-engineer", "받는 사람");
assert.strictEqual(readAnswer('{"intent":"question","reply":"x"}').audience, undefined);
// #1318 토론 — debate 의도·형식(모르면 회의식), 다른 의도엔 format 없음
assert.deepStrictEqual(readAnswer('{"intent":"debate","format":"court","reply":"양측 들어 봅시다."}'), { intent: "debate", reply: "양측 들어 봅시다.", format: "court" });
assert.strictEqual(readAnswer('{"intent":"debate","reply":"x"}').format, "council", "형식 없으면 회의식");
assert.strictEqual(readAnswer('{"intent":"debate","format":"duel","reply":"x"}').format, "council", "모르는 형식도 회의식");
assert.strictEqual(readAnswer('{"intent":"question","format":"court","reply":"x"}').format, undefined, "토론 아니면 형식 없음");
assert.deepStrictEqual(courtSeats(["app-builder", "test-engineer", "bug-fixer", "doc-writer"]), { a: "app-builder", b: "test-engineer", jurors: ["bug-fixer", "doc-writer"] });
assert.deepStrictEqual(courtSeats(["app-builder", "test-engineer"]), { a: "app-builder", b: "test-engineer", jurors: [] }, "배심 없으면 진행자만 판결");
assert.strictEqual(courtSeats(["app-builder"]), null, "한 명이면 재판 안 됨");
assert.strictEqual(juryVote("**A** — 더 설득력 있음"), "A", "마크다운 감싼 표");
assert.strictEqual(juryVote("B안이 낫다"), "B");
assert.strictEqual(juryVote("Actually neither"), null, "단어 첫 글자는 표 아님");
assert.strictEqual(juryVote(null), null, "실패한 배심");
assert.strictEqual(juryVote("a bit risky, B is better"), null, "소문자 a는 표 아님");
console.log("crewMeeting.check ok");

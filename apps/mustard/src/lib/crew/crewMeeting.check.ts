// crewMeeting 점검 — node --experimental-strip-types src/lib/crew/crewMeeting.check.ts
import assert from "node:assert";
import { callsEveryone, pickParticipants, planFromWrapUp, readAnswer, readJson, withIdleTimeout } from "./crewMeeting.ts";

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
await assert.rejects(withIdleTimeout(() => new Promise(() => {}), 50, 1000), /timeout/, "움직임 없으면 idle에 끊김");
await assert.rejects(withIdleTimeout(async (touch, signal) => { while (!signal.aborted) { await tick(10); touch(); } }, 50, 120), /timeout/, "계속 움직여도 전체 상한");
let aborted = false;
await assert.rejects(withIdleTimeout((_t, signal) => new Promise((_r, rej) => signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); })), 30, 1000));
assert.ok(aborted, "끊을 때 작업도 abort");
await assert.rejects(withIdleTimeout(async () => { throw new Error("boom"); }, 50, 100), /boom/, "작업 오류는 그대로");
console.log("crewMeeting.check ok");

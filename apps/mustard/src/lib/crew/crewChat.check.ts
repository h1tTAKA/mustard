// crewChat 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewChat.check.ts
import assert from "node:assert";
import { appendFileSync } from "node:fs";
import { addGuideline, appendMsg, chatFile, findMsg, parseMentions, readGuidelines, readMsgs, roomSummaries } from "./crewChat.ts";

assert.ok(process.env.MUSTARD_CREW_DIR, "임시 디렉터리 필수");
const root = "/tmp/repo-chat";
assert.deepStrictEqual(readMsgs(root), [], "없으면 빈 채널");
const a = appendMsg(root, { from: "scope-planner", kind: "start", text: "맡을게요", taskId: "t1", ts: 100 });
appendMsg(root, { from: "scope-planner", kind: "handoff", text: "spec 끝 @app-builder", mentions: ["app-builder"], ts: 200 });
appendFileSync(chatFile(root), "{broken\n");
appendMsg(root, { from: "human", kind: "human", text: "좋아요", replyTo: a.id, ts: 300 });
const all = readMsgs(root);
assert.deepStrictEqual(all.map((m) => m.kind), ["start", "handoff", "human"], "순서·깨진 줄 건너뜀");
assert.deepStrictEqual(readMsgs(root, 150).map((m) => m.ts), [200, 300], "since 이후만");
assert.strictEqual(readMsgs(root, 0, 1).length, 1, "limit");
assert.strictEqual(findMsg(root, a.id)?.text, "맡을게요");
assert.strictEqual(appendMsg(root, { from: "board", kind: "gate", text: "x".repeat(9000) }).text.length, 8000, "길이 제한");

const known = new Set(["app-builder", "test-engineer", "bug-fixer"]);
assert.deepStrictEqual(parseMentions("@app-builder 하고 @Test-Engineer, @nobody @app-builder", known), ["app-builder", "test-engineer"]);
assert.deepStrictEqual(parseMentions("메일 a@b.com", known), []);
// 팀 지침 — 같은 글은 한 번, 최근 30개, 빈 글 무시
assert.deepStrictEqual(readGuidelines("/g"), []);
addGuideline("/g", "커밋은 일본어"); addGuideline("/g", "  "); addGuideline("/g", "커밋은 일본어");
assert.deepStrictEqual(readGuidelines("/g"), ["커밋은 일본어"]);
for (let i = 0; i < 35; i++) addGuideline("/g", `g${i}`);
assert.strictEqual(readGuidelines("/g").length, 30);
assert.strictEqual(readGuidelines("/g").at(-1), "g34");
// #1392 방 — room 없는 옛 글 = 팀방, 1:1 방은 그 방만, room 안 주면 전 방(알림·엔진)
const r2 = "/tmp/repo-rooms";
appendMsg(r2, { from: "human", kind: "human", text: "팀에게", ts: 10 });
appendMsg(r2, { from: "human", kind: "human", text: "빌더에게", room: "app-builder", ts: 20 });
appendMsg(r2, { from: "app-builder", kind: "answer", text: "네", room: "app-builder", ts: 30 });
appendMsg(r2, { from: "board", kind: "gate", text: "관문", ts: 40 });
assert.deepStrictEqual(readMsgs(r2, 0, 400, false, "").map((m) => m.text), ["팀에게", "관문"], "팀방 = room 없는 글");
assert.deepStrictEqual(readMsgs(r2, 0, 400, false, "app-builder").map((m) => m.text), ["빌더에게", "네"], "1:1 방");
assert.strictEqual(readMsgs(r2).length, 4, "room 안 주면 전 방");
assert.deepStrictEqual(readMsgs(r2, 25, 400, false, "app-builder").map((m) => m.ts), [30], "방 + since");
const sum = roomSummaries(r2);
assert.deepStrictEqual(sum.map((x) => [x.room, x.count, x.last.text]), [["", 2, "관문"], ["app-builder", 2, "네"]], "방 요약 — 최근 순·글 수·마지막 글");
console.log("crewChat.check ok");

// crewChat 점검 — MUSTARD_CREW_DIR=<임시> node --experimental-strip-types src/lib/crew/crewChat.check.ts
import assert from "node:assert";
import { appendFileSync } from "node:fs";
import { appendMsg, chatFile, findMsg, parseMentions, readMsgs } from "./crewChat.ts";

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
console.log("crewChat.check ok");

// #1374 patch-sna 점검 — 한 번만 고치는지, 서브 에이전트 메시지는 버리고 백그라운드 끝 알림은 milestone으로 넘기는지
import assert from "node:assert/strict";
import { patch } from "./patch-sna.mjs";

const src = `class P {\n  normalizeEvent(msg) {\n    return { type: "orig", msg };\n  }\n}\nP;`;
const out = patch(src);
assert.ok(out && out !== src, "고침");
assert.equal(patch(out), out, "두 번 돌려도 한 번만");
assert.equal(patch(src + src), null, "고칠 자리가 둘이면 실패");

const P = new Function(`return ${out}`)();
const n = (m) => new P().normalizeEvent(m);
assert.equal(n({ type: "assistant", parent_tool_use_id: "toolu_1", message: {} }), null, "서브 에이전트 메시지는 버림");
assert.equal(n({ type: "assistant", parent_tool_use_id: null }).type, "orig", "메인 메시지는 그대로");
const bash = n({ type: "system", subtype: "task_notification", status: "completed", tool_use_id: "toolu_2", task_id: "b1", summary: 'Background command "x" completed (exit code 0)' });
assert.equal(bash.type, "milestone");
assert.deepEqual(bash.data, { kind: "task_notification", status: "completed", toolUseId: "toolu_2", taskId: "b1" });
assert.match(bash.message, /Background command/);
const agent = n({ type: "system", subtype: "task_notification", status: "completed", tool_use_id: "toolu_3", summary: "긴 리뷰 결과…", summary_is_report: true });
assert.equal(agent.message, "", "에이전트 보고서 원문은 안 넘김");
assert.equal(n({ type: "system", subtype: "init" }).type, "orig", "다른 system은 그대로");
console.log("patch-sna ok");

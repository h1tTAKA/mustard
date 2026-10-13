// agentSessionParse 점검 — node --experimental-strip-types src/lib/agentSessionParse.check.ts
import assert from "node:assert";
import { parseClaudeLine, parseCodexLine, segmentForCommit, COMMIT_RE } from "./agentSessionParse.ts";

const iso = (s: number) => new Date(s * 1000).toISOString();
const T = 1_800_000_000; // 커밋 시각(초)
const cl = (type: string, content: unknown, s: number, extra = {}) => JSON.stringify({ type, message: { content }, timestamp: iso(s), gitBranch: "feature/x", cwd: "/r", ...extra });
const bash = (cmd: string, s: number) => cl("assistant", [{ type: "tool_use", name: "Bash", input: { command: cmd } }], s);
const res = (out: string, s: number) => cl("user", [{ type: "tool_result", content: out }], s);
// 턴1: 이전 커밋 + 마무리 말 / 턴2: 새 프롬프트 → 작업 → 커밋 → "커밋했어요" / 턴3: 다음 프롬프트
const claude = [
  cl("user", "이전 작업 해줘", T - 1000),
  bash("git commit -m old", T - 900), res("[feature/x abc1234] old", T - 899),
  cl("assistant", [{ type: "text", text: "이전 커밋 했어요" }], T - 898),
  cl("user", [{ type: "text", text: "<task-notification>서브 끝</task-notification>" }], T - 500), // 시스템 끼움 — 턴 시작 아님
  cl("user", "버튼 색 바꿔줘", T - 300),
  cl("assistant", [{ type: "text", text: "Button.tsx를 고칠게요" }, { type: "tool_use", name: "Edit", input: { file_path: "Button.tsx" } }], T - 200),
  cl("assistant", [{ type: "text", text: "서브" }], T - 150, { isSidechain: true }),
  bash("rtk git add a && rtk git commit -m 'fix'", T - 2), res("ok", T + 1),
  bash("git pull", T + 3), res("Already up to date.", T + 4), // 커밋 직후 pull — 대상 아님(2초 넘음), 같은 턴 다음 경계
  cl("assistant", [{ type: "text", text: "고쳤고 커밋했어요, 확인해 보세요" }], T + 5),
  cl("user", "다음 작업", T + 60),
];
const seg = segmentForCommit(claude, parseClaudeLine, T)!;
assert.ok(seg, "커밋 구간 찾음");
assert.ok(seg.msgs[0].text.includes("<task-notification>") || seg.msgs[0].text === "버튼 색 바꿔줘", "이전 커밋 턴 다음부터 시작");
assert.ok(!seg.msgs.some((m) => m.text.includes("이전 커밋 했어요")), "이전 커밋 마무리 말은 이전 커밋 몫");
assert.ok(seg.msgs.some((m) => m.text === "ok"), "커밋 결과 포함");
assert.ok(!seg.msgs.some((m) => m.text.includes("서브")), "사이드체인 제외");
assert.ok(!seg.msgs.some((m) => m.text === "다음 작업"), "다음 프롬프트 전까지");
assert.strictEqual(seg.closed, true);
assert.strictEqual(seg.branch, "feature/x");
assert.strictEqual(segmentForCommit(claude, parseClaudeLine, T - 3600), null, "커밋 시각 전 15분 안에 호출 없으면 null");
// 턴이 아직 안 끝남(다음 프롬프트·다음 커밋 없음) → closed false, 마무리 말까지
const open = segmentForCommit(claude.slice(0, 9).concat(cl("assistant", [{ type: "text", text: "커밋했어요, 확인해 보세요" }], T + 5)), parseClaudeLine, T)!;
assert.strictEqual(open.closed, false);
assert.strictEqual(open.msgs.at(-1)!.text, "커밋했어요, 확인해 보세요", "턴 끝 마무리 말 포함");
// 같은 턴에 커밋 두 번 → 두 번째는 첫 커밋 결과 다음부터
const two = [cl("user", "둘 다 해줘", T - 100), bash("git commit -m a", T - 50), res("ok a", T - 49), cl("assistant", [{ type: "text", text: "두 번째 작업" }], T - 30), bash("git commit -m b", T - 1), res("ok b", T)];
const s2 = segmentForCommit(two, parseClaudeLine, T)!;
assert.deepStrictEqual(s2.msgs.map((m) => m.text), ["두 번째 작업", "▸ Bash: git commit -m b", "ok b"]);
const s1 = segmentForCommit(two, parseClaudeLine, T - 49)!;
assert.ok(s1.msgs.at(-1)!.text === "ok a" && s1.closed, "첫 커밋은 다음 커밋 호출 직전까지");

// Codex
const cx = (type: string, payload: unknown, s: number) => JSON.stringify({ timestamp: iso(s), type, payload });
const codex = [
  cx("session_meta", { cwd: "/r", id: "s1" }, T - 1000),
  cx("event_msg", { type: "user_message", message: "README 고쳐" }, T - 100),
  cx("event_msg", { type: "agent_message", message: "고칠게요" }, T - 90),
  cx("response_item", { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "git -C /r commit -am docs" }) }, T - 1),
  cx("response_item", { type: "function_call_output", output: "[main 1234567] docs" }, T),
  cx("event_msg", { type: "agent_message", message: "커밋했어요" }, T + 2),
];
const cs = segmentForCommit(codex, parseCodexLine, T)!;
assert.deepStrictEqual(cs.msgs.map((m) => m.role), ["user", "assistant", "tool", "tool", "assistant"]);
assert.strictEqual(cs.cwd, "/r");
assert.ok(COMMIT_RE.test("rtk git commit -m x") && COMMIT_RE.test("git -C a commit") && !COMMIT_RE.test("git log --grep commit"));
assert.ok(COMMIT_RE.test("gh pr merge 12 --merge") && COMMIT_RE.test("git checkout main && git pull") && COMMIT_RE.test("git merge feature/x"), "머지도 경계");
assert.strictEqual(parseClaudeLine("not json"), null);
console.log("agentSessionParse ok");

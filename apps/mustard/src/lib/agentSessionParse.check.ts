// agentSessionParse 점검 — node --experimental-strip-types src/lib/agentSessionParse.check.ts
import assert from "node:assert";
import { parseClaudeLine, parseCodexLine, segmentForCommit, COMMIT_RE } from "./agentSessionParse.ts";

const iso = (s: number) => new Date(s * 1000).toISOString();
const T = 1_800_000_000; // 커밋 시각(초)
// Claude: 이전 커밋 → 작업 → 이번 커밋(rtk, 출력에 해시 없음) → 다음 작업
const cl = (type: string, content: unknown, s: number, extra = {}) => JSON.stringify({ type, message: { content }, timestamp: iso(s), gitBranch: "feature/x", cwd: "/r", ...extra });
const claude = [
  cl("assistant", [{ type: "tool_use", name: "Bash", input: { command: "git commit -m old" } }], T - 900),
  cl("user", [{ type: "tool_result", content: "[feature/x abc1234] old" }], T - 899),
  cl("user", "버튼 색 바꿔줘", T - 300),
  cl("assistant", [{ type: "text", text: "Button.tsx를 고칠게요" }, { type: "tool_use", name: "Edit", input: { file_path: "Button.tsx" } }], T - 200),
  cl("assistant", [{ type: "text", text: "서브" }], T - 150, { isSidechain: true }),
  cl("assistant", [{ type: "tool_use", name: "Bash", input: { command: "rtk git add a && rtk git commit -m 'fix'" } }], T - 2),
  cl("user", [{ type: "tool_result", content: "ok" }], T + 1),
  cl("assistant", [{ type: "tool_use", name: "Bash", input: { command: "open http://x" } }], T + 5),
  cl("user", "다음 작업", T + 60),
];
const seg = segmentForCommit(claude, parseClaudeLine, T)!;
assert.ok(seg, "커밋 구간 찾음");
assert.deepStrictEqual(seg.msgs.map((m) => m.role), ["user", "assistant", "tool", "tool", "tool"], "이전 커밋 이후~이번 커밋+결과, 사이드체인 제외");
assert.ok(seg.msgs[0].text.includes("버튼") && seg.msgs.at(-1)!.text === "ok");
assert.strictEqual(seg.branch, "feature/x");
assert.strictEqual(segmentForCommit(claude, parseClaudeLine, T - 3600), null, "커밋 시각 전 15분 안에 호출 없으면 null");

// Codex: event_msg 대화 + function_call git commit
const cx = (type: string, payload: unknown, s: number) => JSON.stringify({ timestamp: iso(s), type, payload });
const codex = [
  cx("session_meta", { cwd: "/r", id: "s1" }, T - 1000),
  cx("event_msg", { type: "user_message", message: "README 고쳐" }, T - 100),
  cx("event_msg", { type: "agent_message", message: "고칠게요" }, T - 90),
  cx("response_item", { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "git -C /r commit -am docs" }) }, T - 1),
  cx("response_item", { type: "function_call_output", output: "[main 1234567] docs" }, T),
];
const cs = segmentForCommit(codex, parseCodexLine, T)!;
assert.deepStrictEqual(cs.msgs.map((m) => m.role), ["user", "assistant", "tool", "tool"]);
assert.strictEqual(cs.cwd, "/r");
assert.ok(COMMIT_RE.test("rtk git commit -m x") && COMMIT_RE.test("git -C a commit") && !COMMIT_RE.test("git log --grep commit"));
assert.ok(COMMIT_RE.test("gh pr merge 12 --merge --delete-branch") && COMMIT_RE.test("git checkout main && git pull") && COMMIT_RE.test("git merge feature/x"), "머지도 경계");
// 머지: 커밋 뒤 리뷰 대화 → gh pr merge(머지 커밋 시각 직전) 구간
const M = T + 3600;
const merged = [...claude,
  cl("user", "리뷰 반영하고 머지해", M - 600),
  cl("assistant", [{ type: "text", text: "리뷰 반영 후 머지할게요" }], M - 500),
  cl("assistant", [{ type: "tool_use", name: "Bash", input: { command: "gh pr merge 3 --merge" } }], M - 3),
  cl("user", [{ type: "tool_result", content: "✓ Merged" }], M),
];
const ms = segmentForCommit(merged, parseClaudeLine, M)!;
assert.ok(ms.msgs.some((m) => m.text.includes("리뷰 반영하고 머지")) && !ms.msgs.some((m) => m.text.includes("버튼 색")) && ms.msgs.at(-1)!.text === "✓ Merged", "머지 세션 = 지난 커밋 이후 리뷰·머지 대화(이전 커밋 작업은 제외)");
assert.strictEqual(parseClaudeLine("not json"), null);
// 리뷰: 커밋 직후(3초 뒤) git pull 호출이 있어도 커밋 호출을 고름
const pulled = [...claude.slice(0, 7), cl("assistant", [{ type: "tool_use", name: "Bash", input: { command: "git pull" } }], T + 3)];
assert.ok(segmentForCommit(pulled, parseClaudeLine, T)!.msgs.some((m) => m.text.includes("버튼 색")), "커밋 직후 pull에 안 끌려감");
console.log("agentSessionParse ok");

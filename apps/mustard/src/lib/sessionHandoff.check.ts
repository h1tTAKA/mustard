// sessionHandoff 점검 — node --experimental-strip-types src/lib/sessionHandoff.check.ts
import assert from "node:assert";
import { formatSessionHandoff } from "./sessionHandoff.ts";
const md = formatSessionHandoff({ request: " 이어서 테스트 추가해줘 ", subject: "fix: x", hash: "abc1234def", branch: "feature/a", agent: "Claude Code", summary: "요약",
  messages: [{ role: "user", text: "고쳐줘", ts: 1 }, { role: "tool", text: "```\ncode\n```", ts: 2 }] });
assert.ok(md.startsWith("## Catch-up session: fix: x"));
assert.ok(md.includes("**Request:** 이어서 테스트 추가해줘") && md.includes("- Branch: feature/a") && md.includes("- Commit: abc1234def"));
assert.ok(md.includes("````\n[User] 고쳐줘"), "내용 백틱보다 긴 펜스");
assert.ok(!md.includes("\x1b"));
assert.ok(!formatSessionHandoff({ request: "  ", subject: "s", hash: "abc1234", branch: "", agent: "", summary: "", messages: [] }).includes("**Request:**"), "요청 비우면 공유만");
console.log("sessionHandoff ok");

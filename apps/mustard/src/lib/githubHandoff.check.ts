// githubHandoff 점검 — node --experimental-strip-types src/lib/githubHandoff.check.ts
import assert from "node:assert";
import { formatGithubHandoff } from "./githubHandoff.ts";

const md = formatGithubHandoff({ kind: "pr", number: 1, title: "Fix IME", part: "review", url: "https://x/1", author: "me", file: "a.js", line: 12, body: "use ```js``` here\u001b[31m" }, " please fix ");
assert.ok(md.startsWith("**Request:** please fix"), md);
assert.ok(md.includes("## GitHub PR #1 review comment: Fix IME") && md.includes("- File: a.js:12") && md.includes("- Author: @me"), md);
assert.ok(md.includes("````\nuse ```js``` here"), "본문 ``` 보다 긴 펜스");
assert.ok(!md.includes("\u001b"), "제어 문자 제거(터미널 안전)");
const issue = formatGithubHandoff({ kind: "issue", number: 7, title: "Bug", part: "body", body: "x".repeat(7000) });
assert.ok(issue.startsWith("Please look at this") && issue.includes("## GitHub Issue #7: Bug") && issue.includes("…(truncated)") && issue.length < 6500, "기본 요청·길이 상한");
console.log("githubHandoff ok");

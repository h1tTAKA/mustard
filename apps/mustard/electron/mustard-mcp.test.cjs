// mustard-mcp 점검 — node electron/mustard-mcp.test.cjs
const assert = require("node:assert");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { repoRoot } = require("./mustard-mcp.cjs");

const t = mkdtempSync(join(tmpdir(), "mmcp-"));
mkdirSync(join(t, "repo", ".git"), { recursive: true });
mkdirSync(join(t, "repo", "apps", "web"), { recursive: true });
assert.strictEqual(repoRoot(join(t, "repo", "apps", "web")), join(t, "repo"), "하위 폴더 → 레포 루트");
assert.strictEqual(repoRoot(join(t, "repo")), join(t, "repo"));
mkdirSync(join(t, "wt"), { recursive: true }); writeFileSync(join(t, "wt", ".git"), "gitdir: /x"); // worktree는 .git이 파일
assert.strictEqual(repoRoot(join(t, "wt")), join(t, "wt"), "worktree");
mkdirSync(join(t, "plain"), { recursive: true });
assert.strictEqual(repoRoot(join(t, "plain")), join(t, "plain"), ".git 없으면 cwd 그대로");
console.log("mustard-mcp ok");

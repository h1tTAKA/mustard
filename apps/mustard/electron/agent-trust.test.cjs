const assert = require("node:assert");
const { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync, statSync, chmodSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { trustAgentFolder, claudeConfigFile } = require("./agent-trust.cjs");

const home = realpathSync(mkdtempSync(join(tmpdir(), "trust-home-")));
const dir = realpathSync(mkdtempSync(join(tmpdir(), "trust-ws-")));
const env = {};

// Claude — 설정 파일 없으면 손대지 않음
assert.strictEqual(trustAgentFolder("claude", dir, { home, env }), "missing-config");
const f = join(home, ".claude.json");
writeFileSync(f, JSON.stringify({ userID: "u", projects: { [dir]: { allowedTools: ["x"] } } }));
chmodSync(f, 0o600);
assert.strictEqual(trustAgentFolder("claude", dir, { home, env }), "granted");
const j = JSON.parse(readFileSync(f, "utf8"));
assert.deepStrictEqual(j.projects[dir], { allowedTools: ["x"], hasTrustDialogAccepted: true }, "기존 값 보존");
assert.strictEqual(j.userID, "u", "다른 키 보존");
assert.strictEqual(statSync(f).mode & 0o777, 0o600, "권한 그대로");
assert.ok(!existsSync(`${f}.lock`), "잠금 풀림");
assert.strictEqual(trustAgentFolder("claude", dir, { home, env }), "unchanged", "이미 신뢰");
// 잠금이 잡혀 있으면 포기
const dir2 = realpathSync(mkdtempSync(join(tmpdir(), "trust-ws2-")));
mkdirSync(`${f}.lock`);
assert.strictEqual(trustAgentFolder("claude", dir2, { home, env }), "locked");
require("node:fs").rmdirSync(`${f}.lock`);
// 깨진 파일은 안 씀
writeFileSync(f, "{broken");
assert.strictEqual(trustAgentFolder("claude", dir2, { home, env }), "unreadable");
assert.strictEqual(readFileSync(f, "utf8"), "{broken");
// CLAUDE_CONFIG_DIR
assert.strictEqual(claudeConfigFile(home, { CLAUDE_CONFIG_DIR: "/c" }), "/c/.claude.json");

// Codex — 홈 없으면 안 씀, 있으면 표 추가, 이미 있으면 그대로
assert.strictEqual(trustAgentFolder("codex", dir, { home, env }), "missing-config");
mkdirSync(join(home, ".codex"));
writeFileSync(join(home, ".codex", "config.toml"), 'model = "x"');
assert.strictEqual(trustAgentFolder("codex", dir, { home, env }), "granted");
const t = readFileSync(join(home, ".codex", "config.toml"), "utf8");
assert.ok(t.startsWith('model = "x"\n') && t.includes(`[projects."${dir}"]\ntrust_level = "trusted"\n`), t);
assert.strictEqual(trustAgentFolder("codex", dir, { home, env }), "unchanged");

// 그 밖 에이전트·빈 폴더
assert.strictEqual(trustAgentFolder("gemini", dir, { home, env }), "skipped");
assert.strictEqual(trustAgentFolder("claude", "", { home, env }), "skipped");
console.log("agent-trust ok");

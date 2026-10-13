// mustard-mcp-install 점검 — node electron/mustard-mcp-install.test.cjs
const assert = require("node:assert");
const { claudeHasSame, tomlHasSame, tomlSection, mergeJsonConfig, dropLegacyProjectEntry } = require("./mustard-mcp-install.cjs");

const want = { command: "/Applications/Mustard.app/Contents/MacOS/Mustard", args: ["/u/mustard-mcp.cjs", "/u/ep.json"] };
const cj = (srv) => JSON.stringify({ projects: {}, mcpServers: { pencil: {}, ...(srv ? { mustard: srv } : {}) } });
assert.ok(claudeHasSame(cj({ type: "stdio", command: want.command, args: want.args, env: { ELECTRON_RUN_AS_NODE: "1" } }), want));
assert.ok(!claudeHasSame(cj({ command: "/old/Mustard", args: want.args, env: { ELECTRON_RUN_AS_NODE: "1" } }), want), "앱 위치 바뀜");
assert.ok(!claudeHasSame(cj({ command: want.command, args: want.args }), want), "env 빠짐");
assert.ok(!claudeHasSame(cj(null), want));
assert.ok(!claudeHasSame("{broken", want));

const toml = `model = "x"

[mcp_servers.mustard-browser]
command = "/old"

[mcp_servers.mustard]
command = "${want.command}"
args = ["${want.args[0]}", "${want.args[1]}"]

[mcp_servers.mustard.env]
ELECTRON_RUN_AS_NODE = "1"

[mcp_servers.other]
command = "/x"
`;
const sec = tomlSection(toml);
assert.ok(sec.startsWith("[mcp_servers.mustard]") && sec.includes("ELECTRON_RUN_AS_NODE") && !sec.includes("[mcp_servers.other]"), "하위 .env 포함, 다음 섹션 전까지");
assert.ok(tomlSection(toml, "mustard-browser").includes('"/old"') && !tomlSection(toml, "mustard-browser").includes(want.command), "이름이 겹쳐도(mustard / mustard-browser) 각자 섹션");
assert.ok(tomlHasSame(toml, want));
assert.ok(!tomlHasSame(toml.replace('"1"', '"0"'), want));
assert.ok(!tomlHasSame(null, want));

// JSON(OpenCode·Cursor·Gemini) — 다른 MCP·다른 키 보존, 옛 Mustard 항목만 제거
const entry = { command: want.command, args: want.args, env: { ELECTRON_RUN_AS_NODE: "1" } };
const cur = JSON.stringify({ hooks: { a: 1 }, mcpServers: { pencil: { command: "/p" }, "mustard-browser": { command: "/old" } } });
const merged = JSON.parse(mergeJsonConfig(cur, "mcpServers", entry));
assert.deepStrictEqual(Object.keys(merged.mcpServers).sort(), ["mustard", "pencil"]);
assert.deepStrictEqual(merged.hooks, { a: 1 }, "다른 설정 보존");
assert.deepStrictEqual(merged.mcpServers.pencil, { command: "/p" }, "다른 MCP 그대로");
assert.strictEqual(mergeJsonConfig(JSON.stringify(merged), "mcpServers", entry), null, "이미 같으면 안 씀");
assert.strictEqual(mergeJsonConfig("// jsonc\n{}", "mcpServers", entry), null, "못 읽으면 손대지 않음");
assert.ok(JSON.parse(mergeJsonConfig("", "mcp", { type: "local" })).mcp.mustard, "파일 없으면 새로");

// 레포 .mcp.json — mustard-katchup만
const proj = JSON.stringify({ mcpServers: { "mustard-katchup": { command: "node" }, other: { command: "x" } } });
assert.deepStrictEqual(JSON.parse(dropLegacyProjectEntry(proj)).mcpServers, { other: { command: "x" } });
assert.strictEqual(dropLegacyProjectEntry(JSON.stringify({ mcpServers: { other: {} } })), null, "우리 항목 없으면 안 씀");
console.log("mustard-mcp-install ok");

const assert = require("node:assert");
const { claudeHasSame, codexHasSame, codexSection } = require("./browser-mcp-install.cjs");

const want = { command: "/Applications/Mustard.app/Contents/MacOS/Mustard", args: ["/u/browser-mcp.cjs", "/u/ep.json"] };
const cj = (srv) => JSON.stringify({ projects: {}, mcpServers: { pencil: {}, ...(srv ? { "mustard-browser": srv } : {}) } });
assert.ok(claudeHasSame(cj({ type: "stdio", command: want.command, args: want.args, env: { ELECTRON_RUN_AS_NODE: "1" } }), want));
assert.ok(!claudeHasSame(cj({ command: "/old/Mustard", args: want.args, env: { ELECTRON_RUN_AS_NODE: "1" } }), want), "앱 위치 바뀜");
assert.ok(!claudeHasSame(cj({ command: want.command, args: want.args }), want), "env 빠짐");
assert.ok(!claudeHasSame(cj(null), want));
assert.ok(!claudeHasSame("{broken", want));

const toml = `model = "x"

[mcp_servers.node_repl]
command = "/a/node_repl"

[mcp_servers.mustard-browser]
command = "${want.command}"
args = ["${want.args[0]}", "${want.args[1]}"]

[mcp_servers.mustard-browser.env]
ELECTRON_RUN_AS_NODE = "1"

[mcp_servers.other]
command = "/Applications/Mustard.app/Contents/MacOS/Mustard"
`;
const sec = codexSection(toml);
assert.ok(sec.includes("ELECTRON_RUN_AS_NODE") && !sec.includes("[mcp_servers.other]"), "하위 .env 포함, 다음 섹션 전까지");
assert.ok(codexHasSame(toml, want));
assert.ok(!codexHasSame(toml.replace('"1"', '"0"'), want));
assert.ok(!codexHasSame(toml.replace(want.args[0], "/old/browser-mcp.cjs"), want));
assert.ok(!codexHasSame(`[mcp_servers.other]\ncommand = "${want.command}"\nargs = ["${want.args[0]}", "${want.args[1]}"]\n[mcp_servers.other.env]\nELECTRON_RUN_AS_NODE = "1"\n`, want), "다른 이름 섹션은 X");
assert.ok(!codexHasSame(null, want));
console.log("browser-mcp-install ok");

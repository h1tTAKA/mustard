// 인앱 브라우저 MCP를 Claude/Codex에 자동 등록(#1041) — 부팅 시 1회, 실패해도 앱 정상.
// - 스크립트를 userData에 복사(앱 번들 안 경로는 업데이트·이동으로 바뀜) → 그 경로를 등록.
// - 실행 = Mustard 실행파일을 node로(ELECTRON_RUN_AS_NODE=1) — 에이전트 환경에 node가 없어도 됨.
// - 주의: claude의 -e는 값을 여러 개 받는 옵션이라 이름을 -e 뒤에 두면 이름까지 env로 먹음(#1041 리뷰) → 이름 먼저.
// - 이미 같은 설정이면 건너뜀. 다르면(앱 위치 변경 등) 지우고 다시 등록. 설정 파일은 읽기만, 쓰기는 각 CLI가.
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { execFile } = require("node:child_process");
const { join } = require("node:path");
const { homedir } = require("node:os");

const NAME = "mustard-browser";

function readText(p) { try { return readFileSync(p, "utf8"); } catch { return null; } }
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 20000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr || err?.message || "").slice(0, 300) })));

// 순수 — 지금 등록된 값이 원하는 값과 같은지.
function claudeHasSame(claudeJsonText, want) {
  try {
    const cur = JSON.parse(claudeJsonText)?.mcpServers?.[NAME];
    return !!cur && cur.command === want.command && JSON.stringify(cur.args) === JSON.stringify(want.args) && cur.env?.ELECTRON_RUN_AS_NODE === "1";
  } catch { return false; }
}
function codexSection(tomlText) {
  if (!tomlText) return null;
  const start = tomlText.indexOf(`[mcp_servers.${NAME}]`);
  if (start < 0) return null;
  const rest = tomlText.slice(start + 1);
  const next = rest.search(/\n\[(?!mcp_servers\.mustard-browser[.\]])/); // 다음 섹션(자기 하위 .env 제외) 전까지
  return tomlText.slice(start, next < 0 ? undefined : start + 1 + next);
}
function codexHasSame(tomlText, want) {
  const sec = codexSection(tomlText);
  return !!sec && sec.includes(JSON.stringify(want.command)) && want.args.every((a) => sec.includes(JSON.stringify(a))) && /ELECTRON_RUN_AS_NODE\s*=\s*"1"/.test(sec);
}

async function installBrowserMcp({ userData, execPath, claudePath, codexPath }) {
  const script = join(userData, "mustard-mcp.cjs");
  const endpoint = join(userData, "mustard-mcp-endpoint.json");
  mkdirSync(userData, { recursive: true });
  const src = readFileSync(join(__dirname, "mustard-mcp.cjs"), "utf8");
  if (readText(script) !== src) writeFileSync(script, src);
  const want = { command: execPath, args: [script, endpoint] };
  const result = {};

  if (claudePath) {
    const dir = process.env.CLAUDE_CONFIG_DIR?.trim();
    const cfg = readText(dir ? join(dir, ".claude.json") : join(homedir(), ".claude.json"));
    if (cfg !== null && claudeHasSame(cfg, want)) result.claude = "same";
    else {
      await run(claudePath, ["mcp", "remove", "-s", "user", NAME]); // 없으면 실패 — 무시
      const r = await run(claudePath, ["mcp", "add", "-s", "user", NAME, "-e", "ELECTRON_RUN_AS_NODE=1", "--", want.command, ...want.args]);
      result.claude = r.ok ? "added" : `failed: ${r.out}`;
    }
  }
  if (codexPath) {
    const home = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
    if (codexHasSame(readText(join(home, "config.toml")), want)) result.codex = "same";
    else {
      await run(codexPath, ["mcp", "remove", NAME]);
      const r = await run(codexPath, ["mcp", "add", NAME, "--env", "ELECTRON_RUN_AS_NODE=1", "--", want.command, ...want.args]);
      result.codex = r.ok ? "added" : `failed: ${r.out}`;
    }
  }
  return result;
}

module.exports = { installBrowserMcp, claudeHasSame, codexHasSame, codexSection, NAME };

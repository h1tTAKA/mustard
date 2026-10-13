// Mustard MCP를 유저 에이전트들에 자동 등록(#1041 → #1070 통합) — 부팅 시 1회(패키징 앱), 실패해도 앱 정상.
// - 스크립트를 userData에 복사(앱 번들 안 경로는 업데이트·이동으로 바뀜) → 그 경로를 등록.
// - 실행 = Mustard 실행파일을 node로(ELECTRON_RUN_AS_NODE=1) — 에이전트 환경에 node가 없어도 됨.
// - 깔려 있는 에이전트만: Claude·Codex·Grok은 각 CLI로(설정 파일은 읽기만), OpenCode·Cursor·Gemini는 설정 JSON에 우리 항목만.
// - 이미 같은 설정이면 건너뜀. 옛 Mustard 항목(mustard-browser·mustard-katchup)만 지움 — 다른 MCP는 절대 안 건드림.
// - 주의: claude의 -e는 값을 여러 개 받는 옵션이라 이름을 -e 뒤에 두면 이름까지 env로 먹음(#1041 리뷰) → 이름 먼저.
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const { execFile } = require("node:child_process");
const { join, dirname } = require("node:path");
const { homedir } = require("node:os");

const NAME = "mustard";
const LEGACY = ["mustard-browser", "mustard-katchup"];
const ENV = { ELECTRON_RUN_AS_NODE: "1" };

function readText(p) { try { return readFileSync(p, "utf8"); } catch { return null; } }
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 20000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr || err?.message || "").slice(0, 300) })));

// ── 순수 판정(테스트) ──
function claudeHasSame(claudeJsonText, want, name = NAME) {
  try {
    const cur = JSON.parse(claudeJsonText)?.mcpServers?.[name];
    return !!cur && cur.command === want.command && JSON.stringify(cur.args) === JSON.stringify(want.args) && cur.env?.ELECTRON_RUN_AS_NODE === "1";
  } catch { return false; }
}
const claudeHas = (claudeJsonText, name) => { try { return !!JSON.parse(claudeJsonText)?.mcpServers?.[name]; } catch { return false; } };
// TOML(Codex·Grok)에서 [mcp_servers.<name>] 섹션(하위 .env 포함, 다음 다른 섹션 전까지)
function tomlSection(tomlText, name = NAME) {
  if (!tomlText) return null;
  const head = `[mcp_servers.${name}]`;
  const start = tomlText.indexOf(head);
  if (start < 0) return null;
  const rest = tomlText.slice(start + 1);
  const esc = name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const next = rest.search(new RegExp(`\\n\\[(?!mcp_servers\\.${esc}[.\\]])`));
  return tomlText.slice(start, next < 0 ? undefined : start + 1 + next);
}
function tomlHasSame(tomlText, want, name = NAME) {
  const sec = tomlSection(tomlText, name);
  return !!sec && sec.includes(JSON.stringify(want.command)) && want.args.every((a) => sec.includes(JSON.stringify(a))) && /ELECTRON_RUN_AS_NODE\s*=\s*"1"/.test(sec);
}
// JSON 설정(OpenCode·Cursor·Gemini) — 우리 항목만 넣고 옛 Mustard 항목만 뺌. 바뀐 게 없으면 null(안 씀). 파싱 실패(주석 등)면 null.
function mergeJsonConfig(text, key, entry) {
  let doc; try { doc = text && text.trim() ? JSON.parse(text) : {}; } catch { return null; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const servers = doc[key] && typeof doc[key] === "object" ? { ...doc[key] } : {};
  const before = JSON.stringify(servers);
  for (const old of LEGACY) delete servers[old];
  servers[NAME] = entry;
  if (JSON.stringify(servers) === before) return null;
  return JSON.stringify({ ...doc, [key]: servers }, null, 2) + "\n";
}
// 레포 .mcp.json(예전 "MCP 연결" 버튼이 넣은 것) — mustard-katchup 키 하나만 뺌. 없거나 파싱 실패면 null.
function dropLegacyProjectEntry(text) {
  let doc; try { doc = JSON.parse(text); } catch { return null; }
  if (!doc?.mcpServers?.["mustard-katchup"]) return null;
  const servers = { ...doc.mcpServers }; delete servers["mustard-katchup"];
  return JSON.stringify({ ...doc, mcpServers: servers }, null, 2) + "\n";
}

// ── 등록 ──
async function viaCli(cli, tomlPath, want, addArgs, removeArgs) { // Codex·Grok 공통(TOML + CLI)
  const toml = readText(tomlPath);
  for (const old of LEGACY) if (tomlSection(toml, old)) await run(cli, removeArgs(old));
  if (tomlHasSame(toml, want)) return "same";
  await run(cli, removeArgs(NAME)); // 없으면 실패 — 무시
  const r = await run(cli, addArgs);
  return r.ok ? "added" : `failed: ${r.out}`;
}
function viaJson(path, key, entry) {
  if (!existsSync(dirname(path))) return undefined; // 그 에이전트 안 깔림
  const text = readText(path);
  if (text && text.trim()) { try { JSON.parse(text); } catch { return "skipped: unreadable"; } } // 주석 든 JSONC 등 — 손대지 않음
  const next = mergeJsonConfig(text ?? "", key, entry);
  if (next === null) return "same";
  try { writeFileSync(path, next); return "added"; } catch (e) { return `failed: ${String(e?.message || e).slice(0, 120)}`; }
}

async function installMustardMcp({ userData, execPath, claudePath, codexPath, grokPath }) {
  const script = join(userData, "mustard-mcp.cjs");
  const endpoint = join(userData, "mustard-mcp-endpoint.json");
  mkdirSync(userData, { recursive: true });
  const src = readFileSync(join(__dirname, "mustard-mcp.cjs"), "utf8");
  if (readText(script) !== src) writeFileSync(script, src);
  const want = { command: execPath, args: [script, endpoint] };
  const result = {};
  const home = homedir();

  if (claudePath) {
    const dir = process.env.CLAUDE_CONFIG_DIR?.trim();
    const cfgPath = dir ? join(dir, ".claude.json") : join(home, ".claude.json");
    let cfg = readText(cfgPath);
    for (const old of LEGACY) if (cfg !== null && claudeHas(cfg, old)) await run(claudePath, ["mcp", "remove", "-s", "user", old]);
    cfg = readText(cfgPath);
    if (cfg !== null && claudeHasSame(cfg, want)) result.claude = "same";
    else {
      await run(claudePath, ["mcp", "remove", "-s", "user", NAME]);
      const r = await run(claudePath, ["mcp", "add", "-s", "user", NAME, "-e", "ELECTRON_RUN_AS_NODE=1", "--", want.command, ...want.args]);
      result.claude = r.ok ? "added" : `failed: ${r.out}`;
    }
    // 예전 레포별 등록(.mcp.json의 mustard-katchup)만 정리 — Claude가 아는 프로젝트 폴더들
    let projects = []; try { projects = Object.keys(JSON.parse(readText(cfgPath) || "{}").projects || {}); } catch { /* 무시 */ }
    let cleaned = 0;
    for (const p of projects) {
      const f = join(p, ".mcp.json"); const t = readText(f); if (!t) continue;
      const next = dropLegacyProjectEntry(t);
      if (next) { try { writeFileSync(f, next); cleaned++; } catch { /* 권한 등 — 건너뜀 */ } }
    }
    if (cleaned) result.claudeProjectsCleaned = cleaned;
  }
  if (codexPath) {
    const toml = join(process.env.CODEX_HOME?.trim() || join(home, ".codex"), "config.toml");
    result.codex = await viaCli(codexPath, toml, want, ["mcp", "add", NAME, "--env", "ELECTRON_RUN_AS_NODE=1", "--", want.command, ...want.args], (n) => ["mcp", "remove", n]);
  }
  if (grokPath) {
    result.grok = await viaCli(grokPath, join(home, ".grok", "config.toml"), want, ["mcp", "add", NAME, "-s", "user", "-e", "ELECTRON_RUN_AS_NODE=1", "--", want.command, ...want.args], (n) => ["mcp", "remove", n]);
  }
  const std = { command: want.command, args: want.args, env: ENV };
  result.opencode = viaJson(join(home, ".config", "opencode", "opencode.json"), "mcp", { type: "local", command: [want.command, ...want.args], environment: ENV, enabled: true });
  result.cursor = viaJson(join(home, ".cursor", "mcp.json"), "mcpServers", std);
  result.gemini = viaJson(join(home, ".gemini", "settings.json"), "mcpServers", std);
  return result;
}

module.exports = { installMustardMcp, claudeHasSame, tomlHasSame, tomlSection, mergeJsonConfig, dropLegacyProjectEntry, NAME };

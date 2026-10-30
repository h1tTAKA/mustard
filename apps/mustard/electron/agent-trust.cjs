// 에이전트 작업 폴더 미리 신뢰(#1216) — Mustard가 만든 작업공간에서 Claude·Codex가 "이 폴더를 믿나요?"를 매번 묻지 않게, 띄우기 직전 신뢰로 기록.
// 실패(설정 파일 없음·깨짐·잠금 못 잡음·모르는 형식)면 아무것도 안 함 — 그때는 에이전트가 원래대로 물어볼 뿐.
const { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join, sep } = require("node:path");

const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const STALE_MS = 10_000; // proper-lockfile 기본 — 잡은 쪽이 살아 있으면 계속 갱신하므로 이보다 오래된 잠금은 죽은 것

// 신뢰해도 되는 폴더 = Mustard가 만든 작업공간(사람용·Crew) 안쪽만. 아무 레포에서나 띄울 때까지 신뢰하면
// 클론해 온 레포의 hooks·MCP 설정이 묻지 않고 돌기 때문(리뷰). 렌더러가 다른 경로를 넘겨도 여기서 걸림.
function trustRoots(home, env = process.env) {
  return [env.MUSTARD_WORKSPACES_DIR || join(home, "mustard", "workspaces"), env.MUSTARD_WORKTREE_DIR || join(home, ".nunopi", "worktrees")].map(real);
}
const inRoots = (dir, roots) => { const d = real(dir); return roots.some((r) => d.startsWith(r + sep)); };

// Claude 전역 설정 위치 — 옛 .config.json이 있으면 그것, 아니면 CLAUDE_CONFIG_DIR(또는 홈)의 .claude.json
function claudeConfigFile(home, env) {
  const legacy = join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), ".config.json");
  if (existsSync(legacy)) return legacy;
  return join(env.CLAUDE_CONFIG_DIR || home, env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? ".claude-custom-oauth.json" : ".claude.json");
}

// proper-lockfile과 같은 잠금 = "<실제 파일>.lock" 폴더. 잡혀 있으면 잠깐씩(await, main을 막지 않음) 기다리다 포기, 10초 넘은 건 죽은 잠금이라 치움.
async function withLock(target, fn) {
  const lock = `${target}.lock`;
  for (let i = 0; i < 4; i++) {
    try { mkdirSync(lock); } catch (e) {
      if (e.code !== "EEXIST") return "unreadable";
      try { if (Date.now() - statSync(lock).mtimeMs > STALE_MS) { rmdirSync(lock); continue; } } catch { continue; }
      await wait(25 * 2 ** i);
      continue;
    }
    try { return fn(); } finally { try { rmdirSync(lock); } catch { /* 이미 없음 */ } }
  }
  return "locked";
}
// 원자 쓰기 — 링크면 실제 파일 자리에(링크 자체를 일반 파일로 바꾸지 않게, 리뷰), 권한 그대로
function replaceFile(target, text) {
  const tmp = join(dirname(target), `.mustard-trust-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, text, { mode: statSync(target).mode & 0o777 });
  renameSync(tmp, target);
}

// projects[폴더].hasTrustDialogAccepted = true. 키 = 실제 경로(NFC) + 받은 경로가 다르면 그것도.
async function trustClaude(dir, { home, env = process.env } = {}) {
  const file = claudeConfigFile(home, env);
  if (!existsSync(file)) return "missing-config"; // Claude를 한 번도 안 켬 — 첫 실행 때 Claude가 만듦
  const target = real(file);
  const keys = [...new Set([real(dir).normalize("NFC"), dir.normalize("NFC")])];
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  return withLock(target, () => {
    let cfg;
    try { cfg = JSON.parse(readFileSync(target, "utf8")); } catch { return "unreadable"; }
    if (!isObj(cfg) || (cfg.projects !== undefined && !isObj(cfg.projects))) return "unreadable";
    const projects = { ...(cfg.projects || {}) };
    if (keys.some((k) => isObj(projects[k]) && projects[k].hasTrustDialogAccepted === true)) return "unchanged";
    for (const k of keys) projects[k] = isObj(projects[k]) ? { ...projects[k], hasTrustDialogAccepted: true } : { hasTrustDialogAccepted: true };
    replaceFile(target, JSON.stringify({ ...cfg, projects }, null, 2));
    return "granted";
  });
}

// Codex: config.toml에 [projects."<폴더>"] trust_level = "trusted".
// 그 경로가 파일 어디에든 있거나, projects를 점 키·인라인 표로 쓰고 있으면 손대지 않음(같은 표를 두 번 정의하면 Codex 설정 전체가 안 열림, 리뷰).
const tomlStr = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
async function trustCodex(dir, { home, env = process.env } = {}) {
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  if (!existsSync(codexHome)) return "missing-config"; // Codex를 안 씀
  const file = join(codexHome, "config.toml");
  const path = real(dir);
  const table = `[projects.${tomlStr(path)}]\ntrust_level = "trusted"\n`;
  if (!existsSync(file)) { writeFileSync(file, table, { mode: 0o600 }); return "granted"; }
  const target = real(file);
  let text;
  try { text = readFileSync(target, "utf8"); } catch { return "unreadable"; }
  if (text.includes(path) || text.includes(tomlStr(path).slice(1, -1))) return "unchanged";
  if (/^\s*projects\s*(=|\.)/m.test(text)) return "unsupported";
  replaceFile(target, `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${table}`);
  return "granted";
}

// 에이전트별 — 지원하는 것만, Mustard 작업공간 안쪽만(그 밖은 그대로 물어봄)
async function trustAgentFolder(agent, dir, opts = {}) {
  if (!dir || (agent !== "claude" && agent !== "codex")) return "skipped";
  if (!inRoots(dir, trustRoots(opts.home, opts.env))) return "outside";
  try { return agent === "claude" ? await trustClaude(dir, opts) : await trustCodex(dir, opts); } catch { return "unreadable"; }
}

module.exports = { trustAgentFolder, trustClaude, trustCodex, claudeConfigFile, trustRoots };

// 에이전트 작업 폴더 미리 신뢰(#1216) — 새 작업공간에서 Claude·Codex가 "이 폴더를 믿나요?"를 매번 묻지 않게, 띄우기 직전 신뢰로 기록.
// 실패(설정 파일 없음·깨짐·잠금 못 잡음)면 아무것도 안 함 — 그때는 에이전트가 원래대로 물어볼 뿐.
const { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");

const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Claude 전역 설정 위치 — 옛 .config.json이 있으면 그것, 아니면 CLAUDE_CONFIG_DIR(또는 홈)의 .claude.json
function claudeConfigFile(home, env) {
  const legacy = join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), ".config.json");
  if (existsSync(legacy)) return legacy;
  return join(env.CLAUDE_CONFIG_DIR || home, env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? ".claude-custom-oauth.json" : ".claude.json");
}

// Claude가 쓰는 잠금과 같은 방식(proper-lockfile = "<파일>.lock" 폴더 만들기) — 잡혀 있으면 몇 번만 기다리고 포기(Claude 쓰기를 깨지 않게)
function withLock(file, fn) {
  const lock = `${file}.lock`;
  for (let i = 0; i < 4; i++) { // 최대 ~0.4초 — main을 오래 멈추지 않게
    try { mkdirSync(lock); } catch (e) { if (e.code !== "EEXIST") return "unreadable"; sleep(25 * 2 ** i); continue; }
    try { return fn(); } finally { try { rmdirSync(lock); } catch { /* 이미 없음 */ } }
  }
  return "locked";
}

// projects[폴더].hasTrustDialogAccepted = true. 같은 폴더(실제 경로·NFC)가 이미 신뢰면 안 씀.
function trustClaude(dir, { home, env = process.env } = {}) {
  const file = claudeConfigFile(home, env);
  if (!existsSync(file)) return "missing-config"; // Claude를 한 번도 안 켬 — 첫 실행 때 Claude가 만듦
  const key = real(dir).normalize("NFC");
  return withLock(file, () => {
    let cfg;
    try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch { return "unreadable"; }
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return "unreadable";
    if (cfg.projects !== undefined && (typeof cfg.projects !== "object" || cfg.projects === null || Array.isArray(cfg.projects))) return "unreadable";
    const projects = { ...(cfg.projects || {}) };
    const cur = projects[key];
    if (cur && typeof cur === "object" && cur.hasTrustDialogAccepted === true) return "unchanged";
    projects[key] = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur, hasTrustDialogAccepted: true } : { hasTrustDialogAccepted: true };
    const tmp = `${file}.mustard-${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...cfg, projects }, null, 2), { mode: statSync(file).mode & 0o777 }); // 원래 권한 그대로
    renameSync(tmp, file); // 한 번에 바꿔 끼움 — 쓰다 만 파일이 남지 않게
    return "granted";
  });
}

// Codex: config.toml에 [projects."<폴더>"] trust_level = "trusted". 그 표가 이미 있으면(신뢰든 아니든 사용자 선택) 손대지 않음.
const tomlStr = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
function trustCodex(dir, { home, env = process.env } = {}) {
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  if (!existsSync(codexHome)) return "missing-config"; // Codex를 안 씀
  const file = join(codexHome, "config.toml");
  const header = `[projects.${tomlStr(real(dir))}]`;
  let text = "";
  try { text = existsSync(file) ? readFileSync(file, "utf8") : ""; } catch { return "unreadable"; }
  if (text.split(/\r?\n/).some((l) => l.trim() === header)) return "unchanged";
  appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}\n${header}\ntrust_level = "trusted"\n`);
  return "granted";
}

// 에이전트별 — 지원하는 것만(그 밖은 그대로 물어봄)
function trustAgentFolder(agent, dir, opts) {
  if (!dir) return "skipped";
  try {
    if (agent === "claude") return trustClaude(dir, opts);
    if (agent === "codex") return trustCodex(dir, opts);
  } catch { return "unreadable"; }
  return "skipped";
}

module.exports = { trustAgentFolder, trustClaude, trustCodex, claudeConfigFile };

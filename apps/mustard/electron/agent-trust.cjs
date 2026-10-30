// 에이전트 작업 폴더 미리 신뢰(#1216) — Mustard가 만든 작업공간(worktree)에서 Claude가 "이 폴더를 믿나요?"를 매번 묻지 않게, 띄우기 직전 신뢰로 기록.
// 조건: Mustard 작업공간 안쪽 + 그 레포의 메인 폴더를 사용자가 이미 Claude에서 신뢰함 + 작업공간의 지금 커밋이 이미 레포에 있는 코드
// (내 로컬 브랜치나 origin 브랜치에 들어 있음) → 그 신뢰를 작업공간에 물려줌. 포크 PR처럼 남의 커밋에서 시작한 작업공간은 원래대로 물어봄(리뷰).
// 한계: 신뢰를 준 뒤 그 작업공간에서 바뀌는 것(에이전트 자신의 작업)은 Claude가 다시 묻지 않음 — 사람이 직접 "믿어요"를 눌렀을 때와 같음.
// 실패(설정 파일 없음·깨짐·잠금 못 잡음)면 아무것도 안 함 — 그때는 Claude가 원래대로 물어볼 뿐.
// ponytail: Claude만. Codex(config.toml)는 TOML 형식이 여러 가지라 안전하게 덧붙이기 어려움 — 필요해지면 TOML 파서로.
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve, sep } = require("node:path");

const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const git = async (cwd, args) => (await promisify(execFile)("git", args, { cwd, encoding: "utf8", timeout: 3000 })).stdout.trim(); // 비동기 — main을 막지 않게(리뷰)
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Mustard가 만든 작업공간 루트(사람용·Crew) — 렌더러가 다른 경로를 넘겨도 여기서 걸림
function trustRoots(home, env = process.env) {
  return [env.MUSTARD_WORKSPACES_DIR || join(home, "mustard", "workspaces"), env.MUSTARD_WORKTREE_DIR || join(home, ".nunopi", "worktrees")].map(real);
}
const inRoots = (dir, roots) => roots.some((r) => dir.startsWith(r + sep));

// 작업공간의 메인 폴더 = 공용 .git의 부모(linked worktree일 때만). 아니면 null.
async function mainOf(dir) {
  try {
    const [gitDir, common] = (await git(dir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])).split("\n");
    return gitDir !== common && common.endsWith(`${sep}.git`) ? real(dirname(common)) : null;
  } catch { return null; }
}
// 작업공간의 지금 커밋(HEAD)이 그 작업공간 자기 브랜치 말고 다른 로컬 브랜치나 origin 브랜치에도 들어 있는지 = 이미 레포에 있는 코드.
// 포크 PR(refs/pull로 받아 만든 브랜치)은 자기 브랜치에만 있어 false. 확인 못 하면 false.
async function knownCommit(dir) {
  try {
    const own = await git(dir, ["symbolic-ref", "-q", "HEAD"]).catch(() => "");
    const refs = (await git(dir, ["for-each-ref", "--contains", "HEAD", "--format=%(refname)", "refs/heads", "refs/remotes/origin"])).split("\n").filter(Boolean);
    return refs.some((r) => r !== own && r !== "refs/remotes/origin/HEAD");
  } catch { return false; }
}

// Claude 전역 설정 위치 — 옛 .config.json이 있으면 그것, 아니면 CLAUDE_CONFIG_DIR(또는 홈)의 .claude.json
function claudeConfigFile(home, env) {
  const legacy = join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), ".config.json");
  if (existsSync(legacy)) return legacy;
  return join(env.CLAUDE_CONFIG_DIR || home, env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? ".claude-custom-oauth.json" : ".claude.json");
}

// proper-lockfile과 같은 잠금 = "<실제 파일>.lock" 폴더. 잡혀 있으면 잠깐씩(await) 기다리다 포기 — 남의 잠금은 죽은 것이라도 건드리지 않음(치우다 살아 있는 잠금을 뺏을 수 있어서, 리뷰).
async function withLock(target, fn) {
  const lock = `${target}.lock`;
  for (let i = 0; i < 4; i++) {
    try { mkdirSync(lock); } catch (e) {
      if (e.code !== "EEXIST") return "unreadable";
      await wait(25 * 2 ** i);
      continue;
    }
    try { return fn(); } finally { try { rmdirSync(lock); } catch { /* 이미 없음 */ } }
  }
  return "locked";
}

// 원자 쓰기 — 링크면 실제 파일 자리에(링크 자체를 일반 파일로 바꾸지 않게), 권한 그대로
function replaceFile(target, text) {
  const mode = statSync(target).mode & 0o777;
  const tmp = join(dirname(target), `.mustard-trust-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, text, { mode: 0o600 });
    chmodSync(tmp, mode); // umask 무시하고 원래 권한 그대로(리뷰)
    renameSync(tmp, target);
  } catch (e) { rmSync(tmp, { force: true }); throw e; } // 실패하면 설정 사본을 남기지 않음
}

const trusted = (projects, k) => isObj(projects[k]) && projects[k].hasTrustDialogAccepted === true;

// 키 = 실제 경로(NFC) + 받은 경로가 다르면 그것도. 빠진 키만 채움(하나만 있고 하나는 없으면 그것까지, 리뷰).
async function trustClaude(dir, main, { home, env = process.env } = {}) {
  const file = claudeConfigFile(home, env);
  if (!existsSync(file)) return "missing-config"; // Claude를 한 번도 안 켬
  const target = real(file);
  const keys = [...new Set([real(dir).normalize("NFC"), dir.normalize("NFC")])];
  return withLock(target, () => {
    let cfg;
    try { cfg = JSON.parse(readFileSync(target, "utf8")); } catch { return "unreadable"; }
    if (!isObj(cfg) || (cfg.projects !== undefined && !isObj(cfg.projects))) return "unreadable";
    const projects = { ...(cfg.projects || {}) };
    if (!trusted(projects, main.normalize("NFC"))) return "main-untrusted"; // 메인 폴더를 사용자가 아직 안 믿음 — 물려줄 신뢰 없음
    const missing = keys.filter((k) => !trusted(projects, k));
    if (!missing.length) return "unchanged";
    for (const k of missing) projects[k] = isObj(projects[k]) ? { ...projects[k], hasTrustDialogAccepted: true } : { hasTrustDialogAccepted: true };
    replaceFile(target, JSON.stringify({ ...cfg, projects }, null, 2));
    return "granted";
  });
}

async function trustAgentFolder(agent, dir, opts = {}) {
  if (!dir || agent !== "claude") return "skipped";
  dir = resolve(dir); // ".." 조각 정리
  try { if (!statSync(dir).isDirectory()) return "skipped"; } catch { return "skipped"; }
  if (!inRoots(real(dir), trustRoots(opts.home, opts.env))) return "outside";
  const main = await mainOf(dir);
  if (!main) return "not-worktree";
  if (!(await knownCommit(dir))) return "unknown-commit";
  try { return await trustClaude(dir, main, opts); } catch { return "unreadable"; }
}

module.exports = { trustAgentFolder, claudeConfigFile, trustRoots };

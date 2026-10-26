// 컴퓨터 사용(#1175 1단계) — 에이전트의 데스크톱 앱 조작을 외부 드라이버(cua-driver)에 넘기고, Mustard는 막기·기록만.
// 호출은 모두 main을 거침(Mustard MCP → main 로컬 HTTP → 여기) — 그래서 끄기·비상 정지·막는 앱·기록이 에이전트 종류와 상관없이 걸림.
// 설정 = ~/.nunopi/computer-use.json { enabled(기본 끔), blocked:[앱 이름] }, 기록 = ~/.nunopi/computer-use-log.jsonl(최근 200건).
// 권한(접근성·화면 기록)은 드라이버 앱이 받음 — Mustard는 TCC 권한이 필요 없음.
const { readFileSync, writeFileSync, mkdirSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");
const { runCmd, shellPath, mergePath, candidates } = require("./agent-cli.cjs");

const BIN = "cua-driver";
// 기본으로 막는 앱 — 비밀번호·인증 정보가 든 앱(이름 부분 일치, 대소문자 무시)
const DEFAULT_BLOCKED = ["1Password", "Bitwarden", "Dashlane", "LastPass", "NordPass", "Proton Pass", "Keychain Access", "Passwords"];
const LOG_MAX = 200;

const dir = (home = homedir()) => join(home, ".nunopi");
function readConfig(home) {
  let c = {};
  try { c = JSON.parse(readFileSync(join(dir(home), "computer-use.json"), "utf8")) || {}; } catch { /* 없음 = 기본값 */ }
  return { enabled: c.enabled === true, blocked: Array.isArray(c.blocked) ? c.blocked.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : DEFAULT_BLOCKED };
}
function writeConfig(patch, home) {
  const next = { ...readConfig(home), ...patch };
  mkdirSync(dir(home), { recursive: true });
  writeFileSync(join(dir(home), "computer-use.json"), JSON.stringify(next));
  return next;
}

// 인자에서 대상 앱 단서 — pid(숫자)와 앱 이름류 문자열(app·app_name·bundle_id·name). 하위 객체도 한 단계 봄.
function targetsOf(args) {
  const pids = [], names = [];
  const scan = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 1) return;
    for (const [k, v] of Object.entries(o)) {
      if (/^(pid|target_pid)$/i.test(k) && Number.isInteger(Number(v)) && Number(v) > 0) pids.push(Number(v));
      else if (/^(app|app_name|application|bundle_id|bundleId|name)$/i.test(k) && typeof v === "string") names.push(v);
      else if (v && typeof v === "object") scan(v, depth + 1);
    }
  };
  scan(args, 0);
  return { pids, names };
}
// 막힌 앱이면 그 이름, 아니면 null. labels = pid로 찾은 실행 파일 경로·앱 이름들 + 인자의 이름들
function blockedBy(labels, blocked) {
  const low = labels.map((s) => String(s).toLowerCase());
  return blocked.find((b) => low.some((l) => l.includes(b.toLowerCase()))) || null;
}
// pid → 실행 파일 경로(예: /Applications/1Password.app/Contents/MacOS/1Password). 못 찾으면 ""
async function procPath(pid, run = runCmd) {
  const r = await run("/bin/ps", ["-p", String(pid), "-o", "comm="], 5000, process.env);
  return r.code === 0 ? r.out.trim() : "";
}

// 드라이버 찾기 — 로그인 셸 PATH + 흔한 설치 폴더. { path, version } | null
let driverCache = null;
async function findDriver({ force = false, home = homedir(), run = runCmd } = {}) {
  if (driverCache && !force) return driverCache;
  const pathStr = mergePath(process.env.PATH, await shellPath({ force }));
  for (const p of candidates([BIN], pathStr, home)) {
    const r = await run(p, ["--version"], 10_000, { ...process.env, PATH: pathStr });
    if (r.code === 0) { driverCache = { path: p, version: (/\d+\.\d+\.\d+[\w.+-]*/.exec(r.out)?.[0]) || r.out.split("\n")[0].slice(0, 40), env: { ...process.env, PATH: pathStr } }; return driverCache; }
  }
  driverCache = null;
  return null;
}

function log(entry, home) {
  try {
    const f = join(dir(home), "computer-use-log.jsonl");
    mkdirSync(dir(home), { recursive: true });
    appendFileSync(f, JSON.stringify(entry) + "\n");
    const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
    if (lines.length > LOG_MAX * 2) writeFileSync(f, lines.slice(-LOG_MAX).join("\n") + "\n"); // 두 배 넘으면 한 번에 잘라 냄
  } catch { /* 기록 실패는 조작을 막지 않음 */ }
}
function readLog(home, n = 50) {
  try { return readFileSync(join(dir(home), "computer-use-log.jsonl"), "utf8").split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l)).reverse(); }
  catch { return []; }
}

// 정지 세대 — 비상 정지 뒤에 도착한 결과는 버림(에이전트에게 "정지됨")
let generation = 0;

// 드라이버 실행 — 결과 { ok, text } | { ok:false, error }
async function driver(args, { timeout = 60_000, home } = {}) {
  const d = await findDriver({ home });
  if (!d) return { ok: false, error: "driver-missing" };
  const gen = generation;
  const r = await runCmd(d.path, args, timeout, d.env);
  if (gen !== generation) return { ok: false, error: "stopped" };
  if (r.timedOut) return { ok: false, error: "timeout" };
  return r.code === 0 ? { ok: true, text: r.out } : { ok: false, error: "driver-error", text: r.out.slice(0, 2000) };
}

// 에이전트 도구 한 번 — 켜짐·막는 앱 확인 → 드라이버 → 기록
async function call(tool, args = {}, { home, cwd = "", run = runCmd } = {}) {
  const at = new Date().toISOString();
  const cfg = readConfig(home);
  if (!cfg.enabled) return { ok: false, error: "disabled" };
  if (typeof tool !== "string" || !/^[a-z][a-z0-9_]*$/i.test(tool)) return { ok: false, error: "bad-tool" };
  const { pids, names } = targetsOf(args);
  const labels = [...names, ...(await Promise.all(pids.map((p) => procPath(p, run))))].filter(Boolean);
  const hit = blockedBy(labels, cfg.blocked);
  const app = labels[0] ? String(labels[0]).split("/").find((s) => s.endsWith(".app"))?.replace(/\.app$/, "") || String(labels[0]).split("/").pop() : "";
  if (hit) { log({ at, tool, app, cwd, result: "blocked" }, home); return { ok: false, error: "blocked", app: hit }; }
  const r = await driver(["call", tool, JSON.stringify(args ?? {})], { home });
  log({ at, tool, app, cwd, result: r.ok ? "ok" : r.error }, home);
  return r;
}

// 비상 정지 — 끄고, 진행 중 결과는 버림(드라이버 쪽 동작은 한 번에 하나라 곧 끝남)
function stop(home) { generation++; writeConfig({ enabled: false }, home); log({ at: new Date().toISOString(), tool: "(stop)", app: "", cwd: "", result: "stopped" }, home); }

// 설정 화면용 — 드라이버 상태 + 권한 상태(드라이버가 내는 글 그대로 — 형식이 버전마다 다를 수 있어 줄 단위로 판정)
async function status({ force = false, home } = {}) {
  const d = await findDriver({ force, home });
  const cfg = readConfig(home);
  if (!d) return { ...cfg, driver: null, permissions: null };
  const p = await runCmd(d.path, ["permissions", "status"], 15_000, d.env);
  const perm = (re) => { const line = p.out.split("\n").find((l) => re.test(l)); return !line ? "unknown" : /(not|missing|denied|✗|false|off)/i.test(line) ? "missing" : /(grant|ok|✓|true|on|allowed)/i.test(line) ? "granted" : "unknown"; };
  return { ...cfg, driver: { path: d.path, version: d.version }, permissions: p.code === -1 ? null : { accessibility: perm(/accessib/i), screen: perm(/screen/i) } };
}

module.exports = { DEFAULT_BLOCKED, readConfig, writeConfig, targetsOf, blockedBy, findDriver, driver, call, stop, status, readLog, BIN };

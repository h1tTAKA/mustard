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

// 인자에서 대상 앱 단서 — pid(숫자)와 앱 이름류 문자열(app·app_name·bundle_id·name), 하위 객체 전부.
// targeted = 창·요소·좌표를 가리키는 인자가 있음(값이 객체여도) — 그런데 확인되는 pid가 없으면 어느 앱인지 몰라 막을 수 없음 → 거절(리뷰).
// 이름은 막기에만 쓰고 통과 근거로는 안 씀("name": "Save" 같은 값으로 비켜 가지 않게, 리뷰)
function targetsOf(args) {
  const pids = [], names = [];
  let targeted = false;
  const scan = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 8) return;
    for (const [k, v] of Object.entries(o)) {
      if (/^(window_?id|window_?index|window|element_?token|element_?index|element|x|y|from_x|to_x|point|position)$/i.test(k)) targeted = true;
      if (/^(pid|target_pid)$/i.test(k) && Number.isInteger(Number(v)) && Number(v) > 0) pids.push(Number(v));
      else if (/^(app|app_name|application|bundle_id|bundleId|name)$/i.test(k) && typeof v === "string") names.push(v);
      else if (v && typeof v === "object") scan(v, depth + 1);
    }
  };
  scan(args, 0);
  return { pids, names, targeted };
}
// 막힌 앱이면 그 이름, 아니면 null. labels = pid로 찾은 실행 파일 경로·앱 이름들 + 인자의 이름들
function blockedBy(labels, blocked) {
  const low = labels.map((s) => String(s).toLowerCase());
  return blocked.find((b) => low.some((l) => l.includes(b.toLowerCase()))) || null;
}
// 지금 앞에 있는 앱의 번들 경로(macOS) — 대상이 없는 키 입력도 앞 앱으로 가니 모든 호출에서 확인(리뷰). 다른 OS·실패 = ""
async function frontApp(run = runCmd) {
  if (process.platform !== "darwin") return "";
  const asn = (await run("/usr/bin/lsappinfo", ["front"], 5000, process.env)).out.trim();
  if (!asn) return "";
  const r = await run("/usr/bin/lsappinfo", ["info", "-only", "bundlepath", asn], 5000, process.env);
  return /"([^"]+)"\s*$/.exec(r.out.trim())?.[1] || "";
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

// 정지 세대 — 호출이 시작될 때 세대를 잡고, 그 사이 비상 정지가 있었으면 드라이버를 안 띄우거나 결과를 버림.
// live = 실행 중인 드라이버 — 비상 정지 때 프로세스 그룹째 죽임(리뷰)
let generation = 0;
const live = new Set();

// 드라이버 실행 — 결과 { ok, text } | { ok:false, error }. gen = 호출 시작 때 세대(없으면 지금)
async function driver(args, { timeout = 60_000, home, gen = generation } = {}) {
  const d = await findDriver({ home });
  if (!d) return { ok: false, error: "driver-missing" };
  if (gen !== generation) return { ok: false, error: "stopped" };
  const r = await runCmd(d.path, args, timeout, d.env, (c) => { live.add(c); c.on("close", () => live.delete(c)); });
  if (gen !== generation) return { ok: false, error: "stopped" };
  if (r.timedOut) return { ok: false, error: "timeout" };
  return r.code === 0 ? { ok: true, text: r.out } : { ok: false, error: "driver-error", text: r.out.slice(0, 2000) };
}

// 에이전트 도구 한 번 — 켜짐·막는 앱 확인 → 드라이버 → 기록
async function call(tool, args = {}, { home, cwd = "", run = runCmd } = {}) {
  const at = new Date().toISOString();
  const gen = generation; // 기다리는 동안(ps 등) 비상 정지가 와도 잡히게 맨 처음에(리뷰)
  const cfg = readConfig(home);
  if (!cfg.enabled) return { ok: false, error: "disabled" };
  if (typeof tool !== "string" || !/^[a-z][a-z0-9_]*$/i.test(tool)) return { ok: false, error: "bad-tool" };
  const { pids, names, targeted } = targetsOf(args);
  if (targeted && !pids.length) { log({ at, tool, app: "", cwd, result: "no-target" }, home); return { ok: false, error: "no-target" }; }
  const paths = await Promise.all(pids.map((p) => procPath(p, run)));
  if (paths.some((p) => !p)) { log({ at, tool, app: "", cwd, result: "no-target" }, home); return { ok: false, error: "no-target" }; } // pid가 어느 앱인지 못 찾음 → 막을 수 없으니 거절
  const labels = [...paths, ...names];
  const app = labels[0] ? String(labels[0]).split("/").find((s) => s.endsWith(".app"))?.replace(/\.app$/, "") || String(labels[0]).split("/").pop() : "";
  let hit = blockedBy(labels, cfg.blocked); // 대상 앱 먼저, 다음 지금 앞에 있는 앱
  if (!hit) {
    const front = await frontApp(run);
    if (process.platform === "darwin" && !front) { log({ at, tool, app, cwd, result: "front-unknown" }, home); return { ok: false, error: "front-unknown" }; } // 앞 앱을 모르면 막을 수 없으니 거절(리뷰)
    hit = blockedBy([front].filter(Boolean), cfg.blocked);
  }
  if (hit) { log({ at, tool, app, cwd, result: "blocked" }, home); return { ok: false, error: "blocked", app: hit }; }
  const r = await driver(["call", tool, JSON.stringify(args ?? {})], { home, gen });
  log({ at, tool, app, cwd, result: r.ok ? "ok" : r.error }, home);
  return r;
}

// 비상 정지 — 끄고, 실행 중인 드라이버는 그룹째 죽이고, 늦게 온 결과는 버림
function stop(home) {
  generation++;
  for (const c of live) { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* 이미 끝남 */ } } }
  live.clear();
  writeConfig({ enabled: false }, home); log({ at: new Date().toISOString(), tool: "(stop)", app: "", cwd: "", result: "stopped" }, home);
}

// 설정 화면용 — 드라이버 상태 + 권한 상태(드라이버가 내는 글 그대로 — 형식이 버전마다 다를 수 있어 줄 단위로 판정)
async function status({ force = false, home } = {}) {
  const d = await findDriver({ force, home });
  if (!d) return { ...readConfig(home), driver: null, permissions: null };
  const p = await runCmd(d.path, ["permissions", "status"], 15_000, d.env);
  const cfg = readConfig(home); // 기다린 뒤에 읽음 — 그 사이 켜기/끄기가 바뀌어도 최신 값(리뷰)
  const perm = (re) => { const line = p.out.split("\n").find((l) => re.test(l)); return !line ? "unknown" : /(not|missing|denied|✗|false|off)/i.test(line) ? "missing" : /(grant|ok|✓|true|on|allowed)/i.test(line) ? "granted" : "unknown"; };
  return { ...cfg, driver: { path: d.path, version: d.version }, permissions: p.code === -1 ? null : { accessibility: perm(/accessib/i), screen: perm(/screen/i) } };
}

// 에이전트 도구(Mustard MCP의 computer_*) → MCP 결과 모양. 꺼져 있으면 목록·설명도 안 줌(에이전트가 유저에게 켜 달라고 하게).
const ERR = {
  disabled: "Computer use is turned off in Mustard (Settings > Computer use). Ask the user to turn it on. Do not try other ways to control the desktop.",
  "driver-missing": "The desktop driver (cua-driver) is not installed. Ask the user to install it from Mustard (Settings > Computer use). Do not install it yourself.",
  blocked: "Mustard blocks this app (Settings > Computer use > Blocked apps). Do not operate it; tell the user.",
  stopped: "The user stopped computer use (emergency stop). Stop all desktop actions and report what you did so far.",
  timeout: "The driver did not answer in time. Take a fresh snapshot before retrying.",
  "bad-tool": "Invalid driver tool name. Use computer_tools to list tools.",
  "front-unknown": "Mustard could not tell which app is in front, so it refused the action. Try again in a moment.",
  "no-target": "Mustard needs to know which app this targets: include the app's pid (from the window state/app list) in args. Mustard checks it against blocked apps.",
};
async function agentTool(name, args = {}, { home, cwd = "" } = {}) {
  const out = (t, isError = false) => ({ content: [{ type: "text", text: String(t || "(empty)") }], isError });
  if (!readConfig(home).enabled) return out(ERR.disabled, true);
  const tool = String(args?.tool || "");
  let r;
  if (name === "computer_tools") r = await driver(["list-tools"], { home });
  else if (name === "computer_describe") r = /^[a-z][a-z0-9_]*$/i.test(tool) ? await driver(["describe", tool], { home }) : { ok: false, error: "bad-tool" };
  else if (name === "computer_call") r = await call(tool, args?.args && typeof args.args === "object" ? args.args : {}, { home, cwd });
  else return out(`Unknown tool: ${name}`, true);
  if (r.ok) return out(r.text);
  return out(r.error === "blocked" ? `${ERR.blocked} (${r.app})` : ERR[r.error] || `Driver error: ${r.text || r.error}`, true);
}

module.exports = { agentTool, DEFAULT_BLOCKED, readConfig, writeConfig, targetsOf, blockedBy, findDriver, driver, call, stop, status, readLog, BIN };

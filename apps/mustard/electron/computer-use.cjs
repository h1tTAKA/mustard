// 컴퓨터 사용(#1175 1단계) — 에이전트의 데스크톱 앱 조작을 외부 드라이버(cua-driver)에 넘기고, Mustard는 막기·기록만.
// 호출은 모두 main을 거침(Mustard MCP → main 로컬 HTTP → 여기) — 그래서 끄기·비상 정지·막는 앱·기록이 에이전트 종류와 상관없이 걸림.
// 설정 = ~/.nunopi/computer-use.json { enabled(기본 끔), blocked:[앱 이름] }, 기록 = ~/.nunopi/computer-use-log.jsonl(최근 200건).
// 권한(접근성·화면 기록)은 드라이버 앱이 받음 — Mustard는 TCC 권한이 필요 없음.
const { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { homedir, tmpdir, release } = require("node:os");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
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

// ── 내장 도우미(#1189, macOS 14+) ── 있으면 외부 드라이버 대신. `open -n -g`로 띄워 권한이 도우미 자신에게 붙게.
// 소켓 하나를 계속 씀(0700 임시 폴더, 1회용 토큰 파일 — 도우미가 읽고 지움). 끊기면 다음 요청 때 다시 띄움.
const HELPER_ID = "ai.neuradex.mustard.computer-use";
let helperApp = null;
function setHelperApp(p) { helperApp = p && process.platform === "darwin" && Number(release().split(".")[0]) >= 23 && existsSync(p) ? p : null; }
let conn = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let starting = null, startingGen = -1; // 띄우는 중 — 동시에 온 요청이 도우미를 둘 띄우지 않게 같은 약속을 기다림(비상 정지 전에 띄우던 건 안 씀, 리뷰)
function helper() {
  if (conn && !conn.sock.destroyed) return Promise.resolve(conn);
  if (!starting || startingGen !== generation) {
    const p = startHelper().finally(() => { if (starting === p) starting = null; });
    starting = p; startingGen = generation;
  }
  return starting;
}
async function startHelper() {
  const gen = generation;
  const dir = mkdtempSync(join(tmpdir(), "mcu-"));
  const sockPath = join(dir, "s"), tokenFile = join(dir, "t"), token = randomBytes(24).toString("hex");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const r = await runCmd("/usr/bin/open", ["-n", "-g", helperApp, "--args", "--serve", sockPath, "--token-file", tokenFile], 15_000, process.env);
  for (let i = 0; r.code === 0 && i < 100 && !existsSync(sockPath); i++) await sleep(100);
  const sock = await new Promise((res) => { const s = net.createConnection(sockPath); s.once("connect", () => res(s)); s.once("error", () => res(null)); });
  if (!sock) { rmSync(dir, { recursive: true, force: true }); return null; }
  const c = { sock, pending: new Map(), buf: "", id: 0, token };
  sock.setEncoding("utf8");
  sock.on("data", (d) => {
    c.buf += d;
    for (let i; (i = c.buf.indexOf("\n")) >= 0;) {
      const line = c.buf.slice(0, i); c.buf = c.buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      const p = c.pending.get(m.id); if (p) { c.pending.delete(m.id); p(m); }
    }
  });
  sock.on("error", () => {});
  sock.on("close", () => {
    for (const p of c.pending.values()) p({ ok: false, error: { code: "helper-gone", message: "The helper stopped." } });
    c.pending.clear(); rmSync(dir, { recursive: true, force: true });
    if (conn === c) conn = null;
  });
  // 도우미 pid — 비상 정지 때 이미 받은 동작까지 멈추려고 프로세스째 끝냄. pid를 못 받으면 못 쓰는 연결로 보고 버림(리뷰)
  const id = ++c.id;
  const hs = await new Promise((res) => { const t = setTimeout(() => res(null), 10_000); c.pending.set(id, (m) => { clearTimeout(t); res(m); }); sock.write(JSON.stringify({ id, token, method: "handshake", params: {} }) + "\n"); });
  c.pid = Number(hs?.result?.pid) || 0;
  c.version = hs?.result?.version || "";
  if (!c.pid) { sock.destroy(); await runCmd("/usr/bin/pkill", ["-f", `--serve ${sockPath}`], 5000, process.env); return null; } // 띄운 도우미도 바로 끝냄(리뷰)
  if (gen !== generation) { sock.destroy(); try { process.kill(c.pid, "SIGKILL"); } catch { /* 이미 끝남 */ } return null; } // 띄우는 사이 비상 정지 — 연결로 안 씀(리뷰)
  conn = c; // 악수가 끝난 뒤에야 쓸 수 있는 연결로
  return c;
}
async function helperReq(method, params = {}, timeout = 60_000, gen = generation) {
  const c = await helper();
  if (gen !== generation) return { ok: false, error: { code: "stopped", message: "" } }; // 띄우는 사이 비상 정지(리뷰)
  if (!c) return { ok: false, error: { code: "helper-launch", message: "Could not start Mustard Computer Use." } };
  const id = ++c.id;
  return new Promise((res) => {
    const t = setTimeout(() => { c.pending.delete(id); res({ ok: false, error: { code: "timeout", message: "" } }); }, timeout);
    c.pending.set(id, (m) => { clearTimeout(t); res(m); });
    c.sock.write(JSON.stringify({ id, token: c.token, method, params }) + "\n");
  });
}
const restartHelper = () => { conn?.sock.destroy(); conn = null; };
const killHelper = () => { const pid = conn?.pid; restartHelper(); if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* 이미 끝남 */ } } };
// 도우미 답 → { ok, text } | { ok:false, error, text }. 트리는 JSON 밖에 그대로 붙여 읽기 쉽게.
function helperOut(m) {
  if (m.ok) {
    const r = m.result;
    if (r && typeof r === "object" && typeof r.tree === "string") { const { tree, ...head } = r; return { ok: true, text: `${JSON.stringify(head)}\n\n${tree}` }; }
    return { ok: true, text: JSON.stringify(r) };
  }
  const e = m.error || {};
  if (e.code === "app_blocked") return { ok: false, error: "blocked", app: String(e.message || "").replace(/^Mustard blocks (.*?)\..*$/, "$1") };
  if (e.code === "timeout") return { ok: false, error: "timeout" };
  if (e.code === "stopped") return { ok: false, error: "stopped" };
  return { ok: false, error: "helper-error", text: `${e.code}: ${e.message}` };
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
  // 내장 도우미는 이름으로 찾은 실제 앱을 막는 앱 목록으로 다시 확인하므로 pid가 없어도 됨
  if (targeted && !pids.length && !helperApp) { log({ at, tool, app: "", cwd, result: "no-target" }, home); return { ok: false, error: "no-target" }; }
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
  if (gen !== generation) return { ok: false, error: "stopped" };
  const r = helperApp
    ? await helperReq("call", { tool, args: args ?? {}, blocked: cfg.blocked }, 60_000, gen).then((m) => (gen !== generation ? { ok: false, error: "stopped" } : helperOut(m)))
    : await driver(["call", tool, JSON.stringify(args ?? {})], { home, gen });
  log({ at, tool, app, cwd, result: r.ok ? "ok" : r.error }, home);
  return r;
}

// 비상 정지 — 끄고, 실행 중인 드라이버는 그룹째 죽이고, 늦게 온 결과는 버림
function stop(home) {
  generation++;
  for (const c of live) { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* 이미 끝남 */ } } }
  live.clear();
  starting?.then((c) => { if (c?.pid) { try { process.kill(c.pid, "SIGKILL"); } catch { /* 이미 끝남 */ } } }); // 띄우는 중이던 도우미도(리뷰)
  killHelper(); // 도우미를 프로세스째 끝냄 — 이미 받아 둔 입력·클릭도 실행되지 않게(리뷰)
  writeConfig({ enabled: false }, home); log({ at: new Date().toISOString(), tool: "(stop)", app: "", cwd: "", result: "stopped" }, home);
}

// 설정 화면용 — 드라이버 상태 + 권한 상태(드라이버가 내는 글 그대로 — 형식이 버전마다 다를 수 있어 줄 단위로 판정)
async function status({ force = false, home } = {}) {
  if (helperApp) {
    // 화면 기록 권한은 켠 뒤 새 프로세스여야 보임 → 다시 확인이거나 아직 안 켜진 권한이 있으면 도우미를 새로 띄워 확인
    const ask = () => helperReq("permissions", {}, 15_000);
    let m = force ? (restartHelper(), await ask()) : await ask();
    if (m.ok && (!m.result.accessibility || !m.result.screen)) { restartHelper(); m = await ask(); }
    const v = m.ok ? conn?.version || "" : "";
    const g = (b) => (m.ok ? (b ? "granted" : "missing") : "unknown");
    return { ...readConfig(home), driver: { path: helperApp, version: v, builtin: true }, permissions: { accessibility: g(m.result?.accessibility), screen: g(m.result?.screen) } };
  }
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
  if (name === "computer_tools") r = helperApp ? helperOut(await helperReq("list_tools")) : await driver(["list-tools"], { home });
  else if (name === "computer_describe") r = !/^[a-z][a-z0-9_]*$/i.test(tool) ? { ok: false, error: "bad-tool" } : helperApp ? helperOut(await helperReq("describe", { tool })) : await driver(["describe", tool], { home });
  else if (name === "computer_call") r = await call(tool, args?.args && typeof args.args === "object" ? args.args : {}, { home, cwd });
  else return out(`Unknown tool: ${name}`, true);
  if (r.ok) return out(r.text);
  return out(r.error === "blocked" ? `${ERR.blocked} (${r.app})` : ERR[r.error] || `Failed: ${r.text || r.error}`, true);
}

// 권한 요청(도우미 이름으로 macOS 프롬프트 + 시스템 설정) / 접근 초기화(macOS가 기억한 허용을 지움 — 다시 받아야 함)
async function grant(kind) {
  if (helperApp) { const m = await helperReq("request_permission", { kind: kind === "screen" ? "screen" : "accessibility" }); return { ok: !!m.ok }; }
  const r = await driver(["permissions", "grant"], { timeout: 120_000 });
  return { ok: r.ok, text: r.text };
}
async function resetAccess() {
  restartHelper();
  const a = await runCmd("/usr/bin/tccutil", ["reset", "Accessibility", HELPER_ID], 10_000, process.env);
  const b = await runCmd("/usr/bin/tccutil", ["reset", "ScreenCapture", HELPER_ID], 10_000, process.env);
  return { ok: a.code === 0 && b.code === 0 };
}

module.exports = { setHelperApp, grant, resetAccess, agentTool, DEFAULT_BLOCKED, readConfig, writeConfig, targetsOf, blockedBy, findDriver, driver, call, stop, status, readLog, BIN };

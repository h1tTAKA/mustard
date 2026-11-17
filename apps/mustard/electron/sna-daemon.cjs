// #1358 채팅 AI 서버(SNA) 데몬 — 앱 시작 때 살아 있는 데몬에 다시 붙거나 새로 띄움. 앱을 닫아도 데몬은 계속(채팅 작업 계속).
// 상태 파일 userData/sna-daemon.json(0600): { pid, port, token, version, startedAt, appPid }. 포트·토큰은 고정(다시 붙어도 Next에 같은 주소).
// 버전(SNA_DAEMON_VERSION + SNA 패키지 버전)이 다르면: 일하는 세션이 없을 때만 교체, 있으면 이번엔 옛 데몬 그대로(다음 시작에 교체).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SNA_DAEMON_VERSION = 3; // 데몬 껍데기·띄우는 방식(env 등)·SNA 패치(scripts/patch-sna.mjs)를 바꾸면 올릴 것 — 2 = 앱 생존을 명령줄까지 확인(MUSTARD_APP_EXEC), 3 = 서브 에이전트 메시지 거르기 패치(#1374)

const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; } };
// pid가 정말 우리 데몬인지 — 재부팅 뒤 같은 번호를 다른 프로세스가 쓸 수 있어 끄기 전에 명령줄 확인(Windows는 확인 못 해 안 끔)
function ours(pid) {
  if (!alive(pid)) return false;
  if (process.platform === "win32") return false; // 확인 수단이 없음 — 답하는지(/health)로만 판단(재부팅 뒤 같은 번호의 남의 프로세스를 우리 것으로 착각하지 않게, 리뷰)
  try { return require("node:child_process").execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).includes("sna-daemon-host"); } catch { return null; } // ps 실패 = 모름(우리 것일 수 있음 — 같은 DB에 둘을 띄우지 않게, 리뷰)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 무엇을 할지 — 순수 함수(점검용). st = 상태 파일, now = { alive, healthy, busy, version }
function decide(st, now) {
  if (!st || !st.pid || !now.alive || !now.healthy) return "spawn";
  if (st.version === now.version) return "reuse";
  return now.busy ? "keep-old" : "replace";
}

async function healthy(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
}
async function busy(st) {
  try {
    const r = await fetch(`http://127.0.0.1:${st.port}/agent/sessions`, { headers: { authorization: `Bearer ${st.token}` }, signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return (j.sessions || []).some((s) => s.id !== "default" && s.alive && (s.agentStatus === "busy" || (s.state && s.state !== "idle")));
  } catch { return true; } // 모르면 일하는 중으로(작업을 죽이지 않게)
}

// opts: { userData, hostScript, standaloneScript, env(SNA_* 등 SNA 설정), isPortFree, getFreePort, log }
async function ensureSnaDaemon(opts) {
  const statePath = path.join(opts.userData, "sna-daemon.json");
  // 버전 = 껍데기 번호 + SNA 패키지 버전 + 설정(env) 지문 — CLI 경로 등 설정이 바뀌어도 (일 없을 때) 새로 띄움
  const version = `${SNA_DAEMON_VERSION}-${opts.snaVersion || "?"}-${crypto.createHash("sha1").update(JSON.stringify(opts.env || {})).digest("hex").slice(0, 8)}`;
  const write = (st) => { fs.writeFileSync(statePath, JSON.stringify(st), { mode: 0o600 }); try { fs.chmodSync(statePath, 0o600); } catch { /* ignore */ } };
  let st = null;
  try { st = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { /* 처음 */ }
  const live = !!(st && alive(st.pid));
  let up = live && await healthy(st.port);
  for (let i = 0; live && !up && i < 8; i++) { await sleep(1000); up = await healthy(st.port); } // 잠깐 바빠서 못 답했을 수 있음 — 바로 죽이면 일하던 채팅이 죽음(리뷰)
  // 우리 데몬인가: 상태 파일 포트에서 답하거나 / ps 명령줄이 우리 것(확인 실패는 "모름" = 우리 것으로 — 다음 실행에 다시 확인)
  // Windows는 ps가 없어 답하는지로만(포트가 잡혀 있다고 우리 것이라 볼 수 없음, 리뷰) — 한계: 답 없는 우리 데몬이 있으면 둘째가 뜰 수 있음
  const owned = live && (up || ours(st.pid) !== false);
  // 우리 데몬인데 답이 없음 → 절대 죽이지 않고 그대로 씀(일하는 세션이 있을 수 있음, 같은 DB로 둘을 띄우지도 않음, 리뷰). 멈춰 버렸으면 메뉴 "완전히 종료"로 끔
  // ponytail: 멈춘 데몬 자동 교체 없음 — 실제로 멈추는 일이 보이면 "답 없음이 이어진 시간"을 재서 교체 추가
  const action = owned && !up ? "keep-old" : decide(st, { alive: owned, healthy: up, busy: up && st.version !== version ? await busy(st) : false, version });
  opts.log?.(`[sna-daemon] ${action}${st ? ` (pid ${st.pid}, v${st.version} → v${version})` : ""}`);
  if (action === "reuse" || action === "keep-old") {
    write({ ...st, appPid: process.pid });
    return { baseUrl: `http://127.0.0.1:${st.port}`, authToken: st.token, pid: st.pid, reused: true };
  }
  if (action === "replace") { // 답하고(=우리 데몬) 버전이 다르고 일하는 세션이 없을 때만 — 옛 데몬(버전 다름, 일하는 세션 없음 확인함) 정리 — SIGTERM이면 SNA가 세션을 닫고 끔
    try { process.kill(st.pid, "SIGTERM"); } catch { /* ignore */ }
    for (let i = 0; i < 150 && alive(st.pid); i++) await sleep(100); // SNA가 세션을 정리하고 끌 시간(15초) — 넘으면 강제
    if (alive(st.pid)) try { process.kill(st.pid, "SIGKILL"); } catch { /* ignore */ }
  }
  const token = (st && st.token) || crypto.randomBytes(32).toString("hex");
  const port = st && st.port && await opts.isPortFree(st.port) ? st.port : await opts.getFreePort();
  const logPath = path.join(opts.userData, "sna-daemon.log");
  try { if (fs.statSync(logPath).size > 5 * 1024 * 1024) fs.truncateSync(logPath, 0); } catch { /* 없음 */ }
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [opts.hostScript], {
    cwd: opts.userData, detached: true, stdio: ["ignore", out, out], // IPC 없음 → 앱이 꺼져도 SNA의 "부모 끊김 종료"가 안 걸림
    env: { ...process.env, ...opts.env, ELECTRON_RUN_AS_NODE: "1", SNA_PORT: String(port), SNA_HOST: "127.0.0.1", SNA_AUTH_TOKEN: token, MUSTARD_SNA_STATE: statePath, MUSTARD_SNA_STANDALONE: opts.standaloneScript, MUSTARD_APP_EXEC: process.execPath },
  });
  child.unref();
  fs.closeSync(out);
  write({ pid: child.pid, port, token, version, startedAt: Date.now(), appPid: process.pid });
  for (let i = 0; i < 150; i++) { // 최대 15초
    if (await healthy(port)) return { baseUrl: `http://127.0.0.1:${port}`, authToken: token, pid: child.pid, reused: false };
    if (!alive(child.pid)) break;
    await sleep(100);
  }
  throw new Error(`SNA daemon did not become ready (log: ${logPath})`);
}

// "완전히 종료" — 데몬까지 끔(SIGTERM → 세션 정리). 우리 데몬이 확실할 때만: ps 명령줄이 우리 것이거나(확인 못 하면) 상태 파일 포트에서 답할 때(리뷰: 재부팅 뒤 같은 번호의 남의 프로세스를 끄지 않게).
// 끈 뒤 상태 파일을 지움 — 정리하는 몇 초 사이 다시 켜도 죽어 가는 데몬에 붙지 않고 새로 띄움.
async function stopSnaDaemon(userData) {
  const p = path.join(userData, "sna-daemon.json");
  let st;
  try { st = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return; }
  const o = ours(st.pid); // ps가 남의 것(false)이라고 하면 포트가 답해도 안 끔(리뷰)
  if (o === true || ((o === null || process.platform === "win32") && alive(st.pid) && await healthy(st.port))) {
    try { process.kill(st.pid, "SIGTERM"); } catch { /* 이미 꺼짐 */ }
    for (let i = 0; i < 50 && alive(st.pid); i++) await sleep(100); // SNA 정리(세션 끄기·서버 닫기, 최대 3초)를 기다림 — 그 사이 다시 켜서 같은 DB로 둘이 뜨지 않게(리뷰)
    if (alive(st.pid)) try { process.kill(st.pid, "SIGKILL"); } catch { /* ignore */ }
  }
  if (!alive(st.pid) || (o === false && process.platform !== "win32")) try { fs.rmSync(p, { force: true }); } catch { /* ignore */ } // 아직 살아 있는(끄지 못한) 우리 데몬이면 상태를 남겨 다음 실행이 그대로 씀(Windows의 false는 "확인 못 함"이라 지우지 않음)
}
// 앱이 꺼질 때 — 데몬은 두고 "앱 없음"만 표시(데몬이 스스로 끌 때 판단)
function detachSnaDaemon(userData) {
  const p = path.join(userData, "sna-daemon.json");
  try { const st = JSON.parse(fs.readFileSync(p, "utf8")); if (st.appPid === process.pid) fs.writeFileSync(p, JSON.stringify({ ...st, appPid: 0 }), { mode: 0o600 }); } catch { /* 없음 */ }
}

module.exports = { ensureSnaDaemon, stopSnaDaemon, detachSnaDaemon, decide, SNA_DAEMON_VERSION };

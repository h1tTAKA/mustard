// 터미널 pty 데몬(#682) — node-pty를 소유하는 독립 프로세스. electron과 분리돼 앱 종료에도 생존.
// electron이 fork(detached,unref)로 스폰, 유닉스 소켓(토큰 인증)으로 통신. 재실행 시 재접속해 live reattach.
// 프로토콜: 개행 구분 JSON. 클라 → { t, ... }, 데몬 → { t, ... }.
//   attach(id?) 인증 → ok. ensure{id,cwd,cols,rows} → ensured{id,ok,buffer}. input{id,data} / resize{id,cols,rows} / kill{id}.
//   list → listed{sessions:[{id,cwd,process,pid}]}(#764). 데몬 push: data{id,data} / exit{id}.
const net = require("node:net");
// 버전 파일이 옆에 없어도(패키징 누락 등) 데몬은 떠야 함 — 못 읽으면 0(= 앱이 "옛 데몬"으로 보고 안내만).
let DAEMON_VERSION = 0;
try { ({ DAEMON_VERSION } = require("./daemon-version.cjs")); } catch { /* 터미널은 살림 */ }
const fs = require("node:fs");
const { applyTerminalEnv } = require("./terminal-env.cjs");

const SOCK = process.env.NUNOPI_TERM_SOCK;   // 소켓 경로
const TOKEN = process.env.NUNOPI_TERM_TOKEN; // 인증 토큰
const IDLE_MS = 30 * 60 * 1000;              // ptys 0 && client 0 지속 시 자동 종료(잔존 방지)
if (!SOCK || !TOKEN) { console.error("[term-daemon] SOCK/TOKEN 필요"); process.exit(1); }

let pty;
try { pty = require("node-pty"); } catch (e) { console.error("[term-daemon] node-pty 없음:", e && e.message); process.exit(1); }

const PTY_BUFFER_MAX = 200_000;
const ptys = new Map();        // id → { proc, buffer, cwd }
const clients = new Set();     // 인증된 소켓들
let idleTimer = null;

function scheduleIdleReap() {
  if (idleTimer) clearTimeout(idleTimer);
  if (ptys.size === 0 && clients.size === 0) idleTimer = setTimeout(() => { if (ptys.size === 0 && clients.size === 0) shutdown(); }, IDLE_MS);
}
function shutdown() {
  try { fs.unlinkSync(SOCK); } catch { /* ignore */ }
  process.exit(0);
}
function send(sock, msg) { try { sock.write(JSON.stringify(msg) + "\n"); } catch { /* ignore */ } }
function broadcast(msg) { for (const c of clients) send(c, msg); }

// #1196 유저가 고른 셸 — 절대 경로이고 실행할 수 있는 파일일 때만(이상한 값으로 터미널이 안 열리는 일 없게), 아니면 기본 셸
function pickShell(want) {
  const def = process.env.NUNOPI_TERM_SHELL || process.env.SHELL || "/bin/bash";
  if (typeof want !== "string" || !want || !require("path").isAbsolute(want)) return def;
  try { fs.accessSync(want, fs.constants.X_OK); return fs.statSync(want).isFile() ? want : def; } catch { return def; }
}
// #1213 셸 인자 — 문자열 배열(최대 32개·각 1024자·NUL 없음)일 때만, 아니면 인자 없음(지금처럼).
function pickArgs(a) {
  return Array.isArray(a) && a.length <= 32 && a.every((x) => typeof x === "string" && x.length <= 1024 && !x.includes("\0")) ? a : [];
}
function ensure({ id, cwd, cols, rows, dark, shell: wantShell, shellArgs }) {
  let s = ptys.get(id);
  if (!s) {
    const shell = pickShell(wantShell);
    const env = { ...process.env };
    delete env.npm_config_prefix; delete env.NPM_CONFIG_PREFIX; // nvm 경고 방지(#674)
    // #979 부모 Claude Code 런타임 env 제거 — Mustard를 claude 세션 안에서 띄우면 CLAUDE_CODE_CHILD_SESSION 등이 상속돼
    // 터미널의 claude가 자식 세션으로 오인(트랜스크립트 저장 꺼짐)하고, MESSAGING_SOCKET/TOKEN까지 새 격리가 깨짐.
    // 유저가 셸 rc에 둔 CLAUDE_* 설정은 로그인 셸이 다시 읽으므로 상속분만 지워도 안전.
    for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_")) delete env[k];
    delete env.NUNOPI_TERM_SOCK; delete env.NUNOPI_TERM_TOKEN; delete env.NUNOPI_TERM_SHELL; // 데몬 내부 env 누출 방지
    env.MUSTARD_TERM_ID = id; // #989 관리형 Claude 훅이 이 세션으로 상태 POST(없으면 훅 no-op = Mustard 밖 claude)
    // 터미널 배경 밝기 힌트(#914) — CLI TUI(claude 등)가 라이트/다크 색을 스스로 고르게. "fg;bg" ANSI 인덱스.
    // 라이트=bg 15(밝음)→"0;15", 다크=bg 0(어두움)→"15;0". OSC11 응답과 병행(env만 보는 도구 커버).
    env.COLORFGBG = dark === false ? "0;15" : "15;0";
    applyTerminalEnv(env); // #1226 색 능력(COLORTERM=truecolor 등) — 앱을 켠 방식과 상관없이 같게(diff 줄 배경)
    let proc;
    // cols 하한 20 클램프(#832) — 레이아웃 미확정 폭으로 극소 cols가 새 나가도 셸 출력이 세로로 깨지지 않게(FE 폭 가드 백스톱).
    try { proc = pty.spawn(shell, pickArgs(shellArgs), { name: "xterm-256color", cols: Math.max(cols || 80, 20), rows: rows || 24, cwd, env }); }
    catch (e) { return { id, ok: false, reason: String((e && e.message) || e) }; }
    s = { proc, buffer: "", cwd };
    proc.onData((data) => {
      s.buffer += data;
      if (s.buffer.length > PTY_BUFFER_MAX) s.buffer = s.buffer.slice(-PTY_BUFFER_MAX);
      broadcast({ t: "data", id, data });
    });
    proc.onExit(() => { ptys.delete(id); broadcast({ t: "exit", id }); scheduleIdleReap(); });
    ptys.set(id, s);
  }
  return { id, ok: true, buffer: s.buffer };
}

const AUTH_TIMEOUT_MS = 5000;      // 인증 없이 열려있는 소켓 방치 방지(FD 누수 차단)
const PREAUTH_BUF_MAX = 4096;      // 미인증 상태 버퍼 상한 — 개행 없는 대량 전송으로 메모리 소모 차단
const server = net.createServer((sock) => {
  let authed = false;
  let buf = "";
  // 인증 지연/무응답 소켓은 타임아웃으로 강제 종료(로컬이라도 접속 스팸 → FD 고갈 방지).
  const authTimer = setTimeout(() => { if (!authed) sock.destroy(); }, AUTH_TIMEOUT_MS);
  sock.on("data", (chunk) => {
    buf += chunk.toString();
    if (!authed && buf.length > PREAUTH_BUF_MAX) { sock.destroy(); return; } // 미인증 폭주 차단
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      // 미인증 상태에선 첫 줄이 반드시 유효한 attach여야 함 — 깨진 JSON이면 즉시 종료(방치 금지).
      let m; try { m = JSON.parse(line); } catch { if (!authed) { sock.destroy(); return; } continue; }
      if (!authed) { // 첫 메시지는 반드시 인증
        if (m.t === "attach" && m.token === TOKEN) { authed = true; clearTimeout(authTimer); clients.add(sock); scheduleIdleReap(); send(sock, { t: "ready" }); }
        else { sock.destroy(); }
        continue;
      }
      if (m.t === "ensure") send(sock, { t: "ensured", ...ensure(m) });
      else if (m.t === "input") { const s = ptys.get(m.id); if (s) { try { s.proc.write(m.data); } catch { /* ignore */ } } }
      else if (m.t === "resize") { const s = ptys.get(m.id); if (s && m.cols > 0 && m.rows > 0) { try { s.proc.resize(m.cols, m.rows); } catch { /* ignore */ } } }
      else if (m.t === "kill") { const s = ptys.get(m.id); if (s) { try { s.proc.kill(); } catch { /* ignore */ } ptys.delete(m.id); } scheduleIdleReap(); }
      else if (m.t === "list") { // 세션 목록(#764) — 레포탭 호버 카드 + 탭 에이전트 검출(#803/#836).
        const sessions = [];
        for (const [id, s] of ptys) {
          let procName = "", pid = 0;
          try { procName = s.proc.process || ""; } catch { /* node-pty getter 실패 관대 */ }
          try { pid = s.proc.pid || 0; } catch { /* pid getter도 관대 — 하나 throw로 list 통째 실패 방지 */ }
          // buffer tail 동봉(#836) — main이 ensure(탭 클릭) 없이도 비활성 탭의 에이전트를 파싱하게.
          // parseAgentScreen은 8KB tail만 보므로 16KB면 충분(전체 200KB 전송 낭비 방지).
          sessions.push({ id, cwd: s.cwd, process: procName, pid, screen: s.buffer.slice(-16000) });
        }
        send(sock, { t: "listed", sessions, version: DAEMON_VERSION, pid: process.pid }); // #1036 앱이 옛 데몬 감지
      }
    }
  });
  sock.on("close", () => { clearTimeout(authTimer); clients.delete(sock); scheduleIdleReap(); });
  sock.on("error", () => { clearTimeout(authTimer); clients.delete(sock); });
});

// 앱 종료(SIGTERM)에 안 죽음 — 세션 생존 목적. 유휴 reap으로만 종료.
process.on("SIGTERM", () => { /* ignore — 생존 */ });
process.on("SIGINT", () => { /* ignore */ });

try { fs.unlinkSync(SOCK); } catch { /* stale 소켓 정리 */ }
// readiness는 클라가 소켓 연결 성공으로 판단 — process.send는 disconnect 후 비동기 EPIPE 위험이라 안 씀.
server.listen(SOCK, () => { scheduleIdleReap(); });
server.on("error", (e) => { console.error("[term-daemon] listen 실패:", e && e.message); process.exit(1); });

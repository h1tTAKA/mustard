// #1358 채팅 AI 서버(SNA)를 앱과 떼어 돌리는 껍데기. 앱(Electron)이 ELECTRON_RUN_AS_NODE + detached + IPC 없이 띄움
// → 앱이 꺼져도 안 따라 꺼짐(SNA standalone은 부모 IPC가 끊기면 스스로 끄는데, IPC가 없으면 그 신호 자체가 없음).
// 스스로 끄는 조건: 앱이 꺼져 있고 일하는 채팅 세션도, 턴 뒤에 도는 백그라운드 작업도 없는 상태가 IDLE_MS 동안 이어질 때 → SIGTERM(SNA가 세션 정리 후 종료).
// 상태 파일(sna-daemon.json)의 pid가 내가 아니면(앱이 새 데몬으로 갈아 끼움) 일하는 세션이 없을 때 끔.
const fs = require("node:fs");

const STATE = process.env.MUSTARD_SNA_STATE;
const IDLE_MS = Number(process.env.MUSTARD_SNA_IDLE_MS) || 30 * 60_000;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; } };
// 앱이 살아 있나 — 번호만 보면 앱이 비정상 종료한 뒤 그 번호를 다른 프로그램이 써서 영영 안 꺼짐(리뷰) → 명령줄이 앱 실행 파일인지까지
function appAlive(pid) {
  if (!alive(pid)) return false;
  const exe = process.env.MUSTARD_APP_EXEC;
  if (!exe) return true;
  try {
    if (process.platform === "win32") return require("node:child_process").execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 3000 }).toLowerCase().includes(require("node:path").basename(exe).toLowerCase()); // Windows는 실행 파일 이름으로(리뷰)
    return require("node:child_process").execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).includes(exe);
  } catch { return true; }
}

// sna-daemon.cjs working()과 글자 그대로 같은 줄(점검이 비교) — waiting은 쉬는 상태, 단 띄운 지 30초 안은 일하는 중
const working = (s) => s.id !== "default" && s.alive && (s.agentStatus === "busy" || s.state === "processing" || s.state === "permission" || (s.state === "waiting" && Date.now() - (s.lastActivityAt || 0) < 30_000));
// 메인 턴이 끝난 뒤 도는 백그라운드 작업 수 — SNA 패치(scripts/patch-sna.mjs)가 같은 프로세스에 셈 둠
const bg = () => (typeof globalThis.__mustardSnaBg === "function" ? globalThis.__mustardSnaBg() : 0);
async function anyWorking() {
  if (bg() > 0) return true;
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.SNA_PORT}/agent/sessions`, { headers: { authorization: `Bearer ${process.env.SNA_AUTH_TOKEN}` }, signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return (j.sessions || []).some((s) => working(s));
  } catch { return true; } // 못 물어보면 일하는 중으로 — 잘못 꺼서 작업을 죽이는 것보다 늦게 꺼지는 게 나음
}

let idleSince = Date.now();
setInterval(async () => {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* 파일이 없으면 판단 보류 */ }
  const busy = (st.pid === process.pid && st.appPid && appAlive(st.appPid)) || await anyWorking();
  if (st.pid && st.pid !== process.pid) { if (!busy) process.kill(process.pid, "SIGTERM"); return; } // 앱이 새 데몬으로 갈아 끼움 — 일하는 채팅이 끝나면 끔(리뷰: 바로 끄면 일하던 에이전트가 죽음)
  if (busy) idleSince = Date.now();
  else if (Date.now() - idleSince >= IDLE_MS) process.kill(process.pid, "SIGTERM");
}, Number(process.env.MUSTARD_SNA_TICK_MS) || 60_000);

// 앱이 새 데몬으로 갈아 끼울지 볼 때 쓰라고 백그라운드 작업 수를 파일로 — 바뀔 때만 씀(5초마다 확인, 메모리 값이라 가벼움)
const BG = require("node:path").join(require("node:path").dirname(STATE || "."), "sna-daemon-bg.json");
// 임시 파일에 쓰고 이름 바꾸기 — 앱이 쓰는 도중의 반쪽 파일을 읽어 "작업 없음"으로 보지 않게(리뷰)
const writeBg = (n) => { try { fs.writeFileSync(`${BG}.tmp`, JSON.stringify({ pid: process.pid, bg: n })); fs.renameSync(`${BG}.tmp`, BG); } catch { /* 다음에 */ } };
let lastBg = 0;
writeBg(0); // 뜨자마자 — 죽은 옛 데몬이 남긴 파일(번호 재사용 시 잘못 믿음)을 바로 덮음(리뷰)
setInterval(() => { const n = bg(); if (n !== lastBg) { lastBg = n; writeBg(n); } }, 5000);
process.on("exit", () => { try { if (JSON.parse(fs.readFileSync(BG, "utf8")).pid === process.pid) fs.unlinkSync(BG); } catch { /* 없음 */ } }); // 내 파일일 때만 — 갈아 끼운 새 데몬 것은 둠

require(process.env.MUSTARD_SNA_STANDALONE);

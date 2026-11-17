// #1358 채팅 AI 서버(SNA)를 앱과 떼어 돌리는 껍데기. 앱(Electron)이 ELECTRON_RUN_AS_NODE + detached + IPC 없이 띄움
// → 앱이 꺼져도 안 따라 꺼짐(SNA standalone은 부모 IPC가 끊기면 스스로 끄는데, IPC가 없으면 그 신호 자체가 없음).
// 스스로 끄는 조건: 앱이 꺼져 있고 일하는 채팅 세션도 없는 상태가 IDLE_MS 동안 이어질 때 → SIGTERM(SNA가 세션 정리 후 종료).
// 상태 파일(sna-daemon.json)의 pid가 내가 아니면(앱이 새 데몬으로 갈아 끼움) 일하는 세션이 없을 때 끔.
const fs = require("node:fs");

const STATE = process.env.MUSTARD_SNA_STATE;
const IDLE_MS = Number(process.env.MUSTARD_SNA_IDLE_MS) || 30 * 60_000;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; } };

async function working() {
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.SNA_PORT}/agent/sessions`, { headers: { authorization: `Bearer ${process.env.SNA_AUTH_TOKEN}` }, signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return (j.sessions || []).some((s) => s.id !== "default" && s.alive && (s.agentStatus === "busy" || (s.state && s.state !== "idle")));
  } catch { return true; } // 못 물어보면 일하는 중으로 — 잘못 꺼서 작업을 죽이는 것보다 늦게 꺼지는 게 나음
}

let idleSince = Date.now();
setInterval(async () => {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* 파일이 없으면 판단 보류 */ }
  const busy = (st.pid === process.pid && st.appPid && alive(st.appPid)) || await working();
  if (st.pid && st.pid !== process.pid) { if (!busy) process.kill(process.pid, "SIGTERM"); return; } // 앱이 새 데몬으로 갈아 끼움 — 일하는 채팅이 끝나면 끔(리뷰: 바로 끄면 일하던 에이전트가 죽음)
  if (busy) idleSince = Date.now();
  else if (Date.now() - idleSince >= IDLE_MS) process.kill(process.pid, "SIGTERM");
}, Number(process.env.MUSTARD_SNA_TICK_MS) || 60_000);

require(process.env.MUSTARD_SNA_STANDALONE);

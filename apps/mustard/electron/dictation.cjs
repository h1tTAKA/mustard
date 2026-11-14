// 받아쓰기(#1341, #1349) — macOS 음성 인식 도우미(native/dictation-macos)를 자식으로 띄워 줄 단위 JSON을 렌더러로 넘김.
// 한 번에 하나(새로 시작하면 이전 것은 끔). 이벤트: ready·level·partial·final·error, 도우미가 끝나면 {type:"end", code}.
// 권한 거부·도우미 없음은 error로. 마이크 설정 화면 열기는 openSettings.
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createInterface } = require("node:readline");

let helper = "";
let proc = null;
let owner = null;
const send = (o) => { try { if (owner && !owner.isDestroyed()) owner.send("dictation:event", o); } catch { /* 창 닫힘 */ } };

function setHelper(p) { helper = p; }
function available() { return process.platform === "darwin" && !!helper && existsSync(helper); }
function start(wc, locale) {
  if (!available()) return { ok: false, error: "unavailable" };
  stopNow();
  owner = wc;
  const lc = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(locale || "")) ? String(locale) : "en-US";
  const p = spawn(helper, ["--locale", lc], { stdio: ["pipe", "pipe", "ignore"] });
  proc = p;
  createInterface({ input: p.stdout }).on("line", (l) => { if (proc !== p) return; try { send(JSON.parse(l)); } catch { /* 깨진 줄 */ } });
  // 권한 설명이 없거나 TCC가 막으면 시그널로 죽음 — 화면이 기다리지 않게 end로 알림
  p.on("exit", (code, sig) => { if (proc === p) { proc = null; send({ type: "end", code: code ?? -1, signal: sig || undefined }); } });
  p.on("error", (e) => { if (proc === p) { proc = null; send({ type: "error", code: "spawn", message: String(e?.message || e) }); } });
  return { ok: true };
}
function command(cmd) { try { proc?.stdin.write(`${cmd}\n`); } catch { /* 이미 끝남 */ } }
function stopNow() { if (proc) { const p = proc; proc = null; try { p.stdin.write("cancel\n"); } catch { /* */ } setTimeout(() => { try { p.kill(); } catch { /* */ } }, 500); } }

module.exports = { setHelper, available, start, stop: () => command("stop"), cancel: () => { command("cancel"); }, stopNow };

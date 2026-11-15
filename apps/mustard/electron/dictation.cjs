// 받아쓰기(#1341, #1349) — 두 엔진, 렌더러로 가는 이벤트는 같음(ready·level·partial·final·error, 끝나면 end).
//  · 기본(system): macOS 음성 인식 도우미(native/dictation-macos)가 녹음·인식 둘 다.
//  · 로컬 모델(local): 도우미 --pcm이 소리만 내보내고 → 일꾼(stt-worker.mjs, transcribe-cpp)이 글로. 모델은 설정에서 받은 것.
// 한 번에 하나(새로 시작하면 이전 것은 끔). 권한 거부·도우미 없음은 error로. 마이크 설정 화면 열기는 openSettings.
const { spawn, fork, execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createInterface } = require("node:readline");

let helper = "", workerScript = "", modulesDir = "";
let proc = null, owner = null, worker = null, workerReady = false, local = null, seq = 0; // local = {id, helperReady, modelReady} — id는 받아쓰기 번호(일꾼 결과와 맞춰 봄)
const send = (o) => { try { if (owner && !owner.isDestroyed()) owner.send("dictation:event", o); } catch { /* 창 닫힘 */ } };

function setHelper(p) { helper = p; }
function setLocalEngine(script, mods) { workerScript = script; modulesDir = mods; }
function available() { return process.platform === "darwin" && !!helper && existsSync(helper); }
function localAvailable() { return available() && !!workerScript && existsSync(workerScript) && existsSync(`${modulesDir}/transcribe-cpp/package.json`); }
// 마이크 장치 목록(도우미 --list-devices)
function devices() {
  return new Promise((res) => { if (!available()) return res([]); execFile(helper, ["--list-devices"], { timeout: 5000 }, (e, out) => { try { res(e ? [] : JSON.parse(String(out).trim() || "[]")); } catch { res([]); } }); });
}

function ensureWorker() {
  if (worker && worker.connected) return worker;
  workerReady = false;
  worker = fork(workerScript, [modulesDir], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "ignore", "inherit", "ipc"] });
  worker.on("message", (m) => {
    if (!local) return;
    if (m.sid !== undefined && m.sid !== local.id) return; // 옛 받아쓰기의 늦은 결과 — 지금 것에 안 섞음(재리뷰)
    if (m.type === "loaded") { local.modelReady = true; if (local.helperReady) send({ type: "ready" }); }
    else if (m.type === "partial") send({ type: "partial", text: m.text });
    else if (m.type === "final") { const done = local; local = null; send({ type: "final", text: m.text }); if (done) send({ type: "end", code: 0 }); }
    else if (m.type === "error") { local = null; stopNow(); send({ type: "error", code: "local", message: m.message }); }
  });
  worker.on("exit", () => { const w = worker; if (w === worker) worker = null; if (local) { local = null; send({ type: "error", code: "local", message: "speech engine stopped" }); } });
  return worker;
}

// opts: {locale, device?, engine?: "system"|"local", modelPath?, language?}
function start(wc, opts) {
  const o = typeof opts === "string" ? { locale: opts } : (opts || {});
  if (!available()) return { ok: false, error: "unavailable" };
  stopNow();
  owner = wc;
  const lc = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(o.locale || "")) ? String(o.locale) : "en-US";
  const dev = typeof o.device === "string" && /^[\w:.\-]{1,200}$/.test(o.device) ? ["--device", o.device] : [];
  const useLocal = o.engine === "local" && typeof o.modelPath === "string" && existsSync(o.modelPath) && localAvailable();
  const p = spawn(helper, useLocal ? ["--pcm", ...dev] : ["--locale", lc, ...dev], { stdio: ["pipe", "pipe", useLocal ? "pipe" : "ignore"] });
  proc = p;
  if (useLocal) {
    const w = ensureWorker();
    local = { id: ++seq, helperReady: false, modelReady: false };
    w.send({ type: "load", modelPath: o.modelPath });
    w.send({ type: "start", sid: local.id, language: String(o.language || lc.split("-")[0]) });
    p.stdout.on("data", (b) => { try { if (proc === p) w.stdin.write(b); } catch { /* 일꾼 끝남 */ } });
    createInterface({ input: p.stderr }).on("line", (l) => {
      if (proc !== p) return;
      let e; try { e = JSON.parse(l); } catch { return; }
      if (e.type === "ready") { if (local) { local.helperReady = true; if (local.modelReady) send({ type: "ready" }); } }
      else send(e); // level·error
    });
  } else {
    createInterface({ input: p.stdout }).on("line", (l) => { if (proc !== p) return; try { send(JSON.parse(l)); } catch { /* 깨진 줄 */ } });
  }
  // 권한 설명이 없거나 TCC가 막으면 시그널로 죽음 — 화면이 기다리지 않게 end로 알림. 로컬은 녹음이 끝나면 일꾼에게 확정을 맡김(end는 final 뒤에)
  p.on("close", (code, sig) => { // exit는 stdout을 다 읽기 전에 올 수 있음 — 마지막 소리까지 일꾼에 넘긴 뒤 확정(리뷰)
    if (proc !== p) return;
    proc = null;
    if (useLocal && local && code === 0) { worker?.send({ type: "finish", sid: local.id }); return; }
    if (useLocal) { local = null; worker?.send({ type: "cancel" }); }
    send({ type: "end", code: code ?? -1, signal: sig || undefined });
  });
  p.on("error", (e) => { if (proc === p) { proc = null; send({ type: "error", code: "spawn", message: String(e?.message || e) }); } });
  return { ok: true, engine: useLocal ? "local" : "system" };
}
function command(cmd) { try { proc?.stdin.write(`${cmd}\n`); } catch { /* 이미 끝남 */ } }
function cancel() { if (local) { local = null; worker?.send({ type: "cancel" }); } command("cancel"); }
function stopNow() {
  if (local) { local = null; worker?.send({ type: "cancel" }); }
  if (proc) { const p = proc; proc = null; try { p.stdin.write("cancel\n"); } catch { /* */ } setTimeout(() => { try { p.kill(); } catch { /* */ } }, 500); }
}
function shutdown() { stopNow(); try { worker?.kill(); } catch { /* */ } }

module.exports = { setHelper, setLocalEngine, available, localAvailable, devices, start, stop: () => command("stop"), cancel, stopNow, shutdown };

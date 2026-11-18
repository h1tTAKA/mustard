// sna-daemon 점검 — node electron/sna-daemon.check.cjs
// 가짜 SNA(standalone 대신 /health·/agent/sessions만 답하는 작은 서버)로 띄우기 → 다시 붙기 → 설정 바뀜(일 없음) 교체 → 완전히 종료, 그리고 껍데기의 "앱 없음 + 일 없음" 스스로 종료.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { ensureSnaDaemon, stopSnaDaemon, detachSnaDaemon, decide, working, bgPath } = require("./sna-daemon.cjs");

assert.equal(decide(null, {}), "spawn");
assert.equal(decide({ pid: 1, version: "a" }, { alive: true, healthy: true, version: "a" }), "reuse");
assert.equal(decide({ pid: 1, version: "a" }, { alive: true, healthy: true, busy: true, version: "b" }), "keep-old");
assert.equal(decide({ pid: 1, version: "a" }, { alive: true, healthy: true, busy: false, version: "b" }), "replace");
assert.equal(decide({ pid: 1, version: "a" }, { alive: true, healthy: false, version: "a" }), "spawn");
const w = (state, agentStatus = "idle") => working({ id: "x", alive: true, state, agentStatus });
assert.equal(w("waiting"), false, "답 끝나고 기다리는 채팅은 쉬는 중 — 데몬 교체를 막지 않음");
assert.equal(w("idle"), false);
assert.equal(w("processing"), true);
assert.equal(w("permission"), true);
assert.equal(w("waiting", "busy"), true);
assert.equal(working({ id: "x", alive: false, state: "processing" }), false, "죽은 세션은 빼");
assert.equal(working({ id: "x", alive: true, state: "waiting", lastActivityAt: Date.now() - 5000 }), true, "시작 직후 첫 글자 전은 일하는 중");
assert.equal(working({ id: "x", alive: true, state: "waiting", lastActivityAt: Date.now() - 60_000 }), false);
assert.equal([{ id: "x", alive: true, state: "waiting", lastActivityAt: Date.now() - 60_000 }].some(working), false, ".some(working)처럼 넘겨도(두 번째 인자 = 번호) 쉬는 중"); // 실제 앱에서 터진 버그
const hostSrc = fs.readFileSync(path.join(__dirname, "sna-daemon-host.cjs"), "utf8");
assert.ok(hostSrc.includes(`const working = ${working.toString()};`), "껍데기의 판정 줄이 sna-daemon.cjs와 같음");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-daemon-"));
const fake = path.join(dir, "fake-standalone.cjs");
fs.writeFileSync(fake, `require("node:http").createServer((q, r) => { r.setHeader("content-type","application/json"); r.end(q.url === "/health" ? "{}" : JSON.stringify({ sessions: process.env.FAKE_BUSY ? [{ id: "a", alive: true, agentStatus: "busy", state: "processing" }] : [] })); }).listen(Number(process.env.SNA_PORT), "127.0.0.1");
if (process.env.FAKE_BG) globalThis.__mustardSnaBg = () => 1; // 패치된 SNA 대신 — 턴 뒤 백그라운드 작업 1개
process.on("SIGTERM", () => process.exit(0));`);
const host = path.join(__dirname, "sna-daemon-host.cjs");
const free = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const isFree = (p) => new Promise((res) => { const s = net.createServer(); s.on("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (f, ms = 5000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const opts = (env) => ({ userData: dir, hostScript: host, standaloneScript: fake, snaVersion: "t", env, isPortFree: isFree, getFreePort: free });

(async () => {
  const a = await ensureSnaDaemon(opts({ X: "1" }));
  assert.equal(a.reused, false);
  const b = await ensureSnaDaemon(opts({ X: "1" }));
  assert.equal(b.reused, true); assert.equal(b.pid, a.pid); assert.equal(b.baseUrl, a.baseUrl); assert.equal(b.authToken, a.authToken); // 다시 붙음 — 같은 주소·토큰
  const st = JSON.parse(fs.readFileSync(path.join(dir, "sna-daemon.json"), "utf8"));
  assert.equal(st.appPid, process.pid);
  assert.equal((fs.statSync(path.join(dir, "sna-daemon.json")).mode & 0o777), 0o600);
  const c = await ensureSnaDaemon(opts({ X: "2" })); // 설정 바뀜 + 일 없음 → 교체
  assert.notEqual(c.pid, a.pid); assert.equal(c.authToken, a.authToken, "토큰은 유지");
  assert.ok(await wait(() => !alive(a.pid)), "옛 데몬 꺼짐");
  await stopSnaDaemon(dir);
  assert.ok(await wait(() => !alive(c.pid)), "완전히 종료");
  assert.ok(!fs.existsSync(path.join(dir, "sna-daemon.json")), "끈 뒤 상태 파일 지움(정리 중 다시 켜도 새로 띄움)");

  // 껍데기 스스로 종료: 앱 없음(appPid 0) + 일 없음이 IDLE 넘으면 끔. 일하는 중이면 안 끔.
  process.env.MUSTARD_SNA_IDLE_MS = "300"; process.env.MUSTARD_SNA_TICK_MS = "100";
  const d = await ensureSnaDaemon(opts({ X: "3" }));
  detachSnaDaemon(dir);
  assert.ok(await wait(() => !alive(d.pid), 4000), "앱 없고 일 없으면 스스로 끔");
  process.env.FAKE_BUSY = "1";
  const e = await ensureSnaDaemon(opts({ X: "4" }));
  detachSnaDaemon(dir);
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(alive(e.pid), "일하는 중이면 안 끔");
  await stopSnaDaemon(dir);
  assert.ok(await wait(() => !alive(e.pid)));

  // 턴 뒤 백그라운드 작업(세션은 쉬는 중): 껍데기가 수를 파일에 적고 → 버전 바뀌어도 교체 안 함, 앱 없어도 안 끔
  delete process.env.FAKE_BUSY; process.env.FAKE_BG = "1";
  const f = await ensureSnaDaemon(opts({ X: "5" }));
  const bgFile = bgPath(path.join(dir, "sna-daemon.json"));
  assert.ok(await wait(() => { try { const b = JSON.parse(fs.readFileSync(bgFile, "utf8")); return b.pid === f.pid && b.bg === 1; } catch { return false; } }, 7000), "껍데기가 백그라운드 작업 수를 적음");
  const g = await ensureSnaDaemon(opts({ X: "6" }));
  assert.equal(g.pid, f.pid, "백그라운드 작업이 돌면 교체 안 함");
  detachSnaDaemon(dir);
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(alive(f.pid), "백그라운드 작업이 돌면 앱 없어도 안 끔");
  await stopSnaDaemon(dir);
  assert.ok(await wait(() => !alive(f.pid)));
  console.log("sna-daemon ok");
})().catch((err) => { console.error(err); process.exit(1); });

// computer-use 점검 — node electron/computer-use.test.cjs (임시 홈, 드라이버 없이)
const assert = require("node:assert");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const cu = require("./computer-use.cjs");

(async () => {
  const home = mkdtempSync(join(tmpdir(), "cu-"));

  // 기본 = 끔, 막는 앱 기본 목록
  let c = cu.readConfig(home);
  assert.strictEqual(c.enabled, false);
  assert.ok(c.blocked.includes("1Password"));

  // 꺼져 있으면 드라이버까지 안 감
  assert.deepStrictEqual(await cu.call("click", { pid: 1 }, { home }), { ok: false, error: "disabled" });

  // 인자에서 대상 찾기 — pid·앱 이름, 한 단계 아래까지
  assert.deepStrictEqual(cu.targetsOf({ pid: 844, window_id: 3 }), { pids: [844], names: [] });
  assert.deepStrictEqual(cu.targetsOf({ target: { app: "Safari" } }), { pids: [], names: ["Safari"] });
  assert.deepStrictEqual(cu.targetsOf({ pid: "abc" }), { pids: [], names: [] });

  // 막기 판정 — 부분 일치·대소문자 무시
  assert.strictEqual(cu.blockedBy(["/Applications/1Password.app/Contents/MacOS/1Password"], c.blocked), "1Password");
  assert.strictEqual(cu.blockedBy(["Safari"], c.blocked), null);

  // 켜고, pid가 비밀번호 관리자면 막힘 + 기록
  cu.writeConfig({ enabled: true }, home);
  const fakePs = async () => ({ code: 0, out: "/Applications/Bitwarden.app/Contents/MacOS/Bitwarden\n" });
  const r = await cu.call("click", { pid: 77, element_index: 2 }, { home, run: fakePs, cwd: "/repo" });
  assert.deepStrictEqual(r, { ok: false, error: "blocked", app: "Bitwarden" });
  const lg = cu.readLog(home);
  assert.strictEqual(lg[0].result, "blocked");
  assert.strictEqual(lg[0].app, "Bitwarden");

  // 도구 이름 검사(명령 주입 방지는 execFile이지만 이상한 이름은 미리 거름)
  assert.strictEqual((await cu.call("click; rm", {}, { home })).error, "bad-tool");

  // 유저 목록으로 바꾸면 기본 목록 대신
  cu.writeConfig({ blocked: ["Slack"] }, home);
  assert.strictEqual(cu.blockedBy(["Slack"], cu.readConfig(home).blocked), "Slack");
  assert.strictEqual(cu.blockedBy(["1Password"], cu.readConfig(home).blocked), null);

  // 비상 정지 = 끔 + 기록
  cu.stop(home);
  assert.strictEqual(cu.readConfig(home).enabled, false);
  assert.strictEqual(cu.readLog(home)[0].result, "stopped");

  console.log("computer-use ok");
})().catch((e) => { console.error(e); process.exit(1); });

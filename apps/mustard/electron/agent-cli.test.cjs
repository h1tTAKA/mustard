// agent-cli 점검 — node electron/agent-cli.test.cjs
const assert = require("node:assert");
const { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, realpathSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { AGENTS, mergePath, candidates, detectAgent, checkAuth, shellPath, versionOf } = require("./agent-cli.cjs");

(async () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "acli-")));
  const home = join(tmp, "home"); mkdirSync(home);
  const sh = (dir, name, body) => { mkdirSync(dir, { recursive: true }); const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return p; };
  // 깨진 mise shim(#1164)이 PATH 앞에, 진짜 claude는 ~/.local/bin(폴백)에
  const shim = sh(join(tmp, "mise-shims"), "claude", 'echo "mise ERROR claude not installed" >&2; exit 1');
  const good = sh(join(home, ".local", "bin"), "claude", 'echo "2.1.226 (Claude Code)"');
  const claude = AGENTS.find((a) => a.id === "claude");
  const pathStr = join(tmp, "mise-shims");
  assert.deepStrictEqual(candidates(claude.bins, pathStr, home), [shim, good], "PATH 먼저, 다음 설치 폴더");
  const d = await detectAgent(claude, { pathStr, home });
  assert.strictEqual(d.status, "ok"); assert.strictEqual(d.path, good, "--version 통과한 경로를 고름(깨진 shim 건너뜀)");
  assert.strictEqual(d.version, "2.1.226");
  assert.strictEqual(d.tried.length, 1); assert.match(d.tried[0].error, /mise ERROR/, "건너뛴 이유 남김");
  // 같은 실제 파일(링크)은 한 번만
  mkdirSync(join(tmp, "links")); symlinkSync(good, join(tmp, "links", "claude"));
  assert.strictEqual(candidates(claude.bins, join(tmp, "links"), home).length, 1);
  // 깨짐만 있으면 broken, 하나도 없으면 missing
  const codex = AGENTS.find((a) => a.id === "codex");
  sh(join(tmp, "only-broken"), "codex", "exit 127");
  assert.strictEqual((await detectAgent(codex, { pathStr: join(tmp, "only-broken"), home })).status, "broken");
  assert.strictEqual((await detectAgent(AGENTS.find((a) => a.id === "gemini"), { pathStr: join(tmp, "nope"), home })).status, "missing");
  // 로그인(Emdash) — 가짜 실행으로
  const fake = (code, out) => async () => ({ code, out, timedOut: false });
  assert.strictEqual(await checkAuth(claude, good, { env: { ANTHROPIC_API_KEY: "x" }, run: fake(1, "") }), "authenticated", "API 키 env면 로그인");
  assert.strictEqual(await checkAuth(claude, good, { env: {}, run: fake(0, '{"loggedIn":true}') }), "authenticated");
  assert.strictEqual(await checkAuth(claude, good, { env: {}, run: fake(1, "Not logged in. Run claude auth login") }), "unauthenticated");
  assert.strictEqual(await checkAuth(claude, good, { env: {}, run: fake(2, "weird") }), "unknown", "모르면 unknown");
  assert.strictEqual(await checkAuth(codex, "x", { env: {}, run: fake(0, "Logged in using ChatGPT") }), "authenticated");
  assert.strictEqual(await checkAuth(codex, "x", { env: {}, run: fake(1, "Not logged in") }), "unauthenticated", "부정형을 먼저 봄");
  const oc = AGENTS.find((a) => a.id === "opencode");
  assert.strictEqual(await checkAuth(oc, "x", { env: {}, run: fake(0, "0 credentials") }), "unauthenticated");
  assert.strictEqual(await checkAuth(oc, "x", { env: {}, run: fake(0, "2 credentials") }), "authenticated");
  assert.strictEqual(await checkAuth(AGENTS.find((a) => a.id === "gemini"), "x", { env: {}, run: fake(0, "") }), "unknown", "확인 방법 없는 건 unknown");
  // PATH 합치기·버전
  assert.strictEqual(mergePath("/a:/b", "/b:/c:"), "/a:/b:/c", "있는 건 그대로, 새 것만 뒤에");
  assert.strictEqual(versionOf("codex-cli 0.160.0"), "0.160.0");
  // 로그인 셸 PATH — 프로필 배너는 구분자로 걸러냄
  const fakeShell = sh(join(tmp, "bin"), "fsh", 'echo "Welcome banner"; PATH=/x/y:/z; eval "$2"');
  assert.strictEqual(await shellPath({ force: true, shell: fakeShell }), "/x/y:/z");
  assert.strictEqual(await shellPath({ force: true, shell: join(tmp, "no-shell") }), null, "셸 실패면 null");
  console.log("agent-cli.test ok");
})().catch((e) => { console.error(e); process.exit(1); });

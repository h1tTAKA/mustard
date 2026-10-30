const assert = require("node:assert");
const { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync, statSync, chmodSync, symlinkSync, lstatSync, rmdirSync, utimesSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { trustAgentFolder, claudeConfigFile } = require("./agent-trust.cjs");

(async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "trust-home-")));
  const env = {};
  const ws = join(home, "mustard", "workspaces", "repo");
  const dir = join(ws, "a"), dir2 = join(ws, "b");
  mkdirSync(dir, { recursive: true }); mkdirSync(dir2, { recursive: true });
  const opts = { home, env };

  // Mustard 작업공간 밖은 안 함(클론한 레포·렌더러가 넘긴 아무 경로)
  assert.strictEqual(await trustAgentFolder("claude", home, opts), "outside");
  mkdirSync(join(home, "mustard", "workspaces-evil", "x"), { recursive: true });
  assert.strictEqual(await trustAgentFolder("claude", join(home, "mustard", "workspaces-evil", "x"), opts), "outside", "앞부분만 같은 경로");
  assert.strictEqual(await trustAgentFolder("claude", `${dir}/../../../../..`, opts), "outside", ".. 정리");
  assert.strictEqual(await trustAgentFolder("claude", join(ws, "nope"), opts), "skipped", "없는 폴더");

  // Claude — 설정 파일 없으면 손대지 않음
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "missing-config");
  // .claude.json이 링크 — 실제 파일에 쓰고 링크는 그대로(리뷰)
  const realCfg = join(home, "dotfiles-claude.json");
  writeFileSync(realCfg, JSON.stringify({ userID: "u", projects: { [dir]: { allowedTools: ["x"] } } }));
  chmodSync(realCfg, 0o600);
  const f = join(home, ".claude.json");
  symlinkSync(realCfg, f);
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "granted");
  assert.ok(lstatSync(f).isSymbolicLink(), "링크 유지");
  const j = JSON.parse(readFileSync(realCfg, "utf8"));
  assert.deepStrictEqual(j.projects[dir], { allowedTools: ["x"], hasTrustDialogAccepted: true }, "기존 값 보존");
  assert.strictEqual(j.userID, "u", "다른 키 보존");
  assert.strictEqual(statSync(realCfg).mode & 0o777, 0o600, "권한 그대로");
  assert.ok(!existsSync(`${realCfg}.lock`), "잠금 풀림");
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "unchanged", "이미 신뢰");
  // 잠금이 살아 있으면 포기, 10초 넘은 죽은 잠금은 치우고 진행
  mkdirSync(`${realCfg}.lock`);
  assert.strictEqual(await trustAgentFolder("claude", dir2, opts), "locked");
  const old = (Date.now() - 60_000) / 1000; utimesSync(`${realCfg}.lock`, old, old);
  assert.strictEqual(await trustAgentFolder("claude", dir2, opts), "granted", "죽은 잠금");
  assert.ok(!existsSync(`${realCfg}.lock`));
  // 깨진 파일은 안 씀
  writeFileSync(realCfg, "{broken");
  const dir3 = join(ws, "c"); mkdirSync(dir3);
  assert.strictEqual(await trustAgentFolder("claude", dir3, opts), "unreadable");
  assert.strictEqual(readFileSync(realCfg, "utf8"), "{broken");
  assert.strictEqual(claudeConfigFile(home, { CLAUDE_CONFIG_DIR: "/c" }), "/c/.claude.json");

  // Codex — 홈 없으면 안 씀
  assert.strictEqual(await trustAgentFolder("codex", dir, opts), "missing-config");
  const ch = join(home, ".codex"); mkdirSync(ch);
  const toml = join(ch, "config.toml");
  writeFileSync(toml, 'model = "x"');
  assert.strictEqual(await trustAgentFolder("codex", dir, opts), "granted");
  const t = readFileSync(toml, "utf8");
  assert.ok(t.startsWith('model = "x"\n') && t.includes(`[projects."${dir}"]\ntrust_level = "trusted"\n`), t);
  assert.strictEqual(await trustAgentFolder("codex", dir, opts), "unchanged");
  // 이미 다른 모양으로 그 경로가 있으면 그대로(리터럴 따옴표·점 키·주석)
  for (const [v, want] of [[`[projects.'${dir2}'] # x\ntrust_level = "untrusted"\n`, "unchanged"], [`projects."${dir2}" = { trust_level = "untrusted" }\n`, "unsupported"]]) {
    writeFileSync(toml, v);
    assert.strictEqual(await trustAgentFolder("codex", dir2, opts), want, v);
    assert.strictEqual(readFileSync(toml, "utf8"), v, "안 바꿈");
  }
  // projects를 인라인 표·따옴표 점 키로 쓰면 덧붙이지 않음
  for (const v of [`projects = { "/other" = { trust_level = "trusted" } }\n`, `"projects"."/other".trust_level = "trusted"\n`]) {
    writeFileSync(toml, v);
    assert.strictEqual(await trustAgentFolder("codex", dir2, opts), "unsupported", v);
  }
  // 앞부분만 같은 다른 폴더 표가 있어도 내 표는 추가
  writeFileSync(toml, `[projects."${dir2}x"]\ntrust_level = "trusted"\n`);
  assert.strictEqual(await trustAgentFolder("codex", dir2, opts), "granted");
  // 끊긴 링크면 새로 안 만듦
  require("node:fs").rmSync(toml); symlinkSync(join(home, "nowhere.toml"), toml);
  assert.strictEqual(await trustAgentFolder("codex", dir2, opts), "unreadable");
  assert.ok(!existsSync(join(home, "nowhere.toml")));

  // 그 밖 에이전트·빈 폴더
  assert.strictEqual(await trustAgentFolder("gemini", dir, opts), "skipped");
  assert.strictEqual(await trustAgentFolder("claude", "", opts), "skipped");
  rmdirSync(dir3);
  console.log("agent-trust ok");
})().catch((e) => { console.error(e); process.exit(1); });

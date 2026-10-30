const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync, statSync, chmodSync, symlinkSync, lstatSync, utimesSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { trustAgentFolder, claudeConfigFile } = require("./agent-trust.cjs");

(async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "trust-home-")));
  const env = {}, opts = { home, env };
  // 메인 레포 + Mustard 작업공간 루트 아래 worktree 2개
  const main = join(home, "code", "repo");
  mkdirSync(main, { recursive: true });
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "ignore" });
  git(main, "init", "-q"); git(main, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "i");
  const ws = join(home, "mustard", "workspaces", "repo");
  mkdirSync(ws, { recursive: true });
  const dir = join(ws, "a"), dir2 = join(ws, "b");
  git(main, "worktree", "add", "-q", dir, "-b", "a"); git(main, "worktree", "add", "-q", dir2, "-b", "b");

  // 작업공간 밖·.. ·없는 폴더·worktree 아님·다른 에이전트
  assert.strictEqual(await trustAgentFolder("claude", main, opts), "outside", "메인 폴더(작업공간 밖)");
  mkdirSync(join(home, "mustard", "workspaces-evil", "x"), { recursive: true });
  assert.strictEqual(await trustAgentFolder("claude", join(home, "mustard", "workspaces-evil", "x"), opts), "outside", "앞부분만 같은 경로");
  assert.strictEqual(await trustAgentFolder("claude", `${dir}/../../../..`, opts), "outside", ".. 정리");
  assert.strictEqual(await trustAgentFolder("claude", join(ws, "nope"), opts), "skipped", "없는 폴더");
  const plain = join(ws, "plain"); mkdirSync(plain);
  assert.strictEqual(await trustAgentFolder("claude", plain, opts), "not-worktree", "작업공간 안이어도 worktree가 아니면 안 함");
  assert.strictEqual(await trustAgentFolder("codex", dir, opts), "skipped");
  assert.strictEqual(await trustAgentFolder("claude", "", opts), "skipped");

  // 설정 파일 없음 → 손대지 않음
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "missing-config");
  // .claude.json이 링크 — 실제 파일에 쓰고 링크는 그대로
  const realCfg = join(home, "dotfiles-claude.json");
  writeFileSync(realCfg, JSON.stringify({ userID: "u", projects: { [dir]: { allowedTools: ["x"] } } }));
  chmodSync(realCfg, 0o600);
  const f = join(home, ".claude.json");
  symlinkSync(realCfg, f);
  // 메인 폴더를 아직 안 믿으면 물려줄 신뢰 없음
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "main-untrusted");
  writeFileSync(realCfg, JSON.stringify({ userID: "u", projects: { [main]: { hasTrustDialogAccepted: true }, [dir]: { allowedTools: ["x"] } } }));
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "granted");
  assert.ok(lstatSync(f).isSymbolicLink(), "링크 유지");
  const j = JSON.parse(readFileSync(realCfg, "utf8"));
  assert.deepStrictEqual(j.projects[dir], { allowedTools: ["x"], hasTrustDialogAccepted: true }, "기존 값 보존");
  assert.strictEqual(j.userID, "u", "다른 키 보존");
  assert.strictEqual(statSync(realCfg).mode & 0o777, 0o600, "권한 그대로");
  assert.ok(!existsSync(`${realCfg}.lock`), "잠금 풀림");
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "unchanged", "이미 신뢰");
  // 링크 경로로 띄우면 빠진 키(링크 경로)만 더 씀
  const alias = join(ws, "alias"); symlinkSync(dir, alias);
  assert.strictEqual(await trustAgentFolder("claude", alias, opts), "granted");
  assert.strictEqual(JSON.parse(readFileSync(realCfg, "utf8")).projects[alias].hasTrustDialogAccepted, true);
  // 잠금이 살아 있으면 포기, 10초 넘은 죽은 잠금은 치우고 진행
  mkdirSync(`${realCfg}.lock`);
  assert.strictEqual(await trustAgentFolder("claude", dir2, opts), "locked");
  const old = (Date.now() - 60_000) / 1000; utimesSync(`${realCfg}.lock`, old, old);
  assert.strictEqual(await trustAgentFolder("claude", dir2, opts), "granted", "죽은 잠금");
  assert.ok(!existsSync(`${realCfg}.lock`));
  // 깨진 파일은 안 씀
  writeFileSync(realCfg, "{broken");
  assert.strictEqual(await trustAgentFolder("claude", dir, opts), "unreadable");
  assert.strictEqual(readFileSync(realCfg, "utf8"), "{broken");
  assert.strictEqual(claudeConfigFile(home, { CLAUDE_CONFIG_DIR: "/c" }), "/c/.claude.json");
  console.log("agent-trust ok");
})().catch((e) => { console.error(e); process.exit(1); });

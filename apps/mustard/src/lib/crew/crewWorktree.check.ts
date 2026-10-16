// crewWorktree 점검 — 임시 git 레포에서 생성·재사용·정리.
// MUSTARD_WORKTREE_DIR=<임시> node --experimental-strip-types src/lib/crew/crewWorktree.check.ts
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureWorktree, removeWorktree, worktreeFor } from "./crewWorktree.ts";

assert.ok(process.env.MUSTARD_WORKTREE_DIR, "임시 디렉터리 필수");
const root = mkdtempSync(join(tmpdir(), "crew-repo-"));
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
g(root, "init", "-q", "-b", "main");
g(root, "config", "user.email", "t@t"); g(root, "config", "user.name", "t");
writeFileSync(join(root, "a.txt"), "1"); g(root, "add", "."); g(root, "commit", "-qm", "init");

const id = "3f2a9c1e-aaaa-bbbb";
assert.deepStrictEqual(worktreeFor(root, id, "Fix Login Bug!").branch, "crew/3f2a9c1e-fix-login-bug", "브랜치 이름");
assert.strictEqual(worktreeFor(root, id, "로그인 버그").branch, "crew/3f2a9c1e", "영문 없으면 id만");

const w = await ensureWorktree(root, id, "Fix Login Bug!");
assert.ok(w.created && existsSync(join(w.dir, "a.txt")) && existsSync(join(w.dir, ".crew")), "생성 + .crew/");
assert.strictEqual(w.base, "main");
assert.strictEqual(g(w.dir, "rev-parse", "--abbrev-ref", "HEAD"), "crew/3f2a9c1e-fix-login-bug");
assert.ok(readFileSync(join(root, ".git", "info", "exclude"), "utf8").includes(".crew/"), ".crew/ 제외 등록");
writeFileSync(join(w.dir, ".crew", "spec.md"), "x");
assert.strictEqual(g(w.dir, "status", "--porcelain"), "", ".crew/는 git에 안 잡힘");
assert.strictEqual(g(root, "status", "--porcelain"), "", "사람 작업 폴더 그대로");

const again = await ensureWorktree(root, id, "Fix Login Bug!");
assert.ok(!again.created && again.dir === w.dir, "재사용");
await ensureWorktree(root, "zzzz9999", "other");
assert.strictEqual(readFileSync(join(root, ".git", "info", "exclude"), "utf8").split("\n").filter((l) => l === ".crew/").length, 1, "exclude 한 번만");

writeFileSync(join(w.dir, "b.txt"), "2"); g(w.dir, "add", "b.txt"); g(w.dir, "commit", "-qm", "agent work");
await removeWorktree(root, id, "Fix Login Bug!");
assert.ok(!existsSync(w.dir), "폴더 정리");
assert.ok(g(root, "branch", "--list", "crew/3f2a9c1e-fix-login-bug").length > 0, "브랜치(에이전트 커밋)는 남김");
const back = await ensureWorktree(root, id, "Fix Login Bug!");
assert.ok(back.created && existsSync(join(back.dir, "b.txt")), "남은 브랜치로 다시 붙임(작업 이어짐)");

console.log("crewWorktree.check ok");

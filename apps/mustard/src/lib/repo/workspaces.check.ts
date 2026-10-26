// workspaces 점검 — node --experimental-strip-types src/lib/repo/workspaces.check.ts
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "ws-")));
process.env.MUSTARD_WORKSPACES_DIR = join(tmp, "workspaces");
process.env.MUSTARD_CREW_DIR = join(tmp, "crew");
process.env.MUSTARD_WORKTREE_DIR = join(tmp, "crew-wt");
const { checkWorkspace, createWorkspace, forceDeleteBranch, removeWorkspace, resolveBase } = await import("./workspaces.ts");
const { branchFor, issueName, slugName } = await import("./workspaceName.ts");
const { trustScript } = await import("../crew/worktreeBootstrap.ts");

// 이름 규칙(Orca)
assert.strictEqual(slugName("Fix Login Bug!!"), "fix-login-bug");
assert.strictEqual(slugName("a..b"), "a.b");
assert.strictEqual(slugName("x".repeat(60)).length, 48);
assert.strictEqual(slugName("한글만"), "");
assert.strictEqual(issueName(12, "Issue #12: Add dark mode"), "add-dark-mode", "앞머리 떼기");
assert.strictEqual(issueName(7, "한글 제목"), "issue-7", "slug가 비면 issue-N");
assert.strictEqual(branchFor(" a//b ", "x"), "a/b/x"); assert.strictEqual(branchFor("", "x"), "x");

// 임시 레포 + 원격(bare)
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const origin = join(tmp, "origin.git"); mkdirSync(origin); g(origin, "init", "-q", "--bare", "-b", "main");
const root = join(tmp, "myrepo"); mkdirSync(root);
g(root, "init", "-q", "-b", "main"); g(root, "config", "user.email", "t@t"); g(root, "config", "user.name", "t");
writeFileSync(join(root, "a.txt"), "1"); g(root, "add", "."); g(root, "commit", "-qm", "c1");
g(root, "remote", "add", "origin", origin); g(root, "push", "-q", "origin", "main");
// PR: 같은 레포 브랜치 feat/x, fork PR은 refs/pull/5/head
g(root, "switch", "-qc", "feat/x"); writeFileSync(join(root, "b.txt"), "2"); g(root, "add", "."); g(root, "commit", "-qm", "c2"); g(root, "push", "-q", "origin", "feat/x");
const prSha = g(root, "rev-parse", "HEAD");
g(origin, "update-ref", "refs/pull/5/head", prSha);
g(root, "switch", "-q", "main"); g(root, "branch", "-qD", "feat/x"); g(root, "update-ref", "-d", "refs/remotes/origin/feat/x");
const mainHead = g(root, "rev-parse", "HEAD");

// 시작점
assert.strictEqual((await resolveBase(root, "main")).ref, "refs/heads/main");
assert.strictEqual((await resolveBase(root, "origin/main")).ref, "refs/remotes/origin/main", "원격 추적 ref 먼저");
await assert.rejects(resolveBase(root, "--upload-pack=x"), "옵션처럼 생긴 시작점 거부");
await assert.rejects(resolveBase(root, "nope"));

// 만들기 — 접두/이름, 겹치면 -2
const w1 = await createWorkspace(root, { name: "Dark Mode", base: "main", prefix: "hong" });
assert.strictEqual(w1.branch, "hong/dark-mode");
assert.strictEqual(w1.dir, join(tmp, "workspaces", "myrepo", "dark-mode"));
assert.strictEqual(g(w1.dir, "rev-parse", "HEAD"), mainHead);
assert.strictEqual(g(root, "config", "branch.hong/dark-mode.base"), "refs/heads/main", "비교 기준 기록");
assert.strictEqual(g(root, "rev-parse", "--abbrev-ref", "HEAD"), "main", "메인 체크아웃은 그대로");
const w2 = await createWorkspace(root, { name: "dark mode", base: "main", prefix: "hong" });
assert.strictEqual(w2.branch, "hong/dark-mode-2");
const w3 = await createWorkspace(root, { name: "main", base: "main" });
assert.strictEqual(w3.branch, "main-2", "있는 브랜치 이름이면 다음 번호");
assert.ok(w3.dir.endsWith("/main-2"), "폴더 이름도 같은 번호");

// PR — 같은 레포(upstream 연결)·fork(refs/pull), head 확인
const p1 = await createWorkspace(root, { name: "", pr: { number: 4, headRefName: "feat/x", headRefOid: prSha, cross: false } });
assert.strictEqual(p1.branch, "feat/x");
assert.strictEqual(g(p1.dir, "rev-parse", "HEAD"), prSha);
assert.strictEqual(g(root, "rev-parse", "--abbrev-ref", "feat/x@{u}"), "origin/feat/x", "같은 레포 PR은 원격 브랜치 추적");
const p2 = await createWorkspace(root, { name: "", pr: { number: 5, headRefName: "feat/x", headRefOid: prSha, cross: true } });
assert.strictEqual(p2.branch, "feat/x-2", "로컬에 같은 이름 있으면 번호");
assert.ok(p2.dir.endsWith("pr-5-2") || p2.dir.endsWith("pr-5"));
await assert.rejects(createWorkspace(root, { name: "", pr: { number: 5, headRefName: "feat/x", headRefOid: "0".repeat(40), cross: true } }), /pr head moved/);
await assert.rejects(createWorkspace(root, { name: "", pr: { number: 5, headRefName: "-x", cross: true } }), /bad pr/);
assert.strictEqual(g(root, "rev-parse", "--abbrev-ref", "HEAD"), "main");

// 점검·지우기
writeFileSync(join(w1.dir, "dirty.txt"), "x");
writeFileSync(join(root, ".gitignore"), "*.local\n"); writeFileSync(join(w1.dir, ".gitignore"), "*.local\n"); writeFileSync(join(w1.dir, "notes.local"), "x");
let c = await checkWorkspace(root, w1.dir);
assert.deepStrictEqual(c.ignored, ["notes.local"], "gitignore된 것도 지워진다고 알림");
assert.strictEqual(c.dirty, 2, "dirty.txt + .gitignore");
assert.deepStrictEqual(await removeWorkspace(root, w1.dir, { force: true, expectDirty: 1 }), { status: "dirty", dirty: 2 }, "본 것보다 더 바뀌었으면 force여도 멈춤");
execFileSync("rm", [join(w1.dir, "notes.local"), join(w1.dir, ".gitignore")]);
c = await checkWorkspace(root, w1.dir);
assert.strictEqual(c.dirty, 1); assert.strictEqual(c.unpushed, 0, "main에서 갈라진 직후 = 원격에 다 있음");
let r = await removeWorkspace(root, w1.dir, { deleteBranch: true });
assert.deepStrictEqual(r, { status: "dirty", dirty: 1 }, "미커밋이면 force 없이 안 지움");
g(w1.dir, "add", "."); g(w1.dir, "commit", "-qm", "local");
c = await checkWorkspace(root, w1.dir);
assert.strictEqual(c.dirty, 0); assert.strictEqual(c.unpushed, 1, "올라간 적 없는 커밋 1");
r = await removeWorkspace(root, w1.dir, { deleteBranch: true });
assert.deepStrictEqual(r, { status: "removed", branch: "hong/dark-mode", branchKept: true }, "머지 안 된 브랜치는 -d가 거부 → 남김");
assert.ok(!existsSync(w1.dir));
await forceDeleteBranch(root, "hong/dark-mode");
assert.throws(() => g(root, "rev-parse", "--verify", "refs/heads/hong/dark-mode"));
r = await removeWorkspace(root, w2.dir, { deleteBranch: true });
assert.deepStrictEqual(r, { status: "removed", branch: "hong/dark-mode-2", branchKept: false }, "머지된(같은) 브랜치는 -d로 지움");
await assert.rejects(forceDeleteBranch(root, "main"), /not a kept branch/, "지우며 남긴 브랜치만 강제 삭제(아무 브랜치나 -D 금지)");

// 거부 — 메인·남의 폴더
await assert.rejects(removeWorkspace(root, root), /main worktree/);
await assert.rejects(removeWorkspace(root, tmp), /not a worktree/);

// archive — 승인 전이면 멈춤, 승인 뒤 실행, 실패면 안 지움
const archive = "echo bye > \"$MUSTARD_ROOT_PATH/archived-$MUSTARD_WORKSPACE_NAME\"";
mkdirSync(join(root, ".mustard"), { recursive: true });
writeFileSync(join(root, ".mustard", "config.json"), JSON.stringify({ scripts: { archive } }));
c = await checkWorkspace(root, w3.dir);
assert.deepStrictEqual(c.archive, { script: archive, trusted: false, tooLong: false });
r = await removeWorkspace(root, w3.dir);
assert.deepStrictEqual(r, { status: "archive-untrusted", script: archive });
assert.ok(existsSync(w3.dir), "승인 전엔 안 지움");
trustScript(root, archive);
r = await removeWorkspace(root, w3.dir);
assert.strictEqual(r.status, "removed");
assert.ok(existsSync(join(root, "archived-main-2")), "archive가 지우기 전에 돎(이름도 겹쳐서 main-2)");
assert.ok(!existsSync(join(p1.dir, ".crew")), "사람용 작업공간엔 .crew 안 남김");
writeFileSync(join(root, ".mustard", "config.json"), JSON.stringify({ scripts: { archive: "exit 3" } }));
trustScript(root, "exit 3");
r = await removeWorkspace(root, p1.dir);
assert.strictEqual(r.status, "archive-failed", "archive 실패면 안 지움(Orca)");
r = await removeWorkspace(root, p1.dir, { allowFailedArchive: true });
assert.strictEqual(r.status, "removed");
r = await removeWorkspace(root, p2.dir, { skipArchive: true });
assert.strictEqual(r.status, "removed", "archive 건너뛰기");
console.log("workspaces.check ok");

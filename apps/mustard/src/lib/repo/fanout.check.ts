// fanout 점검 — node --experimental-strip-types src/lib/repo/fanout.check.ts
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "fo-")));
process.env.MUSTARD_WORKSPACES_DIR = join(tmp, "workspaces");
process.env.MUSTARD_FANOUT_DIR = join(tmp, "fanout");
process.env.MUSTARD_CREW_DIR = join(tmp, "crew");
const { adoptFanout, candidateDiff, capDiff, createFanout, discardFanout, dropLosers, getFanout, listFanouts, setTabs, MAX_DIFF } = await import("./fanout.ts");
const { baseBranch } = await import("./draftPr.ts");

const root = join(tmp, "repo");
mkdirSync(root);
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
g(root, "init", "-q", "-b", "main");
g(root, "config", "user.email", "t@t"); g(root, "config", "user.name", "t");
writeFileSync(join(root, "a.txt"), "one\n");
g(root, "add", "."); g(root, "commit", "-qm", "init");

// 잘못된 입력
await assert.rejects(createFanout(root, { name: "x", prompt: "", agents: ["claude", "codex"] }), /prompt/);
await assert.rejects(createFanout(root, { name: "x", prompt: "p", agents: ["claude"] }), /bad agents/);
await assert.rejects(createFanout(root, { name: "x", prompt: "p", agents: ["claude", "--evil"] }), /bad agents/);
await assert.rejects(createFanout(root, { name: "x", prompt: "p", agents: ["claude", "codex"], models: ["opus; rm -rf ~", ""] }), /bad model/, "모델 칸에 셸 글자 거부(#1313)");

// 같은 에이전트 두 번 → 이름 -2, 기록 저장
const f = await createFanout(root, { name: "fix", prompt: "fix it", agents: ["claude", "claude", "codex"], models: ["opus", " ", "gpt-5.6-sol"], base: "main" });
assert.deepStrictEqual(f.candidates.map((c) => c.model), ["opus", undefined, "gpt-5.6-sol"], "후보마다 모델 저장, 비우면 없음(#1313)");
await assert.rejects(createFanout(root, { name: "x", prompt: "p", agents: ["claude", "codex"], models: ["--yolo", ""] }), /bad model/, "플래그처럼 보이는 모델 거부(리뷰)");
assert.deepStrictEqual(f.candidates.map((c) => c.dir.split("/").pop()), ["fix-claude", "fix-claude-2", "fix-codex"]);
assert.ok(f.candidates.every((c) => existsSync(c.dir)));
assert.strictEqual(getFanout(root, f.id)?.prompt, "fix it");
assert.strictEqual(listFanouts(root).length, 1);
// 탭 id는 후보 순서대로, 이상한 값은 버림
setTabs(root, f.id, ["t-1", "bad id!", "t-3"]);
assert.deepStrictEqual(getFanout(root, f.id)?.candidates.map((c) => c.tab), ["t-1", undefined, "t-3"]);

// 후보 0: 커밋 + 미커밋, 후보 1: 새 파일만, 후보 2: 그대로
const [c0, c1, c2] = f.candidates;
writeFileSync(join(c0.dir, "a.txt"), "one\ntwo\n"); g(c0.dir, "commit", "-qam", "two");
writeFileSync(join(c0.dir, "a.txt"), "one\ntwo\nthree\n");
writeFileSync(join(c1.dir, "new.txt"), "hello\nworld\n");
const d0 = await candidateDiff(c0);
assert.deepStrictEqual(d0.files, [{ path: "a.txt", added: 2, removed: 0 }]); // 커밋 + 미커밋이 한 diff로
const d1 = await candidateDiff(c1);
assert.deepStrictEqual(d1.files, [{ path: "new.txt", added: 2, removed: 0 }]);
assert.ok(d1.diff.includes("+hello"));
assert.strictEqual(g(c1.dir, "status", "--porcelain"), "?? new.txt"); // index를 안 건드림(add -N 안 씀)
assert.strictEqual((await candidateDiff(c2)).files.length, 0);

// 기준점이 뒤로 움직여도 같은 비교(merge-base 고정)
writeFileSync(join(root, "b.txt"), "x\n"); g(root, "add", "."); g(root, "commit", "-qm", "main moves");
assert.deepStrictEqual((await candidateDiff(c0)).files.map((x) => x.path), ["a.txt"]);

// 줄 수: ++ · -- 로 시작하는 코드 줄도 셈(머리말만 뺌)
assert.deepStrictEqual(capDiff(["diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--- old comment\n-- y\n+++i;\n++j;\n"]).files[0], { path: "x", added: 2, removed: 2 });

// 상한: 큰 파일은 이름·줄 수만, 전체 글은 MAX_DIFF 이하
const part = (p: string, n: number) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -0,0 +1,${n} @@\n${"+x\n".repeat(n)}`;
const cap = capDiff([part("small", 3), part("huge", 20_000), ...Array.from({ length: 10 }, (_, i) => part(`m${i}`, 3000))]);
assert.strictEqual(cap.files.find((x) => x.path === "huge")?.big, true);
assert.strictEqual(cap.files.find((x) => x.path === "huge")?.added, 20_000);
assert.ok(cap.truncated && cap.diff.length <= MAX_DIFF && cap.diff.includes("+++ b/small") && !cap.diff.includes("+++ b/huge"));

// 채택: 승자에 바뀐 게 없으면 막음 / PR이 실패하면(원격 없음) 승자 커밋만 하고 아무것도 안 지움
await assert.rejects(adoptFanout(root, f.id, 2), /no changes/);
await assert.rejects(adoptFanout(root, f.id, 1), /origin/);
assert.strictEqual(g(c1.dir, "status", "--porcelain"), ""); // 새 파일이 커밋됨
assert.ok(f.candidates.every((c) => existsSync(c.dir)) && getFanout(root, f.id)?.status === "running");
await assert.rejects(dropLosers(root, f.id), /not adopted/); // 나머지 지우기는 채택(PR 성공) 뒤에만
// 모두 버리기: 폴더·브랜치 전부(미커밋 있어도), 상태 discarded, 두 번은 안 됨
assert.deepStrictEqual(await discardFanout(root, f.id), { left: [] });
assert.ok(f.candidates.every((c) => !existsSync(c.dir)));
assert.strictEqual(g(root, "branch", "--list", "fix-*"), "");
assert.strictEqual(getFanout(root, f.id)?.status, "discarded");
await assert.rejects(discardFanout(root, f.id), /not running/);

// 새 파일이 200개를 넘으면 넘는 건 이름만 + 잘림 표시(채택 때 같이 커밋되니 목록에서 빠지면 안 됨)
const f2 = await createFanout(root, { name: "many", prompt: "p", agents: ["claude", "codex"] });
for (let i = 0; i < 205; i++) writeFileSync(join(f2.candidates[0].dir, `n${String(i).padStart(3, "0")}.txt`), "x\n");
const many = await candidateDiff(f2.candidates[0]);
assert.strictEqual(many.files.length, 205);
assert.ok(many.truncated && many.files.filter((x) => x.big).length >= 5);
await discardFanout(root, f2.id);

// 비밀일 수 있는 새 파일: 판정 입력엔 이름만, 채택 커밋엔 안 들어감
const { SECRET } = await import("./fanout.ts");
for (const x of [".env", "app/.env.local", "keys/server.pem", "id_rsa", "config/credentials.json", ".npmrc"]) assert.ok(SECRET.test(x), x);
for (const x of ["env.ts", "src/key.ts", "README.md", "environment.md"]) assert.ok(!SECRET.test(x), x);
const f3 = await createFanout(root, { name: "sec", prompt: "add it", agents: ["claude", "codex"] });
writeFileSync(join(f3.candidates[0].dir, ".env"), "TOKEN=abc\n");
writeFileSync(join(f3.candidates[0].dir, "feature.txt"), "ok\n");
const sd = await candidateDiff(f3.candidates[0]);
assert.ok(!sd.diff.includes("TOKEN=abc") && sd.files.some((x) => x.path === ".env" && x.big));
await assert.rejects(adoptFanout(root, f3.id, 0), /origin/); // 원격이 없어 PR에서 멈춤 — 커밋은 됨
assert.strictEqual(g(f3.candidates[0].dir, "show", "--name-only", "--format=", "HEAD"), "feature.txt");
assert.strictEqual(g(f3.candidates[0].dir, "status", "--porcelain"), "?? .env");
// 에이전트가 직접 커밋한 비밀 파일: 판정 입력엔 이름만, 채택은 막음
const sec = f3.candidates[1];
writeFileSync(join(sec.dir, "id_rsa"), "PRIVATE\n"); writeFileSync(join(sec.dir, "ok.txt"), "ok\n");
g(sec.dir, "add", "."); g(sec.dir, "commit", "-qm", "oops");
const cd = await candidateDiff(sec);
assert.ok(!cd.diff.includes("PRIVATE") && cd.files.some((x) => x.path === "id_rsa" && x.big) && cd.diff.includes("+++ b/ok.txt"));
await assert.rejects(adoptFanout(root, f3.id, 1), /secret files: id_rsa/);
// 한글 폴더 안 비밀 파일(git이 경로를 따옴표로 감싸던 경우)도 이름만 + 경로가 제대로 읽힘
mkdirSync(join(sec.dir, "설정"));
writeFileSync(join(sec.dir, "설정", ".env"), "K=LIVE\n"); writeFileSync(join(sec.dir, "설정", "메모.txt"), "hi\n");
g(sec.dir, "add", "."); g(sec.dir, "commit", "-qm", "ko");
const kd = await candidateDiff(sec);
assert.ok(!kd.diff.includes("K=LIVE") && kd.files.some((x) => x.path === "설정/.env" && x.big) && kd.files.some((x) => x.path === "설정/메모.txt"));
// 이름에 공백(git이 +++ 끝에 탭을 붙임)·이름 바꾸기로 비밀이 된/비밀이던 파일도 내용이 안 나감
writeFileSync(join(sec.dir, "my key.pem"), "PEMDATA\n"); writeFileSync(join(sec.dir, "a b.txt"), "x\n");
g(sec.dir, "add", "."); g(sec.dir, "commit", "-qm", "sp");
const sp = await candidateDiff(sec);
assert.ok(!sp.diff.includes("PEMDATA") && sp.files.some((x) => x.path === "my key.pem" && x.big) && sp.files.some((x) => x.path === "a b.txt" && !x.big));
await discardFanout(root, f3.id);

// 폴더는 이미 없고 브랜치만 남은 후보도 버리기가 끝까지 감(지난 시도가 중간에 멈춘 경우)
const f4 = await createFanout(root, { name: "half", prompt: "p", agents: ["claude", "codex"] });
g(root, "worktree", "remove", "--force", f4.candidates[0].dir);
assert.deepStrictEqual(await discardFanout(root, f4.id), { left: [] });
assert.strictEqual(g(root, "branch", "--list", "half-*"), "");

// PR 기준 브랜치: 브랜치만, HEAD·SHA·PR 전용 ref는 빈 값(gh 기본)
assert.strictEqual(baseBranch("refs/heads/main"), "main");
assert.strictEqual(baseBranch("refs/remotes/origin/release/1.0"), "release/1.0");
assert.strictEqual(baseBranch("main"), "main");
for (const x of ["HEAD", "", undefined, "a1b2c3d4", "refs/mustard/pull/3"]) assert.strictEqual(baseBranch(x), "");

console.log("fanout ok");

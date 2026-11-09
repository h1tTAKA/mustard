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
const { candidateDiff, capDiff, createFanout, getFanout, listFanouts, setTabs, MAX_DIFF } = await import("./fanout.ts");

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

// 같은 에이전트 두 번 → 이름 -2, 기록 저장
const f = await createFanout(root, { name: "fix", prompt: "fix it", agents: ["claude", "claude", "codex"], base: "main" });
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

// 상한: 큰 파일은 이름·줄 수만, 전체 글은 MAX_DIFF 이하
const part = (p: string, n: number) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -0,0 +1,${n} @@\n${"+x\n".repeat(n)}`;
const cap = capDiff([part("small", 3), part("huge", 20_000), ...Array.from({ length: 10 }, (_, i) => part(`m${i}`, 3000))]);
assert.strictEqual(cap.files.find((x) => x.path === "huge")?.big, true);
assert.strictEqual(cap.files.find((x) => x.path === "huge")?.added, 20_000);
assert.ok(cap.truncated && cap.diff.length <= MAX_DIFF && cap.diff.includes("+++ b/small") && !cap.diff.includes("+++ b/huge"));

console.log("fanout ok");

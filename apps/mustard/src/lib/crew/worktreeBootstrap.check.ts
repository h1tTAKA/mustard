// worktreeBootstrap 점검 — node --experimental-strip-types src/lib/crew/worktreeBootstrap.check.ts
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isTrusted, markSetupDone, materialize, noLinkUnder, normRel, parseConfig, parseInclude, readConfig, readRepoPrefs, readRepoScripts, runArchive, runSetup, setupDone, setupScriptFor, trustScript, writeRepoPrefs, writeRepoScripts } from "./worktreeBootstrap.ts";

// 경로 정리·거부
assert.strictEqual(normRel("./.env/"), ".env");
assert.strictEqual(normRel("a\\b\\c"), "a/b/c");
for (const bad of ["/etc/passwd", "C:/x", "../up", "a/../b", "a//b", "a/./b", ".git/hooks", "x/.GIT", "", "   "]) assert.strictEqual(normRel(bad), null, bad);

// 설정 — 잘못된 필드는 버리고 나머지 적용
const c = parseConfig(JSON.stringify({ scripts: { setup: "  pnpm install \n", archive: "", extra: 1 }, setupAgentStartupPolicy: "wait-for-setup", worktree: { sharedDirectories: [".cache/", "./.cache", "../x", 5, "node_modules"] } }));
assert.deepStrictEqual(c, { setup: "pnpm install", startup: "wait-for-setup", sharedDirectories: [".cache", "node_modules"] }, "빈 archive·나쁜 경로·숫자 버림, 중복 제거");
assert.deepStrictEqual(parseConfig("{not json"), { sharedDirectories: [] }, "깨진 JSON = 빈 설정");
assert.deepStrictEqual(parseConfig("[1]"), { sharedDirectories: [] }, "배열 루트 = 빈 설정");
assert.deepStrictEqual(parseConfig(JSON.stringify({ scripts: "x", worktree: [], setupAgentStartupPolicy: "later" })), { sharedDirectories: [] }, "타입 틀린 묶음·정책 무시");
assert.strictEqual(parseConfig(JSON.stringify({ scripts: { setup: "x".repeat(70 * 1024) } })).setup, undefined, "필드 64KiB 넘으면 그 필드만 버림");
assert.deepStrictEqual(parseConfig(" ".repeat(300 * 1024) + "{}"), { sharedDirectories: [] }, "파일 256KiB 넘으면 통째로 무시");

// .worktreeinclude
assert.deepStrictEqual(parseInclude(["# 비밀", ".env", "./.env", ".env.local  ", "", "!.env.prod", "*.pem", "a?b", ".vscode/settings.json", "../out", "k # not comment"].join("\n")),
  [".env", ".env.local", ".vscode/settings.json", "k # not comment"], "주석·glob·부정·상위 경로 제외, 줄 중간 #은 경로의 일부");
assert.strictEqual(parseInclude(Array.from({ length: 1200 }, (_, i) => `f${i}`).join("\n")).length, 1000, "1000개까지");

// ── materialize: 임시 레포 → worktree ──
const root = realpathSync(mkdtempSync(join(tmpdir(), "wtb-")));
const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
writeFileSync(join(root, ".gitignore"), ".env\n.env.local\nnode_modules/\n.cache/\nbig/\nsecret-link\n");
writeFileSync(join(root, "tracked.txt"), "t");
mkdirSync(join(root, ".mustard")); writeFileSync(join(root, ".mustard", "config.json"), JSON.stringify({ worktree: { sharedDirectories: ["node_modules", "tracked.txt", "nope"] } }));
writeFileSync(join(root, ".worktreeinclude"), [".env", ".env.local", "tracked.txt", "missing.env", "node_modules", "big", "secret-link"].join("\n"));
g("add", "-A"); g("commit", "-qm", "init");
writeFileSync(join(root, ".env"), "A=1");
mkdirSync(join(root, "node_modules", "pkg"), { recursive: true }); writeFileSync(join(root, "node_modules", "pkg", "i.js"), "x");
mkdirSync(join(root, "big")); for (let i = 0; i < 30; i++) writeFileSync(join(root, "big", `f${i}`), "0123456789");
writeFileSync(join(root, "real-secret"), "S"); symlinkSync(join(root, "real-secret"), join(root, "secret-link"));
const wt = join(root, "..", `${root.split("/").pop()}-wt`);
g("worktree", "add", "-q", "-b", "w", wt);

const rep = await materialize(root, wt, { bytes: 10_000, entries: 20 });
assert.deepStrictEqual(rep.shared, ["node_modules"], "무시된 폴더만 공유");
assert.ok(lstatSync(join(wt, "node_modules")).isSymbolicLink() && existsSync(join(wt, "node_modules", "pkg", "i.js")), "공유 = 심링크");
assert.ok(rep.copied.includes(".env") && readFileSync(join(wt, ".env"), "utf8") === "A=1", ".env 복사");
writeFileSync(join(wt, ".env"), "B=2"); assert.strictEqual(readFileSync(join(root, ".env"), "utf8"), "A=1", "복사본은 독립");
const why = Object.fromEntries(rep.skipped.map((x) => [x.path, x.reason]));
assert.strictEqual(why["tracked.txt"], "not-ignored", "추적 파일은 공유·복사 안 함");
assert.strictEqual(why["nope"], "not-ignored");
assert.strictEqual(why["missing.env"], "not-ignored", "gitignore에 없는 경로");
assert.strictEqual(why[".env.local"], "missing", "무시되지만 없는 파일");
assert.strictEqual(why["node_modules"], "exists", "이미 공유된 건 다시 복사 안 함");
assert.strictEqual(why["big"], "over-budget", "한도 넘으면 건너뜀");
assert.ok(rep.copied.includes("secret-link") && !lstatSync(join(wt, "secret-link")).isSymbolicLink() && readFileSync(join(wt, "secret-link"), "utf8") === "S", "맨 위 링크는 대상 내용을 복사");

const rep2 = await materialize(root, wt, { bytes: 10_000, entries: 20 });
assert.deepStrictEqual([rep2.shared, rep2.copied], [[], []], "두 번째엔 다 이미 있음 — 덮어쓰지 않음");
assert.strictEqual(readFileSync(join(wt, ".env"), "utf8"), "B=2", "기존 대상 보존");

// ── setup / archive + 신뢰(#1176 커밋 3) — 신뢰 저장소는 MUSTARD_CREW_DIR 임시 폴더 ──
process.env.MUSTARD_CREW_DIR ??= mkdtempSync(join(tmpdir(), "wtb-crew-"));
const setCfg = (where: string, scripts: Record<string, string>) => { mkdirSync(join(where, ".mustard"), { recursive: true }); writeFileSync(join(where, ".mustard", "config.json"), JSON.stringify({ scripts })); };
assert.deepStrictEqual(await runSetup(root, wt), { status: "none" }, "worktree에 setup 없으면 none");
process.env.MUSTARD_SECRET_TOKEN = "leak-me";
const script = 'echo "$MUSTARD_WORKSPACE_NAME" > made.txt; test "$MUSTARD_ROOT_PATH" = "' + root + '" && test "$PWD" = "$MUSTARD_WORKTREE_PATH" && test -z "$MUSTARD_SECRET_TOKEN" && test -n "$PATH"';
setCfg(wt, { setup: script });
const u = await runSetup(root, wt);
assert.ok(u.status === "untrusted" && u.script === script && !existsSync(join(wt, "made.txt")), "승인 전엔 실행 안 함");
trustScript(root, script); trustScript(root, script);
assert.ok(isTrusted(root, script) && !isTrusted(root, script + " "), "내용이 바뀌면 다시 승인");
const ok = await runSetup(root, wt);
assert.ok(ok.status === "ok" && readFileSync(join(wt, "made.txt"), "utf8").trim() === wt.split("/").pop(), "승인 후 실행 + 환경변수");
assert.ok(readFileSync(join(wt, ".crew", "setup.log"), "utf8").startsWith("# setup"), "로그 파일");
assert.ok(setupDone(root, wt) && !existsSync(join(wt, ".crew", "setup-done")), "완료 표시는 worktree 밖(에이전트가 못 씀)");
assert.deepStrictEqual(await runSetup(root, wt), { status: "none" }, "같은 내용이면 다시 안 돎");
const long = "echo x # " + "y".repeat(4100);
setCfg(wt, { setup: long }); trustScript(root, long);
assert.deepStrictEqual(await runSetup(root, wt), { status: "too-long" }, "4000자 넘으면 승인돼 있어도 안 돎(사람이 끝까지 못 봄)");
markSetupDone(root, wt, "skipped");
assert.deepStrictEqual(await runSetup(root, wt), { status: "none" }, "건너뛰기 표시");
markSetupDone(root, wt, "reset");

const bad = "echo before; false; echo after";
setCfg(wt, { setup: bad }); trustScript(root, bad);
const f = await runSetup(root, wt);
assert.ok(f.status === "failed" && f.result.code !== 0 && f.result.tail.includes("before") && !f.result.tail.includes("after"), "bash -e: 첫 실패에서 멈춤 + 끝부분 로그");
const slow = "sleep 30 & sleep 30";
setCfg(wt, { setup: slow }); trustScript(root, slow);
const t0 = Date.now(); const s2 = await runSetup(root, wt, 300);
assert.ok(s2.status === "failed" && s2.result.timedOut && Date.now() - t0 < 5000, "시간 초과면 그룹째 끔");

assert.strictEqual(noLinkUnder("/a/b", "/a/bc/x"), false, "base 밖(이름만 비슷)은 거부");
// 설정 파일이 링크면 안 읽음(로컬 파일 노출 방지)
const lroot = realpathSync(mkdtempSync(join(tmpdir(), "wtb-link-")));
writeFileSync(join(lroot, "secret.txt"), JSON.stringify({ scripts: { setup: "cat ~/.ssh/id_rsa" } }));
mkdirSync(join(lroot, ".mustard")); symlinkSync(join(lroot, "secret.txt"), join(lroot, ".mustard", "config.json"));
assert.strictEqual(readConfig(lroot).setup, undefined, "링크 설정 거부");
const lroot2 = realpathSync(mkdtempSync(join(tmpdir(), "wtb-link2-")));
mkdirSync(join(lroot2, "real", ".mustard"), { recursive: true }); writeFileSync(join(lroot2, "real", ".mustard", "config.json"), JSON.stringify({ scripts: { setup: "x" } }));
mkdirSync(join(lroot2, "wt")); symlinkSync(join(lroot2, "real", ".mustard"), join(lroot2, "wt", ".mustard"));
assert.strictEqual(readConfig(join(lroot2, "wt")).setup, undefined, "중간 폴더 링크도 거부");

// 백그라운드로 남긴 프로세스가 출력 통로를 쥐어도 bash가 끝나면 바로 끝남(그룹째 정리)
const bg = "sleep 30 & echo started";
setCfg(wt, { setup: bg }); trustScript(root, bg); markSetupDone(root, wt, "reset");
const tb = Date.now(); const b = await runSetup(root, wt, 20_000);
assert.ok(b.status === "ok" && Date.now() - tb < 3000, "exit 기준으로 끝남(시간 초과까지 안 기다림)");
// 링크 검사 — 정규화 안 된 base(상대·..)여도 허술하게 통과하지 않음
assert.strictEqual(readConfig(join(lroot2, "wt", "..", "wt")).setup, undefined, "표기가 달라도 링크 거부");

// archive는 메인 체크아웃 설정 + 승인된 것만
assert.strictEqual(await runArchive(root, wt), null, "archive 없으면 null");
setCfg(root, { archive: "touch archived.txt" });
assert.strictEqual(await runArchive(root, wt), null, "승인 전 archive 안 돎");
trustScript(root, "touch archived.txt");
const a = await runArchive(root, wt);
assert.ok(a?.ok && existsSync(join(wt, "archived.txt")), "승인된 archive는 worktree에서 실행");
// ── 앱에서 편집(#1216) — 모르는 키 보존, 쓴 스크립트는 승인, 깨진 파일·링크·나쁜 경로 거부 ──
{
  const r = realpathSync(mkdtempSync(join(tmpdir(), "wtb-edit-")));
  assert.deepStrictEqual(readRepoScripts(r), { setup: "", archive: "", shared: [], broken: false }, "파일 없음 = 빈 값");
  assert.strictEqual(writeRepoScripts(r, { setup: "", archive: "", shared: [] }), "ok");
  assert.ok(!existsSync(join(r, ".mustard")), "빈 설정이면 파일 안 만듦");
  mkdirSync(join(r, ".mustard"));
  writeFileSync(join(r, ".mustard", "config.json"), JSON.stringify({ team: 1, scripts: { setup: "old", other: "x" }, setupAgentStartupPolicy: "wait-for-setup" }));
  assert.strictEqual(writeRepoScripts(r, { setup: "old", archive: "", shared: [] }), "ok");
  assert.ok(!isTrusted(r, "old"), "그대로 둔 채 저장하면 레포 스크립트를 승인하지 않음");
  assert.strictEqual(writeRepoScripts(r, { setup: " pnpm i ", archive: "", shared: ["node_modules/", " .cache "] }), "ok");
  const j = JSON.parse(readFileSync(join(r, ".mustard", "config.json"), "utf8"));
  assert.deepStrictEqual(j, { team: 1, scripts: { setup: "pnpm i", other: "x" }, setupAgentStartupPolicy: "wait-for-setup", worktree: { sharedDirectories: ["node_modules", ".cache"] } }, "모르는 키 보존");
  assert.ok(isTrusted(r, "pnpm i"), "앱에서 쓴 스크립트는 승인");
  assert.strictEqual(writeRepoScripts(r, { setup: "x", archive: "", shared: ["../up"] }), "bad-path");
  assert.strictEqual(writeRepoScripts(r, { setup: "x".repeat(4001), archive: "", shared: [] }), "too-long");
  writeFileSync(join(r, ".mustard", "config.json"), "{broken");
  assert.strictEqual(readRepoScripts(r).broken, true);
  assert.strictEqual(writeRepoScripts(r, { setup: "y", archive: "", shared: [] }), "broken", "깨진 파일은 안 덮어씀");
  assert.strictEqual(readFileSync(join(r, ".mustard", "config.json"), "utf8"), "{broken");
  // 새 worktree에 설정이 없으면 메인 것
  const wt2 = realpathSync(mkdtempSync(join(tmpdir(), "wtb-wt-")));
  writeFileSync(join(r, ".mustard", "config.json"), JSON.stringify({ scripts: { setup: "main-setup" } }));
  assert.strictEqual(setupScriptFor(r, wt2, true), "main-setup", "사람용: 파일 없으면 메인 것");
  assert.strictEqual(setupScriptFor(r, wt2), undefined, "Crew(기본): 메인 것 안 씀");
  mkdirSync(join(wt2, ".mustard")); writeFileSync(join(wt2, ".mustard", "config.json"), "{}");
  assert.strictEqual(setupScriptFor(r, wt2, true), undefined, "브랜치가 setup을 뺐으면 메인 것 안 씀");
  // 내 PC 설정
  assert.deepStrictEqual(readRepoPrefs(r), { setupAuto: true }, "기본 켬");
  writeRepoPrefs(r, { setupAuto: false });
  assert.deepStrictEqual(readRepoPrefs(r), { setupAuto: false });
}
console.log("worktreeBootstrap.check ok");

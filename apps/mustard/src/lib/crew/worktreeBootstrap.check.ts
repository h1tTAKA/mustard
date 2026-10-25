// worktreeBootstrap 점검 — node --experimental-strip-types src/lib/crew/worktreeBootstrap.check.ts
import assert from "node:assert";
import { normRel, parseConfig, parseInclude } from "./worktreeBootstrap.ts";

// 경로 정리·거부(Orca 규칙)
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
console.log("worktreeBootstrap.check ok");

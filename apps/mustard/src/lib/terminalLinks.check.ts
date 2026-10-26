// terminalLinks 점검 — node --experimental-strip-types src/lib/terminalLinks.check.ts
import assert from "node:assert";
import { findLinks, resolvePath, repoRelative, findRepoFile } from "./terminalLinks.ts";

const pick = (s: string) => findLinks(s).map((l) => (l.kind === "url" ? ["url", l.url] : ["file", l.path, l.line ?? null, l.col ?? null]));

// 웹 주소 — 끝 문장부호·닫는 괄호 제거, localhost:포트는 http 붙임
assert.deepStrictEqual(pick("열기: https://github.com/a/b/pull/12."), [["url", "https://github.com/a/b/pull/12"]]);
assert.deepStrictEqual(pick("(see http://x.dev/path)"), [["url", "http://x.dev/path"]]);
assert.deepStrictEqual(pick("  ▲ Local: localhost:3000/"), [["url", "http://localhost:3000/"]]);
assert.deepStrictEqual(pick("wiki https://en.wikipedia.org/wiki/A_(b)"), [["url", "https://en.wikipedia.org/wiki/A_(b)"]], "짝 맞는 괄호는 유지");

// 파일 — 폴더가 있거나 줄 번호가 있을 때만
assert.deepStrictEqual(pick("src/app/page.tsx:12:5 error"), [["file", "src/app/page.tsx", 12, 5]]);
assert.deepStrictEqual(pick("at ./lib/x.ts:3"), [["file", "./lib/x.ts", 3, null]]);
assert.deepStrictEqual(pick("Edited /Users/me/repo/README.md"), [["file", "/Users/me/repo/README.md", null, null]]);
assert.deepStrictEqual(pick("main.go(14,2): bad"), [["file", "main.go", 14, 2]]);
assert.deepStrictEqual(pick("node v24.14.0 and next 16.0.1"), [], "버전 숫자는 아님");
assert.deepStrictEqual(pick("see README.md for more"), [], "폴더도 줄 번호도 없는 이름 하나는 안 잡음");

// 주소 안의 글자는 파일로 안 봄, 여러 개는 순서대로
assert.deepStrictEqual(pick("https://x.dev/a/b.js and src/c.ts:1"), [["url", "https://x.dev/a/b.js"], ["file", "src/c.ts", 1, null]]);
// 위치(start) — 화면 칸과 맞춰야 밑줄이 맞음
const [l] = findLinks("  → src/a.ts:9");
assert.strictEqual(l.start, 4);
assert.strictEqual(l.text, "src/a.ts:9");

// 경로 풀기 — cwd 기준, . .. 정리, ~ 는 모름
assert.strictEqual(resolvePath("/r/apps/web", "../../lib/x.ts"), "/r/lib/x.ts");
assert.strictEqual(resolvePath("/r", "./src/a.ts"), "/r/src/a.ts");
assert.strictEqual(resolvePath("/r", "/etc/hosts"), "/etc/hosts");
assert.strictEqual(resolvePath("/r", "~/a.ts"), null);
assert.strictEqual(repoRelative("/r/", "/r/src/a.ts"), "src/a.ts");
assert.strictEqual(repoRelative("/r", "/rr/a.ts"), null, "이름만 같은 옆 폴더는 레포 밖");

// 파일 찾기 — cwd 기준 우선, 낡은 cwd면 끝이 같은 파일이 하나일 때만
const F = ["apps/web/page.tsx", "apps/admin/page.tsx", "apps/web/lib/x.ts", "README.md"];
assert.strictEqual(findRepoFile(F, "/r", "/r/apps/web", "./page.tsx"), "apps/web/page.tsx", "셸 지금 폴더 기준");
assert.strictEqual(findRepoFile(F, "/r", "/r", "./page.tsx"), null, "끝이 같은 게 둘이면 추측 안 함");
assert.strictEqual(findRepoFile(F, "/r", "/r", "lib/x.ts"), "apps/web/lib/x.ts", "낡은 cwd — 하나면 그것");
assert.strictEqual(findRepoFile(F, "/r", "/r", "/etc/x.ts"), null, "절대 경로는 추측 안 함");
assert.strictEqual(findRepoFile(F, "/r", "/r", "../lib/x.ts"), null, "../ 는 레포 밖이라 추측 안 함");
assert.strictEqual(findRepoFile([], "/r", "/r", "src/big.ts", true), "src/big.ts", "목록이 잘린 큰 레포 — 풀린 경로 그대로");
assert.strictEqual(findRepoFile([], "/r", "/r", "../out.ts", true), null);

console.log("terminalLinks ok");

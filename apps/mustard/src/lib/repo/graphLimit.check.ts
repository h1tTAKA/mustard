// graphLimit 점검(#1338) — node --experimental-strip-types apps/mustard/src/lib/repo/graphLimit.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
process.env.MUSTARD_CODEGRAPH_DIR = mkdtempSync(join(tmpdir(), "glimit-")); // 실제 설정 파일 안 건드림
const { filePriority, clampLimit, graphMaxFiles, setGraphMaxFiles, LIMIT_DEFAULT } = await import("./graphLimit.ts");
const { scanRepo } = await import("./scan.ts");

assert.equal(filePriority("src/a.ts"), 0);
assert.equal(filePriority("packages/ui/lib/b.ts"), 0);
assert.equal(filePriority("misc/c.ts"), 1);
assert.equal(filePriority("src/__tests__/a.ts"), 2);
assert.equal(filePriority("src/a.test.ts"), 2);
assert.equal(filePriority("examples/x.ts"), 2);
assert.equal(filePriority("pkg/foo_test.go"), 2);
assert.equal(clampLimit(10), 500); assert.equal(clampLimit(1e9), 200000);
assert.equal(graphMaxFiles(), LIMIT_DEFAULT);
assert.equal(setGraphMaxFiles(1234), 1234);
assert.equal(graphMaxFiles(), 1234);

// 넘으면 소스 먼저 — 상한 3에 테스트·예제·기타·소스가 섞인 레포
const r = mkdtempSync(join(tmpdir(), "glimit-repo-"));
const put = (rel: string) => { const p = join(r, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, "export {}"); };
for (const f of ["examples/e1.ts", "tests/t1.ts", "misc/m1.ts", "src/s1.ts", "src/s2.ts", "src/s1.test.ts", "package.json"]) put(f);
const s = scanRepo(r, { maxFiles: 3 });
assert.ok(s.capped);
assert.equal(s.total, 6);
assert.deepEqual(s.files.filter((f) => f.endsWith(".ts")).sort(), ["misc/m1.ts", "src/s1.ts", "src/s2.ts"]);
assert.ok(s.files.includes("package.json")); // 설정 파일은 상한 밖
console.log("graphLimit ok");

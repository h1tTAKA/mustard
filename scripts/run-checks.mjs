#!/usr/bin/env node
// 레포 점검 한 번에(#1153) — git이 추적하는 *.test.cjs·*.check.ts 등을 찾아 파일 폴더에서 하나씩 node로 실행.
// 빌드 산출물(.next·dist_electron)은 git 추적이 아니라 자동 제외. 하나라도 실패면 exit 1(CI가 막음).
// 쓰기: npm run check  ·  일부만: npm run check -- crew  (경로에 그 글자가 든 것만)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const only = process.argv.slice(2);
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(test|check)\.(c?js|mjs|ts)$/.test(f))
  .filter((f) => !only.length || only.some((o) => f.includes(o)));

const fails = [];
const t0 = Date.now();
for (const f of files) {
  const ts = f.endsWith(".ts");
  const s = Date.now();
  // 저장소를 건드리는 점검은 실제 기록 대신 임시 폴더를 요구함(없으면 일부러 실패) → 점검마다 새 임시 폴더, 끝나면 지움
  const tmp = mkdtempSync(join(tmpdir(), "mustard-check-"));
  const env = { ...process.env, MUSTARD_STREAM_DIR: join(tmp, "stream"), MUSTARD_CREW_DIR: join(tmp, "crew"), MUSTARD_WORKTREE_DIR: join(tmp, "worktrees") };
  // .ts는 타입만 지우고 실행(Node 22는 플래그 필요, 24는 기본). 2분 넘으면 멈춘 걸로.
  const r = spawnSync(process.execPath, [...(ts ? ["--experimental-strip-types", "--no-warnings"] : []), basename(f)], { cwd: resolve(root, dirname(f)), encoding: "utf8", timeout: 120_000, env });
  rmSync(tmp, { recursive: true, force: true });
  const ok = r.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${((Date.now() - s) / 1000).toFixed(1)}s ${f}`);
  if (!ok) fails.push({ f, out: `${r.error ? String(r.error) + "\n" : ""}${r.stderr || ""}${r.stdout || ""}`.trim().split("\n").slice(0, 15).join("\n") });
}
for (const { f, out } of fails) console.log(`\n--- ${f}\n${out}`);
console.log(`\n${files.length - fails.length}/${files.length} 통과 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails.length ? 1 : 0);

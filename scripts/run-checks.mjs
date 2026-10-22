#!/usr/bin/env node
// 레포 점검 한 번에(#1153) — git이 추적하는 *.test.cjs·*.check.ts 등을 찾아 파일 폴더에서 하나씩 node로 실행.
// 빌드 산출물(.next·dist_electron)은 git 추적이 아니라 자동 제외. 하나라도 실패면 exit 1(CI가 막음).
// 쓰기: npm run check  ·  일부만: npm run check -- crew  (경로에 그 글자가 든 것만)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // pathname은 %인코딩 그대로(공백·한글 경로에서 죽음, 리뷰)
const only = process.argv.slice(2);
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(test|check)\.(c?js|mjs|ts)$/.test(f))
  .filter((f) => !only.length || only.some((o) => f.includes(o)));

// 지우기 실패는 넘김(시간 초과로 끊긴 점검이 아직 쓰는 중일 수 있음 — 요약까지는 가야 함). 실행기가 끊겨도 지금 임시 폴더는 지움.
// ponytail: 시간 초과면 직접 자식만 끔(손자 프로세스는 남을 수 있음) — 서버를 띄우는 점검이 생기면 detached + 프로세스 그룹 kill로.
let current = null;
const clean = (dir) => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 넘김 */ } };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { if (current) clean(current); process.exit(130); });

const fails = [];
const t0 = Date.now();
for (const f of files) {
  const ts = f.endsWith(".ts");
  const s = Date.now();
  // 저장소를 건드리는 점검은 실제 기록 대신 임시 폴더를 요구함(없으면 일부러 실패) → 점검마다 새 임시 폴더, 끝나면 지움
  const tmp = (current = mkdtempSync(join(tmpdir(), "mustard-check-")));
  const env = { ...process.env, MUSTARD_STREAM_DIR: join(tmp, "stream"), MUSTARD_CREW_DIR: join(tmp, "crew"), MUSTARD_WORKTREE_DIR: join(tmp, "worktrees") };
  // .ts는 타입만 지우고 실행(Node 22는 플래그 필요, 24는 기본). 2분 넘으면 멈춘 걸로.
  const r = spawnSync(process.execPath, [...(ts ? ["--experimental-strip-types", "--no-warnings"] : []), basename(f)], { cwd: resolve(root, dirname(f)), encoding: "utf8", timeout: 120_000, env });
  clean(tmp); current = null;
  const ok = r.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${((Date.now() - s) / 1000).toFixed(1)}s ${f}`);
  if (!ok) fails.push({ f, out: `${r.error ? String(r.error) + "\n" : ""}${r.stderr || ""}${r.stdout || ""}`.trim().split("\n").slice(0, 15).join("\n") });
}
for (const { f, out } of fails) console.log(`\n--- ${f}\n${out}`);
console.log(`\n${files.length - fails.length}/${files.length} 통과 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails.length ? 1 : 0);

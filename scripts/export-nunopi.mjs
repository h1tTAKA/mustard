#!/usr/bin/env node
// 누노피 단독 레포 내보내기(#1116) — 모노레포(원본)에서 apps/nunopi + packages/core + packages/nunopi만 뽑아
// 혼자 설치·빌드되는 레포 폴더를 만든다. 동기화 워크플로(sync-nunopi.yml)가 이 결과를 h1tTAKA/nunopi에 push.
// 사용: node scripts/export-nunopi.mjs <출력 폴더>   (출력 폴더는 비어 있거나 없어야 함)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) { console.error("usage: export-nunopi.mjs <out dir>"); process.exit(1); }
if (existsSync(out) && readdirSync(out).length) { console.error(`out dir not empty: ${out}`); process.exit(1); }
mkdirSync(out, { recursive: true });

// 추적 중인 파일만(빌드 산출물·node_modules·로그 제외)
const files = execFileSync("git", ["ls-files", "apps/nunopi", "packages/core", "packages/nunopi"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
for (const f of files) { mkdirSync(dirname(join(out, f)), { recursive: true }); cpSync(join(root, f), join(out, f)); }

// 루트 package.json — 워크스페이스 3개, 명령은 단독 앱으로
const mono = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pkg = {
  name: "nunopi",
  version: mono.version,
  private: true,
  description: "Learn the code your AI agents write — analyze, explain and memorize code and tech text.",
  workspaces: ["apps/nunopi", "packages/core", "packages/nunopi"],
  ...(mono.overrides ? { overrides: mono.overrides } : {}),
  scripts: {
    dev: "npm run dev --workspace apps/nunopi",
    build: "npm run build --workspace apps/nunopi",
    lint: "npm run lint --workspace apps/nunopi",
    "electron:dev": "npm run electron:dev --workspace apps/nunopi",
    "electron:dist": "npm run electron:dist --workspace apps/nunopi",
  },
};
writeFileSync(join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
// 잠금 파일은 원본 것을 시작점으로 — 동기화 워크플로가 `npm install --package-lock-only`로 쓰지 않는 패키지를 걷어냄
cpSync(join(root, "package-lock.json"), join(out, "package-lock.json"));

// 누노피 레포 전용 파일(README·.gitignore·CI)
cpSync(join(root, "scripts", "nunopi-repo"), out, { recursive: true });
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
writeFileSync(join(out, "SYNCED_FROM"), `h1tTAKA/mustard@${sha}\n`);
console.log(`exported ${files.length} files → ${out} (mustard@${sha.slice(0, 8)})`);

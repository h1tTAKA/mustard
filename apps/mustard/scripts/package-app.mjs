// electron-builder 래퍼(#898, #684 OOM + 네이티브 ABI 해결).
//
// 문제 1 (OOM): hoist 모노레포에서 electron-builder는 package.json dependencies를 자동 수집하며
//   루트 node_modules(1.2G)를 순회하다 OOM한다. Next 서버 deps는 이미 .next/standalone에 있어
//   asar엔 불필요. → 패키징 동안만 dependencies를 네이티브·메인프로세스 allowlist로 줄인다.
// 문제 2 (네이티브 ABI): better-sqlite3 12.11.1은 electron prebuild가 없고, electron-builder의
//   @electron/rebuild는 이 hoist 환경서 electron 헤더로 소스빌드하지 못해 시스템-node ABI(127)를
//   남긴다(전자는 148 요구 → SNA fork 로드 실패). → 여기서 node-gyp로 electron 헤더 직접 소스빌드해
//   루트 사본을 148로 만든 뒤 electron-builder가 그대로 복사(yml의 npmRebuild:false로 덮어쓰기 방지).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const KEEP = new Set(["@sna-sdk/core", "@sna-sdk/client", "better-sqlite3", "node-pty", "langfuse"]);
const NATIVE = ["better-sqlite3", "node-pty"]; // 소스빌드 대상(electron ABI)

const args = process.argv.slice(2);
// --config <file>에서 electronVersion 파싱(yml). 못 찾으면 폴백.
function electronVersionFromConfig() {
  const ci = args.indexOf("--config");
  if (ci >= 0 && args[ci + 1] && existsSync(args[ci + 1])) {
    const m = readFileSync(args[ci + 1], "utf8").match(/electronVersion:\s*([0-9][0-9.]*)/);
    if (m) return m[1];
  }
  return "43.7.0";
}

const repoRoot = join(process.cwd(), "..", "..");
const electronVersion = electronVersionFromConfig();
const arch = process.arch;

// 0) 컴퓨터 사용 도우미(#1189) .app — macOS만. 실패하면 패키징 중단(electron-builder가 Resources에 넣을 .app이 있어야 함).
if (process.platform === "darwin") {
  const r = spawnSync("node", ["native/computer-use-macos/build-app.mjs"], { stdio: "inherit" });
  if (r.status !== 0) { console.error("[package-app] 컴퓨터 사용 도우미 빌드 실패 — Xcode 명령줄 도구(swift)를 확인하세요"); process.exit(r.status ?? 1); } // 옛 .app이나 빠진 채로 패키징하지 않음(리뷰)
}

// 1) 네이티브를 electron ABI로 소스빌드(루트 node_modules — 소스가 있는 곳).
for (const mod of NATIVE) {
  const dir = join(repoRoot, "node_modules", mod);
  if (!existsSync(dir)) continue;
  console.log(`[package-app] ${mod} electron ABI 소스빌드(electron=${electronVersion}, arch=${arch})`);
  const r = spawnSync(
    "node-gyp",
    ["rebuild", `--target=${electronVersion}`, `--arch=${arch}`, "--dist-url=https://electronjs.org/headers"],
    { cwd: dir, stdio: "inherit", shell: true },
  );
  if (r.status !== 0) {
    console.error(`[package-app] ${mod} electron 소스빌드 실패(status=${r.status})`);
    process.exit(r.status ?? 1);
  }
}

// 2) 패키징 동안 dependencies 축소(OOM 회피). 축소본으로 방치되면 리포 손상이라
//    finally + 시그널(SIGINT/SIGTERM)·uncaughtException까지 반드시 원복.
const pkgPath = "package.json";
const orig = readFileSync(pkgPath, "utf8");
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  try { writeFileSync(pkgPath, orig); console.log("[package-app] package.json 원복 완료"); }
  catch (e) { console.error("[package-app] 원복 실패! package.json 수동 복구 필요:", String(e?.message || e)); }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { restore(); process.exit(1); });
}
process.on("uncaughtException", (e) => { console.error(e); restore(); process.exit(1); });

const pkg = JSON.parse(orig);
const full = pkg.dependencies ?? {};
const minimal = {};
for (const [k, v] of Object.entries(full)) if (KEEP.has(k)) minimal[k] = v;
pkg.dependencies = minimal;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[package-app] dependencies ${Object.keys(full).length} → ${Object.keys(minimal).length}개: ${Object.keys(minimal).join(", ")}`);

try {
  const r = spawnSync("electron-builder", args, { stdio: "inherit", shell: true });
  process.exitCode = r.status ?? 1;
} finally {
  restore(); // 원본 정확 복원
}

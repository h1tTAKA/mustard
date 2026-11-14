// 레포 파일 스캐너 — 서버(Node) 전용. 폴더를 훑어 지원 소스 파일 경로를 모은다.
// 무시 디렉터리 제외 + 파일 수 상한(폭주 방지). import 파싱은 graph.ts에서.
import { readdirSync, existsSync, statSync, type Dirent } from "node:fs";
import { isConfigFile, CONFIG_MAX_BYTES } from "./configFiles.ts";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { SUPPORTED_EXTS } from "./langs.ts"; // .ts 명시 — scan.check(strip-types)가 직접 로드(symbols.ts 관례)
import { UNITY_ASSET_EXTS } from "./unityAssets.ts";
import { GODOT_FILE_EXTS } from "./godotAssets.ts";

// 파싱 대상 확장자 — 언어 레지스트리(langs.ts)서 파생(단일 소스).
const SUPPORTED = SUPPORTED_EXTS;
// 훑지 않을 디렉터리(빌드 산출물·의존성·VCS).
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "dist_electron", "build", "out", "coverage", // dist_electron = electron-builder 출력(.app 안 소스 사본, #1155)
  ".turbo", ".vercel", ".cache", "graphify-out", ".idea", ".vscode",
  // #1331 의존성·생성물(이름이 확실한 것 — 커밋돼 있어도 남의 코드). 실측: Flutter ios/Pods의 .h가 그래프를 차지
  "Pods", "Carthage", "DerivedData", ".dart_tool", ".pub-cache", ".gradle", "vendor", "__pycache__", ".mypy_cache", ".pytest_cache", // vendor = Go·PHP가 커밋해 두는 남의 코드(리뷰)
]);
// git이 없는 레포에서만 거르는 이름 — 진짜 소스 폴더 이름일 수도 있어 git 레포는 .gitignore에 맡김(리뷰)
const NOGIT_IGNORE = new Set(["target", "venv", ".venv"]);
// #1331 git 레포면 git이 보는 파일(추적 + 무시 안 된 새 파일)만 — 폴더마다 .gitignore·info/exclude를 그대로 따름.
// 반환: 허용 파일 집합 + 그 파일들이 든 폴더 집합(폴더째 건너뛰기용). git이 없거나 실패하면 null(기존 걷기 그대로).
// 한계: 요청 경로에서 동기 실행(기존 걷기도 동기) — 초대형 레포는 목록 받는 동안 서버가 잠깐 멈춤. 경로는 UTF-8로 읽음.
function gitVisible(root: string): { files: Set<string>; dirs: Set<string> } | null {
  if (!existsSync(join(root, ".git"))) return null;
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const files = new Set(out.split("\0").filter(Boolean));
    const dirs = new Set<string>([""]);
    for (const f of files) { let i = f.lastIndexOf("/"); while (i > 0) { const d = f.slice(0, i); if (dirs.has(d)) break; dirs.add(d); i = d.lastIndexOf("/"); } }
    return { files, dirs };
  } catch { return null; }
}
// 게임 엔진 자동 생성 폴더(#1003, 에픽 #1002) — 그 폴더가 엔진 프로젝트일 때만 바로 아래 이름을 제외.
// (Library/ 같은 이름은 다른 레포에선 진짜 코드일 수 있어 전역 무시 X.) 실측: Unity Library/PackageCache가
// 3000 상한 중 2904를 먹어 게임 코드가 밀려날 뻔.
export type Engine = "unity" | "unreal" | "godot";
const ENGINE_IGNORE: Record<Engine, Set<string>> = {
  // 소문자로 비교(리뷰) — Windows·macOS는 대소문자 무시 FS라 "library" 같은 폴더도 있을 수 있음.
  unity: new Set(["library", "temp", "obj", "logs", "usersettings", "build", "builds", "memorycaptures"]),
  unreal: new Set(["binaries", "intermediate", "saved", "deriveddatacache"]),
  godot: new Set([".godot", ".import"]),
};
// 한 폴더의 엔트리로 엔진 판별 — Unity: Assets/ + ProjectSettings/ 형제, Unreal: *.uproject, Godot: project.godot.
export function detectEngine(entries: Dirent[]): Engine | null {
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()));
  if (dirs.has("assets") && dirs.has("projectsettings")) return "unity";
  if (entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith(".uproject"))) return "unreal";
  if (entries.some((e) => e.isFile() && e.name.toLowerCase() === "project.godot")) return "godot";
  return null;
}

// .NET 프로젝트 빌드 산출물(#1007, 에픽 #1002-1c) — *.csproj/fsproj/vbproj 옆의 obj/·bin/만 제외. 엔진 루트 밖 순수 .NET
// 프로젝트(cooing sim/·tools/loadtest)도 대상. bin/은 다른 레포에선 실행 스크립트(진짜 코드)라 전역 무시 X.
const DOTNET_IGNORE = new Set(["obj", "bin"]);
export function isDotnetProject(entries: Dirent[]): boolean {
  return entries.some((e) => e.isFile() && /[^.]\.(cs|fs|vb)proj$/i.test(e.name));
}

// Unity 씬·프리팹·데이터 에셋(#1009) — 코드는 아니지만 "어떤 스크립트를 어디서 쓰나"가 여기 있음(graph.ts가 GUID로 연결).
const UNITY_ASSETS: ReadonlySet<string> = new Set(UNITY_ASSET_EXTS);
// 게임 에셋은 항상 "Unity 루트의 Assets/" 아래 — walk가 감지된 Unity 루트에서 Assets로 들어갈 때만 플래그를 켬(#1010 리뷰: 웹 레포
// src/assets/*.asset 오인 방지). ProjectSettings/*.asset(엔진 설정 20여 개)은 게임 구조 아님 → 제외.

// Godot 스크립트·씬·리소스(#1011) — project.godot 있는 폴더(Godot 루트)와 그 아래에서만(다른 레포 오인 방지, Unity와 같은 플래그 전파).
const GODOT_FILES: ReadonlySet<string> = new Set(GODOT_FILE_EXTS);

// 파일 수 상한 — 초대형 레포 방어(후속 최적화 전까지).
export const MAX_FILES = 3000;

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

export interface ScanResult {
  root: string;
  files: string[];   // 레포 루트 기준 상대경로(POSIX 구분자 "/")
  capped: boolean;   // 상한에 걸려 잘렸으면 true
  godotRoots?: string[]; // project.godot 있는 폴더들(레포 상대, 루트=""). res://의 기준(#1012 리뷰) — scanRepo만 채움
  engines: Engine[]; // 감지된 게임 엔진(#1003) — 레포 요약 등에 사용
}

// root 아래 지원 파일을 재귀 수집. IGNORE_DIRS·숨김폴더 제외, MAX_FILES 상한.
// #1331 코드 생성기 산출물(사람이 안 쓰는 파일) — 그래프에서 뺌. Dart build_runner·freezed·mockito, protobuf.
const GENERATED_RE = /\.(g|freezed|mocks|gr|config)\.dart$|\.pb(json|enum|server)?\.dart$|_pb2(_grpc)?\.py$|\.pb\.go$/i;

// #1335 설정 파일 — 이름 목록에 있고 1MiB 이하
const isConfigOk = (full: string, rel: string) => { if (!isConfigFile(rel)) return false; try { return statSync(full).size <= CONFIG_MAX_BYTES; } catch { return false; } };

export function scanRepo(root: string): ScanResult {
  const files: string[] = [];
  const engines = new Set<Engine>();
  const godotRoots: string[] = [];
  let capped = false;
  const vis = gitVisible(root);
  const subs: string[] = [];
  const inSub = (rel: string) => subs.some((s) => rel === s || rel.startsWith(`${s}/`));

  const walk = (dir: string, inUnityAssets = false, inGodot = false) => {
    if (capped) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 등 — 그 폴더만 건너뜀
    }
    const engine = detectEngine(entries);
    if (engine) engines.add(engine);
    const dotnet = isDotnetProject(entries);
    const godot = inGodot || engine === "godot";
    if (engine === "godot") godotRoots.push(relative(root, dir).split(sep).join("/"));
    for (const e of entries) {
      if (capped) return;
      const name = e.name;
      const full = join(dir, name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(name) || name.startsWith(".")) continue; // 숨김·무시 폴더 스킵
        if (engine && ENGINE_IGNORE[engine].has(name.toLowerCase())) continue; // 엔진 자동 생성 폴더(#1003)
        if (dotnet && DOTNET_IGNORE.has(name.toLowerCase())) continue; // .NET obj/bin(#1007)
        const rel = relative(root, full).split(sep).join("/");
        if (!vis && NOGIT_IGNORE.has(name)) continue;
        if (vis && !inSub(rel)) {
          if (vis.files.has(rel)) subs.push(rel); // 서브모듈(git은 폴더 하나로만 보여 줌) — 그 안은 거르지 않고 걸음(리뷰)
          else if (!vis.dirs.has(rel)) continue; // git이 안 보는 폴더(무시됨) — 통째로 건너뜀
        }
        walk(full, inUnityAssets || (engine === "unity" && name.toLowerCase() === "assets"), godot);
      } else if (e.isFile() && (!vis || vis.files.has(relative(root, full).split(sep).join("/")) || inSub(relative(root, full).split(sep).join("/"))) && !GENERATED_RE.test(name) && (SUPPORTED.has(ext(name)) || isConfigOk(full, relative(root, full).split(sep).join("/")) || (inUnityAssets && UNITY_ASSETS.has(ext(name))) || (godot && GODOT_FILES.has(ext(name))))) {
        files.push(relative(root, full).split(sep).join("/"));
        if (files.length >= MAX_FILES) { capped = true; return; }
      }
    }
  };
  walk(root);
  return { root, files, capped, engines: [...engines], godotRoots };
}

// 전체 파일(확장자 무관) — 워크스페이스 파일트리용(#647). IGNORE_DIRS·숨김 폴더는 제외하되
// 숨김 파일(.gitignore·.env 등)은 포함(에디터 트리 관례). MAX_FILES 상한.
export function scanAllFiles(root: string): ScanResult {
  const files: string[] = [];
  const engines = new Set<Engine>();
  let capped = false;
  const walk = (dir: string) => {
    if (capped) return;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const engine = detectEngine(entries);
    if (engine) engines.add(engine);
    const dotnet = isDotnetProject(entries);
    for (const e of entries) {
      if (capped) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        if (engine && ENGINE_IGNORE[engine].has(e.name.toLowerCase())) continue; // 엔진 자동 생성 폴더(#1003)
        if (dotnet && DOTNET_IGNORE.has(e.name.toLowerCase())) continue; // .NET obj/bin(#1007)
        walk(full);
      } else if (e.isFile()) {
        files.push(relative(root, full).split(sep).join("/"));
        if (files.length >= MAX_FILES) { capped = true; return; }
      }
    }
  };
  walk(root);
  return { root, files, capped, engines: [...engines] };
}

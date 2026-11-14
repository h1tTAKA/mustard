// 설정 파일 연결(#1335) — 매니페스트를 읽어 레포 안 것끼리만 잇기(외부 의존은 버림, 키 노드 없음). imports.ts 해석 재사용.
//  1. 워크스페이스 루트(package.json workspaces·pnpm-workspace.yaml·go.work) → 멤버 매니페스트 (contains)
//  2. 매니페스트 → 레포 안 형제 패키지 매니페스트 (imports) — package.json 의존·pubspec 의존이 레포 패키지 이름과 맞을 때
//  3. tsconfig/jsconfig → extends 대상 (extends)
//  4. 매니페스트 → 그 패키지 진입 파일 (imports) — 설정 노드가 외톨이로 남지 않게
//  5. Gradle settings → include한 모듈 build 파일 (contains)
//  6. 그래도 연결 없는 설정(eslint·next 설정, AndroidManifest, Info.plist 등) → 같은·위 폴더의 가장 가까운 매니페스트 (contains)
// 안 함: "tsconfig가 모든 .ts를 설정"(N×M 엣지).
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { RepoEdge } from "./types";
import { parseJsonc, tryResolve, resolveWorkspace } from "./imports.ts";
import { isConfigFile } from "./configFiles.ts";

type Pkgs = Map<string, { dir: string; entry?: string }>;
const read = (root: string, rel: string) => { try { return readFileSync(join(root, rel), "utf8"); } catch { return null; } };
const dirOf = (f: string) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "");
const at = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

// pubspec.yaml dependencies·dev_dependencies 블록의 패키지 이름(2칸 들여쓴 "이름:" 줄)
export function pubspecDeps(yaml: string): string[] {
  const out: string[] = [];
  let inDeps = false;
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) { inDeps = /^(dependencies|dev_dependencies|dependency_overrides):/.test(line); continue; }
    const m = inDeps ? /^ {2}([\w-]+):/.exec(line) : null;
    if (m) out.push(m[1]);
  }
  return out;
}
// go.work `use ./a` / `use ( ./a ./b )`
export function goWorkUses(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*use\s*\(([\s\S]*?)\)/gm)) for (const l of m[1].split("\n")) { const p = l.trim().split(/\s+/)[0]; if (p && !p.startsWith("//")) out.push(p); }
  for (const m of text.matchAll(/^\s*use\s+([^\s(]+)/gm)) out.push(m[1]);
  return out.map((p) => posix.normalize(p).replace(/^\.\/?/, "").replace(/\/$/, ""));
}

export function configEdges(root: string, files: string[], fileSet: Set<string>, wsPkgs: Pkgs, dartPkgs: Map<string, string>): RepoEdge[] {
  const edges: RepoEdge[] = [], seen = new Set<string>();
  const add = (source: string, target: string, relation: RepoEdge["relation"]) => {
    if (source === target || !fileSet.has(source) || !fileSet.has(target)) return;
    const k = `${source}|${target}|${relation}`;
    if (!seen.has(k)) { seen.add(k); edges.push({ source, target, relation }); }
  };
  // 1. 워크스페이스 루트 → 멤버
  const wsRoot = fileSet.has("pnpm-workspace.yaml") ? "pnpm-workspace.yaml" : "package.json";
  for (const { dir } of wsPkgs.values()) add(wsRoot, at(dir, "package.json"), "contains");
  const work = read(root, "go.work");
  if (work) for (const d of goWorkUses(work)) add("go.work", at(d, "go.mod"), "contains");

  for (const f of files) {
    const name = f.slice(f.lastIndexOf("/") + 1);
    const dir = dirOf(f);
    if (name === "package.json") {
      const pj = parseJsonc<Record<string, unknown>>(read(root, f) ?? "");
      if (!pj) continue;
      // 2. 레포 안 형제 패키지
      for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const deps = pj[key];
        if (deps && typeof deps === "object") for (const dep of Object.keys(deps)) { const p = wsPkgs.get(dep); if (p) add(f, at(p.dir, "package.json"), "imports"); }
      }
      // 4. 진입 파일 — 워크스페이스 패키지면 그 해석, 아니면 main/module/exports
      const own = typeof pj.name === "string" && wsPkgs.get(pj.name)?.dir === dir ? resolveWorkspace(pj.name, wsPkgs, fileSet) : null;
      const ex = pj.exports as unknown;
      const raw = [typeof ex === "string" ? ex : (ex as Record<string, unknown> | undefined)?.["."], pj.source, pj.module, pj.main].find((x): x is string => typeof x === "string");
      const entry = own ?? (raw ? tryResolve(posix.join(dir, raw.replace(/^\.\//, "")), fileSet) ?? tryResolve(posix.join(dir, raw.replace(/^\.\//, "").replace(/^(dist|lib|build)\//, "src/").replace(/\.(c|m)?js$/, "")), fileSet) : null);
      if (entry) add(f, entry, "imports");
    } else if (name === "pubspec.yaml") {
      const y = read(root, f) ?? "";
      for (const dep of pubspecDeps(y)) { const d = dartPkgs.get(dep); if (d != null) add(f, at(d, "pubspec.yaml"), "imports"); }
      const pkg = /^name:\s*([\w-]+)/m.exec(y)?.[1];
      const entry = [pkg && at(dir, `lib/${pkg}.dart`), at(dir, "lib/main.dart")].find((x): x is string => !!x && fileSet.has(x));
      if (entry) add(f, entry, "imports");
    } else if (/^(tsconfig(\.[\w-]+)?|jsconfig)\.json$/.test(name)) {
      // 3. extends(상대 경로만 — 패키지 이름 extends는 레포 밖)
      const cfg = parseJsonc<{ extends?: string | string[] }>(read(root, f) ?? "");
      for (const e of [cfg?.extends].flat()) {
        if (typeof e !== "string" || !e.startsWith(".")) continue;
        const p = posix.normalize(posix.join(dir, e.endsWith(".json") ? e : `${e}.json`));
        add(f, p, "extends");
      }
    } else if (/^settings\.gradle(\.kts)?$/.test(name)) {
      for (const m of (read(root, f) ?? "").matchAll(/include\s*\(?\s*((?:["'][:\w.-]+["']\s*,?\s*)+)/g)) {
        for (const q of m[1].matchAll(/["']:?([\w.:-]+)["']/g)) { const mod = q[1].replace(/:/g, "/"); for (const b of ["build.gradle.kts", "build.gradle"]) add(f, at(dir, `${mod}/${b}`), "contains"); }
      }
    } else if (name === "go.mod") {
      const entry = ["main.go", "cmd/main.go"].map((x) => at(dir, x)).find((x) => fileSet.has(x));
      if (entry) add(f, entry, "imports");
    }
  }
  // 6. 외톨이 설정 → 가장 가까운 매니페스트(같은 폴더면 자기 말고, 없으면 위로). 매니페스트가 하나도 없으면 그대로 둠.
  const MANIFEST = ["package.json", "pubspec.yaml", "go.mod", "Cargo.toml", "pyproject.toml", "composer.json", "pom.xml", "settings.gradle.kts", "settings.gradle", "build.gradle.kts", "build.gradle"];
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  for (const f of files) {
    if (linked.has(f) || !isConfigFile(f)) continue;
    let d = dirOf(f);
    for (;;) {
      const owner = MANIFEST.map((m) => at(d, m)).find((m) => m !== f && fileSet.has(m));
      if (owner) { add(owner, f, "contains"); break; }
      if (!d) break;
      d = dirOf(d);
    }
  }
  return edges;
}

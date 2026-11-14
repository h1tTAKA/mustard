// import 지정자 → 레포 내 파일 해석(#853) — 상대(./ ../) + tsconfig paths 별칭(@/* 등) + baseUrl bare.
// (상대만 해석하면 Next 앱의 @/ 별칭 import가 전부 엣지 0 → 그래프 반쪽.)
// 경량 모듈(node:path/fs만) — 단위테스트·재사용 쉽게 graph.ts서 분리.
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

const CANDIDATE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".kt", ".rb", ".rs", ".php", ".cs", ".c", ".cc", ".cpp", ".swift", ".dart", ".m", ".mm", ".h", ".lua", ".ex", ".exs", ".zig", ".sol", ".scala", ".vue", ".svelte"];
const INDEX_BASES = ["index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py"];

// tsconfig paths 별칭 규칙. pattern "@/*" → targets ["src/*","*"](baseUrl 기준 root-상대 접두).
export interface AliasConf { baseDir: string; rules: Array<{ prefix: string; suffix: string; wildcard: boolean; pattern: string; targets: string[] }> }

// 후보 경로(root-상대)를 확장자/인덱스로 fileSet서 찾기.
function tryResolve(base: string, fileSet: Set<string>): string | null {
  const b = posix.normalize(base).replace(/^\.?\//, "").replace(/^\/+/, "");
  for (const ext of CANDIDATE_EXTS) { const c = b + ext; if (fileSet.has(c)) return c; }
  for (const idx of INDEX_BASES) { const c = posix.join(b, idx); if (fileSet.has(c)) return c; }
  return null;
}

export function resolveImport(spec: string, fromFile: string, fileSet: Set<string>, alias?: AliasConf): string | null {
  if (spec.startsWith(".")) { // 상대
    return tryResolve(posix.join(posix.dirname(fromFile), spec), fileSet);
  }
  if (alias) {
    for (const r of alias.rules) { // tsconfig paths 별칭
      if (r.wildcard) {
        if (spec.length >= r.prefix.length + r.suffix.length && spec.startsWith(r.prefix) && spec.endsWith(r.suffix)) {
          const rest = spec.slice(r.prefix.length, spec.length - r.suffix.length);
          for (const t of r.targets) { const hit = tryResolve(posix.join(alias.baseDir, t.replace("*", rest)), fileSet); if (hit) return hit; }
        }
      } else if (spec === r.pattern) {
        for (const t of r.targets) { const hit = tryResolve(posix.join(alias.baseDir, t), fileSet); if (hit) return hit; }
      }
    }
    // baseUrl bare import(별칭 미매칭 시)
    const hit = tryResolve(posix.join(alias.baseDir, spec), fileSet); if (hit) return hit;
  }
  return null; // 패키지/외부
}

// Python bare import(#1005) — `import _health_route` / `from pkg.mod import x`(지정자 "pkg/mod"). 스크립트 폴더가
// sys.path에 들어가는 Python 동작 근사: 파일 폴더 → 상위 폴더들 → 레포 루트 순으로 a/b(.py|/__init__.py) 탐색.
// (상대 import는 resolveImport가 처리. 외부 패키지면 레포에 없으니 null.)
export function resolvePythonBare(spec: string, fromFile: string, fileSet: Set<string>): string | null {
  if (!spec || spec.startsWith(".")) return null;
  let dir = posix.dirname(fromFile);
  for (;;) {
    const hit = tryResolve(dir === "." ? spec : posix.join(dir, spec), fileSet);
    if (hit) return hit;
    if (dir === "." || dir === "") return null;
    const up = posix.dirname(dir);
    dir = up === dir ? "." : up;
  }
}

// JSONC(주석·후행쉼표) 관대 파싱.
function parseJsonc<T = unknown>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { /* strip 후 재시도 */ }
  try {
    const stripped = text.replace(/\/\/[^\n\r]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped) as T;
  } catch { return null; }
}

// #1331 모노레포 — 파일마다 가장 가까운 tsconfig/jsconfig(위로 올라가며) + extends 체인(상대 경로만). 폴더별 캐시.
// (전엔 레포 루트 설정만 읽어 apps/web/src의 @/ import가 전부 미해결 — mustard 자체도 고립 파일 91개.)
type Co = { baseUrl?: string; paths?: Record<string, string[]> };
function readCo(root: string, relCfg: string, depth = 0): { co: Co; dir: string } | null {
  let text: string;
  try { text = readFileSync(join(root, relCfg), "utf8"); } catch { return null; }
  const cfg = parseJsonc<{ extends?: string | string[]; compilerOptions?: Co }>(text);
  if (!cfg) return null;
  const dir = posix.dirname(relCfg) === "." ? "" : posix.dirname(relCfg);
  let base: { co: Co; dir: string } | null = null;
  const ext = Array.isArray(cfg.extends) ? cfg.extends[cfg.extends.length - 1] : cfg.extends;
  if (ext && depth < 5 && ext.startsWith(".")) { const p = posix.normalize(posix.join(dir, ext.endsWith(".json") ? ext : `${ext}.json`)); if (!p.startsWith("..")) base = readCo(root, p, depth + 1); }
  const co = cfg.compilerOptions ?? {};
  // baseUrl·paths는 그것을 적은 설정 파일 폴더 기준 — 자식에 없으면 부모 것을(부모 폴더 기준) 물려받음
  // paths만 있고 baseUrl은 부모에 있으면 — TS는 그 paths를 부모 baseUrl 기준으로 풂(리뷰)
  if (co.paths && !co.baseUrl && base?.co.baseUrl) return { co: { paths: co.paths, baseUrl: posix.relative(dir, posix.join(base.dir, base.co.baseUrl)) || "." }, dir };
  if (co.paths || co.baseUrl) return { co, dir };
  return base ?? { co: {}, dir };
}
function toAlias(co: Co, dir: string): AliasConf | null {
  const baseDir = posix.normalize(posix.join(dir, co.baseUrl ?? ".")).replace(/^\.$/, "");
  const rules: AliasConf["rules"] = [];
  for (const [pattern, targets] of Object.entries(co.paths ?? {})) {
    const star = pattern.indexOf("*");
    const wildcard = star >= 0 && star === pattern.lastIndexOf("*"); // 정확히 1개만 와일드카드 취급(다중 *는 exact로, 오해석 방지)
    rules.push({ prefix: wildcard ? pattern.slice(0, star) : "", suffix: wildcard ? pattern.slice(star + 1) : "", wildcard, pattern, targets: (targets ?? []).map((t) => t.replace(/^\.\//, "")) });
  }
  return rules.length || co.baseUrl ? { baseDir, rules } : null;
}
export function aliasFinder(root: string): (file: string) => AliasConf | null {
  const byDir = new Map<string, AliasConf | null>();
  const at = (dir: string): AliasConf | null => {
    const hit = byDir.get(dir);
    if (hit !== undefined) return hit;
    let found: AliasConf | null | undefined;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const r = readCo(root, dir ? `${dir}/${name}` : name);
      if (r) { found = toAlias(r.co, r.dir); break; }
    }
    if (found === undefined) found = dir ? at(posix.dirname(dir) === "." ? "" : posix.dirname(dir)) : null; // 설정 없으면 위 폴더 것
    byDir.set(dir, found);
    return found;
  };
  return (file) => at(posix.dirname(file) === "." ? "" : posix.dirname(file));
}

// #1331 워크스페이스 패키지 — package.json workspaces(배열·{packages}) / pnpm-workspace.yaml 의 "폴더/*"·정확한 폴더 → 패키지 이름 → 폴더.
export function workspacePackages(root: string): Map<string, { dir: string; entry?: string }> {
  const out = new Map<string, { dir: string; entry?: string }>();
  const globs: string[] = [];
  try { const pj = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); const w = pj.workspaces; globs.push(...(Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : [])); } catch { /* 없음 */ }
  try { const y = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"); for (const m of y.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)) globs.push(m[1]); } catch { /* 없음 */ }
  const dirs: string[] = [];
  for (const g of globs) {
    if (g.startsWith("!")) continue;
    const clean = g.replace(/\/+$/, "");
    if (clean.endsWith("/*")) { const parent = clean.slice(0, -2); try { for (const e of readdirSync(join(root, parent), { withFileTypes: true })) if (e.isDirectory()) dirs.push(`${parent}/${e.name}`); } catch { /* 없음 */ } }
    else if (!clean.includes("*")) dirs.push(clean);
  }
  for (const d of dirs) {
    try {
      const pj = JSON.parse(readFileSync(join(root, d, "package.json"), "utf8"));
      if (typeof pj.name !== "string") continue;
      const ex = typeof pj.exports === "string" ? pj.exports : typeof pj.exports?.["."] === "string" ? pj.exports["."] : pj.exports?.["."]?.import ?? pj.exports?.["."]?.default;
      const entry = [ex, pj.source, pj.module, pj.main, pj.types].find((x) => typeof x === "string") as string | undefined;
      out.set(pj.name, { dir: d, ...(entry ? { entry: entry.replace(/^\.\//, "") } : {}) });
    } catch { /* package.json 없음 */ }
  }
  return out;
}
// `@scope/pkg` / `@scope/pkg/sub` → 그 워크스페이스 패키지의 파일(진입 파일·src/index·sub·src/sub 순).
export function resolveWorkspace(spec: string, pkgs: Map<string, { dir: string; entry?: string }>, fileSet: Set<string>): string | null {
  let best = "";
  for (const name of pkgs.keys()) if ((spec === name || spec.startsWith(`${name}/`)) && name.length > best.length) best = name;
  if (!best) return null;
  const { dir, entry } = pkgs.get(best)!;
  const rest = spec.slice(best.length + 1);
  const cands = rest ? [posix.join(dir, rest), posix.join(dir, "src", rest)] : [...(entry ? [posix.join(dir, entry), posix.join(dir, entry.replace(/^(dist|lib|build)\//, "src/").replace(/\.(c|m)?js$/, ""))] : []), posix.join(dir, "src/index"), posix.join(dir, "index")];
  for (const c of cands) { const hit = tryResolve(c, fileSet); if (hit) return hit; }
  return null;
}

// tsconfig/jsconfig의 baseUrl + paths → AliasConf(root-상대). 레포 루트 설정만(호환용 — 그래프는 aliasFinder를 씀).
export function loadAliases(root: string): AliasConf | null {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    let text: string;
    try { text = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const cfg = parseJsonc<{ compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }>(text);
    const co = cfg?.compilerOptions;
    if (!co) continue;
    const baseDir = posix.normalize(co.baseUrl ?? ".").replace(/^\.\/?$/, "").replace(/^\.\//, "");
    const rules: AliasConf["rules"] = [];
    for (const [pattern, targets] of Object.entries(co.paths ?? {})) {
      const star = pattern.indexOf("*");
      const wildcard = star >= 0 && star === pattern.lastIndexOf("*"); // 정확히 1개만 와일드카드 취급(다중 *는 exact로, 오해석 방지)
      const prefix = wildcard ? pattern.slice(0, star) : "";
      const suffix = wildcard ? pattern.slice(star + 1) : "";
      rules.push({ prefix, suffix, wildcard, pattern, targets: (targets ?? []).map((t) => t.replace(/^\.\//, "")) });
    }
    if (rules.length || co.baseUrl) return { baseDir, rules };
  }
  return null;
}

// ── JVM(Java·Kotlin)·Go import(#1023) ──────────────────────────────────────────
// 둘 다 상대경로가 아니라 "패키지 경로"로 import → resolveImport(상대·tsconfig)로는 0건이었음(gson 264·cobra 36 전부 외톨이).
// 폴더 → 그 폴더 파일들 인덱스(언어별 정규식). 그래프 빌드당 1회.
export function dirIndex(files: string[], re: RegExp): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const f of files) {
    if (!re.test(f)) continue;
    const d = posix.dirname(f) === "." ? "" : posix.dirname(f);
    const a = m.get(d);
    if (a) a.push(f); else m.set(d, [f]);
  }
  return m;
}
export const JVM_RE = /\.(java|kt|kts|scala|sc)$/i;
export const SWIFT_RE = /\.swift$/i;
export const GO_RE = /\.go$/i;
const noExt = (f: string) => f.replace(/\.[^./]+$/, "");

// Java/Kotlin `import com.x.Foo`(지정자 "com/x/Foo") → 경로가 /com/x/Foo.(java|kt)로 끝나는 파일(src/main/java 등 소스 루트 무관).
// static import `com.x.Foo.bar` → 마지막 조각 떼고 재시도. 와일드카드 `com.x.*`(지정자 "com/x/") → 그 패키지 폴더 파일들.
export function resolveJvmImport(spec: string, jvmDirs: Map<string, string[]>): string[] {
  const s = spec.replace(/\/+$/, "");
  if (!s) return [];
  // 같은 패키지가 여러 소스 루트에 있을 수 있음(src/main·src/test) → 일치하는 폴더 전부.
  const pkgFiles = (pkg: string) => {
    const out: string[] = [];
    for (const [d, fs] of jvmDirs) if (d === pkg || d.endsWith(`/${pkg}`)) out.push(...fs);
    return out;
  };
  if (spec.endsWith("/")) return pkgFiles(s); // com.x.* (추출기가 * 앞 "com.x."까지 잡음)
  const segs = s.split("/");
  for (let n = segs.length; n >= 2; n--) {
    const cls = segs.slice(0, n).join("/");
    const dir = segs.slice(0, n - 1).join("/");
    const hit = pkgFiles(dir).find((f) => noExt(f) === cls || noExt(f).endsWith(`/${cls}`));
    if (hit) return [hit];
  }
  return [];
}

// Dart(#1331) — 레포 안 패키지 이름 → 패키지 폴더. `<폴더>/lib/` 아래 dart 파일이 있는 폴더의 pubspec.yaml `name:`(모노레포 여러 패키지).
export function dartPackages(root: string, files: string[]): Map<string, string> {
  const dirs = new Set<string>();
  for (const f of files) { if (!f.endsWith(".dart")) continue; const i = f.startsWith("lib/") ? 0 : f.indexOf("/lib/"); if (i >= 0) dirs.add(i === 0 ? "" : f.slice(0, i)); }
  const out = new Map<string, string>();
  for (const d of dirs) {
    try { const name = /^name:\s*([\w-]+)/m.exec(readFileSync(join(root, d, "pubspec.yaml"), "utf8"))?.[1]; if (name) out.set(name, d); } catch { /* pubspec 없음 */ }
  }
  return out;
}
// `package:이름/경로.dart` → `<패키지 폴더>/lib/경로.dart`(레포 밖 패키지면 null).
export function resolveDartPackage(spec: string, pkgs: Map<string, string>, fileSet: Set<string>): string | null {
  const m = /^package:([\w-]+)\/(.+)$/.exec(spec);
  if (!m) return null;
  const dir = pkgs.get(m[1]);
  if (dir == null) return null;
  const p = (dir ? `${dir}/` : "") + `lib/${m[2]}`;
  return fileSet.has(p) ? p : null;
}

// #1331 Elixir `My.App.User` → 경로가 my/app/user.ex(s)로 끝나는 파일(lib/ 등 루트 무관).
export function resolveElixir(spec: string, files: string[]): string | null {
  const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const segs = spec.replace(/^ex:/, "").split(".").map(snake);
  // 전체 모듈 경로로만(앞 조각을 떼면 Ecto.Repo가 앱의 repo.ex에 붙는 등 엉뚱한 연결, 리뷰)
  const tail = segs.join("/");
  return files.find((f) => /\.exs?$/.test(f) && (noExt(f) === tail || noExt(f).endsWith(`/${tail}`))) ?? null;
}

// go.mod `module github.com/x/y` → 모듈 경로.
export function goModulePath(gomod: string): string | null {
  return /^\s*module\s+(\S+)/m.exec(gomod)?.[1] ?? null;
}
// Go `import "github.com/x/y/sub"` → 모듈 경로를 뗀 폴더(sub)의 .go 파일 전부(Go 패키지 = 폴더). 외부 모듈이면 [].
export function resolveGoImport(spec: string, module: string | null, goDirs: Map<string, string[]>): string[] {
  if (!module || (spec !== module && !spec.startsWith(`${module}/`))) return [];
  return goDirs.get(spec === module ? "" : spec.slice(module.length + 1)) ?? [];
}

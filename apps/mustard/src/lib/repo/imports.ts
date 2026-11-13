// import 지정자 → 레포 내 파일 해석(#853) — 상대(./ ../) + tsconfig paths 별칭(@/* 등) + baseUrl bare.
// (상대만 해석하면 Next 앱의 @/ 별칭 import가 전부 엣지 0 → 그래프 반쪽.)
// 경량 모듈(node:path/fs만) — 단위테스트·재사용 쉽게 graph.ts서 분리.
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

const CANDIDATE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".kt", ".rb", ".rs", ".php", ".cs", ".c", ".cc", ".cpp", ".swift"];
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

// tsconfig/jsconfig의 baseUrl + paths → AliasConf(root-상대). extends는 미추적(루트 설정만, 대부분 충분).
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
export const JVM_RE = /\.(java|kt|kts)$/i;
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

// go.mod `module github.com/x/y` → 모듈 경로.
export function goModulePath(gomod: string): string | null {
  return /^\s*module\s+(\S+)/m.exec(gomod)?.[1] ?? null;
}
// Go `import "github.com/x/y/sub"` → 모듈 경로를 뗀 폴더(sub)의 .go 파일 전부(Go 패키지 = 폴더). 외부 모듈이면 [].
export function resolveGoImport(spec: string, module: string | null, goDirs: Map<string, string[]>): string[] {
  if (!module || (spec !== module && !spec.startsWith(`${module}/`))) return [];
  return goDirs.get(spec === module ? "" : spec.slice(module.length + 1)) ?? [];
}

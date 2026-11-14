// 코드 그래프 파일 수 상한(#1338) — 서버 파일 하나가 기준(그래프 빌드·연결·요약·MCP가 모두 서버 scanRepo라 화면마다 다르면 캐시가 엇갈림).
// 설정 화면은 /api/repo/codegraph/limit로 읽고 씀. 프로세스 메모리에 캐시(설정 바꾸면 바로 갱신).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const LIMIT_DEFAULT = 20000, LIMIT_MIN = 500, LIMIT_MAX = 200000;
const FILE = () => join(process.env.MUSTARD_CODEGRAPH_DIR || join(homedir(), ".nunopi", "codegraph"), "limit.json");
const g = globalThis as unknown as { __mustardGraphLimit?: number };
export const clampLimit = (n: number) => Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(n)));

export function graphMaxFiles(): number {
  if (g.__mustardGraphLimit == null) {
    try { const n = Number(JSON.parse(readFileSync(FILE(), "utf8"))?.maxFiles); g.__mustardGraphLimit = Number.isFinite(n) ? clampLimit(n) : LIMIT_DEFAULT; } catch { g.__mustardGraphLimit = LIMIT_DEFAULT; }
  }
  return g.__mustardGraphLimit;
}
export function setGraphMaxFiles(n: number): number {
  const v = clampLimit(n);
  g.__mustardGraphLimit = v;
  try { mkdirSync(dirname(FILE()), { recursive: true }); writeFileSync(FILE(), JSON.stringify({ maxFiles: v })); } catch { /* 메모리 값은 유지 */ }
  return v;
}

// 넘을 때 남길 순서 — 낮을수록 먼저. 소스 폴더 0, 그 밖 1, 테스트·예제·문서·스크립트 2.
const SRC = new Set(["src", "lib", "app", "apps", "packages", "cmd", "internal", "pkg", "core", "server", "client", "components", "pages", "routes", "sources"]);
const LOW = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e", "fixtures", "__fixtures__", "examples", "example", "samples", "sample", "docs", "doc", "demo", "demos", "benchmarks", "bench", "scripts", "tools", "__mocks__", "mocks", "stories", "storybook"]);
export function filePriority(rel: string): number {
  const segs = rel.split("/");
  const name = segs.pop()!;
  if (segs.some((s) => LOW.has(s.toLowerCase())) || /\.(test|spec|stories)\.[^.]+$|_test\.(go|py|dart)$|^test_.*\.py$/i.test(name)) return 2;
  return segs.some((s) => SRC.has(s.toLowerCase())) ? 0 : 1;
}

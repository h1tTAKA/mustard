// 아키텍처 분석 결과 저장(#1320) — 서버(Node) 전용. 기능 목록·기능별 흐름을 레포별 파일 하나에.
// 전엔 브라우저 localStorage라 MCP·Crew가 못 읽었음. 저장할 때 파일 스냅샷(incremental.ts)을 같이 둬서 "그 뒤로 뭐가 바뀌었나" 계산.
// 위치: ~/.nunopi/arch/<sha(root)>.json. 원자적 쓰기(tmp → rename).
// 한계: 흐름마다 스냅샷(파일 수 × 약 40바이트)을 따로 들고 있음 — 3000파일 레포 흐름 20개면 수 MB. 커지면 스냅샷 공유로.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadOrBuildGraph } from "./loadGraph";
import { readFileCache, canonRoot } from "./graphStore";
import { snapOf, diffSnap, type Snap, type SnapDiff } from "./incremental";

export type ArchFlowNode = { name: string; file?: string; line?: number; role?: string; next?: string[] };
export type ArchSection = { layer: string; nodes: ArchFlowNode[] };
export type ArchCategory = { id: string; title: string; blurb?: string };
// 흐름의 덧붙임(#1322) — 깊이별 설명글(overview 자체는 초보용 기본), 둘러보기 단계. 흐름(노드)이 바뀌면 같이 버림.
export type ArchExtras = { overviews?: { dev?: string; expert?: string }; tour?: { depth: string; steps: { name: string; text: string }[] } };
// snap 없음 = 예전 브라우저 저장분을 옮긴 것(언제 분석했는지 모름) → 차분 없이 옛 방식 갱신.
// 덧붙임 모양 검사(리뷰) — API로 들어온 값만 골라 담음. 잘못된 모양이 저장돼 읽는 쪽(화면·MCP)이 터지지 않게.
export function cleanExtras(x: unknown): ArchExtras {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const out: ArchExtras = {};
  const ov = (o.overviews && typeof o.overviews === "object" ? o.overviews : {}) as Record<string, unknown>;
  const overviews = Object.fromEntries((["dev", "expert"] as const).filter((k) => typeof ov[k] === "string").map((k) => [k, ov[k] as string]));
  if (Object.keys(overviews).length) out.overviews = overviews;
  const tour = o.tour as { depth?: unknown; steps?: unknown } | undefined;
  if (tour && typeof tour === "object" && typeof tour.depth === "string" && Array.isArray(tour.steps)) {
    out.tour = { depth: tour.depth, steps: (tour.steps as { name?: unknown; text?: unknown }[]).filter((s) => typeof s?.name === "string" && typeof s?.text === "string") as { name: string; text: string }[] };
  }
  return out;
}
export interface ArchFlow extends ArchExtras { sections: ArchSection[]; overview: string | null; snap?: Snap; at: number }
export interface ArchCats { items: ArchCategory[]; snap?: Snap; at: number }
export interface ArchFile { v: 1; cats?: ArchCats; flows: Record<string, ArchFlow> }

const DIR = join(homedir(), ".nunopi", "arch");
// 레포 경로 정규화 — 화면(작업공간 경로)과 MCP(cwd에서 찾은 루트)가 같은 파일을 보게(리뷰).
const pathOf = (root: string) => join(DIR, `${createHash("sha256").update(canonRoot(root)).digest("hex").slice(0, 32)}.json`);

// flows는 사용자 문자열(기능 이름)이 키 — "constructor"·"__proto__" 같은 이름이 프로토타입과 섞이지 않게(리뷰).
export const getFlow = (f: ArchFile, name: string): ArchFlow | undefined => (Object.hasOwn(f.flows, name) ? f.flows[name] : undefined);
export function setFlow(f: ArchFile, name: string, v: ArchFlow): void {
  Object.defineProperty(f.flows, name, { value: v, enumerable: true, writable: true, configurable: true });
}

export function readArch(root: string): ArchFile {
  try {
    const j = JSON.parse(readFileSync(pathOf(root), "utf8")) as ArchFile;
    if (j?.v === 1 && j.flows && typeof j.flows === "object") return j;
  } catch { /* 없음·손상 → 빈 것 */ }
  return { v: 1, flows: {} };
}

export function writeArch(root: string, f: ArchFile): void {
  mkdirSync(DIR, { recursive: true });
  const dest = pathOf(root);
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(f));
  renameSync(tmp, dest);
}

// 지금 코드 스냅샷 — 그래프를 (캐시면 즉시) 맞춘 뒤 파일별 파싱 캐시에서.
export async function currentSnap(root: string): Promise<Snap> {
  await loadOrBuildGraph(root);
  return snapOf(readFileCache(root));
}

// 분석 시작 시점 스냅샷 보관(#1320 리뷰) — AI가 몇 분 도는 사이 고친 파일이 "분석함"으로 찍히지 않게, 저장 때 시작 시점 것을 씀.
// 서버 메모리라 재시작하면 사라짐 → 그땐 저장 시점 스냅샷으로(예전과 같음). 최근 20개만.
const begun = new Map<string, Snap>();
export function beginSnap(snap: Snap): string {
  const token = createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16);
  begun.set(token, snap);
  while (begun.size > 20) begun.delete(begun.keys().next().value as string);
  return token;
}
export function takeSnap(token: unknown): Snap | undefined {
  if (typeof token !== "string") return undefined;
  const s = begun.get(token); begun.delete(token); return s;
}

// 저장분이 있으면 지금과 비교한 차분, 없으면 null.
// 지금 스냅샷이 비었으면(파싱 캐시 없음·손상) 비교 불가 → null(전부 "지워짐"으로 오판해 흐름을 비우지 않게, 리뷰).
export const diffFrom = (saved: { snap?: Snap } | undefined, cur: Snap): SnapDiff | null =>
  saved?.snap && Object.keys(cur).length ? diffSnap(saved.snap, cur) : null;

// 차분 갱신 프롬프트용 파일 뼈대 — 파일별 심볼(줄·종류·이름·시그니처). 파일 30개·파일당 40개 상한(토큰 방어).
export async function fileSkeletons(root: string, files: string[]): Promise<string> {
  const { graph } = await loadOrBuildGraph(root);
  const want = new Set(files.slice(0, 30));
  const by = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.kind === "file" || !want.has(n.file)) continue;
    const a = by.get(n.file) ?? [];
    if (a.length < 40) a.push(`  ${n.line ?? "?"}: ${n.kind} ${n.label}${n.signature ? ` ${n.signature}` : ""}`);
    by.set(n.file, a);
  }
  return [...want].map((f) => `${f}\n${(by.get(f) ?? ["  (심볼 없음)"]).join("\n")}`).join("\n");
}

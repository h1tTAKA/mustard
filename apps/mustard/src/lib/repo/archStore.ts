// 아키텍처 분석 결과 저장(#1320) — 서버(Node) 전용. 기능 목록·기능별 흐름을 레포별 파일 하나에.
// 전엔 브라우저 localStorage라 MCP·Crew가 못 읽었음. 저장할 때 파일 스냅샷(incremental.ts)을 같이 둬서 "그 뒤로 뭐가 바뀌었나" 계산.
// 위치: ~/.nunopi/arch/<sha(root)>.json. 원자적 쓰기(tmp → rename).
// 한계: 흐름마다 스냅샷(파일 수 × 약 40바이트)을 따로 들고 있음 — 3000파일 레포 흐름 20개면 수 MB. 커지면 스냅샷 공유로.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadOrBuildGraph } from "./loadGraph";
import { readFileCache } from "./graphStore";
import { snapOf, diffSnap, type Snap, type SnapDiff } from "./incremental";

export type ArchFlowNode = { name: string; file?: string; line?: number; role?: string; next?: string[] };
export type ArchSection = { layer: string; nodes: ArchFlowNode[] };
export type ArchCategory = { id: string; title: string; blurb?: string };
export interface ArchFlow { sections: ArchSection[]; overview: string | null; snap: Snap; at: number }
export interface ArchCats { items: ArchCategory[]; snap: Snap; at: number }
export interface ArchFile { v: 1; cats?: ArchCats; flows: Record<string, ArchFlow> }

const DIR = join(homedir(), ".nunopi", "arch");
const pathOf = (root: string) => join(DIR, `${createHash("sha256").update(root).digest("hex").slice(0, 32)}.json`);

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

// 저장분이 있으면 지금과 비교한 차분, 없으면 null.
export const diffFrom = (saved: { snap?: Snap } | undefined, cur: Snap): SnapDiff | null => (saved?.snap ? diffSnap(saved.snap, cur) : null);

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

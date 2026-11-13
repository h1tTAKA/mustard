// 코드 그래프 저장·freshness(#842 서브2) — 서버(Node) 전용. graph.json을 레포별 중앙 캐시에 저장.
// fingerprint(스캔 파일 mtime 해시)로 변경 감지 → 안 바뀌면 캐시 재사용(빌드 스킵). 레포에 파일 안 남김(중앙 캐시).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { scanRepo } from "./scan";
import { isUnityAsset, underUnityAssets } from "./unityAssets";
import type { RepoGraph } from "./types";
import { PARSE_V, type FileCache } from "./incremental";

const CACHE_DIR = join(homedir(), ".nunopi", "codegraph");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
function cachePath(root: string): string { return join(CACHE_DIR, `${sha(root)}.json`); }

// 지문 — 파일들의 "rel:mtime" 정렬 해시. 파싱 없이 빠름(stat). 어떤 파일이라도 바뀌면 달라짐.
// 이미 스캔한 files를 재사용(라우트서 스캔 1회 → build와 공유, #845 🟡). 독립 사용은 fingerprintRepo.
export function fingerprintFromScan(root: string, files: string[]): string {
  const parts: string[] = [];
  for (const rel of files) {
    let mt = 0;
    try { mt = statSync(join(root, rel)).mtimeMs; } catch { /* 삭제 레이스 — 0 */ }
    parts.push(`${rel}:${mt}`);
  }
  // Unity(#1010 리뷰): 그래프가 .meta GUID로 연결되므로 .meta 변경(GUID 재생성 등)도 재빌드 사유. Unity 에셋 있는 레포만.
  if (files.some(isUnityAsset)) {
    for (const rel of files) {
      if (!underUnityAssets(rel)) continue;
      try { parts.push(`${rel}.meta:${statSync(join(root, `${rel}.meta`)).mtimeMs}`); } catch { /* meta 없음 */ }
    }
  }
  parts.sort();
  parts.push(`parse:${PARSE_V}`); // 추출기 버전이 바뀌면 파일이 그대로여도 다시 빌드(#1320 리뷰)
  return sha(parts.join("\n"));
}
// 독립 호출용(스캔 포함).
export function fingerprintRepo(root: string): string {
  return fingerprintFromScan(root, scanRepo(root).files);
}

interface Cached { fingerprint: string; builtAt: number; graph: RepoGraph }

/** 캐시된 그래프 로드(없거나 손상이면 null). */
export function readCachedGraph(root: string): Cached | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(root), "utf8")) as Cached;
    // RepoGraph는 nodes/edges 배열이 JSON. 그대로 사용.
    if (c && typeof c.fingerprint === "string" && c.graph) return c;
    return null;
  } catch { return null; }
}

/** 그래프+지문 저장(중앙 캐시). builtAt=저장 시각(호출부가 stamp — Date.now 금지 환경 대비 인자). */
export function writeCachedGraph(root: string, fingerprint: string, graph: RepoGraph, builtAt: number): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    // 원자적 쓰기(🟡) — temp에 쓰고 rename. 동시 read가 잘린 JSON을 읽는 일 방지.
    const dest = cachePath(root);
    const tmp = `${dest}.${sha(`${builtAt}:${fingerprint}`).slice(0, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify({ fingerprint, builtAt, graph } satisfies Cached));
    renameSync(tmp, dest);
  } catch { /* 캐시 실패는 치명적 아님 — 다음 빌드서 재시도 */ }
}

// #1320 파일별 파싱 캐시(incremental.ts) — 그래프 캐시 옆 <sha>.files.json. 형식 다르거나 없으면 빈 캐시(첫 빌드처럼).
const FILES_V = 1;
function filesPath(root: string): string { return join(CACHE_DIR, `${sha(root)}.files.json`); }
export function readFileCache(root: string): FileCache {
  try {
    const c = JSON.parse(readFileSync(filesPath(root), "utf8")) as { v?: number; files?: FileCache };
    return c?.v === FILES_V && c.files && typeof c.files === "object" ? c.files : {};
  } catch { return {}; }
}
export function writeFileCache(root: string, files: FileCache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const dest = filesPath(root);
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: FILES_V, files }));
    renameSync(tmp, dest);
  } catch { /* 캐시 실패는 치명적 아님 — 다음 빌드가 전부 파싱 */ }
}

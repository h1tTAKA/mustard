// 파일별 파싱 캐시(#1320) — 그래프 재빌드 때 내용이 안 바뀐 파일은 지난 파싱 결과(import 지정자·심볼)를 재사용.
// 비싼 건 tree-sitter 심볼 추출이라 내용 해시가 같으면 그것만 건너뜀(graph.ts). 파일 사이 패스는 매번 전체(싸고, 다른 파일 변화에 의존).
// 저장: ~/.nunopi/codegraph/<sha(root)>.files.json(graphStore.ts). 여기는 fs 없는 순수 함수만(점검 쉬움).
import { createHash } from "node:crypto";
import type { SymbolInfo, RawCall, RawHeritage } from "./symbols";
import type { RepoNode, RepoEdge } from "./types";

export interface Extracted { symbols: SymbolInfo[]; nodes: RepoNode[]; contains: RepoEdge[]; calls: RawCall[]; heritage: RawHeritage[] }
export interface ParsedFile {
  hash: string;     // 내용 해시 — 같으면 재사용
  sig: string;      // 구조 서명(import + 심볼 이름·종류·소속·시그니처) — 주석·본문만 바뀌면 그대로
  specs?: string[]; // import 지정자(언어 미지원이면 없음)
  ex?: Extracted;   // 심볼 추출 결과(에셋·GDScript 등 건너뛴 파일은 없음)
}
export type FileCache = Record<string, ParsedFile>; // rel 경로 → 파싱 결과

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
// 추출기(언어 파서·심볼 규칙·서명 규칙)를 고치면 이 값을 올림 → 모든 파일 해시가 달라져 한 번 전부 다시 파싱(리뷰).
export const PARSE_V = "5"; // 2~5: #1331 Dart·Ruby 정규식 심볼·Dart import·언어 확장·문자열/주석 처리 수정
export const fileHash = (text: string) => h16(`${PARSE_V}\n${text}`);

// 구조 서명 — 줄 번호·본문은 빼고 "밖에서 보이는 모양"만. 이게 같으면 흐름·기능 목록을 LLM에 다시 물을 이유 없음.
export function fileSig(specs: string[] | undefined, symbols: SymbolInfo[] | undefined): string {
  const imp = [...(specs ?? [])].sort();
  const sym = (symbols ?? []).map((s) => `${s.kind}:${s.owner ?? ""}.${s.name}${s.signature ?? ""}`).sort();
  return h16(`${imp.join("\n")}\n--\n${sym.join("\n")}`);
}

// 스냅샷 — 파일별 [내용 해시, 구조 서명]. 분석 결과(기능 목록·흐름)와 같이 저장해 두고 나중에 지금 것과 비교.
export type Snap = Record<string, [string, string]>;
export function snapOf(cache: FileCache): Snap {
  const out: Snap = {};
  for (const [rel, f] of Object.entries(cache)) out[rel] = [f.hash, f.sig];
  return out;
}

// 두 스냅샷 비교. changed=내용이 다르거나 새 파일, structural=구조 서명이 다르거나 새 파일, removed=없어진 파일.
export interface SnapDiff { changed: string[]; structural: string[]; removed: string[] }
// 새 파일이라도 import·심볼이 하나도 없으면(빈 파일·상수만 등) 구조 변화로 안 침 — "구조 0이면 AI 안 부름"을 지키려고(리뷰).
// 스캔은 추출기가 있는 언어 + 엔진 에셋(서명=내용 해시)만 담아서, 추출기 없는 언어 파일이 여기서 빠지는 일은 없음.
const EMPTY_SIG = fileSig(undefined, undefined);
export function diffSnap(old: Snap, cur: Snap): SnapDiff {
  const changed: string[] = [], structural: string[] = [], removed: string[] = [];
  for (const [rel, [h, s]] of Object.entries(cur)) {
    const o = Object.hasOwn(old, rel) ? old[rel] : undefined;
    if (!o || o[0] !== h) changed.push(rel);
    if (o ? o[1] !== s : s !== EMPTY_SIG) structural.push(rel);
  }
  for (const rel of Object.keys(old)) if (!Object.hasOwn(cur, rel)) removed.push(rel);
  return { changed: changed.sort(), structural: structural.sort(), removed: removed.sort() };
}

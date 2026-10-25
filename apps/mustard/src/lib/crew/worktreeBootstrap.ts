// worktree 부트스트랩 설정(#1176) — 새 worktree에 setup 스크립트·Git에 안 올라가는 파일 복사·폴더 공유.
// Orca(orca.yaml + .worktreeinclude)와 같은 규칙. 설정 파일만 YAML 대신 JSON(.mustard/config.json, 의존성 없이) — 키 이름은 Orca와 같게.
// 서버 전용. 이 파일은 읽기·검증만(실제 복사·실행은 다음 커밋).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_PATH = join(".mustard", "config.json");
export const INCLUDE_FILE = ".worktreeinclude";
const MAX_FILE = 256 * 1024;   // 설정·include 파일 전체 한도(Orca와 같음) — 넘으면 통째로 무시
const MAX_FIELD = 64 * 1024;   // 문자열 필드 한도 — 넘으면 그 필드만 버림
const MAX_SHARED = 100;        // sharedDirectories 앞 100개만
const MAX_INCLUDE = 1000;      // .worktreeinclude 유효 경로 1000개까지

export interface BootstrapConfig {
  setup?: string;                                   // scripts.setup — 새 worktree에서 실행
  archive?: string;                                 // scripts.archive — worktree 지우기 전에 실행
  startup?: "start-immediately" | "wait-for-setup"; // setupAgentStartupPolicy(Crew는 항상 기다림 — 사람용 작업공간에서 씀)
  sharedDirectories: string[];                      // worktree.sharedDirectories — 메인 체크아웃 폴더로 링크
}

// 레포 기준 상대 경로 정리 — 역슬래시→/, 앞 ./·뒤 / 제거. 절대 경로·드라이브·빈 조각·./..·.git 조각이면 null(Orca와 같은 거부 규칙).
export function normRel(raw: string): string | null {
  let p = raw.trim().replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/\/+$/, "");
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === ".." || s.toLowerCase() === ".git")) return null;
  return p;
}

const str = (v: unknown): string | undefined => {
  if (typeof v !== "string" || Buffer.byteLength(v) > MAX_FIELD) return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

// .mustard/config.json 파싱 — 잘못된 필드는 버리고 나머지는 적용. JSON이 깨졌거나 너무 크면 빈 설정.
export function parseConfig(text: string): BootstrapConfig {
  const empty: BootstrapConfig = { sharedDirectories: [] };
  if (Buffer.byteLength(text) > MAX_FILE) return empty;
  let j: unknown;
  try { j = JSON.parse(text); } catch { return empty; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return empty;
  const o = j as Record<string, unknown>;
  const scripts = o.scripts && typeof o.scripts === "object" && !Array.isArray(o.scripts) ? (o.scripts as Record<string, unknown>) : {};
  const wt = o.worktree && typeof o.worktree === "object" && !Array.isArray(o.worktree) ? (o.worktree as Record<string, unknown>) : {};
  const shared = Array.isArray(wt.sharedDirectories) ? wt.sharedDirectories.slice(0, MAX_SHARED) : [];
  const out: BootstrapConfig = { sharedDirectories: [...new Set(shared.map((s) => (typeof s === "string" ? normRel(s) : null)).filter((s): s is string => !!s))] };
  const setup = str(scripts.setup), archive = str(scripts.archive);
  if (setup) out.setup = setup;
  if (archive) out.archive = archive;
  if (o.setupAgentStartupPolicy === "start-immediately" || o.setupAgentStartupPolicy === "wait-for-setup") out.startup = o.setupAgentStartupPolicy;
  return out;
}

// .worktreeinclude 파싱 — 한 줄 한 경로(레포 루트 기준). 빈 줄·# 줄 무시(줄 중간 #은 주석 아님), glob(* ?)·부정(!) 건너뜀.
export function parseInclude(text: string): string[] {
  if (Buffer.byteLength(text) > MAX_FILE) return [];
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#") || l.startsWith("!") || /[*?]/.test(l)) continue;
    const p = normRel(l);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= MAX_INCLUDE) break;
  }
  return out;
}

const readSmall = (file: string): string | null => {
  try { return existsSync(file) && statSync(file).isFile() && statSync(file).size <= MAX_FILE ? readFileSync(file, "utf8") : null; } catch { return null; }
};
export const readConfig = (dir: string): BootstrapConfig => { const t = readSmall(join(dir, CONFIG_PATH)); return t === null ? { sharedDirectories: [] } : parseConfig(t); };
export const readInclude = (dir: string): string[] => { const t = readSmall(join(dir, INCLUDE_FILE)); return t === null ? [] : parseInclude(t); };

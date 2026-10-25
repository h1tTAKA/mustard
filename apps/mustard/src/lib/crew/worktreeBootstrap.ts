// worktree 부트스트랩 설정(#1176) — 새 worktree에 setup 스크립트·Git에 안 올라가는 파일 복사·폴더 공유.
// Orca(orca.yaml + .worktreeinclude)와 같은 규칙. 설정 파일만 YAML 대신 JSON(.mustard/config.json, 의존성 없이) — 키 이름은 Orca와 같게.
// 서버 전용.
import { execFile } from "node:child_process";
import { constants, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

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

// ── 새 worktree에 적용(#1176 커밋 2) ─────────────────────────────────────────────
// 규칙과 원본은 메인 체크아웃 것(Orca와 같음). 공유 먼저, 그다음 복사 — 이미 있는 대상은 건드리지 않음.
// 공유(sharedDirectories) = 메인 폴더로 심링크(편집도 공유) / 복사(.worktreeinclude) = 독립 사본(APFS면 clone — 공간 거의 안 씀).
// 둘 다 "메인 체크아웃에 실제로 있고 gitignore된 것"만 — 추적 파일·없는 경로는 건너뜀.
const pexec = promisify(execFile);
export interface Limits { bytes: number; entries: number }
export const COPY_LIMITS: Limits = { bytes: 2 * 1024 ** 3, entries: 50_000 }; // 일반 복사 한도(Orca와 같음)
export interface MaterializeReport { shared: string[]; copied: string[]; skipped: { path: string; reason: string }[] }

// git check-ignore --stdin — 무시되는 경로만 돌려줌(종료 코드 1 = 하나도 없음)
async function ignoredSet(root: string, paths: string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  try {
    const child = pexec("git", ["check-ignore", "--stdin"], { cwd: root, timeout: 30_000, maxBuffer: 10_000_000 });
    child.child.stdin?.end(paths.join("\n") + "\n");
    return new Set((await child).stdout.split("\n").map((l) => l.trim()).filter(Boolean));
  } catch (e) {
    const out = (e as { stdout?: string }).stdout ?? "";
    return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
  }
}

// 크기 재기 — 한도를 넘는 순간 멈춤(끝까지 안 돎)
function measure(p: string, left: Limits): { bytes: number; entries: number; over: boolean } {
  let bytes = 0, entries = 0;
  const walk = (q: string): boolean => {
    const st = lstatSync(q);
    entries++; if (st.isFile()) bytes += st.size;
    if (entries > left.entries || bytes > left.bytes) return false;
    if (st.isDirectory()) for (const n of readdirSync(q)) if (!walk(join(q, n))) return false;
    return true;
  };
  const ok = walk(p);
  return { bytes, entries, over: !ok };
}

export async function materialize(root: string, dir: string, limits: Limits = COPY_LIMITS): Promise<MaterializeReport> {
  const rep: MaterializeReport = { shared: [], copied: [], skipped: [] };
  const cfg = readConfig(root), include = readInclude(root);
  const ignored = await ignoredSet(root, [...cfg.sharedDirectories, ...include]);
  const exists = (p: string) => { try { lstatSync(p); return true; } catch { return false; } };

  for (const p of cfg.sharedDirectories) {
    const src = join(root, p), dst = join(dir, p);
    if (!ignored.has(p)) { rep.skipped.push({ path: p, reason: "not-ignored" }); continue; }
    if (!existsSync(src) || !statSync(src).isDirectory()) { rep.skipped.push({ path: p, reason: "missing" }); continue; }
    if (exists(dst)) { rep.skipped.push({ path: p, reason: "exists" }); continue; }
    mkdirSync(dirname(dst), { recursive: true });
    symlinkSync(src, dst, "dir");
    rep.shared.push(p);
  }

  const left: Limits = { ...limits };
  for (const p of include) {
    const src0 = join(root, p), dst = join(dir, p);
    if (!ignored.has(p)) { rep.skipped.push({ path: p, reason: "not-ignored" }); continue; }
    if (!existsSync(src0)) { rep.skipped.push({ path: p, reason: "missing" }); continue; }
    if (exists(dst)) { rep.skipped.push({ path: p, reason: "exists" }); continue; } // 공유로 이미 생겼거나 추적 파일
    const src = lstatSync(src0).isSymbolicLink() ? realpathSync(src0) : src0; // 맨 위 링크는 대상 내용을 복사(안쪽 링크는 링크 그대로)
    const m = measure(src, left);
    if (m.over) { rep.skipped.push({ path: p, reason: "over-budget" }); continue; }
    left.bytes -= m.bytes; left.entries -= m.entries;
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true, mode: constants.COPYFILE_FICLONE }); // FICLONE = 되면 clone, 안 되면 일반 복사
    rep.copied.push(p);
  }
  return rep;
}

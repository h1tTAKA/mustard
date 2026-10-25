// worktree 부트스트랩 설정(#1176) — 새 worktree에 setup 스크립트·Git에 안 올라가는 파일 복사·폴더 공유.
// Orca(orca.yaml + .worktreeinclude)와 같은 규칙. 설정 파일만 YAML 대신 JSON(.mustard/config.json, 의존성 없이) — 키 이름은 Orca와 같게.
// 서버 전용.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, constants, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
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

// ── setup / archive 스크립트(#1176 커밋 3) ──────────────────────────────────────
// 레포에 든 스크립트 = 그 레포를 받은 사람의 PC에서 도는 코드 → 내용(sha256)을 사람이 한 번 승인해야 실행(Orca도 명령 승인).
// 신뢰는 레포별·내용별 — 스크립트가 한 글자라도 바뀌면 다시 승인. 저장: ~/.nunopi/crew/<sha(root)>/setup-trust.json
// 실행: bash -e(첫 실패에서 멈춤), cwd = worktree, 출력은 worktree/.crew/<kind>.log, 시간 제한 넘으면 프로세스 그룹째 끔.
// setup은 새 worktree의 설정, archive는 메인 체크아웃의 설정(Orca와 같음).
const sha = (s: string, n = 64) => createHash("sha256").update(s).digest("hex").slice(0, n);
const crewBase = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const trustFile = (root: string) => join(crewBase(), sha(root.replace(/\/+$/, ""), 32), "setup-trust.json");
export const scriptHash = (script: string) => sha(script);

function readTrust(root: string): string[] {
  try { const v = JSON.parse(readFileSync(trustFile(root), "utf8")); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
export const isTrusted = (root: string, script: string) => readTrust(root).includes(scriptHash(script));
export function trustScript(root: string, script: string) {
  const list = readTrust(root), h = scriptHash(script);
  if (list.includes(h)) return;
  mkdirSync(dirname(trustFile(root)), { recursive: true });
  writeFileSync(trustFile(root), JSON.stringify([...list, h].slice(-200)));
}

export interface ScriptResult { ok: boolean; code: number | null; timedOut: boolean; tail: string; log: string }
export function runScript(kind: "setup" | "archive", script: string, root: string, dir: string, timeoutMs: number): Promise<ScriptResult> {
  const log = join(dir, ".crew", `${kind}.log`);
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, `# ${kind} ${new Date().toISOString()}\n`);
  return new Promise((res) => {
    const child = spawn("bash", ["-e", "-c", script], {
      cwd: dir, detached: true, // 새 프로세스 그룹 — 시간 초과면 자식들까지 같이 끔
      env: { ...process.env, MUSTARD_ROOT_PATH: root, MUSTARD_WORKTREE_PATH: dir, MUSTARD_WORKSPACE_NAME: basename(dir) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "", timedOut = false;
    const take = (b: Buffer) => { appendFileSync(log, b); tail = (tail + b.toString()).slice(-2000); };
    child.stdout.on("data", take); child.stderr.on("data", take);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, "SIGKILL"); } catch { /* 이미 끝남 */ } }, timeoutMs);
    const done = (code: number | null) => { clearTimeout(timer); res({ ok: code === 0 && !timedOut, code, timedOut, tail: tail.trim().slice(-800), log }); };
    child.on("error", (e) => { take(Buffer.from(String(e))); done(null); });
    child.on("close", done);
  });
}

export type SetupOutcome =
  | { status: "none" }
  | { status: "untrusted"; script: string }
  | { status: "ok" | "failed"; result: ScriptResult };
export const SETUP_TIMEOUT = 15 * 60_000, ARCHIVE_TIMEOUT = 5 * 60_000; // setup 15분 — Crew 준비 단계 멈춤 감시(20분, #1162)보다 짧게

// 새 worktree의 setup — 없으면 none, 승인 전이면 untrusted(실행 안 함), 승인됐으면 실행.
export async function runSetup(root: string, dir: string, timeoutMs = SETUP_TIMEOUT): Promise<SetupOutcome> {
  const { setup } = readConfig(dir);
  if (!setup) return { status: "none" };
  if (!isTrusted(root, setup)) return { status: "untrusted", script: setup };
  const result = await runScript("setup", setup, root, dir, timeoutMs);
  return { status: result.ok ? "ok" : "failed", result };
}

// worktree 지우기 전 archive — 승인된 것만, 실패해도 지우기는 진행(결과만 돌려줌). 메인 체크아웃의 설정.
export async function runArchive(root: string, dir: string, timeoutMs = ARCHIVE_TIMEOUT): Promise<ScriptResult | null> {
  const { archive } = readConfig(root);
  if (!archive || !isTrusted(root, archive) || !existsSync(dir)) return null;
  return runScript("archive", archive, root, dir, timeoutMs);
}

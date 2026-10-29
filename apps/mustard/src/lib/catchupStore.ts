// 캐치업 날짜별 저장(#994, 에픽 #991) — 서버(Node) 전용. 레포별 폴더에 하루 1파일(jsonl) append.
// ~/.nunopi/stream/<sha(root)>/<YYYY-MM-DD>.jsonl(로컬 날짜). 코드그래프 캐시(~/.nunopi/codegraph)와 같은 루트.
// 레포 폴더엔 아무것도 안 남김. 하루 단위 파일이라 날짜 되돌아보기(캘린더)는 파일 하나만 읽으면 됨.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { isFailedNote } from "./failText.ts";
import { byNewest, collectFacets, tagMatches, type Facet, type TagType } from "./catchupMeta.ts";

export type CatchupKind = "symbol" | "file" | "query" | "repo" | "edit" | "narration" | "diff" | "session"; // session = 커밋을 만든 에이전트 세션(#1064) // diff = 커밋 변경 자동 설명(#1056)
// #1181 wt·br = 메인이 아닌 작업 폴더(git worktree)에서 쌓인 항목 — 그 폴더 경로와 그때 브랜치(폴더를 지워도 브랜치 이름으로 보이게). 메인 항목엔 없음.
export interface CatchupItem { key: string; kind: CatchupKind; target: string; tool: string; ts: number; expl: string; wt?: string; br?: string }

const KINDS = new Set<CatchupKind>(["symbol", "file", "query", "repo", "edit", "narration", "diff", "session"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
// 테스트에서 HOME 바꿔 쓰게 호출 시점 계산.
const baseDir = () => join(process.env.MUSTARD_STREAM_DIR || join(homedir(), ".nunopi", "stream"));
// #1181 저장은 레포 하나(메인 worktree) 기준 — worktree에서 쌓인 것도 메인 폴더에 모으고 wt로 구분(지워도 남고, 머지된 커밋 ↔ 대화가 메인에서 이어지게).
// 판정은 git에 물음: --git-dir ≠ --git-common-dir 이면 linked worktree(→ 메인 = 공용 .git의 부모, wt = 그 worktree 꼭대기). 아니면 연 경로 그대로(하위 폴더·일반 레포는 예전과 같은 자리).
// 경로는 실제 경로(realpath)로 — 심볼릭 링크·/var↔/private/var로 같은 레포가 두 곳에 나뉘지 않게(리뷰). git이 실패하면 그 경로 그대로, 캐시하지 않음(일시 실패가 굳지 않게).
const real = (p: string) => { try { return normPath(realpathSync(p)); } catch { return normPath(p); } };
const whereCache = new Map<string, { main: string; wt?: string; ok?: boolean }>();
function where(root: string): { main: string; wt?: string; ok?: boolean } {
  const r = normPath(root);
  const hit = whereCache.get(r);
  if (hit) return hit;
  const rr = real(r);
  try {
    const [gitDir, common, top] = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"], { cwd: rr, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").map(real);
    const linked = gitDir !== common && basename(common) === ".git";
    const w = linked ? { main: real(dirname(common)), wt: top, ok: true } : { main: rr, ok: true };
    whereCache.set(r, w);
    return w;
  } catch { return { main: rr }; }
}
export const mainOf = (root: string) => where(root).main;
// 그 worktree의 지금 브랜치 — 쓸 때마다 git을 부르지 않게 30초 캐시(리뷰)
const brCache = new Map<string, { br?: string; at: number }>();
function branchOf(dir: string): string | undefined {
  const hit = brCache.get(dir);
  if (hit && Date.now() - hit.at < 30_000) return hit.br;
  let br: string | undefined;
  try { const b = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim(); br = b && b !== "HEAD" ? b : undefined; } catch { /* 모름 */ }
  brCache.set(dir, { br, at: Date.now() });
  return br;
}
const rawDir = (path: string) => join(baseDir(), sha(normPath(path)));
const repoDir = (root: string) => rawDir(mainOf(root));
// 같은 key라도 다른 작업 폴더면 다른 항목
const idOf = (x: { key: string; wt?: string }) => `${x.wt ?? ""}\0${x.key}`;
// 지금 폴더 것만(기본) — 메인 = wt 없는 것, worktree = 그 wt
const inScope = (root: string) => { const { wt } = where(root); return (x: CatchupItem) => x.wt === wt; };
// 그 폴더에서 쓴 항목에 표시 붙이기(클라가 보낸 wt·br은 믿지 않고 서버가 정함)
function tag(root: string, items: CatchupItem[]): CatchupItem[] {
  const { wt } = where(root);
  const br = wt ? branchOf(wt) : undefined;
  return items.map((x) => { const it = { ...x }; delete it.wt; delete it.br; return wt ? { ...it, wt, ...(br ? { br } : {}) } : it; });
}
// #1181 옛 기록 옮기기 — (1) worktree 경로로 따로 쌓였던 폴더는 메인으로(wt·br 붙여) 옮기고 옛 폴더는 .migrated,
// (2) 실제 경로가 아닌 경로(심볼릭 링크 등)로 쌓였던 메인 폴더는 실제 경로 자리로 이름만 바꿈. 성공해야 "끝남"으로 기억(실패면 다음에 다시, 겹친 건 wt+key로 걸러짐, 리뷰).
// 한계: 여러 프로세스가 동시에 옮기면 줄이 빠질 수 있음(appendItems는 잠금 없음) — 한 번뿐인 이관이라 감수.
const migrated = new Set<string>();
// 옛 폴더 하나를 메인 폴더로 합치고 .migrated — as = 그 기록을 쓴 작업 폴더(wt 표시 기준). 옮기기 안에서 다시 옮기기를 부르지 않게 appendRaw(리뷰)
function mergeInto(old: string, as: string, main: string) {
  if (as === main && !existsSync(rawDir(main))) { renameSync(old, rawDir(main)); writeFileSync(join(rawDir(main), "root.txt"), main); return; } // 메인 자기 옛 폴더 + 자리가 비었으면 이름만(worktree 것은 wt 표시가 붙어야 해서 아래로, 리뷰)
  for (const f of readdirSync(old)) if (DAY_RE.test(f.replace(/\.jsonl$/, ""))) appendRaw(as, readDayFile(join(old, f)));
  mkdirSync(rawDir(main), { recursive: true });
  if (!existsSync(join(rawDir(main), "root.txt"))) writeFileSync(join(rawDir(main), "root.txt"), main); // 세션·질문만 옮겨도 어느 레포인지 남게(리뷰)
  for (const sub of ["sessions", "ask"]) { const s = join(old, sub); if (existsSync(s)) cpSync(s, join(rawDir(main), sub), { recursive: true, force: false }); }
  renameSync(old, existsSync(`${old}.migrated`) ? `${old}.migrated.${Date.now()}` : `${old}.migrated`); // 이미 있으면 겹치지 않게(리뷰)
}
// 처음 만질 때 한 번 — 기록 폴더들의 root.txt를 보고 이 레포(메인)나 이 worktree로 풀리는 옛 폴더(옛 경로 표기·심볼릭·worktree 경로로 쌓인 것)를 메인으로 합침(리뷰).
// git이 실패한 판정(ok 없음)으로는 아무것도 안 옮기고 "끝남"으로 기억하지도 않음.
function migrate(root: string) {
  const w = where(root);
  if (!w.ok) return;
  const done = normPath(root); // 연 경로 표기마다 한 번(다른 표기로 쌓인 옛 폴더도 그 표기로 열 때 합쳐지게)
  if (migrated.has(done)) return;
  try {
    let dirs: string[] = []; try { dirs = readdirSync(baseDir()); } catch { /* 없음 */ }
    const self = rawDir(w.main);
    for (const d of dirs) {
      const dir = join(baseDir(), d);
      if (dir === self || d.includes(".migrated")) continue;
      let r0 = ""; try { r0 = real(readFileSync(join(dir, "root.txt"), "utf8").trim()); } catch { /* root.txt 없는 옛 폴더(질문·세션만) — 아래 경로 대조로 */ }
      if (w.wt && (r0 === w.wt || dir === rawDir(w.wt) || dir === rawDir(root))) mergeInto(dir, w.wt, w.main);
      else if (r0 === w.main || (!w.wt && dir === rawDir(root))) mergeInto(dir, w.main, w.main);
    }
    migrated.add(done);
  } catch { /* 다음에 다시 */ }
}
// #998 캐치업 질문 에이전트가 읽을 기록 폴더(--add-dir).
export const streamDirFor = (root: string) => repoDir(root);
// #1068 캐치업을 쓰는 레포들(기록 폴더의 root.txt) + 앱 생존 하트비트 파일 위치
export function catchupRoots(): string[] {
  let dirs: string[]; try { dirs = readdirSync(baseDir()); } catch { return []; }
  return dirs.filter((d) => !d.includes(".migrated")).map((d) => { try { return readFileSync(join(baseDir(), d, "root.txt"), "utf8").trim(); } catch { return ""; } }).filter(Boolean); // #1181 옮기고 남은 옛 폴더는 뺌
}
export const aliveFile = () => join(baseDir(), "alive.json");

// 로컬 날짜 — 서버(standalone)는 같은 기기에서 앱이 띄우므로 화면(dayOf)과 시간대가 같다(#994 리뷰).
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 신뢰 경계(클라 POST) — 필드 타입·길이 검증. 잘못된 항목은 버림.
// #1074 본문 상한 — 큰 커밋 diff 카드는 구간 설명이 수십 개라 8000자에서 뒤가 잘림. 안전 상한만(한 카드 200K).
const EXPL_MAX = 200_000;
export function sanitize(x: unknown): CatchupItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.key !== "string" || !o.key || typeof o.target !== "string" || typeof o.expl !== "string" || !o.expl.trim()) return null;
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts) || o.ts <= 0) return null;
  const kind = KINDS.has(o.kind as CatchupKind) ? (o.kind as CatchupKind) : null;
  if (!kind) return null;
  return { key: o.key.slice(0, 300), kind, target: o.target.slice(0, 300), tool: typeof o.tool === "string" ? o.tool.slice(0, 200) : "", ts: o.ts, expl: o.expl.slice(0, EXPL_MAX),
    ...(typeof o.wt === "string" && o.wt ? { wt: o.wt.slice(0, 1000) } : {}), ...(typeof o.br === "string" && o.br ? { br: o.br.slice(0, 300) } : {}) };
}

function readDayFile(file: string): CatchupItem[] {
  if (!existsSync(file)) return [];
  const out: CatchupItem[] = [];
  const keys = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const it = sanitize(JSON.parse(line));
      if (it?.kind === "narration" && isFailedNote(it.expl)) continue; // #1093 실패 문구가 해설로 저장된 옛 카드 — 숨김(재료가 없어 복구 불가)
      if (it && !keys.has(idOf(it))) { keys.add(idOf(it)); out.push(it); }
    } catch { /* 깨진 줄(쓰다 죽음) 스킵 */ }
  }
  return out;
}

// #1093 같은 key 카드를 새 내용으로 교체(실패 카드 복구) — 그날 파일에서 그 key 줄을 빼고 새 줄 추가. 없던 key면 그냥 추가.
// 임시 파일에 쓰고 rename(쓰다 죽어도 원본 유지). appendItems와 같은 이유로 동기 = 프로세스 안 경합 없음.
export function replaceItems(root: string, items: CatchupItem[]): number {
  if (!root || !items.length) return 0;
  migrate(root);
  items = tag(root, items);
  const dir = repoDir(root);
  mkdirSync(dir, { recursive: true });
  for (const it of items) {
    const file = join(dir, `${dayKey(it.ts)}.jsonl`);
    const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => {
      if (!l.trim()) return false;
      try { const o = JSON.parse(l) as { key?: string; wt?: string }; return !(o.key === it.key && o.wt === it.wt); } catch { return true; }
    }) : [];
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, [...lines, JSON.stringify(it)].join("\n") + "\n");
    renameSync(tmp, file);
  }
  return items.length;
}

// 같은 날 파일에 이미 있는 key는 스킵(이관·재전송 멱등). 날짜는 항목 ts 기준.
// 동시성(#994 리뷰): 읽기~append 사이에 await가 없는 동기 함수라 한 서버 프로세스 안에서 요청끼리 끼어들 수 없음.
// 혹시 생긴 중복(다중 프로세스 등)은 readDayFile이 key로 걸러냄.
// 한계: append마다 그날 파일 전체를 읽음(하루 수백 건 수준 OK) — 커지면 파일별 key 캐시.
export function appendItems(root: string, items: CatchupItem[]): number {
  if (!root || !items.length) return 0;
  migrate(root);
  return appendRaw(root, items);
}
function appendRaw(root: string, items: CatchupItem[]): number {
  if (!items.length) return 0;
  items = tag(root, items);
  const dir = repoDir(root);
  mkdirSync(dir, { recursive: true });
  const rootFile = join(dir, "root.txt");
  if (!existsSync(rootFile)) writeFileSync(rootFile, mainOf(root)); // 어느 레포 폴더인지(디버깅·정리용) — #1181 메인 경로
  const byDay = new Map<string, CatchupItem[]>();
  for (const it of items) { const d = dayKey(it.ts); byDay.set(d, [...(byDay.get(d) ?? []), it]); }
  let added = 0;
  for (const [day, list] of byDay) {
    const file = join(dir, `${day}.jsonl`);
    const seen = new Set(readDayFile(file).map(idOf));
    const fresh = list.filter((x) => (seen.has(idOf(x)) ? false : (seen.add(idOf(x)), true)));
    if (!fresh.length) continue;
    appendFileSync(file, fresh.map((x) => JSON.stringify(x)).join("\n") + "\n");
    added += fresh.length;
  }
  return added;
}

// 기록 있는 날짜(최신 먼저) — 서브 C 캘린더용. #1181 기본은 지금 작업 폴더 항목이 있는 날만, all이면 레포 전체.
const allDays = (root: string) => { const dir = repoDir(root); return existsSync(dir) ? readdirSync(dir).map((f) => f.replace(/\.jsonl$/, "")).filter((d) => DAY_RE.test(d)).sort().reverse() : []; };
export function listDays(root: string, all = false): string[] {
  migrate(root);
  return all ? allDays(root) : allDays(root).filter((d) => readDay(root, d).length > 0); // 한계: 날짜 파일을 다 읽음 — 기록이 아주 많아지면 날짜별 폴더 표시 캐시
}

export function readDay(root: string, day: string, all = false): CatchupItem[] {
  if (!DAY_RE.test(day)) return [];
  migrate(root);
  const items = readDayFile(join(repoDir(root), `${day}.jsonl`));
  return (all ? items : items.filter(inScope(root))).sort(byNewest);
}

// 최근 limit개(최신 날짜 파일부터) — 패널 첫 로드.
export function readRecent(root: string, limit: number): CatchupItem[] {
  const out: CatchupItem[] = [];
  for (const day of allDays(root)) {
    out.push(...readDay(root, day));
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

// 검색(#1049) — 전체 날짜를 최신부터 훑어 제목·설명에 검색어(대소문자 무시)가 든 항목 limit개.
// 한계: 날짜 파일 전수 스캔 — 기록이 수만 개로 커지면 색인(FTS) 고려.
export function searchItems(root: string, q: string, limit: number, all = false): CatchupItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return filterItems(root, (x) => `${x.target}\n${x.expl}`.toLowerCase().includes(needle), limit, all);
}

// #1238 전체 날짜를 최신부터 훑어 조건에 맞는 항목 limit개(검색·브랜치/에이전트/해시·별표·질문 공용).
export function filterItems(root: string, pred: (x: CatchupItem) => boolean, limit: number, all = false): CatchupItem[] {
  const out: CatchupItem[] = [];
  for (const day of allDays(root)) {
    for (const x of readDay(root, day, all)) if (pred(x)) out.push(x);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

// #1238 브랜치·에이전트·해시 카드만(전체 날짜) — 칩·풀다운 필터.
export const tagItems = (root: string, type: TagType, value: string, limit: number, all = false) => filterItems(root, (x) => tagMatches(x, type, value), limit, all);

// #1238 풀다운 값 — 브랜치·에이전트·해시를 최신순으로(종류마다 50개). 다 차면 더 안 읽음.
// ponytail: 전수 스캔(최대 120일) — 기록이 아주 커지면 색인.
export function itemFacets(root: string, all = false): Record<TagType, Facet[]> {
  const items: CatchupItem[] = [];
  for (const day of allDays(root).slice(0, 120)) {
    items.push(...readDay(root, day, all).filter((x) => x.kind === "diff" || x.kind === "session"));
    const f = collectFacets(items);
    if (f.branch.length >= 50 && f.agent.length >= 50 && f.hash.length >= 50) return f;
  }
  return collectFacets(items);
}

// ── 커밋 세션 원본(#1064) — 커밋을 만든 에이전트 대화 구간. 기록 파일이 지워져도 남게 복사 저장. sessions/<hash>.json
const HASH_RE = /^[0-9a-f]{7,64}$/i;
const sessionFile = (root: string, hash: string) => join(repoDir(root), "sessions", `${hash}.json`);
export function writeSession(root: string, hash: string, data: unknown): boolean {
  if (!HASH_RE.test(hash)) return false;
  const dir = join(repoDir(root), "sessions"); mkdirSync(dir, { recursive: true });
  const f = sessionFile(root, hash); writeFileSync(f + ".tmp", JSON.stringify(data)); renameSync(f + ".tmp", f);
  return true;
}
export function readSession(root: string, hash: string): unknown | null {
  if (!HASH_RE.test(hash)) return null;
  try { return JSON.parse(readFileSync(sessionFile(root, hash), "utf8")); } catch { return null; }
}

// ── 항목 질문 대화(#998) — 항목별 ask/<sha(key)>.json. 기록 폴더 안이라 질문 에이전트가 예전 Q&A도 grep.
export interface AskMessage { role: "user" | "assistant"; content: string }
export interface AskThread { key: string; target: string; messages: AskMessage[]; updatedAt: number }
const askDir = (root: string) => join(repoDir(root), "ask");
const askFile = (root: string, key: string) => join(askDir(root), `${sha(key)}.json`);

function sanitizeThread(x: unknown): AskThread | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.key !== "string" || !o.key || !Array.isArray(o.messages)) return null;
  const messages = o.messages.slice(-200).flatMap((m): AskMessage[] => {
    const r = m as Record<string, unknown>;
    return (r?.role === "user" || r?.role === "assistant") && typeof r.content === "string" ? [{ role: r.role, content: r.content.slice(0, 20000) }] : [];
  });
  return { key: o.key.slice(0, 300), target: typeof o.target === "string" ? o.target.slice(0, 300) : "", messages, updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0 };
}

export function readAsk(root: string, key: string): AskThread | null {
  try { return sanitizeThread(JSON.parse(readFileSync(askFile(root, key), "utf8"))); } catch { return null; }
}

// 통째로 교체 저장(대화 전체) — tmp+rename 원자적.
export function writeAsk(root: string, thread: unknown, now: number): AskThread | null {
  const t = sanitizeThread(thread);
  if (!root || !t) return null;
  mkdirSync(askDir(root), { recursive: true });
  const file = askFile(root, t.key);
  const saved = { ...t, updatedAt: now };
  const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(saved));
  renameSync(tmp, file);
  return saved;
}

// 카드 배지 — 항목 key별 유저 질문 수.
export function askCounts(root: string): Record<string, number> {
  const dir = askDir(root);
  if (!existsSync(dir)) return {};
  const out: Record<string, number> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try { const t = sanitizeThread(JSON.parse(readFileSync(join(dir, f), "utf8"))); if (t) out[t.key] = t.messages.filter((m) => m.role === "user").length; } catch { /* 깨진 파일 스킵 */ }
  }
  return out;
}

// ── 레포별 캐치업 설정(#1239) — prefs.json = { off: [끈 항목] }. 전역 설정에서 켠 것 중 이 레포만 끔(전역 켜면 끄지 않은 건 따라 켜짐).
//  서버 해설(narrate)도 봐야 해서 서버 저장(창이 안 열려도 레포마다 끌 수 있게).
export const REPO_PREF_KEYS = ["explainShow", "explainAnalyze", "commandsShow", "commandsAnalyze", "diffShow", "diffAnalyze", "termsShow", "termsAnalyze", "sessionsShow", "sessionsAnalyze"] as const;
export type RepoPrefKey = (typeof REPO_PREF_KEYS)[number];
const prefFile = (root: string) => join(repoDir(root), "prefs.json");
export function readRepoPrefs(root: string): { off: RepoPrefKey[] } {
  try {
    const o = JSON.parse(readFileSync(prefFile(root), "utf8")) as { off?: unknown };
    return { off: Array.isArray(o.off) ? REPO_PREF_KEYS.filter((k) => (o.off as unknown[]).includes(k)) : [] };
  } catch { return { off: [] }; }
}
// 항목 하나만 켜고 끔(목록 통째 저장 X — 창 여러 개·실패가 섞여도 서로 덮지 않게, 리뷰). 읽고 바꾸고 바로 씀(동기라 한 서버 안에선 안 섞임).
export function setRepoPref(root: string, key: unknown, off: boolean): { off: RepoPrefKey[] } | null {
  if (!REPO_PREF_KEYS.includes(key as RepoPrefKey)) return null;
  const cur = readRepoPrefs(root).off.filter((k) => k !== key);
  const clean = { off: REPO_PREF_KEYS.filter((k) => (k === key ? off : cur.includes(k))) };
  mkdirSync(repoDir(root), { recursive: true });
  const file = prefFile(root), tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean));
  renameSync(tmp, file);
  return clean;
}
// 하위 폴더에서 일하는 에이전트(터미널 cwd가 src/ 등)도 레포 최상위 설정을 따르게 — git 최상위(30초 캐시)도 확인(리뷰).
const topCache = new Map<string, { top: string; at: number }>();
const gitTop = (p: string) => {
  const hit = topCache.get(p); if (hit && Date.now() - hit.at < 30_000) return hit.top;
  let top = "";
  try { top = real(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: real(p), encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim()); } catch { /* git 아님 */ }
  topCache.set(p, { top, at: Date.now() });
  return top;
};
export const repoPrefOff = (root: string, key: RepoPrefKey) => {
  if (readRepoPrefs(root).off.includes(key)) return true;
  const top = gitTop(root);
  return !!top && top !== real(root) && readRepoPrefs(top).off.includes(key);
};

// ── 별표(#1238) — 레포별 stars.json = { key: 별표한 시각 }. 화면 표시·별표만 보기.
const starFile = (root: string) => join(repoDir(root), "stars.json");
export function readStars(root: string): Record<string, number> {
  try {
    const o = JSON.parse(readFileSync(starFile(root), "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter((e): e is [string, number] => !!e[0] && typeof e[1] === "number"));
  } catch { return {}; }
}
export function setStar(root: string, key: string, on: boolean, now: number): Record<string, number> {
  const k = key;
  const stars = readStars(root);
  if (on) stars[k] = now; else delete stars[k];
  mkdirSync(repoDir(root), { recursive: true });
  const file = starFile(root);
  const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(stars)); // pid — 두 서버(개발·앱)가 같은 폴더를 써도 안 섞이게(리뷰)
  renameSync(tmp, file);
  return stars;
}

// #1081 키로 항목 찾기(최근 날짜부터) — 질문 답변의 catchup: 링크 → 그 카드로 이동할 날짜를 알려고.
export function findItem(root: string, key: string): CatchupItem | null {
  // 지금 폴더 것을 모든 날짜에서 먼저, 없으면 레포 전체(#1181, 리뷰 — 날짜마다가 아니라 전체에서 우선)
  for (const day of allDays(root)) { const hit = readDay(root, day).find((x) => x.key === key); if (hit) return hit; }
  for (const day of allDays(root)) { const hit = readDay(root, day, true).find((x) => x.key === key); if (hit) return hit; }
  return null;
}

// #1081 커밋 해시(앞 7자 이상)로 diff·세션 카드 찾기 — 질문 답변에 해시만 나오고 링크가 빠졌을 때 앱이 "관련 카드"를 붙이려고.
export function itemsForHashes(root: string, hashes: string[], limit = 30): CatchupItem[] {
  const hs = hashes.map((h) => h.toLowerCase()).filter((h) => /^[0-9a-f]{7,40}$/.test(h));
  if (!hs.length) return [];
  const out: CatchupItem[] = [];
  for (const day of allDays(root)) for (const x of readDay(root, day, true)) { // #1181 커밋 카드는 레포 전체에서(worktree에서 만든 커밋이 머지된 뒤에도)
    const m = /^(?:diff|session)\|([0-9a-f]{7,40})/i.exec(x.key);
    if (m && hs.some((h) => m[1].toLowerCase().startsWith(h) || h.startsWith(m[1].toLowerCase()))) { out.push(x); if (out.length >= limit) return out; }
  }
  return out;
}

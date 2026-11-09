// 겨루기(#1174) — 한 프롬프트를 여러 에이전트에. 후보마다 사람용 작업공간(worktree) 1개, 에이전트는 그 폴더의 터미널 탭에서 돎(화면 쪽).
// 여기는 기록 저장·후보 만들기·후보 diff(기준점 대비, 커밋 + 미커밋 + 새 파일). 서버 전용.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { createWorkspace, forceDeleteBranch, removeWorkspace } from "./workspaces.ts";
import { openDraftPr } from "./draftPr.ts";

const pexec = promisify(execFile);
// git diff는 차이가 있으면 종료 코드 1(--no-index) — 출력만 쓰고 코드는 안 봄
const gitOut = (cwd: string, args: string[]) => pexec("git", args, { cwd, timeout: 60_000, maxBuffer: 50_000_000 }).then((r) => r.stdout, (e: { stdout?: string; code?: number }) => { if (e.code === 1 && typeof e.stdout === "string") return e.stdout; throw e; });

export const MIN_CANDIDATES = 2, MAX_CANDIDATES = 4;
export const MAX_DIFF = 60_000, MAX_FILE_DIFF = 20_000, MAX_UNTRACKED = 200; // 판정 모델 입력 상한(PR 리뷰와 같은 크기) — 넘는 파일은 이름·줄 수만
export interface Candidate { agent: string; dir: string; branch: string; base: string; tab?: string } // tab = 그 후보 터미널 탭 id(= 에이전트 세션 id)
export interface Fanout {
  id: string; name: string; prompt: string; createdAt: number;
  status: "running" | "adopted" | "discarded";
  candidates: Candidate[];
  verdict?: unknown; trial?: unknown; // 판정·재판 결과(뒤 커밋)
  winner?: number; prUrl?: string;
}

const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_FANOUT_DIR || join(homedir(), ".nunopi", "fanout");
const file = (root: string) => join(baseDir(), sha(normPath(root)), "runs.json");

export function listFanouts(root: string): Fanout[] {
  try { const j = JSON.parse(readFileSync(file(root), "utf8")); return Array.isArray(j) ? j : []; } catch { return []; }
}
function writeAll(root: string, all: Fanout[]) {
  const f = file(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(all.slice(0, 50), null, 1)); // 최근 50개
  renameSync(`${f}.tmp`, f);
}
export const getFanout = (root: string, id: string) => listFanouts(root).find((f) => f.id === id) ?? null;
export function saveFanout(root: string, f: Fanout) {
  writeAll(root, [f, ...listFanouts(root).filter((x) => x.id !== f.id)]);
}

// 화면이 연 터미널 탭 id를 후보 순서대로 붙임
export function setTabs(root: string, id: string, tabIds: string[]) {
  const f = getFanout(root, id);
  if (!f) throw new Error("not found");
  f.candidates.forEach((c, i) => { const t = tabIds[i]; if (typeof t === "string" && /^[\w-]{1,64}$/.test(t)) c.tab = t; });
  saveFanout(root, f);
}

const AGENT = /^[a-z0-9][a-z0-9-]{0,31}$/;
export interface CreateFanoutOpts { name: string; prompt: string; agents: string[]; base?: string; prefix?: string }
// 후보 N개 = 작업공간 N개(이름 <이름>-<에이전트>, 같은 에이전트면 createWorkspace가 -2). 중간에 실패하면 만든 것 되돌림.
export async function createFanout(root: string, o: CreateFanoutOpts): Promise<Fanout> {
  const prompt = o.prompt.trim();
  if (!prompt) throw new Error("prompt required");
  if (o.agents.length < MIN_CANDIDATES || o.agents.length > MAX_CANDIDATES || !o.agents.every((a) => AGENT.test(a))) throw new Error("bad agents");
  const made: Candidate[] = [];
  try {
    for (const agent of o.agents) {
      const w = await createWorkspace(root, { name: `${o.name || "fanout"}-${agent}`, base: o.base, prefix: o.prefix });
      made.push({ agent, dir: w.dir, branch: w.branch, base: w.base });
    }
  } catch (e) {
    for (const c of made) await dropCandidate(root, c).catch(() => {}); // 복사해 온 무시된 파일이 있어도 지워지게(본 개수 제한 없음, 리뷰)
    throw e;
  }
  const f: Fanout = { id: randomUUID(), name: o.name, prompt, createdAt: Date.now(), status: "running", candidates: made };
  saveFanout(root, f);
  return f;
}

export interface FileStat { path: string; added: number; removed: number; big?: boolean }
export interface CandidateDiff { files: FileStat[]; added: number; removed: number; diff: string; truncated: boolean }

// 후보 diff — 기준점이 그 뒤로 움직여도 같은 비교가 되게 merge-base에 고정. 작업 폴더 전체(커밋 + 미커밋) 대 기준점 + 새 파일(untracked).
// 새 파일은 index를 건드리는 add -N 대신 --no-index로 따로(에이전트가 쓰는 worktree 상태를 안 바꿈).
export async function candidateDiff(c: Candidate): Promise<CandidateDiff> {
  if (!existsSync(c.dir)) throw new Error("candidate folder gone");
  const mb = (await gitOut(c.dir, ["merge-base", c.base, "HEAD"]).catch(() => "")).trim() || c.base;
  const tracked = await gitOut(c.dir, ["diff", "--no-color", "--no-ext-diff", "-M", mb]);
  const untracked = (await gitOut(c.dir, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const parts = splitDiff(tracked);
  for (const p of untracked.slice(0, MAX_UNTRACKED)) parts.push(await gitOut(c.dir, ["diff", "--no-color", "--no-index", "--", "/dev/null", p]).catch(() => ""));
  const d = capDiff(parts.filter(Boolean));
  // 넘는 새 파일은 이름만(줄 수 0) + 잘림 표시 — 채택하면 git add -A로 같이 들어가니 목록에서 빠지면 안 됨(리뷰)
  for (const p of untracked.slice(MAX_UNTRACKED)) d.files.push({ path: p, added: 0, removed: 0, big: true });
  if (untracked.length > MAX_UNTRACKED) d.truncated = true;
  return d;
}

// "diff --git"마다 한 파일
export const splitDiff = (s: string) => s.split(/^(?=diff --git )/m).filter((x) => x.startsWith("diff --git "));
const pathOf = (part: string) => part.match(/^\+\+\+ b\/(.+)$/m)?.[1] ?? part.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1] ?? "?";
const countLines = (part: string) => {
  let added = 0, removed = 0;
  for (const l of part.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }
  return { added, removed };
};

// 파일별 줄 수는 전부, diff 글은 파일당·전체 상한까지(넘는 파일은 이름만 — 판정 입력이 끝없이 커지지 않게)
export function capDiff(parts: string[]): CandidateDiff {
  const files: FileStat[] = [];
  let diff = "", truncated = false, added = 0, removed = 0;
  for (const part of parts) {
    const n = countLines(part);
    added += n.added; removed += n.removed;
    const big = part.length > MAX_FILE_DIFF || diff.length + part.length > MAX_DIFF;
    files.push({ path: pathOf(part), ...n, ...(big ? { big } : {}) });
    if (big) truncated = true;
    else diff += part.endsWith("\n") ? part : `${part}\n`;
  }
  return { files, added, removed, diff, truncated };
}

// 후보 하나 지우기 — 일부러 버리는 거라 미커밋·무시된 파일도 지움(force, 본 개수 제한 없음), 브랜치도(-d 거부면 -D).
// archive(사람이 승인한 정리 스크립트)는 승인돼 있으면 돌리고, 승인 전이면 건너뜀(묻는 창 없이 여럿을 지우는 흐름이라).
async function dropCandidate(root: string, c: Candidate): Promise<void> {
  const o = { force: true, expectDirty: Number.MAX_SAFE_INTEGER, expectIgnored: Number.MAX_SAFE_INTEGER, deleteBranch: true, allowFailedArchive: true };
  let r = await removeWorkspace(root, c.dir, o);
  if (r.status === "archive-untrusted") r = await removeWorkspace(root, c.dir, { ...o, skipArchive: true });
  if (r.status === "removed" && r.branchKept && r.branch) await forceDeleteBranch(root, r.branch).catch(() => {});
}

// 못 지운 후보 폴더 = 화면이 알려 줌(작업공간 지우기 창으로 마저 지울 수 있음)
async function dropAll(root: string, cs: Candidate[]): Promise<string[]> {
  const left: string[] = [];
  for (const c of cs) await dropCandidate(root, c).catch(() => { left.push(c.dir); });
  return left;
}

const gitIn = (dir: string, args: string[]) => pexec("git", args, { cwd: dir, timeout: 60_000 }).then((r) => r.stdout.trim());
const inFlight = new Set<string>(); // 같은 겨루기 채택·버리기 두 번 눌림 방지
async function once<T>(id: string, run: () => Promise<T>): Promise<T> {
  if (inFlight.has(id)) throw new Error("busy");
  inFlight.add(id);
  try { return await run(); } finally { inFlight.delete(id); }
}

// 채택 — 승자 미커밋 변경을 커밋(메시지 = 프롬프트 첫 줄) → push + draft PR → 나머지 후보 지움. PR이 실패하면 아무것도 안 지움.
export const adoptFanout = (root: string, id: string, winner: number) => once(id, async () => {
  const f = getFanout(root, id);
  if (!f || f.status !== "running") throw new Error("not running");
  const w = f.candidates[winner];
  if (!w || !existsSync(w.dir)) throw new Error("bad winner");
  const title = (f.prompt.split("\n").map((l) => l.trim()).find(Boolean) ?? "Compete result").slice(0, 72);
  if (await gitIn(w.dir, ["status", "--porcelain"])) {
    await gitIn(w.dir, ["add", "-A"]);
    await gitIn(w.dir, ["commit", "-q", "-m", title]);
  }
  const mb = (await gitIn(w.dir, ["merge-base", w.base, "HEAD"]).catch(() => "")) || w.base;
  if (Number(await gitIn(w.dir, ["rev-list", "--count", `${mb}..HEAD`]).catch(() => "0")) === 0) throw new Error("no changes");
  const v = f.verdict as { state?: string; chair?: { why?: string } } | undefined;
  const body = [
    "## Prompt", f.prompt, "",
    "## Compete", ...f.candidates.map((c, i) => `- ${i === winner ? "**adopted**" : "dropped"}: \`${c.agent}\` (\`${c.branch}\`)`), "",
    ...(v?.state === "done" && v.chair?.why ? ["## Verdict", v.chair.why, ""] : []),
    "🤖 Opened from Mustard (compete)",
  ].join("\n");
  const { url } = await openDraftPr({ dir: w.dir, branch: w.branch, base: w.base, title, body });
  saveFanout(root, { ...(getFanout(root, id) ?? f), status: "adopted", winner, prUrl: url }); // push 동안 끝난 판정·재판을 덮어쓰지 않게 지금 기록에(리뷰)
  return { url, left: await dropAll(root, f.candidates.filter((_, i) => i !== winner)) };
});

// 모두 버리기 — 후보 전부 지움
export const discardFanout = (root: string, id: string) => once(id, async () => {
  const f = getFanout(root, id);
  if (!f || f.status !== "running") throw new Error("not running");
  const left = await dropAll(root, f.candidates);
  saveFanout(root, { ...(getFanout(root, id) ?? f), status: "discarded" });
  return { left };
});

// 사람용 worktree 작업공간(#1170) — 브랜치·커밋·PR에서 새 작업 폴더를 만들고, 안전하게 지움. 서버 전용.
// Orca new-workspace·삭제 규칙을 따름(scratchpad/re/orca: worktree-logic·worktree-add·pr-start-point·worktree-removal·worktree-branch-removal).
// 차이: 브랜치 접두 = Mustard 설정(branchPrefix), fork PR push 연결·squash 머지 판정 없음, setup은 터미널이 아니라 #1176 runSetup(환경변수 허용 목록).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { branchFor, slugName, sanitizeSegment } from "./workspaceName.ts";
import { clearSetupState, materialize, MAX_REVIEW, readConfig, readInclude, isTrusted, runArchive, type MaterializeReport, type ScriptResult } from "../crew/worktreeBootstrap.ts";

const pexec = promisify(execFile);
const git = async (cwd: string, args: string[], timeout = 120_000) => (await pexec("git", args, { cwd, timeout, maxBuffer: 10_000_000 })).stdout.trim();
const ok = (p: Promise<unknown>) => p.then(() => true, () => false);

export const workspacesDir = () => process.env.MUSTARD_WORKSPACES_DIR || join(homedir(), "mustard", "workspaces"); // Orca ~/orca/workspaces/<레포>/<이름>
const crewDir = () => process.env.MUSTARD_WORKTREE_DIR || join(homedir(), ".nunopi", "worktrees"); // Crew worktree — Crew가 관리, 여기서 안 지움

async function validBranch(root: string, b: string): Promise<boolean> {
  return !!b && !b.startsWith("-") && ok(git(root, ["check-ref-format", "--branch", b]));
}

// 시작점 → 커밋 SHA(Orca base-ref): refs/면 그대로, 원격 추적 ref → 로컬 브랜치 → 그 밖(SHA·태그)
export async function resolveBase(root: string, base: string): Promise<{ sha: string; ref: string }> {
  const b = base.trim();
  if (!b || b.startsWith("-")) throw new Error("bad base");
  const cands = b.startsWith("refs/") ? [b] : [`refs/remotes/${b}`, `refs/heads/${b}`, b];
  for (const ref of cands) {
    const sha = await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).catch(() => "");
    if (sha) return { sha, ref };
  }
  throw new Error(`base not found: ${b}`);
}

export interface PrStart { number: number; headRefName: string; headRefOid?: string; cross: boolean }
export interface CreateOpts { name: string; base?: string; prefix?: string; pr?: PrStart }
export interface Created { dir: string; branch: string; base: string; bootstrap: MaterializeReport }

// PR을 받을 원격 — upstream(포크해서 작업할 때 원본) → origin → 첫 원격(Orca 배포본 1.4.240과 같은 순서)
const remoteOf = async (root: string) => { const rs = (await git(root, ["remote"]).catch(() => "")).split("\n").filter(Boolean); return ["upstream", "origin"].find((r) => rs.includes(r)) ?? rs[0] ?? ""; };

// PR head를 받아 SHA로(메인 체크아웃은 안 건드림, Orca pr-start-point). 같은 레포 = 그 브랜치를 원격 추적 ref로, fork = refs/pull/N/head를 전용 ref로.
// 받은 SHA가 GitHub가 알려 준 headRefOid와 다르면 거부(Superset — 그 사이 push됐거나 다른 걸 받음).
async function fetchPr(root: string, pr: PrStart): Promise<{ sha: string; remote: string }> {
  const remote = await remoteOf(root);
  if (!remote) throw new Error("no remote");
  if (!Number.isInteger(pr.number) || pr.number <= 0 || !(await validBranch(root, pr.headRefName))) throw new Error("bad pr");
  const ref = pr.cross ? `refs/mustard/pull/${pr.number}` : `refs/remotes/${remote}/${pr.headRefName}`;
  const src = pr.cross ? `refs/pull/${pr.number}/head` : `refs/heads/${pr.headRefName}`;
  await git(root, ["fetch", "--no-tags", remote, `+${src}:${ref}`]);
  const sha = await git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (pr.headRefOid && !sha.startsWith(pr.headRefOid) && !pr.headRefOid.startsWith(sha)) throw new Error("pr head moved");
  return { sha, remote };
}

const branchExists = async (root: string, b: string, withRemote: boolean) => {
  if (await ok(git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]))) return true;
  if (!withRemote) return false;
  const remotes = (await git(root, ["remote"]).catch(() => "")).split("\n").filter(Boolean);
  for (const r of remotes) if (await ok(git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${r}/${b}`]))) return true; // 원격에 같은 이름(Orca)
  return false;
};

// 새 작업공간 — 이름이 겹치면 -2…-100(Orca worktree-create-candidates). 브랜치 = [접두/]이름, PR이면 그 PR 브랜치 이름.
export async function createWorkspace(root: string, o: CreateOpts): Promise<Created> {
  const repo = sanitizeSegment(basename(root)) || "repo";
  const name = slugName(o.name) || (o.pr ? `pr-${o.pr.number}` : "workspace");
  let start: { sha: string; ref: string }, upstream: string | null = null;
  if (o.pr) {
    const { sha, remote } = await fetchPr(root, o.pr);
    start = { sha, ref: o.pr.cross ? `refs/mustard/pull/${o.pr.number}` : `refs/remotes/${remote}/${o.pr.headRefName}` };
    if (!o.pr.cross) upstream = `${remote}/${o.pr.headRefName}`;
  } else {
    start = await resolveBase(root, o.base || "HEAD");
  }
  await git(root, ["worktree", "prune"]).catch(() => {}); // 지워진 폴더의 옛 등록 정리
  for (let i = 1; i <= 100; i++) {
    const n = i === 1 ? name : `${name}-${i}`;
    const branch = o.pr ? (i === 1 ? o.pr.headRefName : `${o.pr.headRefName}-${i}`) : branchFor(o.prefix ?? "", n);
    const dir = join(workspacesDir(), repo, n);
    if (!isUnder(workspacesDir(), dir)) throw new Error("bad path");
    if (existsSync(dir) || !(await validBranch(root, branch)) || (await branchExists(root, branch, !o.pr))) continue;
    if (i > 1 && upstream) upstream = null; // 이름이 바뀌었으면 PR 브랜치를 바로 추적하지 않음(겹친 로컬 브랜치와 헷갈리지 않게)
    mkdirSync(join(dir, ".."), { recursive: true });
    await git(root, ["worktree", "add", "--no-track", "-b", branch, dir, start.sha]);
    await git(root, ["config", "--local", `branch.${branch}.base`, start.ref]).catch(() => {}); // 나중 비교 기준(Orca)
    if (upstream) await git(root, ["branch", `--set-upstream-to=${upstream}`, branch]).catch(() => {});
    clearSetupState(root, dir);
    const bootstrap = await materialize(root, dir).catch((e): MaterializeReport => ({ shared: [], copied: [], skipped: [{ path: "*", reason: String((e as Error)?.message ?? e).slice(0, 200) }] }));
    return { dir, branch, base: start.ref, bootstrap };
  }
  throw new Error("name taken");
}

function isUnder(base: string, p: string) { const r = relative(resolve(base), resolve(p)); return !!r && !r.startsWith("..") && !isAbsolute(r); }
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };

// 이 레포에 등록된 worktree인지 + 지워도 되는 것인지(메인·Crew·잠긴 것 거부)
export async function findWorktree(root: string, dir: string): Promise<{ branch: string | null; locked: boolean }> {
  const out = await git(root, ["worktree", "list", "--porcelain"]);
  const blocks = out.split("\n\n").map((b) => b.split("\n"));
  const target = real(dir);
  for (const [k, lines] of blocks.entries()) {
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || real(path) !== target) continue;
    if (k === 0) throw new Error("main worktree");
    if (isUnder(crewDir(), path)) throw new Error("crew worktree");
    const b = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    return { branch: b, locked: lines.some((l) => l.startsWith("locked")) };
  }
  throw new Error("not a worktree of this repo");
}

// 지우기 전 점검 — 미커밋(Orca preflight와 같은 status)·미푸시(upstream 있으면 앞선 수, 없으면 어느 원격에도 없는 커밋 수). 경고용.
export interface Check { branch: string | null; dirty: number; ignored: string[]; ignoredCount: number; unpushed: number | null; archive: { script: string; trusted: boolean; tooLong: boolean } | null }
export async function checkWorkspace(root: string, dir: string): Promise<Check> {
  const { branch } = await findWorktree(root, dir);
  // 점검이 실패하면 0개로 치지 않고 에러 — 모른 채 지우지 않게(리뷰)
  const st = existsSync(dir) ? await git(dir, ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"]) : "";
  const dirty = st ? st.split("\n").filter(Boolean).length : 0;
  // gitignore된 것도 같이 지워짐(worktree remove는 ignored를 깨끗하다고 봄, 리뷰) — 메인에서 복사·공유해 온 것(.worktreeinclude·sharedDirectories)은 메인에 원본이 있으니 뺌
  const fromMain = new Set([...readInclude(root), ...readConfig(root).sharedDirectories].map((p) => p.replace(/\/+$/, "")));
  // ls-files --directory = 통째로 무시된 폴더(node_modules 등)는 한 줄로, 안까지 안 훑음(큰 레포에서 느려지지 않게, 리뷰)
  const ign = existsSync(dir) ? await git(dir, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]) : "";
  const all = ign.split("\n").filter(Boolean).map((l) => l.replace(/\/+$/, "")).filter((p) => !fromMain.has(p));
  const ignored = all.slice(0, 50), ignoredCount = all.length; // 화면엔 50개까지, 비교는 전체 수로(리뷰)
  let unpushed: number | null = null;
  if (existsSync(dir)) {
    const hasUp = await ok(git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]));
    unpushed = Number(await git(dir, hasUp ? ["rev-list", "--count", "@{u}..HEAD"] : ["rev-list", "--count", "HEAD", "--not", "--remotes"]).catch(() => "NaN"));
    if (!Number.isFinite(unpushed)) unpushed = null; // 모름(원격 없음 등)
  }
  const { archive } = readConfig(root);
  return { branch, dirty, ignored, ignoredCount, unpushed, archive: archive ? { script: archive, trusted: isTrusted(root, archive), tooLong: archive.length > MAX_REVIEW } : null };
}

export type RemoveResult =
  | { status: "dirty"; dirty: number }                           // force 없이 미커밋 있음
  | { status: "archive-untrusted"; script: string }              // archive 승인 먼저
  | { status: "archive-failed"; result: ScriptResult }           // archive 실패 — 지우지 않음(Orca), allowFailedArchive면 계속
  | { status: "removed"; branch: string | null; branchKept: boolean };

export interface RemoveOpts { force?: boolean; expectDirty?: number; expectIgnored?: number; deleteBranch?: boolean; skipArchive?: boolean; allowFailedArchive?: boolean }
// 지우기 — 잠김 거부 → (force 아니면) 미커밋 막음 → archive(승인 필요) → worktree remove → (선택) 로컬 브랜치 -d, 실패면 남김 → prune
export async function removeWorkspace(root: string, dir: string, o: RemoveOpts = {}): Promise<RemoveResult> {
  const { branch, locked } = await findWorktree(root, dir);
  if (locked) throw new Error("locked");
  const present = existsSync(dir);
  // 사람이 본 것보다 늘었으면 멈추고 다시 보여 줌 — 미커밋은 force여도 본 개수까지만, gitignore된 것도 본 개수까지만(리뷰).
  // archive 앞에서만 셈: archive는 사람이 승인한 정리 스크립트라 그게 만든 건 스크립트 몫(뒤에서 세면 매번 늘어 끝없이 다시 묻게 됨, 리뷰)
  if (present) {
    const c = await checkWorkspace(root, dir);
    if ((c.dirty && (!o.force || c.dirty > (o.expectDirty ?? 0))) || c.ignoredCount > (o.expectIgnored ?? 0)) return { status: "dirty", dirty: c.dirty };
  }
  if (present && !o.skipArchive) {
    const { archive } = readConfig(root);
    if (archive && (archive.length > MAX_REVIEW || !isTrusted(root, archive))) return { status: "archive-untrusted", script: archive };
    const r = await runArchive(root, dir, undefined, "state");
    if (r && !r.ok && !o.allowFailedArchive) return { status: "archive-failed", result: r };
  }
  if (present) await git(root, ["worktree", "remove", ...(o.force ? ["--force"] : []), dir]);
  await git(root, ["worktree", "prune"]).catch(() => {});
  let branchKept = !!branch;
  if (branch && o.deleteBranch) branchKept = !(await ok(git(root, ["branch", "-d", "--", branch]))); // 머지 안 된 커밋이 있으면 git이 거부 → 남김(Orca)
  if (branch && o.deleteBranch && branchKept) keptBranches.add(`${root}\0${branch}`);
  return { status: "removed", branch, branchKept };
}

// 남긴 브랜치를 사람이 강제로 — 방금 작업공간을 지우며 -d가 거부해 남긴 브랜치만(아무 브랜치나 -D 하지 않게, 리뷰), 어느 worktree에서도 안 쓰는 것만
const keptBranches = new Set<string>(); // ponytail: 서버 메모리 — 재시작하면 잊음(그땐 터미널에서 git branch -D)
export async function forceDeleteBranch(root: string, branch: string): Promise<void> {
  if (!keptBranches.has(`${root}\0${branch}`)) throw new Error("not a kept branch");
  if (!(await validBranch(root, branch))) throw new Error("bad branch");
  const used = (await git(root, ["worktree", "list", "--porcelain"])).split("\n").some((l) => l === `branch refs/heads/${branch}`);
  if (used) throw new Error("branch in use");
  await git(root, ["branch", "-D", "--", branch]);
  keptBranches.delete(`${root}\0${branch}`);
}


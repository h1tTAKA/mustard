// Crew 카드별 작업 폴더(#1100) — git worktree로 격리. 서버 전용.
// 위치 ~/.nunopi/worktrees/<sha(root)>/<id8> (레포 밖), 브랜치 crew/<id8>[-slug]. 사람의 작업 폴더·브랜치는 안 건드림.
// 결과물 폴더 .crew/는 공유 .git/info/exclude에 넣어 커밋에 안 섞이게.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { materialize, runArchive, type MaterializeReport } from "./worktreeBootstrap.ts";

const pexec = promisify(execFile);
const git = async (cwd: string, args: string[]) => (await pexec("git", args, { cwd, timeout: 120_000, maxBuffer: 10_000_000 })).stdout.trim();
const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_WORKTREE_DIR || join(homedir(), ".nunopi", "worktrees");

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");

export function worktreeFor(root: string, taskId: string, title: string): { dir: string; branch: string } {
  const id8 = taskId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  const s = slug(title);
  return { dir: join(baseDir(), sha(normPath(root)), id8), branch: `crew/${id8}${s ? `-${s}` : ""}` };
}

// #1135 crew/<id8>[-slug] 브랜치 → 그 카드 작업 폴더·id8(캐치업 세션 찾기가 worktree 기록 폴더도 보게). crew 브랜치 아니면 null.
export function crewDirForBranch(root: string, branch: string): { dir: string; id8: string } | null {
  const m = /^crew\/([0-9a-z]{1,8})(?:-|$)/.exec(branch);
  return m ? { dir: join(baseDir(), sha(normPath(root)), m[1]), id8: m[1] } : null;
}

async function isWorktree(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false;
  try { return (await git(dir, ["rev-parse", "--is-inside-work-tree"])) === "true"; } catch { return false; }
}

// .crew/를 공유 exclude에 한 번만(worktree들은 메인 레포의 info/exclude를 같이 씀).
async function excludeCrewDir(root: string) {
  let common = await git(root, ["rev-parse", "--git-common-dir"]);
  if (!isAbsolute(common)) common = join(root, common);
  const ex = join(common, "info", "exclude");
  mkdirSync(join(common, "info"), { recursive: true });
  const cur = existsSync(ex) ? readFileSync(ex, "utf8") : "";
  const lines = cur.split("\n").map((l) => l.trim());
  const add = [".crew/", ".sna/"].filter((x) => !lines.includes(x)); // .sna/ = SNA가 작업 폴더에 만드는 런타임 파일(#1108)
  if (add.length) appendFileSync(ex, `${cur && !cur.endsWith("\n") ? "\n" : ""}# Mustard Crew 결과물·런타임(#1100·#1108)\n${add.join("\n")}\n`);
}

// 있으면 재사용, 없으면 현재 HEAD에서 새 브랜치로 만듦(브랜치만 남아 있으면 그 브랜치로 다시 붙임).
// from = 새 브랜치를 만들 때 시작점(#1114 의존 카드의 브랜치 — 앞 작업 위에 쌓기). 없거나 못 찾으면 HEAD.
export async function ensureWorktree(root: string, taskId: string, title: string, from?: string): Promise<{ dir: string; branch: string; base: string; created: boolean; bootstrap?: MaterializeReport }> {
  const { dir, branch } = worktreeFor(root, taskId, title);
  const base = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD");
  await excludeCrewDir(root);
  if (await isWorktree(dir)) {
    mkdirSync(join(dir, ".crew"), { recursive: true });
    const cur = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => branch);
    return { dir, branch: cur === "HEAD" ? branch : cur, base, created: false }; // 분리 HEAD면 계산한 이름(리뷰)
  }
  await git(root, ["worktree", "prune"]).catch(() => {}); // 지워진 폴더의 옛 등록 정리(같은 경로 재사용 막힘 방지)
  mkdirSync(join(dir, ".."), { recursive: true });
  const exists = await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false);
  const start = from && (await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${from}`]).then(() => true, () => false)) ? from : "HEAD";
  await git(root, exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, start]);
  mkdirSync(join(dir, ".crew"), { recursive: true });
  // #1176 새로 만들 때만 — .worktreeinclude 복사·sharedDirectories 공유(실패해도 worktree는 씀, 보고에 남김)
  const bootstrap = await materialize(root, dir).catch((e): MaterializeReport => ({ shared: [], copied: [], skipped: [{ path: "*", reason: String((e as Error)?.message ?? e).slice(0, 200) }] }));
  return { dir, branch, base, created: true, bootstrap };
}

// 폴더만 정리 — 브랜치(에이전트가 한 커밋)는 남김. 사람이 머지·삭제를 결정.
export async function removeWorktree(root: string, taskId: string, title: string): Promise<void> {
  const { dir } = worktreeFor(root, taskId, title);
  if (await isWorktree(dir)) {
    await runArchive(root, dir).catch(() => null); // #1176 승인된 archive 스크립트 먼저(실패해도 지우기는 진행)
    await git(root, ["worktree", "remove", "--force", dir]);
  }
  await git(root, ["worktree", "prune"]).catch(() => {});
}

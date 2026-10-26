import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkWorkspace, createWorkspace, forceDeleteBranch, pruneWorkspaces, removeWorkspace, findWorktree, type PrStart } from "@/lib/repo/workspaces";
import { markSetupDone, MAX_REVIEW, readConfig, runSetup, trustScript } from "@/lib/crew/worktreeBootstrap";

// 사람용 worktree 작업공간(#1170) — 만들기·점검·지우기·브랜치 강제 삭제·정리·setup 실행·스크립트 승인. 로컬 git 쓰기. 서버 전용.
// path = 레포 탭 경로(메인이든 그 레포의 worktree든) → 메인 worktree를 root로 씀(archive 설정·승인 기록은 메인 기준, #1176과 같음).
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

async function mainRoot(path: string): Promise<string> {
  const out = (await pexecFile("git", ["worktree", "list", "--porcelain"], { cwd: path, timeout: 15000 })).stdout;
  const first = out.split("\n").find((l) => l.startsWith("worktree "));
  if (!first) throw new Error("not a git repo");
  return first.slice(9);
}
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(request: Request): Promise<Response> {
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  const path = str(b.path).trim();
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) return Response.json({ ok: false, error: "not a directory" }, { status: 400 });
  try {
    const root = await mainRoot(path);
    const dir = str(b.dir).trim();
    switch (b.action) {
      case "create": {
        const pr = b.pr as Partial<PrStart> | undefined;
        const prStart = pr && typeof pr === "object" ? { number: Number(pr.number), headRefName: str(pr.headRefName), headRefOid: str(pr.headRefOid) || undefined, cross: !!pr.cross } : undefined;
        const r = await createWorkspace(root, { name: str(b.name), base: str(b.base) || undefined, prefix: str(b.prefix), pr: prStart });
        return Response.json({ ok: true, ...r });
      }
      case "check": return Response.json({ ok: true, ...(await checkWorkspace(root, dir)) });
      case "remove": return Response.json({ ok: true, ...(await removeWorkspace(root, dir, { force: !!b.force, deleteBranch: !!b.deleteBranch, skipArchive: !!b.skipArchive, allowFailedArchive: !!b.allowFailedArchive })) });
      case "delete-branch": await forceDeleteBranch(root, str(b.branch)); return Response.json({ ok: true });
      case "prune": await pruneWorkspaces(root); return Response.json({ ok: true });
      case "setup": { // 새 작업공간의 setup — 승인 전이면 untrusted(스크립트 내용 돌려줌), 승인됐으면 실행(#1176 runSetup, 로그는 작업 폴더 밖)
        await findWorktree(root, dir);
        return Response.json({ ok: true, ...(await runSetup(root, dir, undefined, "state")) });
      }
      case "trust": { // 보여 준 내용과 지금 스크립트가 같을 때만 승인(#1176 decideCard와 같음). skip = 이번 setup 안 돌림
        const kind = b.kind === "archive" ? "archive" : "setup";
        if (kind === "setup") await findWorktree(root, dir);
        const cur = kind === "archive" ? readConfig(root).archive : readConfig(dir).setup;
        if (!cur || cur !== str(b.script) || cur.length > MAX_REVIEW) return Response.json({ ok: false, error: "script changed" });
        if (b.skip && kind === "setup") markSetupDone(root, dir, "skipped");
        else if (!b.skip) trustScript(root, cur);
        return Response.json({ ok: true });
      }
      default: return Response.json({ ok: false, error: "bad action" }, { status: 400 });
    }
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return Response.json({ ok: false, error: (err.stderr || err.message || "failed").trim().slice(0, 500) });
  }
}

import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkWorkspace, createWorkspace, forceDeleteBranch, removeWorkspace, findWorktree, type PrStart } from "@/lib/repo/workspaces";
import { crossSite } from "@/lib/crew/crewPolicy";
import { markSetupDone, MAX_REVIEW, readRepoPrefs, readRepoScripts, runSetup, setupScriptFor, readConfig, trustScript, writeRepoPrefs, writeRepoScripts } from "@/lib/crew/worktreeBootstrap";

// 사람용 worktree 작업공간(#1170) — 만들기·점검·지우기·브랜치 강제 삭제·setup 실행·스크립트 승인. 로컬 git 쓰기. 서버 전용.
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
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 }); // 다른 사이트의 폼 POST로 작업공간·브랜치 지우기 금지(Crew #1137과 같음, 리뷰)
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  const path = str(b.path).trim();
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) return Response.json({ ok: false, error: "not a directory" }, { status: 400 });
  try {
    const root = await mainRoot(path);
    const dir = str(b.dir).trim();
    if (b.action !== "create" && b.action !== "delete-branch" && b.action !== "config-get" && b.action !== "config-set" && !(b.action === "trust" && b.kind === "archive") && (!dir || !isAbsolute(dir))) return Response.json({ ok: false, error: "dir required" }, { status: 400 }); // 빈 값이면 서버 cwd로 풀리지 않게(리뷰)
    switch (b.action) {
      case "create": {
        const pr = b.pr as Partial<PrStart> | undefined;
        const prStart = pr && typeof pr === "object" ? { number: Number(pr.number), headRefName: str(pr.headRefName), headRefOid: str(pr.headRefOid) || undefined, cross: !!pr.cross } : undefined;
        const r = await createWorkspace(root, { name: str(b.name), base: str(b.base) || undefined, prefix: str(b.prefix), pr: prStart });
        return Response.json({ ok: true, ...r });
      }
      case "check": return Response.json({ ok: true, ...(await checkWorkspace(root, dir)) });
      case "remove": return Response.json({ ok: true, ...(await removeWorkspace(root, dir, { force: !!b.force, expectDirty: Number(b.expectDirty) || 0, expectIgnored: Number(b.expectIgnored) || 0, deleteBranch: !!b.deleteBranch, skipArchive: !!b.skipArchive, allowFailedArchive: !!b.allowFailedArchive })) });
      case "delete-branch": await forceDeleteBranch(root, str(b.branch)); return Response.json({ ok: true });
      case "setup": { // 새 작업공간의 setup — 승인 전이면 untrusted(스크립트 내용 돌려줌), 승인됐으면 실행(#1176 runSetup, 로그는 작업 폴더 밖)
        await findWorktree(root, dir);
        if (!readRepoPrefs(root).setupAuto) return Response.json({ ok: true, status: "off" }); // #1216 이 레포는 자동 실행 끔
        return Response.json({ ok: true, ...(await runSetup(root, dir, undefined, "state")) });
      }
      case "trust": { // 보여 준 내용과 지금 스크립트가 같을 때만 승인(#1176 decideCard와 같음). skip = 이번 setup 안 돌림
        const kind = b.kind === "archive" ? "archive" : "setup";
        if (kind === "setup") await findWorktree(root, dir);
        const cur = kind === "archive" ? readConfig(root).archive : setupScriptFor(root, dir); // #1216 runSetup과 같은 출처
        if (!cur || cur !== str(b.script) || cur.length > MAX_REVIEW) return Response.json({ ok: false, error: "script changed" });
        if (b.skip && kind === "setup") markSetupDone(root, dir, "skipped");
        else if (!b.skip) trustScript(root, cur);
        return Response.json({ ok: true });
      }
      // #1216 작업공간 설정 창 — 메인 체크아웃의 .mustard/config.json + 내 PC 설정(자동 실행)
      case "config-get": return Response.json({ ok: true, ...readRepoScripts(root), ...readRepoPrefs(root) });
      case "config-set": {
        const shared = Array.isArray(b.shared) ? b.shared.filter((x): x is string => typeof x === "string") : [];
        const r = writeRepoScripts(root, { setup: str(b.setup), archive: str(b.archive), shared });
        if (r !== "ok") return Response.json({ ok: false, error: r });
        writeRepoPrefs(root, { setupAuto: b.setupAuto !== false });
        return Response.json({ ok: true });
      }
      default: return Response.json({ ok: false, error: "bad action" }, { status: 400 });
    }
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return Response.json({ ok: false, error: (err.stderr || err.message || "failed").trim().slice(0, 500) });
  }
}

import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { branchesFromReflog } from "@/lib/reflogBranch";
import { commitMs } from "@/lib/catchupMeta";

// 최근 커밋(#1054) — HEAD 이력 중 커밋 시각(committer)이 since(유닉스 초) 이후인 것. 커밋 자동 설명이 "새 커밋"을 찾는 데 씀.
// 시각 기준이라 예전 브랜치로 전환해도 옛 커밋은 안 잡힘. 최대 20개(최신순), 머지는 merge: true.
// #1135 Crew(역할 에이전트)는 worktree의 crew/* 브랜치에 커밋 → HEAD 이력에 없음. crew/* 브랜치도 같이 봐서 기존 diff 자동 분석이 Crew 커밋에도.
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

export async function POST(request: Request): Promise<Response> {
  let path: unknown, since: unknown, limit: unknown;
  try { ({ path, since, limit } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (typeof since !== "number" || !Number.isFinite(since) || since < 0) return Response.json({ error: "bad since" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    // limit(선택, 기본 20·최대 100) — #1235 세션 카드 되살리기가 하루치를 훑을 때 늘려 씀.
    // 머지 커밋도 포함(#1064 머지 세션) — merge 표시로 Diff 자동 설명은 건너뜀(머지 diff는 브랜치 전체라 큼).
    const { stdout } = await pexecFile("git", ["log", "HEAD", "--branches=crew/*", "--date-order", "-n", String(typeof limit === "number" && limit >= 1 ? Math.min(Math.floor(limit), 100) : 20), `--since=@${Math.floor(since)}`, "--format=%H%x1f%ct%x1f%P%x1f%s"], { cwd: path, timeout: 8000 });
    const commits = stdout.split("\n").filter(Boolean).map((l) => { const [hash, ct, parents = "", subject = ""] = l.split("\x1f"); return { hash, ts: Number(ct), subject, merge: parents.trim().split(/\s+/).length > 1 }; });
    // Crew 커밋 = crew 브랜치에만 있고 HEAD엔 없는 것(--not HEAD). --source만 쓰면 내 브랜치와 공유하는 옛 커밋도 crew로 적힘(리뷰)
    const crewOnly = new Map<string, string>();
    if (commits.length) {
      const c = await pexecFile("git", ["log", "--branches=crew/*", "--not", "HEAD", "--source", "-n", "200", `--since=@${Math.floor(since)}`, "--format=%H%x1f%S"], { cwd: path, timeout: 8000 }).catch(() => ({ stdout: "" }));
      for (const l of c.stdout.split("\n")) { const [h, src = ""] = l.split("\x1f"); if (h && src.startsWith("crew/")) crewOnly.set(h, src); }
    }
    // #1062 캐치업 diff 카드에 "어느 브랜치·커밋" 표시용 — 지금 HEAD 브랜치(분리 HEAD면 "HEAD").
    const branch = (await pexecFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: path, timeout: 4000 }).catch(() => ({ stdout: "" }))).stdout.trim();
    // #1068 커밋마다 "만들 때 브랜치"(HEAD reflog) — 앱이 꺼져 있다가 몰아서 처리해도 지금 브랜치가 아니라 그때 브랜치. 모르면 지금 브랜치.
    const reflog = commits.length ? (await pexecFile("git", ["reflog", "-n", "2000", "--format=%H%x1f%gs"], { cwd: path, timeout: 4000 }).catch(() => ({ stdout: "" }))).stdout : "";
    const at = branchesFromReflog(reflog.split("\n").filter(Boolean));
        // #1255 ms = 카드 시각(같은 초 커밋도 커밋 순서대로) — --date-order라 자식이 부모보다 먼저
    return Response.json({ ok: true, commits: commitMs(commits).map((c) => ({ ...c, branch: crewOnly.get(c.hash) ?? at.get(c.hash) ?? branch })), branch });
  } catch (e) {
    // 커밋 없는 새 레포(HEAD 없음) 등 — 빈 목록
    return Response.json({ ok: true, commits: [], note: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}

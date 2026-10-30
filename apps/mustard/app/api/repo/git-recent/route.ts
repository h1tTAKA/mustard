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
    const n = typeof limit === "number" && limit >= 1 ? Math.min(Math.floor(limit), 100) : 20;
    const { stdout } = await pexecFile("git", ["log", "HEAD", "--branches=crew/*", "--date-order", "-n", String(n), `--since=@${Math.floor(since)}`, "--format=%H%x1f%ct%x1f%P%x1f%s"], { cwd: path, timeout: 8000 });
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
    // 개수 상한(-n)에 걸렸을 때만(평소 폴링은 since 이후라 드묾) 같은 초 묶음이 잘렸을 수 있음 → 최근 1000개를 다시 받아 목록의 가장 이른 초 이후 전체로 셈(리뷰).
    //  --since는 시계가 어긋난 커밋이 있으면 탐색이 일찍 끊겨 빠질 수 있어 안 쓰고 JS에서 거름. 창 안에서 잘리면 경고(시각이 순서대로라는 전제 — 시계 어긋남 + 1000개 + 같은 초가 겹치면 경고 없이 몇 ms 어긋날 수 있음, 감수).
    let full: { hash: string; ts: number }[] = commits;
    if (commits.length >= n) {
      const minT = Math.min(...commits.map((c) => c.ts));
      const g = await pexecFile("git", ["log", "HEAD", "--branches=crew/*", "--date-order", "-n", "1000", "--format=%H%x1f%ct"], { cwd: path, timeout: 8000 })
        .catch((e) => { console.warn("[git-recent] 같은 초 커밋 다시 받기 실패 — 받은 목록으로만 셈:", (e as Error).message); return null; });
      if (g) {
        const all = g.stdout.split("\n").filter(Boolean).map((l) => { const [hash, ct] = l.split("\x1f"); return { hash, ts: Number(ct) }; });
        if (all.length >= 1000 && all[all.length - 1].ts >= minT) console.warn("[git-recent] 다시 받기 1000개 상한에서 잘림 — 같은 초 순서가 조금 어긋날 수 있음"); // 실제로 창 안에서 잘렸을 때만(리뷰)
        full = all.filter((c) => c.ts >= minT);
      }
    }
    const msBy = new Map(commitMs(full).map((c) => [c.hash, c.ms]));
    if (commits.some((c) => !msBy.has(c.hash))) console.warn("[git-recent] 순서를 못 센 커밋 있음 — 초 단위로 둠");
    return Response.json({ ok: true, commits: commits.map((c) => ({ ...c, ms: msBy.get(c.hash) ?? c.ts * 1000, branch: crewOnly.get(c.hash) ?? at.get(c.hash) ?? branch })), branch });
  } catch (e) {
    // 커밋 없는 새 레포(HEAD 없음) 등 — 빈 목록
    return Response.json({ ok: true, commits: [], note: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}

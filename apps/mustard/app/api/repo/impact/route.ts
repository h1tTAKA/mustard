// 영향 강조용 "바뀐 파일" 목록(#1322) — 서버 전용. 경로는 레포 루트(path) 기준 상대(그래프 노드 id와 같게).
// POST {path, base}:
//   base "analysis" — 기능 목록 분석(저장) 때 스냅샷과 지금 비교(#1320 archStore). 저장분·스냅샷 없으면 noBase.
//   base "worktree" — 커밋 안 한 변경(git diff HEAD) + 추적 안 하는 새 파일.
//   base "branch"   — 기본 브랜치(origin/HEAD → main → master)와 갈라진 지점부터 지금까지(커밋 안 한 것 포함).
// execFile(셸 없음) + --relative(하위 폴더 레포도 루트 기준 경로).
import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { crossSite } from "@/lib/crew/crewPolicy";
import { readArch, currentSnap, diffFrom } from "@/lib/repo/archStore";

export const runtime = "nodejs";
const pexecFile = promisify(execFile);
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const zlist = (s: string) => s.split("\0").filter(Boolean); // -z 출력 — 한글 등 비ASCII·공백 이름도 따옴표·이스케이프 없이 그대로(리뷰)

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ error: "cross-site" }, { status: 403 });
  let b: { path?: unknown; base?: unknown };
  try { b = await request.json(); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (!b || typeof b !== "object") return Response.json({ error: "invalid body" }, { status: 400 });
  const { path, base } = b;
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (base !== "analysis" && base !== "worktree" && base !== "branch") return Response.json({ error: "base must be analysis|worktree|branch" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  const git = async (args: string[]) => (await pexecFile("git", args, { cwd: path, maxBuffer: 20_000_000, timeout: 8000 })).stdout;

  try {
    if (base === "analysis") {
      const d = diffFrom(readArch(path).cats, await currentSnap(path));
      return d ? Response.json({ files: [...d.changed, ...d.removed] }) : Response.json({ files: [], noBase: true });
    }
    let from = "HEAD";
    if (base === "branch") {
      let ref = "";
      try { ref = lines(await git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]))[0]?.replace(/^refs\/remotes\//, "") ?? ""; } catch { /* origin/HEAD 없음 */ }
      for (const cand of [ref, "main", "master"]) {
        if (!cand) continue;
        try { await git(["rev-parse", "--verify", "--quiet", cand]); ref = cand; break; } catch { ref = ""; }
      }
      if (!ref) return Response.json({ files: [], noBase: true });
      from = lines(await git(["merge-base", "HEAD", ref]))[0];
    }
    const changed = zlist(await git(["diff", "--name-only", "-z", "--relative", from]));
    const untracked = zlist(await git(["ls-files", "-z", "--others", "--exclude-standard"]));
    return Response.json({ files: [...new Set([...changed, ...untracked])].sort() });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}

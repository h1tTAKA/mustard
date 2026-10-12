import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// 최근 커밋(#1054) — HEAD 이력 중 커밋 시각(committer)이 since(유닉스 초) 이후인 것. 커밋 자동 설명이 "새 커밋"을 찾는 데 씀.
// 시각 기준이라 예전 브랜치로 전환해도 옛 커밋은 안 잡힘. 머지 커밋 제외, 최대 20개(최신순).
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

export async function POST(request: Request): Promise<Response> {
  let path: unknown, since: unknown;
  try { ({ path, since } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (typeof since !== "number" || !Number.isFinite(since) || since < 0) return Response.json({ error: "bad since" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const { stdout } = await pexecFile("git", ["log", "HEAD", "--no-merges", "-n", "20", `--since=@${Math.floor(since)}`, "--format=%H%x1f%ct"], { cwd: path, timeout: 8000 });
    const commits = stdout.split("\n").filter(Boolean).map((l) => { const [hash, ct] = l.split("\x1f"); return { hash, ts: Number(ct) }; });
    return Response.json({ ok: true, commits });
  } catch (e) {
    // 커밋 없는 새 레포(HEAD 없음) 등 — 빈 목록
    return Response.json({ ok: true, commits: [], note: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}

import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isSafeRef } from "@/lib/repo/gitBranches";

// 브랜치 전환(#1025) — 로컬: git switch <name> / 원격 전용: git switch --track <remote/name>(같은 이름 로컬 추적 브랜치 생성).
// 더티 워킹트리는 자동 stash 안 함(유저 변경 유실 위험) — git이 막으면 stderr를 그대로 돌려줘 토스트로 보여줌.
export const runtime = "nodejs";
const pexecFile = promisify(execFile);

export async function POST(request: Request): Promise<Response> {
  let rawPath: unknown, branch: unknown, remote: unknown, prev: unknown;
  try { ({ path: rawPath, branch, remote, prev } = await request.json()); } catch { return Response.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  if (typeof rawPath !== "string" || !rawPath.trim()) return Response.json({ ok: false, error: "path required" }, { status: 400 });
  const path = rawPath.trim();
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ ok: false, error: "not a directory" }, { status: 400 });
  if (prev !== true && (typeof branch !== "string" || !isSafeRef(branch))) return Response.json({ ok: false, error: "invalid branch" }, { status: 400 });
  try {
    // prev: 이전 위치로(#1025) — `git checkout -`는 직전이 브랜치가 아닌 커밋(분리 HEAD)이어도 돌아감(switch -는 브랜치만).
    const args = prev === true ? ["checkout", "-"] : remote === true ? ["switch", "--track", branch as string] : ["switch", branch as string];
    await pexecFile("git", args, { cwd: path, maxBuffer: 20_000_000, timeout: 20000, env: { ...process.env, LC_ALL: "C" } }); // 오류 글을 영어로 — 화면이 "브랜치 없음"을 알아보게(#1143 재리뷰)
    return Response.json({ ok: true });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return Response.json({ ok: false, error: (err.stderr || err.message || "git failed").trim().slice(0, 500) });
  }
}

import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { scanAllFiles } from "@/lib/repo/scan";

// 워크스페이스 파일트리(#647) — 선택 폴더의 전체 파일 목록. 서버 전용(fs).
// 전체 파일(확장자 무관, 숨김파일 포함), 정크 폴더(node_modules·.git 등) 제외 + 상한. 트리화는 클라에서.
// #1218 hideIgnored = .gitignore에 걸린 파일 빼기(설정 "gitignore 파일 보이기" 끔) — git 레포 아니거나 실패면 그대로.
export const runtime = "nodejs";

// --no-index 없음 = git이 이미 추적하는 파일은 규칙에 걸려도 남김(레포의 일부라서, 리뷰)
// git check-ignore에 목록을 통째로(NUL 구분) 넣고 걸린 것만 받음. 0 = 하나 이상 걸림, 1 = 없음, 그 외(128 레포 아님 등) = 거르지 않음
// 한계: 상한(MAX_FILES)을 거르기 전에 셈 — 무시 파일이 많으면 거른 뒤 목록이 상한보다 짧음, 그때는 걷기 단계에서 거르기
function ignoredOf(cwd: string, files: string[]): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    const p = spawn("git", ["check-ignore", "--stdin", "-z"], { cwd });
    let out = "";
    const timer = setTimeout(() => { p.kill(); resolve(null); }, 10_000);
    p.stdout.setEncoding("utf8").on("data", (d: string) => { out += d; });
    p.on("error", () => { clearTimeout(timer); resolve(null); });
    p.on("close", (code) => { clearTimeout(timer); resolve(code === 0 || code === 1 ? new Set(out.split("\0").filter(Boolean)) : null); });
    p.stdin.on("error", () => {}); // git이 먼저 끝나 파이프가 닫혀도 죽지 않게
    p.stdin.end(files.join("\0"));
  });
}

export async function POST(request: Request): Promise<Response> {
  let path: unknown, hideIgnored: unknown;
  try { ({ path, hideIgnored } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
  try {
    const { files, capped } = scanAllFiles(path);
    const ign = hideIgnored === true && files.length ? await ignoredOf(path, files) : null;
    return Response.json({ files: ign ? files.filter((f) => !ign.has(f)) : files, capped });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

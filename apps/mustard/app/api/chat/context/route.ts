// 채팅 입력 카드 아래 상태 줄(#1341) — GET ?root= → {host, folder, worktree, branch}. 기기 이름은 macOS 컴퓨터 이름(없으면 hostname).
import { isAbsolute, basename } from "node:path";
import { hostname } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
const run = promisify(execFile);
const out = (cmd: string, args: string[]) => run(cmd, args, { encoding: "utf8", timeout: 3000 }).then((r) => r.stdout.trim()).catch(() => "");
let host: Promise<string> | null = null;

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  host ??= (process.platform === "darwin" ? out("scutil", ["--get", "ComputerName"]) : Promise.resolve("")).then((h) => h || hostname().replace(/\.local$/, ""));
  const [branch, gitDir, common] = await Promise.all([
    out("git", ["-C", root, "branch", "--show-current"]),
    out("git", ["-C", root, "rev-parse", "--absolute-git-dir"]),
    out("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  return Response.json({ ok: true, host: await host, folder: basename(root), worktree: !!gitDir && !!common && gitDir !== common, branch });
}

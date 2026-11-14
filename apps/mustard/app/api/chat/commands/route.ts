// 채팅 슬래시 커맨드(#1341) — GET ?root=&provider= → 내 커맨드·스킬 목록.
import { isAbsolute } from "node:path";
import { listCommands } from "@/lib/chat/chatExtras";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  return Response.json({ ok: true, commands: listCommands(root, sp.get("provider") ?? "claude-code") });
}

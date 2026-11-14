// 채팅 @파일 자동완성(#1341) — GET ?root=&q= → 레포 파일 경로 30개.
import { isAbsolute } from "node:path";
import { findFiles } from "@/lib/chat/chatExtras";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  return Response.json({ ok: true, files: await findFiles(root, (sp.get("q") ?? "").slice(0, 200)) });
}

// 채팅 권한 카드 답(#1341) — {root, id, permId, allow}.
import { isAbsolute } from "node:path";
import { answerPermission } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let b: { root?: unknown; id?: unknown; permId?: unknown; allow?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (typeof b.root !== "string" || !isAbsolute(b.root) || typeof b.id !== "string" || typeof b.permId !== "string") return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  return Response.json({ ok: answerPermission(b.root, b.id, b.permId, b.allow === true) });
}

// 채팅 멈춤(#1341) — {root, id}. 하던 일만 끊고 에이전트는 남음(이어서 보낼 수 있음).
import { isAbsolute } from "node:path";
import { stopChat } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let b: { root?: unknown; id?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (typeof b.root !== "string" || !isAbsolute(b.root) || typeof b.id !== "string") return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  return Response.json({ ok: await stopChat(b.root, b.id) });
}

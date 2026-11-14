// 채팅 탭 목록(#1341) — GET ?root= 목록 / POST {root, op:"create", provider} 새 탭 · {root, op:"close", id} 닫기(에이전트도 끔).
import { isAbsolute } from "node:path";
import { closeChat, createChat, listChats } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  return Response.json({ ok: true, chats: listChats(root) });
}

export async function POST(request: Request): Promise<Response> {
  let b: { root?: unknown; op?: unknown; provider?: unknown; id?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  if (b.op === "create") return Response.json({ ok: true, chat: createChat(root, b.provider === "codex" ? "codex" : "claude-code") });
  if (b.op === "close" && typeof b.id === "string") return Response.json({ ok: await closeChat(root, b.id) });
  return Response.json({ ok: false, error: "bad op" }, { status: 400 });
}

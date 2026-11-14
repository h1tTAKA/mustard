// 채팅 탭·기록(#1341) — GET ?root= 열린 탭 / ?root=&history=1 기록(최근 순) / ?root=&cli=1 터미널에서 했던 Claude 대화
// POST {root, op, ...}: create{provider,model?,effort?,mode?} · options{id,provider?,model?,effort?,mode?} · close{id}(보관) · reopen{id} · delete{id}
//   · import{cc}(CLI 대화 가져오기) · handoff{id}(터미널로 넘기기 — 채팅 에이전트를 끄고 CLI 대화 id를 돌려줌)
import { isAbsolute } from "node:path";
import { asProvider, closeChat, createChat, deleteChat, handoffChat, historyChats, importCliSession, listChats, listCliSessions, reopenChat, setOptions } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  if (sp.get("cli")) return Response.json({ ok: true, sessions: listCliSessions(root) });
  return Response.json({ ok: true, chats: sp.get("history") ? historyChats(root) : listChats(root) });
}

export async function POST(request: Request): Promise<Response> {
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  const id = typeof b.id === "string" ? b.id : "";
  switch (b.op) {
    case "create": return Response.json({ ok: true, chat: createChat(root, asProvider(b.provider), { model: typeof b.model === "string" ? b.model : undefined, effort: typeof b.effort === "number" ? b.effort : undefined, mode: b.mode === "plan" || b.mode === "full" ? b.mode : undefined }) });
    case "options": { const chat = await setOptions(root, id, b); return Response.json({ ok: !!chat, chat }); }
    case "close": return Response.json({ ok: await closeChat(root, id) });
    case "reopen": { const chat = reopenChat(root, id); return Response.json({ ok: !!chat, chat }); }
    case "delete": return Response.json({ ok: await deleteChat(root, id) });
    case "import": { const chat = typeof b.cc === "string" ? importCliSession(root, b.cc) : null; return Response.json({ ok: !!chat, chat }); }
    case "handoff": { const r = await handoffChat(root, id); return Response.json({ ok: !!r, ...r }); }
  }
  return Response.json({ ok: false, error: "bad op" }, { status: 400 });
}

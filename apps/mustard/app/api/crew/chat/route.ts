// Crew 팀 채팅(#1104) — GET ?root=&since= 메시지 / POST {root, text, replyTo?} 사람 메시지(@역할 새 카드·카드 답글).
import { isAbsolute } from "node:path";
import { readMsgs } from "@/lib/crew/crewChat";
import { postHuman, registerRoot } from "@/lib/crew/crewRunner";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  registerRoot(root, new URL(request.url).origin); // 채팅만 열어 둬도 Ready 카드가 돌게
  try { return Response.json({ ok: true, msgs: readMsgs(root, Number(sp.get("since")) || 0) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  let b: { root?: unknown; text?: unknown; replyTo?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "";
  if (!isAbsolute(root) || typeof b.text !== "string") return Response.json({ ok: false, error: "root/text required" }, { status: 400 });
  registerRoot(root, new URL(request.url).origin);
  try { return Response.json({ ok: true, ...postHuman(root, b.text, typeof b.replyTo === "string" ? b.replyTo : undefined) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

// 채팅 보내기(#1341) — {root, id, text, images?: [{base64, mime}]}. 처음이면 에이전트를 띄우고 보냄. 결과는 stream으로 옴.
import { isAbsolute } from "node:path";
import { sendChat } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let b: { root?: unknown; id?: unknown; text?: unknown; images?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "", id = typeof b.id === "string" ? b.id : "";
  const text = typeof b.text === "string" ? b.text.slice(0, 100_000) : "";
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 8)
    .filter((im): im is { base64: string; mime: string } => !!im && typeof im.base64 === "string" && typeof im.mime === "string");
  if (!isAbsolute(root) || !id || (!text.trim() && !images.length)) return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  const r = await sendChat(root, id, text, images, new URL(request.url).origin);
  return Response.json(r, { status: r.ok ? 200 : 500 });
}

// 채팅 이미지(#1341) — GET ?name=<sha1>.<ext>. 붙여 넣은 이미지·도구 스크린샷. 이름 꼴만 받아 경로 조작 막음.
import { readImage } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const img = readImage(new URL(request.url).searchParams.get("name") ?? "");
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.buf), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=31536000, immutable" } });
}

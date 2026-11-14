// 채팅 모델 목록(#1341) — GET ?provider= → SNA listModels(10분 캐시).
import { asProvider, listModels } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const p = asProvider(new URL(request.url).searchParams.get("provider"));
  try { return Response.json({ ok: true, models: await listModels(p) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e), models: [] }); }
}

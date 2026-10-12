// 캐치업 해설 분석 켜기/끄기(#1062) — POST { narration: boolean }. observe 라우트가 꺼짐이면 AI 호출 없이 반환.
import { setNarrationOn } from "@/lib/narrationConfig";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { narration?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  if (typeof body.narration !== "boolean") return Response.json({ error: "narration boolean required" }, { status: 400 });
  setNarrationOn(body.narration);
  return Response.json({ ok: true });
}

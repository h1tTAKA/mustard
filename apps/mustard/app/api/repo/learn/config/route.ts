// 캐치업 해설 분석 켜기/끄기·AI(#1062) — POST { narration: boolean, provider?: string }. observe 라우트가 꺼짐이면 AI 호출 없이 반환.
import { setNarrationOn, setNarrationProvider, setNarrationModel } from "@/lib/narrationConfig";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { narration?: unknown; provider?: unknown; model?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  if (typeof body.narration !== "boolean") return Response.json({ error: "narration boolean required" }, { status: 400 });
  setNarrationOn(body.narration);
  if (typeof body.provider === "string") setNarrationProvider(body.provider.slice(0, 40));
  if (typeof body.model === "string") setNarrationModel(body.model.slice(0, 80));
  return Response.json({ ok: true });
}

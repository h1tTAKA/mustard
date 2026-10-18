// 앱 언어 → 서버·Electron(#1125) — I18nProvider가 언어가 정해지거나 바뀔 때마다 POST { locale }.
// ~/.nunopi/narration-locale에 기록 → 캐치업 해설·Crew 메시지·Electron main 문구(tm)가 앱 언어를 따름.
import { setNarrationLocale } from "@/lib/narrationConfig";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { locale?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  if (body.locale !== "ko" && body.locale !== "ja" && body.locale !== "en") return Response.json({ error: "locale required" }, { status: 400 });
  setNarrationLocale(body.locale);
  return Response.json({ ok: true });
}

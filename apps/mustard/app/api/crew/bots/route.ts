// 봇(#1394) — GET 설치된 봇 목록 / POST {op:"install"|"create"|"update"|"uninstall", ...} 후 새 목록.
import { applyBotOp, listBots, type BotOp } from "@/lib/crew/crewBots";
import { crossSite } from "@/lib/crew/crewPolicy";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try { return Response.json({ ok: true, bots: listBots() }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  try { return Response.json({ ok: true, bots: applyBotOp(body as BotOp) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

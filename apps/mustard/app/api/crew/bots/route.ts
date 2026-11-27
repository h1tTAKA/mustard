// 봇(#1394) — GET 설치된 봇 목록 / POST {op:"install"|"create"|"update"|"uninstall", ...} 후 새 목록(만들기면 created = 새 봇 id, #1397).
// install은 화면에서 안 씀(#1397 추천·카탈로그 고르기 제거) — 기본 역할 되살리기 등에 쓸 수 있어 서버엔 둠.
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
  try {
    // 만들기 = 서버에서 앞뒤 목록을 비교해 새 id(같은 프로세스·동기라 다른 창 것과 안 섞임 — 화면 쪽 비교는 낡은 목록이라 섞일 수 있음, 리뷰)
    const before = (body as BotOp)?.op === "create" ? new Set(listBots().map((b) => b.id)) : null;
    const bots = applyBotOp(body as BotOp);
    return Response.json({ ok: true, bots, created: before ? bots.find((b) => !before.has(b.id))?.id : undefined });
  }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

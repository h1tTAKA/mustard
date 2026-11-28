// 봇 할 일 티켓(#1404) — GET ?bot=<id> 목록 / POST {bot, op: "add"|"set"|"comment", ..., by?: "bot"} 후 바뀐 티켓.
// by = "bot"은 봇 도구(crew-control이 붙임), 없으면 화면(주인). 주인 댓글은 봇의 Home Chat에 알려 봇이 바로 반응하게.
import { applyItemOp, listItems, type ItemOp } from "@/lib/crew/crewBotItems";
import { botHome } from "@/lib/crew/crewBots";
import { crossSite } from "@/lib/crew/crewPolicy";
import { listChats, sendChat } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const bot = new URL(request.url).searchParams.get("bot") ?? "";
  try { return Response.json({ ok: true, items: listItems(bot) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const bot = typeof b.bot === "string" ? b.bot : "";
  const by = b.by === "bot" ? "bot" : "owner";
  try {
    const item = applyItemOp(bot, b as unknown as ItemOp, by);
    if (by === "owner" && b.op === "comment") {
      // 봇의 Home Chat(봇 폴더의 열린 대화 중 최근 것)에 알림 — 없으면(대화 전) 다음에 bot_item_list로 봄. 실패해도 댓글은 저장됨(보내다 실패하면 대화에 오류 줄이 남음).
      // 글 = 저장된 댓글(잘린 값), 제목 = 저장소가 한 줄로 만든 값을 JSON 따옴표로(제목 속 " 로 머리줄을 끝내지 못하게, 리뷰)
      const home = botHome(bot);
      const chat = listChats(home).sort((x, y) => y.updatedAt - x.updatedAt)[0];
      if (chat) void sendChat(home, chat.id, `[Mustard: your owner commented on item #${item.n} ${JSON.stringify(item.title)}:]\n${item.activity[item.activity.length - 1]?.text ?? ""}\n\nAnswer on the item with bot_item_comment (or change its status), then reply here in a line or two.`, [], new URL(request.url).origin).catch(() => {});
    }
    return Response.json({ ok: true, item });
  } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

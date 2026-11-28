// 봇(#1394) — GET 설치된 봇 목록 / POST {op:"install"|"create"|"update"|"uninstall"|"delete", ...} 후 새 목록(만들기면 created = 새 봇 id, #1397 · 삭제면 trashed = 비켜 둔 봇 폴더, #1399).
// install은 화면에서 안 씀(#1397 추천·카탈로그 고르기 제거) — 기본 역할 되살리기 등에 쓸 수 있어 서버엔 둠.
import { applyBotOp, deleteBot, deletedFolders, listBots, type BotOp } from "@/lib/crew/crewBots";
import { crossSite } from "@/lib/crew/crewPolicy";
import { MODEL_RE } from "@/lib/crew/crewRoleStore";
import { asProvider, knownModels } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try { return Response.json({ ok: true, bots: listBots(), trashLeft: deletedFolders() }); } // trashLeft = 휴지통에 못 보낸 삭제 폴더(#1399)
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  // 만들기 모델 — 그 실행 AI 목록에 있는 것만(다른 AI 모델 id로 만들어 두고 실행 때 실패하지 않게, 리뷰). 목록을 제대로 못 받으면(SNA 꺼짐) 통과(글자 검사는 역할 저장이 함).
  // 설정 바꾸기(#1399)도 같은 규칙 — 실행 AI를 안 바꾸면 그 봇의 지금 실행 AI 목록으로 대조.
  const b = body as { op?: string; id?: unknown; provider?: unknown; model?: unknown };
  if ((b?.op === "create" || b?.op === "update") && typeof b.model === "string" && b.model.trim()) {
    if (!MODEL_RE.test(b.model.trim())) return Response.json({ ok: false, error: "bad model" }, { status: 400 }); // 저장 때 조용히 기본 모델로 바뀌지 않게(리뷰)
    const provider = b.op === "update" && b.provider === undefined ? listBots().find((x) => x.id === b.id)?.provider : b.provider;
    const ms = await knownModels(asProvider(provider)).catch(() => null);
    if (ms && !ms.some((m) => m.id === (b.model as string).trim())) return Response.json({ ok: false, error: "unknown model" }, { status: 400 });
  }
  try {
    if ((body as BotOp)?.op === "delete") { const { bots, trashed } = deleteBot((body as { id: string }).id); return Response.json({ ok: true, bots, trashed }); }
    // 만들기 = 서버에서 앞뒤 목록을 비교해 새 id(같은 프로세스·동기라 다른 창 것과 안 섞임 — 화면 쪽 비교는 낡은 목록이라 섞일 수 있음, 리뷰)
    const before = (body as BotOp)?.op === "create" ? new Set(listBots().map((b) => b.id)) : null;
    const bots = applyBotOp(body as BotOp);
    return Response.json({ ok: true, bots, created: before ? bots.find((b) => !before.has(b.id))?.id : undefined });
  }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

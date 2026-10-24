// Crew 팀 채팅(#1104) — GET ?root=&since= 메시지 / POST {root, text, replyTo?} 사람 메시지(@역할 새 카드·카드 답글).
import { isAbsolute } from "node:path";
import { readMsgs } from "@/lib/crew/crewChat";
import { answeringRoles, postHuman, registerRoot } from "@/lib/crew/crewRunner";
import { crossSite } from "@/lib/crew/crewPolicy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 }); // #1159 GET도 레포 등록·대기 카드 시작(부수 효과) — <img>로 몰래 부르기 막기
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  // #1167 peek = 알림용 새 글 확인(레포 탭 폴링) — 레포를 Crew 자동 실행 대상으로 올리지 않음(대화방을 연 레포만)
  if (!sp.get("peek")) registerRoot(root, new URL(request.url).origin); // 채팅만 열어 둬도 Ready 카드가 돌게
  try { return Response.json({ ok: true, msgs: readMsgs(root, Number(sp.get("since")) || 0), answering: answeringRoles(root) }); } // #1139 답 쓰는 중인 역할
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 }); // #1137 다른 사이트의 폼 POST로 Crew 조작 금지
  let b: { root?: unknown; text?: unknown; replyTo?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "";
  if (!isAbsolute(root) || typeof b.text !== "string") return Response.json({ ok: false, error: "root/text required" }, { status: 400 });
  registerRoot(root, new URL(request.url).origin);
  try { return Response.json({ ok: true, ...postHuman(root, b.text, typeof b.replyTo === "string" ? b.replyTo : undefined) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

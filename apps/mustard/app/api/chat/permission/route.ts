// 채팅 Claude 권한 훅 창구(#1341) — PreToolUse 훅이 도구마다 부름. {run(=채팅 id), token, tool_name, tool_input} → {decision}.
// 정책이 허용 아니면 채팅에 카드를 띄우고 사람 답(최대 10분)까지 응답을 붙잡음. 탭마다 무작위 토큰으로만 통과.
import { hookDecision } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let b: { run?: unknown; token?: unknown; tool_name?: unknown; tool_input?: unknown };
  try { b = await request.json(); } catch { return Response.json({ decision: "deny", reason: "bad json" }, { status: 400 }); }
  if (typeof b.run !== "string" || typeof b.token !== "string" || typeof b.tool_name !== "string") return Response.json({ decision: "deny", reason: "bad request" }, { status: 400 });
  const input = b.tool_input && typeof b.tool_input === "object" ? (b.tool_input as Record<string, unknown>) : {};
  return Response.json(await hookDecision(b.run, b.token, b.tool_name, input));
}

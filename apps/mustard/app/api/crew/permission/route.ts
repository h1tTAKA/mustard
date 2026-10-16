// Crew 권한 훅 창구(#1100) — Claude 역할 세션의 PreToolUse 훅이 도구마다 부름. {run, token, tool_name, tool_input} → {decision}.
// 정책이 '묻기'면 사람이 보드에서 허락/거절할 때까지(최대 10분) 응답을 붙잡음. 실행마다 무작위 토큰으로만 통과.
import { hookDecision } from "@/lib/crew/crewRunner";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let b: { run?: unknown; token?: unknown; tool_name?: unknown; tool_input?: unknown };
  try { b = await request.json(); } catch { return Response.json({ decision: "deny", reason: "bad json" }, { status: 400 }); }
  if (typeof b.run !== "string" || typeof b.token !== "string" || typeof b.tool_name !== "string") return Response.json({ decision: "deny", reason: "bad request" }, { status: 400 });
  const input = b.tool_input && typeof b.tool_input === "object" ? (b.tool_input as Record<string, unknown>) : {};
  return Response.json(await hookDecision(b.run, b.token, b.tool_name, input));
}

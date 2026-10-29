// 서버 실시간 해설 "만드는 중" 수(#1240) — GET ?root= { narrating }. 캐치업 창이 보일 때만 몇 초마다 물어봄.
import { isAbsolute } from "node:path";
import { narratingFor } from "@/lib/narrateBusy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  return Response.json({ ok: true, narrating: narratingFor(root) });
}

// Crew 보드(#1098) — GET ?root= 보드 / POST {root, op, ...} 연산 하나 적용 후 새 보드.
import { isAbsolute } from "node:path";
import { applyOp, readBoard, type CrewOp } from "@/lib/crew/crewStore";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  try { return Response.json({ ok: true, board: readBoard(root) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  let body: { root?: unknown } & Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof body.root === "string" ? body.root : "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  const { root: _r, ...op } = body; // eslint-disable-line @typescript-eslint/no-unused-vars -- root 빼고 연산만
  try { return Response.json({ ok: true, board: applyOp(root, op as unknown as CrewOp) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

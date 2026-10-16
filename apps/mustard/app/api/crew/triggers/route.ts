// Crew 자동 계기(#1112) — GET ?root= 목록 / POST {root, op:"save"|"delete", ...} 후 새 목록.
import { isAbsolute } from "node:path";
import { applyTriggerOp, readTriggers, type TriggerOp } from "@/lib/crew/crewTriggers";
import { registerRoot } from "@/lib/crew/crewRunner";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  registerRoot(root, new URL(request.url).origin);
  return Response.json({ ok: true, triggers: readTriggers(root) });
}

export async function POST(request: Request): Promise<Response> {
  let b: { root?: unknown } & Record<string, unknown>;
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  registerRoot(root, new URL(request.url).origin); // 계기 확인은 오케스트레이터 tick이 함
  const { root: _r, ...op } = b; // eslint-disable-line @typescript-eslint/no-unused-vars -- root 빼고 연산만
  try { return Response.json({ ok: true, triggers: applyTriggerOp(root, op as unknown as TriggerOp) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

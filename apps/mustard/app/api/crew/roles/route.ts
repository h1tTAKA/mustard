// Crew 역할(#1100) — GET 목록(기본 8 + 커스텀) / POST {op:"save"|"reset"|"delete", ...} 후 새 목록.
import { applyRoleOp, listRoles, type RoleOp } from "@/lib/crew/crewRoleStore";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try { return Response.json({ ok: true, roles: listRoles() }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  try { return Response.json({ ok: true, roles: applyRoleOp(body as RoleOp) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

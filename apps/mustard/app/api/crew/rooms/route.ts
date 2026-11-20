// Crew 대화방 목록(#1392) — GET ?root= 그룹방들 + 방마다 마지막 글(목록) / POST {root, op, ...} 그룹 만들기·초대·내보내기·이름·지우기.
import { isAbsolute } from "node:path";
import { roomSummaries } from "@/lib/crew/crewChat";
import { applyRoomOp, readRooms, type RoomOp } from "@/lib/crew/crewRooms";
import { listRoles } from "@/lib/crew/crewRoleStore";
import { crossSite } from "@/lib/crew/crewPolicy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 });
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  try { return Response.json({ ok: true, groups: readRooms(root), summaries: roomSummaries(root) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

const OPS = new Set(["create", "invite", "remove", "rename", "delete"]);
export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "";
  if (!isAbsolute(root) || !OPS.has(String(b.op))) return Response.json({ ok: false, error: "root/op required" }, { status: 400 });
  try { return Response.json({ ok: true, ...applyRoomOp(root, b as unknown as RoomOp, new Set(listRoles().map((r) => r.id))) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 400 }); }
}

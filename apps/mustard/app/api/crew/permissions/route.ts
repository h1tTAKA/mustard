// Crew 권한 항목 설정(#1279) — GET 지금 값(기본값 합침) / POST {항목: true|false, ...} 바꾼 뒤 새 값. true = 알아서 허용.
import { readPerms, writePerms } from "@/lib/crew/crewPermStore";
import { crossSite } from "@/lib/crew/crewPolicy";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try { return Response.json({ ok: true, perms: readPerms() }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 }); // 앱 화면에서만(#1161) — 에이전트가 스크립트로 자기 권한을 넓히지 못하게
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, error: "object required" }, { status: 400 });
  try { return Response.json({ ok: true, perms: writePerms(body as Record<string, unknown>) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

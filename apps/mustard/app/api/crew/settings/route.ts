// Crew 보드 설정(#1157) — GET ?root= / POST {root, auto} 후 새 설정. 같은 출처(앱 화면)만 바꿀 수 있음.
import { isAbsolute } from "node:path";
import { readSettings, writeSettings } from "@/lib/crew/crewSettings";
import { crossSite } from "@/lib/crew/crewPolicy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  return Response.json({ ok: true, settings: readSettings(root) });
}

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 }); // 다른 사이트가 Auto를 켜지 못하게
  let b: { root?: unknown; auto?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  if (typeof b.auto !== "boolean") return Response.json({ ok: false, error: "auto must be boolean" }, { status: 400 });
  return Response.json({ ok: true, settings: writeSettings(root, { auto: b.auto }) });
}

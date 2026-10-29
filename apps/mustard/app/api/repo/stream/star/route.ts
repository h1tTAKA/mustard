// 캐치업 별표(#1238) — GET ?root= 별표 목록 { key: 시각 } / POST {root, key, on} 켜고 끔.
import { isAbsolute } from "node:path";
import { readStars, setStar } from "@/lib/catchupStore";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  try { return Response.json({ ok: true, stars: readStars(root) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  let body: { root?: unknown; key?: unknown; on?: unknown };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof body.root === "string" ? body.root : "", key = typeof body.key === "string" ? body.key : "";
  if (!isAbsolute(root) || !key || typeof body.on !== "boolean") return Response.json({ ok: false, error: "root/key/on required" }, { status: 400 });
  try { return Response.json({ ok: true, stars: setStar(root, key, body.on, Date.now()) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

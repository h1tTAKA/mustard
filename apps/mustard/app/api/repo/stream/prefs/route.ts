// 레포별 캐치업 설정(#1239) — GET ?root= { off } / POST {root, off} 저장(전역 설정에서 켠 것 중 이 레포만 끈 항목).
import { isAbsolute } from "node:path";
import { readRepoPrefs, writeRepoPrefs } from "@/lib/catchupStore";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  try { return Response.json({ ok: true, ...readRepoPrefs(root) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  let body: { root?: unknown; off?: unknown };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof body.root === "string" ? body.root : "";
  if (!isAbsolute(root) || !Array.isArray(body.off)) return Response.json({ ok: false, error: "root/off required" }, { status: 400 });
  try { return Response.json({ ok: true, ...writeRepoPrefs(root, body.off) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

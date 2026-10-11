// 캐치업 기록(#994) — GET ?root=&limit= 최근 / ?root=&q= 검색(#1049) / ?root=&day=YYYY-MM-DD 하루 / ?root=&days=1 기록 있는 날짜. POST {root, items} append.
import { isAbsolute } from "node:path";
import { appendItems, listDays, readDay, readRecent, sanitize, searchItems, type CatchupItem } from "@/lib/catchupStore";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  try {
    if (sp.get("days")) return Response.json({ ok: true, days: listDays(root) });
    const q = sp.get("q");
    if (q) return Response.json({ ok: true, items: searchItems(root, q.slice(0, 200), 200) });
    const day = sp.get("day");
    if (day) return Response.json({ ok: true, items: readDay(root, day) });
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));
    return Response.json({ ok: true, items: readRecent(root, limit) });
  } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  let body: { root?: unknown; items?: unknown };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof body.root === "string" ? body.root : "";
  if (!isAbsolute(root) || !Array.isArray(body.items)) return Response.json({ ok: false, error: "root/items required" }, { status: 400 });
  const items = body.items.slice(0, 500).map(sanitize).filter((x): x is CatchupItem => !!x);
  try { return Response.json({ ok: true, added: appendItems(root, items) }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

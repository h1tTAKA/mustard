// 캐치업 기록(#994) — #1181 저장은 레포 하나(메인 worktree), 읽기는 기본 그 폴더 것만 · &all=1이면 레포 전체(날짜·하루). GET ?root=&limit= 최근 / ?root=&q= 검색(#1049) / ?root=&day=YYYY-MM-DD 하루 / ?root=&days=1 기록 있는 날짜. POST {root, items, replace?} append(replace면 같은 key 교체).
import { isAbsolute } from "node:path";
import { appendItems, replaceItems, findItem, itemsForHashes, listDays, readDay, readRecent, sanitize, searchItems, type CatchupItem } from "@/lib/catchupStore";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  try {
    const all = sp.get("all") === "1";
    if (sp.get("days")) return Response.json({ ok: true, days: listDays(root, all) });
    const key = sp.get("key"); // #1081 키 하나 찾기(질문 답변 링크 → 카드 이동)
    if (key) return Response.json({ ok: true, item: findItem(root, key.slice(0, 600)) });
    const hashes = sp.get("hashes"); // #1081 커밋 해시들(쉼표) → 그 커밋의 diff·세션 카드
    if (hashes) return Response.json({ ok: true, items: itemsForHashes(root, hashes.split(",").slice(0, 20)) });
    const q = sp.get("q");
    if (q) return Response.json({ ok: true, items: searchItems(root, q.slice(0, 200), 200, all) });
    const day = sp.get("day");
    if (day) return Response.json({ ok: true, items: readDay(root, day, all) });
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));
    return Response.json({ ok: true, items: readRecent(root, limit) });
  } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  let body: { root?: unknown; items?: unknown; replace?: unknown };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof body.root === "string" ? body.root : "";
  if (!isAbsolute(root) || !Array.isArray(body.items)) return Response.json({ ok: false, error: "root/items required" }, { status: 400 });
  const items = body.items.slice(0, 500).map(sanitize).filter((x): x is CatchupItem => !!x);
  try { return Response.json({ ok: true, added: body.replace === true ? replaceItems(root, items) : appendItems(root, items) }); } // #1093 replace = 같은 key 교체(복구)
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

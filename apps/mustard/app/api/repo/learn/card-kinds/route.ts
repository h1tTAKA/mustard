// #1369 저장된 카드 종류 다시 나누기 — 화면이 [{name, def}]를 보내면 해설 AI가 코드·개념·IT를 골라 돌려줌(번호 순, 못 고른 건 null).
import { classifyCardKinds } from "@/lib/narrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: { items?: unknown };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 80).map((x) => ({ name: String((x as { name?: unknown })?.name ?? "").slice(0, 120), def: String((x as { def?: unknown })?.def ?? "").slice(0, 300) })) : [];
  if (!items.length) return Response.json({ ok: true, kinds: [] });
  try {
    const kinds = await classifyCardKinds(items, AbortSignal.timeout(120_000));
    return Response.json({ ok: true, kinds: kinds.map((k) => k ?? null) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

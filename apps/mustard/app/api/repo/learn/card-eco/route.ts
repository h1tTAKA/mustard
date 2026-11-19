// #1388 토큰 카드 소속 — 화면이 [{name, def}]를 보내면 해설 AI가 언어·라이브러리·프레임워크 이름을 돌려줌(번호 순, "" = 모름, 답 빠진 건 null).
import { classifyCardEco } from "@/lib/narrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // 다른 사이트가 브라우저로 몰래 부르지 못하게(AI 호출 비용, 리뷰): JSON만 받고, Origin이 있으면 이 서버와 같아야 함
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return Response.json({ ok: false, error: "json only" }, { status: 415 });
  const origin = req.headers.get("origin");
  if (origin && (() => { try { return new URL(origin).host !== req.headers.get("host"); } catch { return true; } })()) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  let body: { items?: unknown };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 80).map((x) => ({ name: String((x as { name?: unknown })?.name ?? "").slice(0, 120), def: String((x as { def?: unknown })?.def ?? "").slice(0, 300) })) : [];
  if (!items.length) return Response.json({ ok: true, ecos: [] });
  try {
    const ecos = await classifyCardEco(items, AbortSignal.timeout(120_000));
    return Response.json({ ok: true, ecos: ecos.map((k) => k ?? null) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

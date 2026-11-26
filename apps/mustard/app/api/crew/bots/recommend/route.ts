// 봇 추천(#1394) — POST {want, root?} → {ids: 카탈로그 id 3개, langs, by: "ai"|"rule"}. AI 실패·시간 초과면 규칙으로.
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { translate } from "@mustard/core/messages";
import { CATALOG } from "@/lib/crew/crewCatalog";
import { crossSite } from "@/lib/crew/crewPolicy";
import { parseRecommend, recommendPrompt, repoLangs, ruleRecommend } from "@/lib/crew/crewRecommend";
import { askNarrationAI } from "@/lib/narrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 });
  let body: { want?: unknown; root?: unknown } | null;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "bad body" }, { status: 400 });
  const want = typeof body.want === "string" ? body.want.trim().slice(0, 500) : "";
  if (!want) return Response.json({ ok: false, error: "want required" }, { status: 400 });
  // git 레포 폴더만(아무 폴더나 훑지 않게, 리뷰) — 돌려주는 건 확장자 비율뿐
  const root = typeof body.root === "string" && isAbsolute(body.root) && existsSync(join(body.root, ".git")) && statSync(body.root).isDirectory() ? body.root : "";
  const langs = root ? await repoLangs(root) : [];
  const rule = ruleRecommend(want, langs);
  const items = CATALOG.map((c) => ({ id: c.id, desc: c.builtin ? translate("en", `crew.roleDesc.${c.id}`) : c.desc!.en }));
  try {
    const text = await askNarrationAI("bot recommend", recommendPrompt(want, langs, items), AbortSignal.timeout(60_000));
    return Response.json({ ok: true, ids: parseRecommend(text, rule), langs, by: "ai" });
  } catch {
    return Response.json({ ok: true, ids: rule, langs, by: "rule" });
  }
}

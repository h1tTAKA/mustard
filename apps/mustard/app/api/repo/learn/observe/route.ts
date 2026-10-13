// 터미널 에이전트 실시간 활동 내레이션(#870) — main이 관찰한 터미널 버퍼 델타를 받아
// SNA 에이전트(구독 CLI)로 "지금 뭘 어떻게 하는지 + 개념/용어"를 초보 눈높이로 생성해 캐치업(구 학습 스트림)에 push.
// 유저 아키텍처: 머스타드 터미널의 에이전트 동작을 우리 SNA가 관찰하며 실시간 설명.
import { isNarrationOn } from "@/lib/narrationConfig";
import { narrate } from "@/lib/narrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: { cwd?: unknown; agent?: unknown; delta?: unknown; diff?: unknown; providerId?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  const agent = typeof body.agent === "string" && body.agent ? body.agent : "agent";
  const delta = typeof body.delta === "string" ? body.delta.slice(0, 6000) : "";
  const diff = typeof body.diff === "string" ? body.diff.slice(0, 6500) : "";
  if (!cwd || delta.trim().length < 40) return Response.json({ ok: false, reason: "no cwd/delta" });
  if (!isNarrationOn()) return Response.json({ ok: true, skipped: "off" }); // #1062 설정 > 캐치업 > 해설 분석 꺼짐

  try {
    await narrate(cwd, agent, delta, diff, Date.now(), { providerId: body.providerId, signal: req.signal });
    return Response.json({ ok: true });
  } catch (e) {
    // 구독 미가용·레이트리밋 등 — 조용히 실패(다음 델타서 재시도). 사용자 흐름 안 막음.
    return Response.json({ ok: false, reason: String((e as Error)?.message || e) });
  }
}

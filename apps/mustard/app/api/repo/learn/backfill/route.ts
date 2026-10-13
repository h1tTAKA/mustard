// 앱이 꺼져 있던 동안의 캐치업 채우기(#1068) — 에이전트는 데몬에서 계속 도는데 앱(관찰자)이 없어 빠진 활동을 기록에서 재생.
// 앱이 뜰 때 WorkspaceView가 한 번 부름(해설 설정을 먼저 서버에 알린 뒤). 서버 프로세스당 한 번(takeDownWindow), 백그라운드로 돌고 바로 응답.
//  - 편집·명령어·katchup 도구 → 실시간과 같은 이벤트 경로(원래 시각) → 캐치업이 지금처럼 설명
//  - 해설 → 턴 덩어리마다 실시간 해설과 같은 생성(원래 시각으로 저장). 해설 꺼짐이면 생략.
// ponytail: 이벤트 링(200)·SSE 첫 재생(100)이 상한 — 열려 있지 않은 레포에 아주 많이 쌓였으면 오래된 편집·명령어 카드는 빠짐. 해설은 서버 저장이라 전부.
import { takeDownWindow } from "@/lib/catchupAlive";
import { catchupRoots } from "@/lib/catchupStore";
import { activityForRoot } from "@/lib/agentSessions";
import { EDIT_TOOLS, shortToolInput } from "@/lib/agentHookEvent";
import { emitEdit, emitToolCall } from "@/lib/mcpActivity";
import { isNarrationOn } from "@/lib/narrationConfig";
import { narrate } from "@/lib/narrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KATCHUP = /^mcp__mustard(?:-katchup)?__(katchup_\w+)$/; // #1070 통합 MCP(mcp__mustard__) + 옛 이름

async function backfill(from: number, to: number) {
  for (const root of catchupRoots()) {
    let acts; try { acts = await activityForRoot(root, from, to); } catch { continue; }
    for (const a of acts) for (const t of a.tools) {
      const args = t.input && typeof t.input === "object" ? t.input as Record<string, unknown> : {};
      const k = KATCHUP.exec(t.name);
      if (k) emitToolCall(root, k[1], args, false, t.ts);
      else if (EDIT_TOOLS.has(t.name)) { const target = shortToolInput(t.input); if (target) emitEdit(root, t.name, target, false, t.ts); }
    }
    if (!isNarrationOn()) continue;
    const chunks = acts.flatMap((a) => a.chunks.map((c) => ({ ...c, agent: a.agent }))).sort((x, y) => x.ts - y.ts);
    for (const c of chunks) {
      if (!isNarrationOn()) break; // 도중에 꺼면 멈춤
      try { await narrate(root, c.agent, c.text, "", c.ts, { providerId: c.agent === "codex" ? "codex" : undefined }); } catch { /* 한 덩어리 실패 — 다음 */ }
    }
  }
  console.log(`[backfill] done ${new Date(from).toISOString()} ~ ${new Date(to).toISOString()}`);
}

export async function POST(): Promise<Response> {
  const win = takeDownWindow();
  if (!win) return Response.json({ ok: true, window: null });
  void backfill(win.from, win.to).catch((e) => console.log("[backfill] failed", e));
  return Response.json({ ok: true, window: win });
}

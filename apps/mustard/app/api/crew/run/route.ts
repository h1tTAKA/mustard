// Crew 실행(#1100) — GET ?root= 실행 기록(진행 중 포함) / POST {root, taskId, action:"start"|"stop"|"permission"|"gate", approved?, decision?, text?}.
// 권한 승인은 이 경로(사람 클릭)로만 — 에이전트 메시지로 승인되지 않음.
import { isAbsolute } from "node:path";
import { createPr, decideCard, decideDelegated, delegateGate, undelegateGate, listRuns, respondPermission, startRun, stopRun, takeover, MAX_CONCURRENT } from "@/lib/crew/crewRunner";
import { crossSite } from "@/lib/crew/crewPolicy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 }); // #1159 GET도 레포 등록·대기 카드 시작(부수 효과) — <img>로 몰래 부르기 막기
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  // 조회 = 이 레포를 오케스트레이터에 등록(Ready 카드 자동 시작 대상). peek = 읽기만(에이전트 crew_board, #1277 — 안 연 레포를 자동 실행 대상으로 올리지 않음)
  try { return Response.json({ ok: true, runs: listRuns(root, new URL(request.url).origin, !!new URL(request.url).searchParams.get("peek")), maxConcurrent: MAX_CONCURRENT }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 }); // #1137 다른 사이트의 폼 POST로 Crew 조작 금지
  let b: { root?: unknown; taskId?: unknown; action?: unknown; approved?: unknown; decision?: unknown; text?: unknown };
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const root = typeof b.root === "string" ? b.root : "", taskId = typeof b.taskId === "string" ? b.taskId : "";
  if (!isAbsolute(root) || !taskId) return Response.json({ ok: false, error: "root/taskId required" }, { status: 400 });
  try {
    // #1102 관문·질문 — {action:"gate", decision:"approve"|"reject"|"answer", text}. 사람 클릭으로만.
    if (b.action === "gate") {
      const d = b.decision === "approve" || b.decision === "reject" || b.decision === "answer" ? b.decision : null;
      if (!d) return Response.json({ ok: false, error: "bad decision" }, { status: 400 });
      return Response.json({ ok: true, board: decideCard(root, taskId, d, typeof b.text === "string" ? b.text : "") });
    }
    if (b.action === "delegate") { delegateGate(root, taskId); return Response.json({ ok: true }); } // 사람 클릭 — 이 관문 하나를 터미널 에이전트에게
    if (b.action === "undelegate") { undelegateGate(root, taskId); return Response.json({ ok: true }); }
    if (b.action === "agent-gate") { // 터미널 에이전트(MCP crew_decide) — 사람이 맡긴 관문만
      const d = b.decision === "approve" || b.decision === "reject" || b.decision === "answer" ? b.decision : null;
      if (!d) return Response.json({ ok: false, error: "bad decision" }, { status: 400 });
      return Response.json({ ok: true, board: decideDelegated(root, taskId, d, typeof b.text === "string" ? b.text : "") });
    }
    if (b.action === "pr") return Response.json({ ok: true, ...(await createPr(root, taskId)) }); // #1110 사람 클릭
    if (b.action === "takeover") return Response.json({ ok: true, ...(await takeover(root, taskId)) });
    const run = b.action === "start" ? await startRun(root, taskId, new URL(request.url).origin) // 훅이 다시 부를 주소
      : b.action === "stop" ? await stopRun(root, taskId)
      : b.action === "permission" ? await respondPermission(root, taskId, b.approved === true)
      : null;
    if (!run) return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
    return Response.json({ ok: true, run });
  } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 409 }); }
}

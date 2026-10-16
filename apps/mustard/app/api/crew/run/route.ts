// Crew 실행(#1100) — GET ?root= 실행 기록(진행 중 포함) / POST {root, taskId, action:"start"|"stop"|"permission"|"gate", approved?, decision?, text?}.
// 권한 승인은 이 경로(사람 클릭)로만 — 에이전트 메시지로 승인되지 않음.
import { isAbsolute } from "node:path";
import { decideCard, listRuns, respondPermission, startRun, stopRun, MAX_CONCURRENT } from "@/lib/crew/crewRunner";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  if (!isAbsolute(root)) return Response.json({ ok: false, error: "absolute root required" }, { status: 400 });
  // 조회 = 이 레포를 오케스트레이터에 등록(Ready 카드 자동 시작 대상)
  try { return Response.json({ ok: true, runs: listRuns(root, new URL(request.url).origin), maxConcurrent: MAX_CONCURRENT }); }
  catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function POST(request: Request): Promise<Response> {
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
    const run = b.action === "start" ? await startRun(root, taskId, new URL(request.url).origin) // 훅이 다시 부를 주소
      : b.action === "stop" ? await stopRun(root, taskId)
      : b.action === "permission" ? await respondPermission(root, taskId, b.approved === true)
      : null;
    if (!run) return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
    return Response.json({ ok: true, run });
  } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 409 }); }
}

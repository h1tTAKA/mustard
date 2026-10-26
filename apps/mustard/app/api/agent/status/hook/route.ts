// 관리형 Claude 훅 수신(#989) — 훅 명령(electron/claude-hooks.cjs)이 ?event=&term=<pty id>로 Claude 훅 JSON 원문을 POST.
// 훅이 화면 긁기보다 권위: 여기서 쓴 행은 hookAt이 찍혀 status 라우트가 화면 상태로 덮지 않는다.
import { upsert, emit, prune, normPath, findBySession } from "@mustard/nunopi/agent";
import { emitEdit } from "@/lib/mcpActivity";
import { listSubagents } from "@/lib/subagents";
import { EDIT_TOOLS, hookState, shortToolInput } from "@/lib/agentHookEvent";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  // 부팅 토큰 검사(#989 리뷰) — 로컬 웹페이지 등이 가짜 상태를 못 넣게. env 없으면(dev) 생략.
  const expected = process.env.MUSTARD_HOOK_TOKEN;
  if (expected && sp.get("k") !== expected) return Response.json({ ok: false }, { status: 403 });
  const event = sp.get("event") ?? "";
  const term = sp.get("term") ?? "";
  let payload: Record<string, unknown> = {};
  try { const j = await request.json(); if (j && typeof j === "object") payload = j as Record<string, unknown>; } catch { /* 빈 본문 허용 */ }
  const mapped = hookState(event, payload);
  if (!term || !mapped) return Response.json({ ok: true, ignored: event || "no-event" });
  // 키 = 화면 보고가 쓴 행(레포 루트 cwd)과 일치시켜야 한 세션이 한 행. 아직 없으면 claude가 알려준 cwd.
  const existing = findBySession(term);
  const cwd = existing?.cwd ?? (typeof payload.cwd === "string" ? normPath(payload.cwd) : "");
  if (!cwd) return Response.json({ ok: true, ignored: "no-cwd" });
  const now = Date.now();
  let state = mapped.state;
  // #979 백그라운드 서브에이전트 실행 중이면 working 유지(가짜 완료 방지) — 세션 제목(화면 보고) 필요.
  if (state === "done" && !mapped.silent && existing?.task) {
    try { if ((await listSubagents(cwd, existing.task)).some((s) => s.running)) state = "working"; } catch { /* 원 상태 */ }
  }
  const tool = typeof payload.tool_name === "string" ? payload.tool_name : undefined;
  const toolInput = shortToolInput(payload.tool_input);
  upsert({ cwd, sessionId: term, agent: "claude", state, tool, toolInput, prompt: typeof payload.prompt === "string" ? payload.prompt.slice(0, 200) : undefined, hook: true, silent: mapped.silent }, now);
  prune(now);
  emit(cwd);
  try { if (state === "working" && tool && toolInput && EDIT_TOOLS.has(tool)) emitEdit(cwd, tool, toolInput, false, now); } catch { /* 무시 */ }
  return Response.json({ ok: true, state });
}

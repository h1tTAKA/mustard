// 에이전트 상태 수신·조회(#764) — Claude Code 등 CLI 훅이 이벤트를 POST하면 저장 + SSE 푸시,
// 레포탭/호버 카드가 GET(폴백)·SSE(실시간)로 읽는다. 저장·푸시 로직은 @mustard/nunopi/agent(agentStatus) 싱글턴.
import { upsert, query, emit, remove, normPath, prune, get, HOOK_FRESH_MS, type AgentState } from "@mustard/nunopi/agent";
import { EDIT_TOOLS, shortToolInput } from "@/lib/agentHookEvent";
import { emitEdit } from "@/lib/mcpActivity";
import { listSubagents } from "@/lib/subagents";

export const runtime = "nodejs";

// Claude 훅 이벤트 → 상태. 모르는 이벤트(SubagentStop 등)는 null(상태 변경 안 함).
function deriveState(event: string): AgentState | null {
  switch (event) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse": return "working";
    case "Notification": return "waiting"; // 입력/권한 대기
    case "Stop": return "done";
    default: return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  const cwd = typeof body.cwd === "string" ? normPath(body.cwd) : "";
  // 세션 제거(#765) — 버퍼 드라이버가 에이전트 종료(셸 복귀) 감지 시. cwd+sessionId 엔트리 삭제 후 푸시.
  if (body.clear === true) {
    if (!cwd) return Response.json({ error: "cwd required" }, { status: 400 });
    const removed = remove(cwd, typeof body.sessionId === "string" ? body.sessionId : "");
    if (removed) emit(cwd);
    return Response.json({ ok: true, cleared: removed });
  }
  // #989 Ctrl+C 중단 추정(main) — 훅이 working이고 키 입력 이후 새 훅이 없을 때만 알림 없는 done.
  // 서브에이전트가 돌고 있으면 메인 중단 아님. 조건 안 맞으면 무시.
  if (typeof body.interruptAt === "number") {
    const sid = typeof body.sessionId === "string" ? body.sessionId : "";
    const e = cwd ? get(cwd, sid) : undefined;
    const t0 = Date.now();
    if (!e || (e.state !== "working" && e.state !== "waiting") || !e.hookAt || e.hookAt > body.interruptAt || t0 - e.hookAt > HOOK_FRESH_MS) return Response.json({ ok: true, ignored: "interrupt" });
    if (e.task) { try { if ((await listSubagents(cwd, e.task)).some((s) => s.running)) return Response.json({ ok: true, ignored: "child-work" }); } catch { /* 판정 실패 시 진행 */ } }
    upsert({ cwd, sessionId: sid, agent: e.agent, state: "done", hook: true, silent: true }, t0);
    emit(cwd);
    return Response.json({ ok: true, interrupted: true });
  }
  const event = typeof body.event === "string" ? body.event : "";
  // 소스 2가지: 훅(event→deriveState) 또는 버퍼 스크레이핑(explicit state, #765). 하나는 있어야 함.
  const VALID: AgentState[] = ["working", "waiting", "blocked", "done"];
  const explicit = typeof body.state === "string" && (VALID as string[]).includes(body.state) ? (body.state as AgentState) : null;
  if (!cwd || (!event && !explicit)) return Response.json({ error: "cwd and (event or state) required" }, { status: 400 });
  const now = Date.now();
  let state = explicit ?? deriveState(event);
  if (state === null) { prune(now); return Response.json({ ok: true, ignored: event }); }
  // #979 메인 claude가 백그라운드 서브에이전트를 기다리며 idle이면 화면상 done이지만 실제론 작업 중 —
  // 트랜스크립트(subagents/*.jsonl)에 실행 중 서브가 있으면 working 유지(가짜 완료 알림 방지). 화면 스크레이핑은
  // 대기 문구가 스피너 redraw에 밀려 창 밖이라 불안정 → 서브 데이터가 권위.
  const agentName = typeof body.agent === "string" && body.agent ? body.agent : "claude";
  const taskTitle = typeof body.task === "string" ? body.task : "";
  // #989 훅 권위 — 이 세션에 신선한 Claude 훅이 있으면 화면 상태로 덮지 않는다(제목 등만 갱신).
  // 예외: 화면 waiting(권한/선택 박스는 화면이 정확 — AskUserQuestion 등 훅 미등록 경로), 그리고 훅이 waiting인 동안은
  //       화면이 바꿀 수 있음(권한 박스를 Esc로 거절하면 훅이 안 옴 → 박스가 사라진 걸 화면이 정확히 봄).
  // 중단(Ctrl+C)은 위 interruptAt 경로가 처리. Esc 중단은 orca처럼 다음 훅(새 프롬프트·Stop)까지 working 유지.
  const sid = typeof body.sessionId === "string" ? body.sessionId : "";
  const prevEntry = !event ? get(cwd, sid) : undefined;
  if (prevEntry?.hookAt && now - prevEntry.hookAt < HOOK_FRESH_MS && state !== "waiting" && prevEntry.state !== "waiting") state = prevEntry.state;
  if (state === "done" && agentName === "claude" && taskTitle) {
    try { if ((await listSubagents(cwd, taskTitle)).some((s) => s.running)) state = "working"; } catch { /* 판정 실패 시 원 상태 */ }
  }
  upsert({
    cwd,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : "",
    agent: typeof body.agent === "string" && body.agent ? body.agent : "claude",
    state,
    tool: typeof body.tool === "string" ? body.tool : undefined,
    toolInput: shortToolInput(body.toolInput),
    prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 200) : undefined,
    task: typeof body.task === "string" ? body.task.slice(0, 120) : undefined, // #968 세션 작업 제목
  }, now);
  prune(now);
  emit(cwd); // SSE 구독자에게 즉시 푸시(폴링 대기 없이)
  // 편집 활동을 캐치업(구 학습 스트림)으로도(#857) — 코드 편집·실행 툴일 때만. emit 실패가 응답 막지 않게.
  try {
    const tool = typeof body.tool === "string" ? body.tool : "";
    const target = shortToolInput(body.toolInput);
    if (state === "working" && tool && target && EDIT_TOOLS.has(tool)) emitEdit(cwd, tool, target, false, now);
  } catch { /* 무시 */ }
  return Response.json({ ok: true });
}

export async function GET(request: Request): Promise<Response> {
  const root = new URL(request.url).searchParams.get("root") ?? "";
  return Response.json({ ok: true, statuses: query(root, Date.now()) });
}

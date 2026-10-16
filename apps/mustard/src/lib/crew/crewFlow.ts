// Crew 흐름 상태 기계(#1102, 에픽 #1097) — 역할 하나가 끝났을 때 카드를 어디로 보낼지. 순수 함수(AI 아님, 점검 가능).
// 원칙(조사 결론): 순서·종료는 코드가 강제(CrewAI 오배정·AutoGen 무한 반복 회피), 사람은 관문에서만, 실패·반복엔 상한.
import type { CrewGate, CrewStatus, CrewTask } from "./crewTypes.ts";

export const MAX_TEST_LOOPS = 3; // 테스트↔수정 최대
export const MAX_FAILS = 3;      // 같은 단계 연속 실패 차단기
export const MAX_CONSULTS = 3;   // #1108 카드당 동료에게 묻기
export const MAX_REVIEWS = 2;    // #1108 리뷰 변경 요청 왕복

// 역할이 끝내기 전에 .crew/handoff.json에 쓰는 봉투(규약). 없으면 마지막 메시지로 done.
export interface Handoff {
  status: "done" | "needs_input" | "blocked" | "failed" | "changes_requested";
  summary?: string;
  message?: string;        // #1104 팀 채팅에 남길 말(1인칭, 다음 역할 @멘션) — 없으면 summary
  question?: string;       // needs_input
  roles?: string[];        // 범위 기획자 — 이 카드에 필요한 역할(순서대로)
  testsPassed?: boolean;   // 테스트 엔지니어
  destructive?: boolean;   // 데이터 설계자 — 파괴적 변경
  ask?: { to: string; question: string }; // #1108 needs_input을 사람 대신 동료에게
  to?: string;             // #1108 changes_requested — 고칠 역할(없으면 직전 다른 역할)
}

export interface FlowResult { status: CrewStatus; patch: Partial<Pick<CrewTask, "pipeline" | "stage" | "loops" | "fails" | "gate" | "note" | "consult" | "consults" | "reviews">> }

export function parseHandoff(raw: string | null, fallbackSummary?: string): Handoff {
  if (raw) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const status = ["done", "needs_input", "blocked", "failed", "changes_requested"].includes(String(j.status)) ? (j.status as Handoff["status"]) : "done";
      return {
        status,
        ...(typeof j.summary === "string" ? { summary: j.summary.slice(0, 4000) } : {}),
        ...(typeof j.message === "string" ? { message: j.message.slice(0, 4000) } : {}),
        ...(typeof j.question === "string" ? { question: j.question.slice(0, 4000) } : {}),
        ...(Array.isArray(j.roles) ? { roles: j.roles.filter((r): r is string => typeof r === "string").slice(0, 20) } : {}),
        ...(typeof j.testsPassed === "boolean" ? { testsPassed: j.testsPassed } : {}),
        ...(typeof j.destructive === "boolean" ? { destructive: j.destructive } : {}),
        ...(j.ask && typeof j.ask === "object" && typeof (j.ask as Record<string, unknown>).to === "string" && typeof (j.ask as Record<string, unknown>).question === "string"
          ? { ask: { to: String((j.ask as Record<string, unknown>).to), question: String((j.ask as Record<string, unknown>).question).slice(0, 4000) } } : {}),
        ...(typeof j.to === "string" ? { to: j.to } : {}),
      };
    } catch { /* 깨진 JSON — 아래 기본값 */ }
  }
  return { status: "done", ...(fallbackSummary ? { summary: fallbackSummary.slice(0, 4000) } : {}) };
}

// 카드의 파이프라인 — 없으면 담당 역할 하나(자동 배정이면 범위 기획자부터).
export const pipelineOf = (t: Pick<CrewTask, "pipeline" | "role">): string[] => (t.pipeline?.length ? t.pipeline : [t.role ?? "scope-planner"]);

// 역할(role, 단계 stage)이 handoff로 끝남 → 다음 칸·필드. knownRoles = 지금 있는 역할 id(범위 기획자가 모르는 역할을 적으면 버림).
export function next(task: CrewTask, h: Handoff, knownRoles: Set<string>): FlowResult {
  let pipeline = pipelineOf(task);
  const stage = Math.min(task.stage ?? 0, pipeline.length - 1);
  const role = pipeline[stage];
  const gate = (kind: CrewGate["kind"], at: number, text?: string): CrewGate => ({ kind, stage: at, ...(text ? { text } : {}) });

  // #1108 답하기 단계가 끝남 → 묻던 역할로, 답을 메모로(실패해도 답 없이 돌아감 — 묻던 역할이 사람에게 물을 수 있음)
  if (task.consult && task.consult.stage === stage) {
    const answer = (h.message || h.summary || "").trim();
    return { status: "ready", patch: { consult: undefined, fails: 0, gate: undefined, stage: stage + 1, note: `Answer from teammate "${role}" to your question (${task.consult.question}):\n${answer || "(no answer — ask the human if still blocked)"}` } };
  }
  // #1108 동료에게 묻기 — [상대, 나]를 끼우고 상대는 답하기 모드
  if (h.status === "needs_input" && h.ask && knownRoles.has(h.ask.to) && h.ask.to !== role && (task.consults ?? 0) < MAX_CONSULTS) {
    pipeline = [...pipeline.slice(0, stage + 1), h.ask.to, role, ...pipeline.slice(stage + 1)];
    return { status: "ready", patch: { pipeline, stage: stage + 1, consult: { stage: stage + 1, from: role, question: h.ask.question }, consults: (task.consults ?? 0) + 1, fails: 0, gate: undefined, note: undefined } };
  }
  if (h.status === "needs_input") return { status: "needs-you", patch: { gate: gate("question", stage, h.ask?.question || h.question || h.summary), note: undefined, fails: 0 } };
  // #1108 리뷰 변경 요청 — [담당, 나]를 끼워 반영 후 재검토(2왕복), 넘으면 사람(머지 관문에 지적 첨부)
  if (h.status === "changes_requested") {
    const comments = (h.message || h.summary || "").trim();
    const target = h.to && knownRoles.has(h.to) && h.to !== role ? h.to : [...pipeline.slice(0, stage)].reverse().find((r) => r !== role && r !== "scope-planner");
    const reviews = (task.reviews ?? 0) + 1;
    if (!target || reviews > MAX_REVIEWS) return { status: "review", patch: { reviews, fails: 0, gate: gate("merge", stage, `Reviewer "${role}" still requests changes:\n${comments}`) } };
    pipeline = [...pipeline.slice(0, stage + 1), target, role, ...pipeline.slice(stage + 1)];
    return { status: "ready", patch: { pipeline, stage: stage + 1, reviews, fails: 0, gate: undefined, note: `Changes requested by "${role}":\n${comments}` } };
  }
  if (h.status === "blocked" || h.status === "failed") {
    const fails = (task.fails ?? 0) + 1;
    if (fails >= MAX_FAILS) return { status: "blocked", patch: { fails, gate: gate("blocked", stage, h.summary || `${role} failed ${fails} times`) } };
    return { status: "ready", patch: { fails, gate: undefined } }; // 같은 단계 재시도
  }

  // done
  const base = { fails: 0, note: undefined, gate: undefined } as FlowResult["patch"];
  // 범위 기획자가 자동 배정 카드의 역할을 정함(파이프라인이 기획자 하나뿐일 때만 — 사람이 정한 파이프라인은 존중)
  if (role === "scope-planner" && pipeline.length === 1 && h.roles?.length) {
    const roles = h.roles.filter((r) => knownRoles.has(r) && r !== "scope-planner");
    if (roles.length) pipeline = ["scope-planner", ...[...new Set(roles)]];
  }
  // 테스트 실패 → 버그 수정·테스트를 바로 다음에 끼움(최대 3회)
  if (role === "test-engineer" && h.testsPassed === false) {
    const loops = (task.loops ?? 0) + 1;
    if (loops > MAX_TEST_LOOPS) return { status: "blocked", patch: { ...base, loops, gate: gate("blocked", stage, `tests still failing after ${MAX_TEST_LOOPS} fix rounds`) } };
    pipeline = [...pipeline.slice(0, stage + 1), "bug-fixer", "test-engineer", ...pipeline.slice(stage + 1)];
    return { status: "ready", patch: { ...base, pipeline, stage: stage + 1, loops } };
  }
  const nextStage = stage + 1;
  if (nextStage >= pipeline.length) return { status: "review", patch: { ...base, pipeline, stage, gate: gate("merge", stage, h.summary) } }; // 끝 — 머지 관문
  if (role === "scope-planner") return { status: "needs-you", patch: { ...base, pipeline, stage: nextStage, gate: gate("spec", stage, h.summary) } };
  if (role === "data-architect" && h.destructive) return { status: "needs-you", patch: { ...base, pipeline, stage: nextStage, gate: gate("schema", stage, h.summary) } };
  return { status: "ready", patch: { ...base, pipeline, stage: nextStage } };
}

// 사람 결정(보드 클릭) — approve: 관문 통과 / reject: 코멘트와 함께 그 역할 재실행 / answer: 질문 답과 함께 재실행.
export function decideGate(task: CrewTask, action: "approve" | "reject" | "answer", text = ""): FlowResult {
  const g = task.gate;
  if (!g) throw new Error("no gate");
  if (action === "approve") {
    if (g.kind === "question") throw new Error("answer required");
    if (g.kind === "merge") return { status: "done", patch: { gate: undefined } };
    if (g.kind === "blocked") return { status: "ready", patch: { gate: undefined, fails: 0, loops: 0, stage: g.stage } }; // 막힘 해제 = 그 단계부터 다시
    return { status: "ready", patch: { gate: undefined } }; // spec·schema — 단계는 이미 다음으로
  }
  if (!text.trim()) throw new Error("comment required");
  return { status: "ready", patch: { gate: undefined, stage: g.stage, note: text.trim().slice(0, 8000), fails: 0 } };
}

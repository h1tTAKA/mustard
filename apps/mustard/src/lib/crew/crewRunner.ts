// Crew 실행 엔진(#1100, 에픽 #1097) — 카드 하나를 담당 역할 에이전트로 실행. 서버 전용(Next 서버 프로세스 싱글톤).
// 흐름: 카드 → 실행 중 · worktree 준비 → SNA 세션(agent.start, cwd=worktree, 역할 지시문 + Crew 규약) → 이벤트로 실시간 상태
//       → complete = 리뷰 칸(세션 종료해 자리 반납) / error = 막힘 / 권한 요청 = 나 필요(사람 클릭으로만 승인).
// 상태는 SNA 세션 이벤트(기록)로 판정 — 화면 긁기 안 함(#979 교훈). 기록 = ~/.nunopi/crew/<sha>/runs.json.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSnaClient } from "@mustard/core/sna";
import { applyOp, patchTask, readBoard } from "./crewStore";
import { childProgress, decideGate, next, parseHandoff, pickListener, pipelineOf, waitingOn, type Handoff } from "./crewFlow";
import { getRole, listRoles } from "./crewRoleStore";
import { crewProtocol, type CrewRole } from "./crewRoleDefaults";
import { ensureWorktree, worktreeFor } from "./crewWorktree";
import { decide, fromAgentRequest } from "./crewPolicy";
import { narrationLocale } from "@/lib/narrationConfig";
import { defaultSnaModel } from "@mustard/nunopi/server";
import { translate } from "@mustard/core/messages";
import { appendMsg, findMsg, parseMentions, readMsgs, type CrewMsg } from "./crewChat";
import { snaClaudeProvider, snaCodexProvider, snaOpenCodeProvider } from "@mustard/nunopi/server";
import { callsEveryone, pickParticipants, planFromWrapUp, readAnswer, readJson, withIdleTimeout } from "./crewMeeting";
import { isFailedNote } from "@/lib/failText";
import { freshIds, hasTriggers, readTriggers, scheduleDue, writeTriggers, type CrewTrigger } from "./crewTriggers";
import { emitNarration } from "@/lib/mcpActivity";
import { appendItems } from "@/lib/catchupStore";
import type { CrewStatus, CrewTask } from "./crewTypes";

export type RunState = "starting" | "running" | "needs-permission" | "done" | "failed" | "stopped";
export interface CrewRun {
  id: string; root: string; taskId: string; role: string; stage?: number; provider: string; model?: string;
  sessionId?: string; worktree: string; branch: string; base: string;
  state: RunState; startedAt: number; endedAt?: number;
  lastActivity?: string; toolCount: number; tokens?: { input: number; output: number }; costUsd?: number;
  summary?: string; error?: string; permission?: { request: Record<string, unknown>; at: number };
}

export const MAX_CONCURRENT = 3; // 동시 실행 상한(에픽 결정 기본값). SNA 세션 상한은 Electron에서 8로.
const ACTIVE: RunState[] = ["starting", "running", "needs-permission"];
const LANG: Record<string, string> = { ko: "Korean", ja: "Japanese", en: "English" };
// 금지 — 규약에도 적지만 도구 차단으로 한 번 더(push·머지·브랜치 삭제·강제 리셋)
const DISALLOWED = ["Bash(git push:*)", "Bash(git merge:*)", "Bash(git branch -D:*)", "Bash(git branch -d:*)", "Bash(git reset --hard:*)", "Bash(git worktree remove:*)"];

const normPath = (p: string) => p.replace(/\/+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const baseDir = () => process.env.MUSTARD_CREW_DIR || join(homedir(), ".nunopi", "crew");
const runsFile = (root: string) => join(baseDir(), sha(normPath(root)), "runs.json");

// ── 저장(레포별 최근 200개) ─────────────────────────────────────────────
function readRuns(root: string): CrewRun[] {
  try { const j = JSON.parse(readFileSync(runsFile(root), "utf8")); return Array.isArray(j) ? j : []; } catch { return []; }
}
function writeRuns(root: string, runs: CrewRun[]) {
  const f = runsFile(root);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(runs.slice(-200), null, 1));
  renameSync(`${f}.tmp`, f);
}

// ── 프로세스 싱글톤 상태 ──────────────────────────────────────────────
type Pending = { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };
type G = { trigTick?: number; trigBusy?: boolean; roots: Set<string>; origin: string; ticker?: ReturnType<typeof setInterval>; starting: Set<string>; runs: Map<string, CrewRun>; bySession: Map<string, string>; wired: boolean; reconciled: Set<string>; flush: Map<string, ReturnType<typeof setTimeout>>; tokens: Map<string, string>; pending: Map<string, Pending>; answering: Set<string>; answerNext?: Map<string, { human: CrewMsg; roleId: string; taskId?: string; everyone?: boolean }> };
const g = ((globalThis as unknown as { __mustardCrew?: G }).__mustardCrew ??= { roots: new Set(), origin: "", starting: new Set(), runs: new Map(), bySession: new Map(), wired: false, reconciled: new Set(), flush: new Map(), tokens: new Map(), pending: new Map(), answering: new Set() } as G);

// ── Claude 권한 훅 ───────────────────────────────────────────────────
// SNA가 자동으로 넣는 PreToolUse 훅은 인증 없이 SNA에 물어 전부 거부됨(+ 읽기마다 사람에게 물음) → Claude 역할은
// bypassPermissions(SNA 훅 안 넣음) + Mustard 훅: 도구마다 Mustard 서버(/api/crew/permission)에 묻고 crewPolicy가 결정.
// 훅 파일은 실행 때 ~/.nunopi/crew/claude-hook.cjs에 씀(패키지 경로에 안 기댐). 실패하면 거부(안전 쪽).
const HOOK_SRC = `// Mustard Crew PreToolUse 훅(#1100) — 자동 생성. 도구 실행 전에 Mustard에 물어 allow/deny.
const arg = (k) => (process.argv.find((a) => a.startsWith("--" + k + "=")) || "").slice(k.length + 3);
let raw = ""; process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  const out = (d, why) => { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d, ...(why ? { permissionDecisionReason: why } : {}) } })); process.exit(0); };
  try {
    const input = raw.trim() ? JSON.parse(raw) : {};
    const r = await fetch(arg("url") + "/api/crew/permission", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: arg("run"), token: arg("token"), tool_name: input.tool_name, tool_input: input.tool_input }), signal: AbortSignal.timeout(900000) });
    const j = await r.json();
    out(j.decision === "allow" ? "allow" : "deny", j.decision === "allow" ? "" : (j.reason || "Denied by Mustard Crew policy or the user"));
  } catch (e) { out("deny", "Mustard unreachable: " + (e && e.message)); }
});
`;
const hookPath = () => join(baseDir(), "claude-hook.cjs");
function writeHook() { mkdirSync(baseDir(), { recursive: true }); writeFileSync(hookPath(), HOOK_SRC); }

// 훅 요청 처리 — 정책이 allow/deny면 바로, ask면 카드 '나 필요'로 옮기고 사람 클릭(최대 10분, 넘으면 거부)을 기다림.
export async function hookDecision(runId: string, token: string, tool: string, input: Record<string, unknown>): Promise<{ decision: "allow" | "deny"; reason?: string }> {
  const run = g.runs.get(runId);
  if (!run || g.tokens.get(runId) !== token || !ACTIVE.includes(run.state)) return { decision: "deny", reason: "unknown or finished run" };
  const d = decide(tool, input ?? {}, run.worktree);
  if (d === "allow") return { decision: "allow" };
  if (d === "deny") { run.lastActivity = `⛔ ${tool} blocked by policy`; persist(run); return { decision: "deny", reason: "Blocked by Mustard Crew policy (push/merge/destructive git are human-only)" }; }
  if (g.pending.has(runId)) return { decision: "deny", reason: "another permission is pending" };
  run.state = "needs-permission"; run.permission = { request: { tool_name: tool, tool_input: input }, at: Date.now() };
  moveCard(run.root, run.taskId, "needs-you");
  persist(run, true);
  say(run.root, { from: run.role, provider: run.provider, kind: "permission", taskId: run.taskId, mentions: ["you"], ...tx("crewchat.permission", { tool: `${tool}${input.command ? `: ${String(input.command).slice(0, 200)}` : ""}` }) });
  const ok = await new Promise<boolean>((res) => {
    const timer = setTimeout(() => { // 10분 무응답 = 거절, 카드는 다시 실행 중으로(보안 리뷰)
      g.pending.delete(runId);
      if (run.state === "needs-permission") { run.state = "running"; run.permission = undefined; run.lastActivity = "permission timed out (denied)"; moveCard(run.root, run.taskId, "running"); persist(run, true); }
      res(false);
    }, 10 * 60_000);
    g.pending.set(runId, { resolve: (v) => { clearTimeout(timer); g.pending.delete(runId); res(v); }, timer });
  });
  return ok ? { decision: "allow" } : { decision: "deny", reason: "The user denied this action" };
}

// 앱이 재시작되면 이전 실행의 세션은 사라짐 → 진행 중이던 기록은 실패로 정리하고 카드는 막힘으로(첫 접근 때 한 번).
function reconcile(root: string) {
  if (g.reconciled.has(root)) return;
  g.reconciled.add(root);
  const runs = readRuns(root);
  let changed = false;
  for (const r of runs) {
    if (ACTIVE.includes(r.state) && !g.runs.has(r.id)) {
      r.state = "failed"; r.error = tr("crew.reason.interrupted"); r.endedAt = Date.now(); changed = true;
      block(root, r.taskId, r.stage ?? 0, tr("crew.reason.interrupted"));
    }
  }
  if (changed) writeRuns(root, runs);
}

function persist(run: CrewRun, now = false) {
  const save = () => {
    g.flush.delete(run.id);
    const runs = readRuns(run.root).filter((r) => r.id !== run.id);
    writeRuns(run.root, [...runs, run]);
  };
  const t = g.flush.get(run.id);
  if (t) clearTimeout(t);
  if (now) save(); else g.flush.set(run.id, setTimeout(save, 800)); // 스트리밍 중 잦은 쓰기 묶기
}

function moveCard(root: string, taskId: string, status: CrewStatus) {
  try {
    const b = readBoard(root);
    const t = b.tasks.find((x) => x.id === taskId);
    if (!t || t.status === status) return;
    applyOp(root, { op: "move", id: taskId, status, index: b.tasks.filter((x) => x.status === status).length });
  } catch { /* 카드가 지워졌으면 무시 */ }
}

// 모델을 비우면 SNA가 설정 기본(Claude 모델)을 넣어 Codex·Grok·Cursor가 즉시 실패(라이브 테스트) → 실행 AI별 기본 모델을 항상 명시.
const modelFor = (role: CrewRole): string =>
  role.model?.trim() || (role.provider === "grok" ? "grok-build" : role.provider === "cursor" ? "auto" : defaultSnaModel(role.provider as "claude-code" | "codex" | "opencode"));

const oneLine = (s: string, n = 140) => s.replace(/\s+/g, " ").trim().slice(-n);

// 막힘 — 이유를 관문에 남겨 보드에서 보이게(승인 = 그 단계부터 다시)
function block(root: string, taskId: string, stage: number, why: string) {
  try { patchTask(root, taskId, { gate: { kind: "blocked", stage, text: why }, status: "blocked" }); } catch { /* 카드 지워짐 */ }
}

// #1104 팀 채팅·캐치업 — 서버 문구는 앱 언어. 실패해도 실행엔 영향 없게 삼킴.
const tr = (key: string, vars?: Record<string, string | number>) => translate(narrationLocale(), key, vars);
const PROVIDER: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", grok: "Grok Build", cursor: "Cursor", opencode: "OpenCode" };
function roleLabel(id: string): string {
  const r = getRole(id);
  return r && !r.builtin ? r.name : tr(`crew.role.${id}`);
}
// #1125 번역 문구 = text(서버 언어) + i18n 키(화면이 앱 언어로 다시 번역)
const tx = (key: string, vars?: Record<string, string | number>) => ({ text: tr(key, vars), i18n: { key, ...(vars ? { vars } : {}) } });
function say(root: string, m: Omit<CrewMsg, "id" | "ts">) { try { appendMsg(root, m); } catch { /* 채팅 기록 실패는 무시 */ } }
// 캐치업 보고 — 실시간 해설 통로(SSE + 날짜별 저장)로 "역할(AI) · 카드: 한 말"
function report(run: CrewRun, title: string, text: string) {
  try {
    const ts = Date.now(), head = `${roleLabel(run.role)}(${PROVIDER[run.provider] ?? run.provider}) · ${title}`.slice(0, 120);
    const tool = `crew|${run.taskId}`; // #1135 어느 Crew 카드인지(캐치업 Crew 필터·카드 열기)
    const sent = emitNarration(run.root, head, text, ts, tool);
    if (sent) appendItems(run.root, [{ key: `narration|${ts}|${sent.target}`, kind: "narration", target: sent.target, tool, ts, expl: sent.note }]);
  } catch { /* 보고 실패는 무시 */ }
}

// #1102 역할 하나가 끝남 → .crew/handoff.json(없으면 마지막 메시지)으로 흐름 상태 기계 적용 → 카드 이동(다음 Ready는 tick이 시작).
function finish(run: CrewRun, forced?: Handoff) {
  try {
    const file = join(run.worktree, ".crew", "handoff.json");
    const raw = !forced && run.worktree && existsSync(file) ? readFileSync(file, "utf8") : null;
    const h = forced ?? parseHandoff(raw, run.summary);
    const task = readBoard(run.root).tasks.find((t) => t.id === run.taskId);
    if (!task) return;
    const r = next({ ...task, stage: run.stage ?? task.stage }, h, new Set(listRoles().map((x) => x.id)));
    patchTask(run.root, run.taskId, { ...r.patch, status: r.status });
    run.lastActivity = `→ ${r.status}${r.patch.gate ? ` (${r.patch.gate.kind})` : ""}`;
    // #1104 팀 채팅 — 역할이 한 말(+ 다음 역할 @멘션), 관문·막힘은 보드가 사람을 부름
    const nextRole = r.status === "ready" && r.patch.pipeline ? r.patch.pipeline[r.patch.stage ?? 0] : r.status === "ready" ? (task.pipeline ?? [])[(r.patch.stage ?? task.stage ?? 0)] : undefined;
    const base = { taskId: task.id, taskTitle: task.title };
    const said = (h.message || h.summary || run.summary || "").trim();
    const toPeer = h.status === "needs_input" && r.status === "ready"; // #1108 사람 대신 동료에게 물음
    if (toPeer && nextRole) say(run.root, { ...base, from: run.role, provider: run.provider, kind: "handoff", text: `@${nextRole} ${h.ask?.question ?? h.question ?? said}`, mentions: [nextRole] });
    else if (h.status === "needs_input") say(run.root, { ...base, from: run.role, provider: run.provider, kind: "question", text: h.question || said, mentions: ["you"] });
    else if (said) say(run.root, { ...base, from: run.role, provider: run.provider, kind: h.status === "done" || h.status === "changes_requested" ? "handoff" : "blocked", text: nextRole && !said.includes(`@${nextRole}`) ? `${said}\n@${nextRole}` : said, ...(nextRole ? { mentions: [nextRole] } : {}) });
    const gate = r.patch.gate;
    if (gate && gate.kind !== "question") say(run.root, { ...base, from: "board", kind: gate.kind === "blocked" ? "blocked" : "gate", mentions: ["you"],
      ...(gate.kind === "merge" ? tx("crewchat.gate.merge", { branch: run.branch }) : gate.kind === "blocked" ? tx("crewchat.gate.blocked", { why: gate.text ?? "" }) : tx(`crewchat.gate.${gate.kind}`)) });
    if (said) report(run, task.title, h.status === "needs_input" ? (h.question || said) : said);
  } catch (e) { block(run.root, run.taskId, run.stage ?? 0, tr("crew.reason.flowError", { err: String((e as Error)?.message ?? e) })); }
}

// #1102 오케스트레이터 tick — 알려진 레포의 Ready 카드를 동시 상한 안에서 자동 시작(Ready 칸 = 에이전트 대기열).
function ensureTicker() {
  if (g.ticker) return;
  g.ticker = setInterval(() => {
    if (!g.origin) return;
    // #1112 자동 계기 — 1분마다(30틱) 켜진 계기 확인 → 카드 Ready(아래 루프가 시작)
    g.trigTick = ((g.trigTick ?? 0) + 1) % 30;
    if (g.trigTick === 1 && !g.trigBusy) {
      g.trigBusy = true;
      void (async () => { for (const root of g.roots) if (hasTriggers(root)) await checkTriggers(root).catch(() => {}); })().finally(() => { g.trigBusy = false; });
    }
    for (const root of g.roots) {
      let ready: { id: string }[] = [];
      try {
        const tasks = readBoard(root).tasks;
        closeParents(root, tasks);
        ready = tasks.filter((t) => t.status === "ready" && !t.children?.length && !waitingOn(t, tasks).length).sort((a, b) => a.order - b.order); // #1114 의존이 안 끝난 하위는 기다림
      } catch { continue; }
      for (const t of ready) {
        const active = [...g.runs.values()].filter((r) => ACTIVE.includes(r.state)).length + g.starting.size;
        if (active >= MAX_CONCURRENT) return;
        const key = `${root}\n${t.id}`;
        if (g.starting.has(key) || activeFor(root, t.id)) continue;
        g.starting.add(key);
        void startRun(root, t.id, g.origin).catch(() => {}).finally(() => g.starting.delete(key));
      }
    }
  }, 2000);
}
export function registerRoot(root: string, origin?: string) {
  g.roots.add(root);
  if (origin) g.origin = safeOrigin(origin);
  ensureTicker();
}

// ── SNA 이벤트 배선(한 번) ───────────────────────────────────────────
async function wire() {
  if (g.wired) return;
  g.wired = true;
  const sna = await getSnaClient();
  sna.agent.onEvent(({ session, event, isHistory }) => {
    if (isHistory) return;
    const id = g.bySession.get(session); const run = id ? g.runs.get(id) : undefined;
    if (!run || !ACTIVE.includes(run.state)) return;
    const type = String(event.type ?? ""), msg = typeof event.message === "string" ? event.message : "";
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (type === "tool_use") {
      if (!data.update) { run.toolCount++; run.lastActivity = `⚙ ${String(data.toolName ?? msg)}`; }
    } else if (type === "assistant" && msg.trim()) {
      run.lastActivity = oneLine(msg); run.summary = msg.slice(0, 4000);
    } else if (type === "complete") {
      run.state = "done"; run.endedAt = Date.now();
      if (msg && msg !== "Done") run.summary = msg.slice(0, 4000);
      const inp = Number(data.inputTokens ?? 0), out = Number(data.outputTokens ?? 0);
      run.tokens = { input: (run.tokens?.input ?? 0) + inp, output: (run.tokens?.output ?? 0) + out };
      if (typeof data.costUsd === "number") run.costUsd = data.costUsd;
      finish(run); // #1102 봉투 → 다음 역할·관문·Review
      persist(run, true);
      void sna.agent.kill(session).catch(() => {}); // 세션 자리 반납(대화 기록은 SNA DB에 남음 — 넘겨받기·이어 하기는 에픽 4번)
      return;
    } else if (type === "error") {
      // SNA 오류 이벤트는 message가 비는 경우가 있음(Codex 인증 오류 등) → data 안의 실제 이유를 꺼냄(#1108 라이브 테스트)
      const errObj = (data.error ?? {}) as Record<string, unknown>;
      const why = msg || String(errObj.message ?? data.message ?? "") || (Object.keys(data).length ? JSON.stringify(data) : "") || "agent error";
      run.state = "failed"; run.endedAt = Date.now(); run.error = oneLine(why, 400);
      // 로그인·인증 문제는 다시 해도 똑같이 실패 → 재시도 없이 바로 막힘(이유를 보여 줌)
      if (/unauthori[sz]ed|sign in again|log ?in|refresh token|not logged|authenticat/i.test(why)) block(run.root, run.taskId, run.stage ?? 0, `${PROVIDER[run.provider] ?? run.provider} login needed: ${run.error}`);
      else finish(run, { status: "failed", summary: run.error }); // 재시도(3번이면 막힘)
      persist(run, true);
      return;
    } else if (type === "interrupted") {
      run.lastActivity = "interrupted";
    }
    persist(run);
  });
  // #1137 Codex·OpenCode(SNA 승인 흐름)도 Claude 훅과 같은 정책 — 허락·차단은 바로 답하고, 묻기만 사람에게(대화방에도 알림).
  sna.agent.onPermissionRequest(({ session, request, createdAt }) => {
    const id = g.bySession.get(session); const run = id ? g.runs.get(id) : undefined;
    if (!run) return;
    if (!ACTIVE.includes(run.state)) { void sna.agent.respondPermission(session, false).catch(() => {}); return; } // 끝난 실행 — 거절(매달려 있지 않게)
    // 사람 답을 기다리는 요청이 이미 있음 — SNA 응답엔 요청 id가 없어, 지금 자동으로 답하면 사람이 볼 그 요청에 답이 가버림(리뷰). 사람 답이 먼저.
    if (run.state === "needs-permission") return;
    const req = (request ?? {}) as Record<string, unknown>;
    const { tool, input } = fromAgentRequest(req);
    const d = decide(tool, input, run.worktree);
    if (d !== "ask") {
      run.lastActivity = d === "allow" ? `⚙ ${tool}` : `⛔ ${tool} blocked by policy`;
      persist(run);
      void sna.agent.respondPermission(session, d === "allow").catch(() => {});
      return;
    }
    run.state = "needs-permission"; run.permission = { request, at: createdAt || Date.now() };
    moveCard(run.root, run.taskId, "needs-you");
    persist(run, true);
    const cmd = typeof input.command === "string" ? input.command : "";
    say(run.root, { from: run.role, provider: run.provider, kind: "permission", taskId: run.taskId, mentions: ["you"], ...tx("crewchat.permission", { tool: `${tool}${cmd ? `: ${cmd.slice(0, 200)}` : ""}` }) });
  });
  await sna.agent.subscribePermissions().catch(() => {});
}

function buildPrompt(title: string, body: string, role: CrewRole, pipeline: string[], stage: number, note?: string, consult?: { from: string; question: string }): string {
  // #1108 답하기 모드 — 동료 질문에 답만(코드 수정 금지), 답은 봉투 message에
  if (consult) return [
    `# Board card: ${title}`,
    body.trim() ? `\n${body.trim()}` : "",
    `\nYour teammate "${consult.from}" is asking you (as "${role.id}"):`,
    `> ${consult.question}`,
    `\nAnswer ONLY. Read the code and .crew/ files as needed, but do NOT modify any code or commit. Put your answer (concise, concrete) in .crew/handoff.json "message" with status "done" — it goes straight back to "${consult.from}" in the team chat.`,
  ].join("\n");
  return [
    `# Board card: ${title}`,
    body.trim() ? `\n${body.trim()}` : "",
    `\nPipeline: ${pipeline.map((r, i) => (i === stage ? `**${r}**` : r)).join(" → ")} (step ${stage + 1}/${pipeline.length}).`,
    `You are acting as role "${role.id}". Read earlier roles' files in .crew/ first, then do your role's part for this card now.`,
    note ? `\n## Message for you (from the human or a teammate — follow this)\n${note}` : "",
  ].join("\n");
}

// ── 공개 API ─────────────────────────────────────────────────────────
export function listRuns(root: string, origin?: string): CrewRun[] {
  registerRoot(root, origin);
  reconcile(root);
  const disk = readRuns(root);
  const mem = [...g.runs.values()].filter((r) => r.root === root);
  const byId = new Map(disk.map((r) => [r.id, r]));
  for (const r of mem) byId.set(r.id, r); // 진행 중은 메모리가 최신
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}

// 훅이 다시 부를 주소 — 훅 실행 명령줄에 들어가므로 로컬 http 주소 형식만(명령 주입 방지, 보안 리뷰)
const safeOrigin = (o: string) => (/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(o) ? o : `http://127.0.0.1:${Number(process.env.PORT) || 59720}`);

export async function startRun(root: string, taskId: string, origin: string): Promise<CrewRun> {
  origin = safeOrigin(origin);
  registerRoot(root, origin);
  reconcile(root);
  const task = readBoard(root).tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("task not found");
  if (task.gate && task.gate.kind !== "blocked") throw new Error("gate pending");
  const board0 = readBoard(root).tasks;
  if (waitingOn(task, board0).length) throw new Error("waiting on dependencies"); // #1114
  if (task.children?.length) throw new Error("has subtasks"); // 부모는 하위가 일함 // 관문은 관문 창(사람 결정)으로만 — 실행 버튼으로 건너뛰기 금지(리뷰). 막힘은 다시 실행 허용
  const active = [...g.runs.values()].filter((r) => ACTIVE.includes(r.state));
  if (active.some((r) => r.root === root && r.taskId === taskId)) throw new Error("already running");
  if (active.length >= MAX_CONCURRENT) throw new Error(`concurrency limit (${MAX_CONCURRENT})`);
  const pipeline = pipelineOf(task);
  const stage = Math.min(task.stage ?? 0, pipeline.length - 1);
  const role = getRole(pipeline[stage]) ?? getRole("scope-planner")!; // 지워진 커스텀 역할 등 = 범위 기획자
  const note = task.note;
  patchTask(root, taskId, { pipeline, stage, note: undefined, gate: undefined, status: "running" }); // 사람 말은 이번 실행에 한 번만

  const run: CrewRun = { id: randomUUID(), root, taskId, role: role.id, stage, provider: role.provider, model: modelFor(role), worktree: "", branch: "", base: "", state: "starting", startedAt: Date.now(), toolCount: 0, lastActivity: "preparing worktree" };
  g.runs.set(run.id, run);
  persist(run, true);
  try {
    const dep = board0.find((x) => x.id === task.dependsOn?.[task.dependsOn.length - 1]); // ponytail: 의존 여럿이면 마지막 것 브랜치에서 시작(나머지는 그 안에 없을 수 있음), 필요하면 머지 단계 추가
    const wt = await ensureWorktree(root, taskId, task.title, dep ? worktreeFor(root, dep.id, dep.title).branch : undefined);
    Object.assign(run, { worktree: wt.dir, branch: wt.branch, base: wt.base });
    rmSync(join(wt.dir, ".crew", "handoff.json"), { force: true }); // 앞 역할 봉투를 이번 결과로 착각하지 않게
    await wire();
    const sna = await getSnaClient();
    const { sessionId } = await sna.sessions.create({ label: `crew:${task.title.slice(0, 60)}`, cwd: wt.dir, meta: { crew: true, root, taskId, runId: run.id, role: role.id } });
    run.sessionId = sessionId;
    g.bySession.set(sessionId, run.id);
    await sna.agent.subscribe(sessionId);
    const isClaude = role.provider === "claude-code";
    const token = randomUUID();
    g.tokens.set(run.id, token);
    if (isClaude) writeHook();
    await sna.agent.start(sessionId, {
      provider: role.provider, model: modelFor(role), cwd: wt.dir,
      appendSystemPrompt: `${role.instructions}\n\n${crewProtocol(LANG[narrationLocale()] ?? "Korean")}`,
      prompt: buildPrompt(task.title, task.body, role, pipeline, stage, note, task.consult?.stage === stage ? task.consult : undefined),
      // Claude: SNA 훅 대신 Mustard 훅(정책 자동 허락·차단, 나머지만 사람에게). Codex·OpenCode: SNA 기본 승인 흐름(onPermissionRequest).
      permissionMode: isClaude ? "bypassPermissions" : "acceptEdits",
      // Codex: SNA 기본은 작업 폴더마다 .sna/codex-home에 로그인 정보를 복사 → 리프레시 토큰은 한 번 쓰면 무효라 복사본끼리 서로 깨뜨림
      // (라이브 테스트: "refresh token was already used", 사용자 CLI 로그인까지 깨질 위험) → 사용자 원래 CODEX_HOME 하나를 공유(#1108).
      ...(role.provider === "codex" ? { configDir: process.env.CODEX_HOME?.trim() || join(homedir(), ".codex") } : {}),
      ...(isClaude ? { providerOptions: { settings: { hooks: { PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: `node "${hookPath()}" --url=${origin} --run=${run.id} --token=${token}`, timeout: 900 }] }] } } } } : {}),
      disallowedTools: DISALLOWED,
      meta: { crew: true, runId: run.id },
    });
    run.state = "running"; run.lastActivity = "started";
    persist(run, true);
    say(root, { from: role.id, provider: role.provider, kind: "start", taskId, taskTitle: task.title, ...tx(note ? "crewchat.restart" : "crewchat.start", { card: task.title }) });
  } catch (e) {
    run.state = "failed"; run.endedAt = Date.now(); run.error = oneLine(String((e as Error)?.message ?? e), 400);
    block(root, taskId, stage, run.error); // 시작 자체 실패(worktree·SNA)는 재시도 안 함 — 사람이 확인
    persist(run, true);
  }
  return run;
}

const activeFor = (root: string, taskId: string) => [...g.runs.values()].find((r) => r.root === root && r.taskId === taskId && ACTIVE.includes(r.state));

export async function stopRun(root: string, taskId: string): Promise<CrewRun> {
  const run = activeFor(root, taskId);
  if (!run) throw new Error("not running");
  run.state = "stopped"; run.endedAt = Date.now(); run.error = tr("crew.reason.stopped"); run.permission = undefined;
  g.pending.get(run.id)?.resolve(false); // 기다리던 훅은 거부로 풀기
  if (run.sessionId) await (await getSnaClient()).agent.kill(run.sessionId).catch(() => {});
  block(root, taskId, run.stage ?? 0, tr("crew.reason.stopped"));
  persist(run, true);
  return run;
}

// 권한 요청 응답 — 화면 버튼(사람 클릭)에서만 옴. 에이전트가 전한 "승인됐다"는 받지 않음.
export async function respondPermission(root: string, taskId: string, approved: boolean): Promise<CrewRun> {
  const run = activeFor(root, taskId);
  if (!run || run.state !== "needs-permission") throw new Error("no pending permission");
  const hook = g.pending.get(run.id);
  if (!hook && !run.sessionId) throw new Error("no pending permission");
  // #1137 상태를 먼저(동기) 바꿈 — 기다리는 동안 두 번째 클릭이 같은 세션에 또 답하지 않게(리뷰). SNA 실패면 되돌림.
  const prev = run.permission;
  run.state = "running"; run.permission = undefined;
  if (hook) hook.resolve(approved); // Claude — Mustard 훅이 기다리는 중
  else {
    try { await (await getSnaClient()).agent.respondPermission(run.sessionId!, approved); } // Codex·OpenCode — SNA 승인
    catch (e) { run.state = "needs-permission"; run.permission = prev; throw e; }
  }
  run.lastActivity = approved ? "permission approved" : "permission denied";
  moveCard(root, taskId, "running");
  persist(run, true);
  return run;
}

// #1102 사람 결정(보드 클릭) — 관문 승인/반려, 질문 답. 결과가 Ready면 tick이 다음 역할을 시작.
export function decideCard(root: string, taskId: string, action: "approve" | "reject" | "answer", text = "") {
  if (activeFor(root, taskId)) throw new Error("running");
  const task = readBoard(root).tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("task not found");
  const r = decideGate(task, action, text);
  if (action === "approve" && task.gate?.kind === "spec" && task.split?.length) return splitCard(root, task); // #1114 쪼개기 승인
  const board = patchTask(root, taskId, { ...r.patch, status: r.status });
  say(root, { from: "human", kind: "decision", taskId, taskTitle: task.title,
    ...(action === "approve" ? tx(task.gate?.kind === "blocked" ? "crewchat.decision.retry" : "crewchat.decision.approve") : { text: text.trim() }),
    ...(task.gate && task.gate.kind !== "merge" ? { mentions: [(task.pipeline ?? [])[task.gate.stage] ?? ""].filter(Boolean) } : {}) });
  return board;
}

// #1104 사람이 팀 채팅에 쓴 말.
// - 카드 메시지에 답글: 질문 중이면 답 / spec·schema·merge 관문이면 반려(코멘트로 다시) / 막힘이면 다시 / 그 밖은 다음 실행 메모
// - 답글 아님 + @역할: 그 역할(여럿이면 그 순서 파이프라인) 담당 새 카드를 Ready로 → tick이 바로 시작(그록봇식)
// - 그 밖: 채팅에만 남김
export function postHuman(root: string, text: string, replyTo?: string): { msg: CrewMsg; taskId?: string; created?: boolean } {
  const body = text.trim().slice(0, 8000);
  if (!body) throw new Error("empty");
  registerRoot(root);
  const known = new Set(listRoles().map((r) => r.id));
  const mentions = parseMentions(body, known);
  const parent = replyTo ? findMsg(root, replyTo) : undefined;
  const task = parent?.taskId ? readBoard(root).tasks.find((t) => t.id === parent.taskId) : undefined;
  if (!task && !mentions.length) { // #1139 @ 없는 글 — 가장 최근 카드의 담당 역할(없으면 범위 기획자)이 답함
    const tasks = readBoard(root).tasks;
    const who = pickListener(tasks, (id) => activeFor(root, id)?.role);
    const card = who.taskId ? tasks.find((t) => t.id === who.taskId) : undefined;
    const m = appendMsg(root, { from: "human", kind: "human", text: body, ...(replyTo ? { replyTo } : {}), ...(card ? { taskId: card.id, taskTitle: card.title } : {}) });
    if (card && activeFor(root, card.id)) patchTask(root, card.id, { note: [card.note, body].filter(Boolean).join("\n\n") }); // 실행 중 — 다음 실행에도
    void answerHuman(root, m, who.role, card?.id, callsEveryone(body)); // @all = 모든 역할(일 요청이면 전원 회의)
    return { msg: m, ...(card ? { taskId: card.id } : {}) };
  }
  const msg = appendMsg(root, { from: "human", kind: "human", text: body, ...(mentions.length ? { mentions } : {}), ...(replyTo ? { replyTo } : {}), ...(task ? { taskId: task.id, taskTitle: task.title } : {}) });
  if (task) {
    if (activeFor(root, task.id)) { patchTask(root, task.id, { note: [task.note, body].filter(Boolean).join("\n\n") }); return { msg, taskId: task.id }; } // 실행 중 — 다음 실행에
    const g0 = task.gate;
    const retry = g0?.kind === "blocked" ? decideGate(task, "approve") : null; // 막힘 = 그 단계부터 다시(답글을 메모로)
    const r = g0?.kind === "question" ? decideGate(task, "answer", body)
      : retry ? { ...retry, patch: { ...retry.patch, note: body } }
      : g0 ? decideGate(task, "reject", body) // spec·schema·merge 관문에 답글 = 반려 코멘트
      : null;
    if (r) patchTask(root, task.id, { ...r.patch, status: r.status });
    else patchTask(root, task.id, { note: [task.note, body].filter(Boolean).join("\n\n") });
    return { msg, taskId: task.id };
  }
  if (mentions.length) {
    const title = body.replace(/@[a-z0-9-]+/gi, "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 80) || body.slice(0, 80);
    const b = applyOp(root, { op: "create", title, body, status: "ready", role: mentions[0], pipeline: mentions });
    const created = b.tasks[b.tasks.length - 1];
    return { msg, taskId: created.id, created: true };
  }
  return { msg };
}

// #1139 @ 없는 사람 글에 역할이 답함 — 에이전트 세션 없이 한 번 묻는 AI(실시간 해설과 같은 통로, 도구 없음 = 권한 안 생김).
// 재료 = 카드 상태·최근 대화·마지막 인계(카드 없으면 보드 요약). 카드 상태는 안 바꿈(관문 결정은 사람이 보드에서).
// 일 요청이면(또는 @all) 팀 회의 — 진행자(범위 기획자)가 참여 역할을 고르고, 차례로 발언, 마무리로 카드를 만들어 바로 실행(유저).
const ANALYZE: Record<string, typeof snaClaudeProvider> = { codex: snaCodexProvider, opencode: snaOpenCodeProvider };
const AGENT_ID: Record<string, string> = { codex: "codex-agent", opencode: "opencode-agent" };
const MODERATOR = "scope-planner";
const clip = (x: string | undefined, n: number) => (x ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// 실패 이유를 사람 말로(앱 확인: Codex 한 번 묻기는 SNA 복사본 로그인을 써서 "refresh token was already used"로 실패)
function failReason(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  // 이유는 서버 언어 글자로 넣음(화면이 언어를 바꿔도 이 괄호 안은 그대로 — 짧은 진단이라 둠)
  return /refresh token|unauthori[sz]ed|\bsign ?in\b|\blog ?in\b|authenticat/i.test(m) ? tr("crewchat.why.login")
    : /rate.?limit|usage limit|quota|429|too many/i.test(m) ? tr("crewchat.why.limit")
    : /timeout|timed out|abort/i.test(m) ? tr("crewchat.why.timeout")
    : clip(m, 120) || tr("crewchat.why.other");
}
// 역할에게 묻되, Claude가 아닌 AI가 실패하면 Claude로 한 번 더(대화방에 이유와 함께 알림). 그래도 실패면 throw(이유 담김).
// failed = 이번 글 처리에서 이미 실패한 AI — 다음 역할부턴 바로 Claude, 알림도 한 번만(리뷰: 같은 AI 역할 여럿이면 알림·헛호출 반복).
async function askOrFallback(root: string, role: CrewRole, prompt: string, replyTo: string, failed: Set<string>): Promise<{ text: string; provider: string }> {
  // #1162 시간 초과면 같은 AI에게 한 번 더(일시적으로 느린 것 — 대화방에 알림). 두 번째도 실패면 그대로 던짐.
  const askRetry = async (r: CrewRole) => {
    try { return await ask(r, prompt); }
    catch (e) {
      if (!/timeout/i.test(String((e as Error)?.message ?? e))) throw e;
      say(root, { from: "board", kind: "blocked", replyTo, ...tx("crewchat.retrying", { role: roleLabel(r.id) }) });
      return await ask(r, prompt);
    }
  };
  const viaClaude = async () => { try { return { text: await askRetry({ ...role, provider: "claude-code", model: "" }), provider: "claude-code" }; } catch (e2) { throw new Error(failReason(e2)); } };
  if (role.provider !== "claude-code" && failed.has(role.provider)) return viaClaude();
  try { return { text: await askRetry(role), provider: role.provider }; }
  catch (e) {
    const why = failReason(e);
    if (role.provider === "claude-code") throw new Error(why);
    failed.add(role.provider);
    say(root, { from: "board", kind: "blocked", replyTo, ...tx("crewchat.fallback", { role: roleLabel(role.id), ai: PROVIDER[role.provider] ?? role.provider, why }) });
    return viaClaude();
  }
}

// 역할 하나에게 한 번 묻기 — 역할의 AI·모델. #1162 사람이 기다리는 답이라 SNA 줄 맨 앞(priority), 타이머는 '무진행 90초 + 전체 4분'
// (스트림 글자·추론이 오면 다시 셈 — 조용히 멈춘 CLI는 그대로 끊김). 실패면 throw.
async function ask(role: CrewRole, prompt: string): Promise<string> {
  const provider = ANALYZE[role.provider] ?? snaClaudeProvider;
  const pid = AGENT_ID[role.provider] ?? "claude-agent";
  const res = await withIdleTimeout((touch, signal) => provider.analyze({ locale: narrationLocale(), providerId: pid, mode: "crew", code: prompt, messages: [{ role: "user", content: prompt }],
    ...(role.model?.trim() && (role.provider === "claude-code" || ANALYZE[role.provider]) ? { providerSettings: { [pid]: { model: role.model.trim() } } } : {}) } as Parameters<typeof provider.analyze>[0], // 다른 AI(grok·cursor)는 Claude로 → 그 모델 id는 안 맞음
    { signal, onProgress: touch, onThinking: touch, priority: true }), 90_000, 240_000);
  // chat 모드는 학습 카드 블록(```nunopi-cards …```)을 붙임 — 대화방 답엔 필요 없음, 어디 있든 전부 뺌(안 닫힌 건 끝까지)(앱 확인)
  const text = (res?.summary ?? "").replace(/```nunopi-cards[\s\S]*?(```|$)/g, "").trim();
  if (!text || isFailedNote(text)) throw new Error(text || "empty");
  return text;
}

function factsFor(root: string, human: CrewMsg, taskId?: string): string[] {
  const tasks = readBoard(root).tasks;
  const t = taskId ? tasks.find((x) => x.id === taskId) : undefined;
  if (!t) return ["No card is active. Board:", ...tasks.slice(-20).map((x) => `- [${x.status}] ${clip(x.title, 120)}`)];
  const p = pipelineOf(t), run = activeFor(root, t.id);
  const last = [...readRuns(root)].reverse().find((r) => r.taskId === t.id);
  return [`Card: "${clip(t.title, 200)}" — column: ${t.status}${t.gate ? `, waiting for the human: ${t.gate.kind}${t.gate.text ? ` (${clip(t.gate.text, 300)})` : ""}` : ""}`,
    `Card body: ${clip(t.body, 1200) || "(none)"}`,
    `Pipeline: ${p.map((r, i) => (i === Math.min(t.stage ?? 0, p.length - 1) ? `[${r}]` : r)).join(" → ")}`,
    ...(run ? [`Now running: ${run.role} (${run.state}), last activity: ${clip(run.lastActivity, 200)}`] : []),
    ...(last?.summary ? [`Last summary from ${last.role}: ${clip(last.summary, 1200)}`] : []),
    `Recent team chat on this card:`, ...readMsgs(root, 0, 100_000).filter((m) => m.taskId === t.id && m.id !== human.id).slice(-12).map((m) => `- ${m.from} (${m.kind}): ${clip(m.text, 300)}`)];
}
const teamList = () => listRoles().map((r) => `- ${r.id} (${roleLabel(r.id)}): ${clip(r.instructions, 140)}`).join("\n");
const speaking = (root: string, roleId?: string) => { // 지금 말하는 역할 = '쓰는 중' 표시
  const a = (g.answering ??= new Set());
  for (const k of [...a]) if (k.startsWith(`${root}\n`)) a.delete(k);
  if (roleId) a.add(`${root}\n${roleId}`);
};

// 레포마다 한 번에 하나(리뷰: 글을 연달아 보내면 AI 호출이 줄줄이 — 다른 해설과 슬롯을 나눠 씀). 쓰는 중에 온 글은 가장 최근 것만 이어서.
async function answerHuman(root: string, human: CrewMsg, roleId: string, taskId?: string, everyone = false) {
  const queue = (g.answerNext ??= new Map());
  if ([...(g.answering ?? [])].some((k) => k.startsWith(`${root}\n`))) { queue.set(root, { human, roleId, taskId, everyone }); return; }
  const first = getRole(everyone ? MODERATOR : roleId) ?? getRole(MODERATOR);
  if (!first) { say(root, { from: "board", kind: "blocked", replyTo: human.id, ...tx("crewchat.answerFailed", { role: roleId, why: tr("crewchat.why.other") }) }); return; }
  let who = first, meeting = false;
  speaking(root, first.id);
  const failed = new Set<string>();
  const askR = (r: CrewRole, prompt: string) => askOrFallback(root, r, prompt, human.id, failed);
  try {
    const lang = LANG[narrationLocale()] ?? "English";
    const facts = factsFor(root, human, taskId);
    const t = taskId ? readBoard(root).tasks.find((x) => x.id === taskId) : undefined;
    const card = t ? { taskId: t.id, taskTitle: t.title } : {};
    const request = clip(human.text, 2000);
    // ① 첫 답 + 질문/일 요청 판단
    const op = await askR(first, [`You are "${roleLabel(first.id)}" (${first.id}), an agent on a software team board in Mustard.`,
      everyone ? `The human wrote to the whole team (@all):` : `The human wrote in the team chat without @mentioning anyone:`, `> ${request}`, "",
      `Facts (use ONLY these; do not invent progress):`, ...facts, "",
      `Decide the intent: "work" if the human asks the team to build, change, fix or plan something new; otherwise "question" (status, explanation, opinion).`,
      `Reply as ${first.id} in 1-4 short sentences, in ${lang}. You cannot run tools here.${everyone ? " Other teammates will add their view after you." : ""}`,
      `If a card waits for the human (spec/schema/merge approval, a question), say what they need to decide on the board card.`,
      `If intent is "work", your reply opens a short team meeting about it (say so briefly).`,
      `Answer ONLY with JSON: {"intent":"question"|"work","reply":"..."}`].join("\n"));
    const opener = readAnswer(op.text);
    say(root, { from: first.id, provider: op.provider, kind: opener.intent === "work" ? "meeting" : "answer", text: opener.reply.slice(0, 2000), replyTo: human.id, ...card });
    const transcript = [`${first.id}: ${clip(opener.reply, 600)}`];
    meeting = opener.intent === "work";
    if (opener.intent !== "work") {
      if (!everyone) return;
      // @all 질문 — 나머지 역할이 차례로(앞 답을 보며) 한두 문장
      for (const r of listRoles().filter((x) => x.id !== first.id).slice(0, 8)) { // 역할을 늘려도 호출 상한(리뷰)
        who = r; speaking(root, r.id);
        const { text, provider } = await askR(r, [`You are "${roleLabel(r.id)}" (${r.id}) on a software team board. The human asked the whole team:`, `> ${request}`, "",
          `Facts:`, ...facts, "", `Teammates so far:`, ...transcript, "",
          `Add your own view from your role in 1-2 short sentences, in ${lang}. Don't repeat others. Plain text.`].join("\n"));
        say(root, { from: r.id, provider, kind: "answer", text: text.slice(0, 1500), replyTo: human.id, ...card }); // 대신 답한 AI로 표시(리뷰)
        transcript.push(`${r.id}: ${clip(text, 400)}`);
      }
      return;
    }
    // ② 팀 회의 — 진행자가 참여 역할 고르기(@all이면 전원)
    const mod = getRole(MODERATOR) ?? first;
    const known = new Set(listRoles().map((r) => r.id));
    let members = listRoles().map((r) => r.id).filter((id) => id !== mod.id).slice(0, 8); // @all 전원(상한 8, 리뷰)
    if (!everyone) {
      who = mod; speaking(root, mod.id);
      const kick = readJson((await askR(mod, [`You moderate a short team meeting on a software board. Request from the human:`, `> ${request}`, "",
        `Team:`, teamList(), "", `Pick 2-5 roles that should weigh in (not you). Answer ONLY with JSON: {"participants":["role-id",...]}`].join("\n"))).text);
      members = pickParticipants(kick?.participants, known, mod.id);
    }
    for (const id of members) {
      const r = getRole(id); if (!r) continue;
      who = r; speaking(root, r.id);
      // 참여자 하나가 실패해도(Claude로도) 건너뛰고 회의는 계속 — 카드는 만듦(유저: 멈추면 이유 알림)
      let text: string, provider: string;
      try {
        ({ text, provider } = await askR(r, [`You are "${roleLabel(r.id)}" (${r.id}) in a short team meeting. The human asked the team:`, `> ${request}`, "",
          `Board facts:`, ...facts, "", `Meeting so far:`, ...transcript, "",
          `In 1-3 short sentences, in ${lang}: what you would do for this, any risk, and a question for a teammate (@role-id) if needed. Plain text, don't repeat others.`].join("\n")));
      } catch (e) {
        say(root, { from: "board", kind: "blocked", replyTo: human.id, ...tx("crewchat.skipped", { role: roleLabel(r.id), why: String((e as Error)?.message ?? e) }) });
        continue;
      }
      say(root, { from: r.id, provider, kind: "meeting", text: text.slice(0, 1500), replyTo: human.id });
      transcript.push(`${r.id}: ${clip(text, 500)}`);
    }
    // ③ 마무리 → 카드(Ready = 바로 실행)
    who = mod; speaking(root, mod.id);
    const wrapR = await askR(mod, [`You moderate the meeting. Request:`, `> ${request}`, "", `Meeting:`, ...transcript, "", `Team role ids: ${[...known].join(", ")}`, "",
      `Wrap up. Answer ONLY with JSON: {"reply":"1-3 sentences in ${lang}: decisions and who does what","title":"short card title","body":"card description in ${lang} with acceptance criteria","pipeline":["role-id in working order"]}`].join("\n"));
    const wrap = readJson(wrapR.text);
    const plan = planFromWrapUp(wrap, human.text, known);
    const b = applyOp(root, { op: "create", title: plan.title, body: plan.body, status: "ready", ...(plan.pipeline.length ? { role: plan.pipeline[0], pipeline: plan.pipeline } : {}) });
    const made = b.tasks[b.tasks.length - 1];
    const summary = typeof wrap?.reply === "string" && wrap.reply.trim() ? wrap.reply.trim() : plan.title;
    say(root, { from: mod.id, provider: wrapR.provider, kind: "meeting", text: summary.slice(0, 2000), replyTo: human.id, taskId: made.id, taskTitle: made.title, ...(plan.pipeline[0] ? { mentions: [plan.pipeline[0]] } : {}) });
  } catch (e) {
    // 회의 중에 끊기면 카드 없이 멈췄다고(리뷰: 발언만 남고 끝난 것처럼 보임) + 이유(로그인·한도·시간 초과, 유저)
    say(root, { from: "board", kind: "blocked", replyTo: human.id, ...tx(meeting ? "crewchat.meetingStopped" : "crewchat.answerFailed", { role: roleLabel(who.id), why: String((e as Error)?.message ?? e).slice(0, 160) }) });
  } finally {
    speaking(root);
    const nx = queue.get(root);
    if (nx) { queue.delete(root); void answerHuman(root, nx.human, nx.roleId, nx.taskId, nx.everyone); }
  }
}
export const answeringRoles = (root: string) => [...new Set([...[...(g.answering ?? [])].filter((k) => k.startsWith(`${root}\n`)).map((k) => k.slice(root.length + 1)), ...(g.answerNext?.get(root) ? [g.answerNext.get(root)!.roleId] : [])])]; // 차례를 기다리는 답도 '쓰는 중'(재리뷰)

// #1110 Draft PR 만들기 — 사람 클릭으로만(에이전트는 push·PR 금지 정책). 카드 마지막 실행의 작업 폴더·브랜치에서 push → gh pr create --draft.
const pexecFile = promisify(execFile);
const prInFlight = new Set<string>(); // 같은 카드 PR 두 번 눌림 방지(리뷰)
export async function createPr(root: string, taskId: string): Promise<{ url: string }> {
  const key = `${root}\n${taskId}`;
  if (prInFlight.has(key)) throw new Error("already creating a PR");
  prInFlight.add(key);
  try { return await createPrOnce(root, taskId); } finally { prInFlight.delete(key); }
}
async function createPrOnce(root: string, taskId: string): Promise<{ url: string }> {
  if (activeFor(root, taskId)) throw new Error("running");
  const task = readBoard(root).tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("task not found");
  if (task.pr) return task.pr;
  const run = [...listRuns(root)].reverse().find((r) => r.taskId === taskId && r.worktree && r.branch);
  if (!run || !existsSync(run.worktree)) throw new Error("no worktree for this card");
  const git = (args: string[]) => pexecFile("git", args, { cwd: run.worktree, timeout: 120_000 }).then((r) => r.stdout.trim());
  const remote = await git(["remote"]).catch(() => "");
  if (!remote.split("\n").includes("origin")) throw new Error("no git remote 'origin'");
  await git(["push", "-u", "origin", run.branch]);
  const artifacts = (() => { try { return readdirSync(join(run.worktree, ".crew")).filter((f) => f.endsWith(".md")); } catch { return []; } })();
  const body = [
    "## Summary", task.gate?.text || run.summary || task.title, "",
    "## Pipeline", (task.pipeline ?? [run.role]).map((r) => `\`${r}\``).join(" → "), "",
    ...(artifacts.length ? ["## Crew artifacts (in the worktree, not committed)", ...artifacts.map((f) => `- .crew/${f}`), ""] : []),
    "🤖 Opened from Mustard Crew",
  ].join("\n");
  const base = run.base && run.base !== "HEAD" ? run.base : "";
  const out = await pexecFile("gh", ["pr", "create", "--draft", "--head", run.branch, ...(base ? ["--base", base] : []), "--title", task.title, "--body", body], { cwd: run.worktree, timeout: 120_000 })
    .then((r) => r.stdout.trim()).catch((e) => { throw new Error(String((e as { stderr?: string }).stderr || (e as Error).message).trim().slice(0, 300) || "gh failed"); });
  const url = out.split("\n").map((l) => l.trim()).find((l) => /^https?:\/\//.test(l)) ?? out;
  patchTask(root, taskId, { pr: { url } });
  say(root, { from: "board", kind: "gate", taskId, taskTitle: task.title, ...tx("crewchat.prCreated", { url }) });
  return { url };
}

// #1110 터미널로 넘겨받기 — 실행 중이면 멈추고, 그 카드 작업 폴더·마지막 역할의 실행 AI를 돌려줌(화면이 새 터미널 탭에서 이어받음).
export async function takeover(root: string, taskId: string): Promise<{ worktree: string; provider: string }> {
  if (activeFor(root, taskId)) await stopRun(root, taskId);
  const run = [...listRuns(root)].reverse().find((r) => r.taskId === taskId && r.worktree);
  if (!run || !existsSync(run.worktree)) throw new Error("no worktree for this card");
  return { worktree: run.worktree, provider: run.provider };
}

// ── #1112 자동 계기 실행 ─────────────────────────────────────────────
async function sh(cmd: string, args: string[], cwd: string, timeout = 30_000): Promise<string> {
  return (await pexecFile(cmd, args, { cwd, timeout, maxBuffer: 5_000_000 })).stdout.trim();
}
async function baseBranch(root: string): Promise<string> {
  const head = await sh("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root).catch(() => ""); // origin/main
  if (head) return head.replace(/^origin\//, "");
  return sh("git", ["rev-parse", "--abbrev-ref", "HEAD"], root).catch(() => "main");
}
function triggerCard(root: string, t: CrewTrigger, title: string, body: string, chat: { key: string; vars?: Record<string, string | number> }) {
  const b = applyOp(root, { op: "create", title: title.slice(0, 200), body: body.slice(0, 20_000), status: "ready", ...(t.pipeline[0] ? { role: t.pipeline[0] } : {}), ...(t.pipeline.length ? { pipeline: t.pipeline } : {}) });
  const card = b.tasks[b.tasks.length - 1];
  say(root, { from: "board", kind: "gate", taskId: card.id, taskTitle: card.title, ...(() => { const suffix = t.pipeline[0] ? ` @${t.pipeline[0]}` : ""; const c = tx(chat.key, chat.vars); return { text: c.text + suffix, i18n: { ...c.i18n, ...(suffix ? { suffix } : {}) } }; })(), ...(t.pipeline[0] ? { mentions: [t.pipeline[0]] } : {}) });
}
export async function checkTriggers(root: string, now = Date.now()): Promise<void> {
  const list = readTriggers(root);
  let changed = false;
  for (const t of list) {
    if (!t.enabled) continue;
    try {
      if (t.kind === "schedule") {
        if (!scheduleDue(t, now)) continue;
        triggerCard(root, t, t.title ?? tr("crew.scheduledTask"), t.body ?? "", { key: "crewtrig.scheduleChat" });
        t.lastFired = now; delete t.lastError; changed = true;
        continue;
      }
      // CI 실패·이슈 — 새로 나타난 것만, 처음엔 지금 있는 것을 본 것으로만(켜자마자 폭주 방지), 한 번에 최대 2장
      let items: { id: string; title: string; body: string; chat: { key: string; vars?: Record<string, string | number> } }[] = [];
      if (t.kind === "ci-failed") {
        const branch = t.branch || (await baseBranch(root));
        const runs = JSON.parse(await sh("gh", ["run", "list", "--branch", branch, "--limit", "10", "--json", "databaseId,conclusion,name,displayTitle,url"], root) || "[]") as { databaseId: number; conclusion: string; name: string; displayTitle: string; url: string }[];
        items = runs.filter((r) => r.conclusion === "failure").map((r) => ({ id: String(r.databaseId), title: tr("crewtrig.ciTitle", { name: r.name, branch }), body: `${r.displayTitle}\n${r.url}`, chat: { key: "crewtrig.ciChat" } }));
      } else if (t.kind === "issue-label" && t.label) {
        const issues = JSON.parse(await sh("gh", ["issue", "list", "--label", t.label, "--state", "open", "--limit", "30", "--json", "number,title,body,url"], root) || "[]") as { number: number; title: string; body: string; url: string }[];
        items = issues.map((i) => ({ id: String(i.number), title: `#${i.number} ${i.title}`, body: `${i.body ?? ""}\n\n${i.url}`, chat: { key: "crewtrig.issueChat", vars: { label: t.label! } } }));
      }
      if (!t.primed) { t.seen = [...new Set([...t.seen, ...items.map((x) => x.id)])].slice(-500); t.primed = true; delete t.lastError; changed = true; continue; }
      const fresh = freshIds(t.seen, items.map((x) => x.id)).slice(0, 2);
      for (const id of fresh) {
        const it = items.find((x) => x.id === id)!;
        let body = it.body;
        if (t.kind === "ci-failed") { // 실패 로그 뒤쪽(에이전트는 gh를 직접 못 써서 미리 넣어 줌)
          const log = await sh("gh", ["run", "view", id, "--log-failed"], root, 60_000).catch(() => "");
          body = `${tr("crewtrig.ciBody")}\n\n${it.body}${log ? `\n\n\`\`\`\n${log.split("\n").slice(-120).join("\n").slice(-6000)}\n\`\`\`` : ""}`;
        }
        triggerCard(root, t, it.title, body, it.chat);
        t.seen = [...t.seen, id].slice(-500); t.lastFired = now; changed = true;
      }
      if (t.lastError) { delete t.lastError; changed = true; }
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr || (e as Error)?.message || e).trim().slice(0, 300);
      if (t.lastError !== msg) { t.lastError = msg; changed = true; }
    }
  }
  if (changed) { // 실행 중에 화면이 계기를 고쳤을 수 있음 — 최신 파일에 실행 결과 필드만 덮음, 조건이 바뀐 계기는 안 덮음(처음부터 다시, 리뷰)
    const cur = readTriggers(root);
    writeTriggers(root, cur.map((c) => { const r = list.find((x) => x.id === c.id && x.kind === c.kind && x.label === c.label && x.branch === c.branch); return r ? { ...c, seen: r.seen, primed: r.primed, lastFired: r.lastFired, lastError: r.lastError } : c; }));
  }
}

// ── #1114 하위 작업 ─────────────────────────────────────────────────
// 쪼개기 승인 → 하위 카드(Ready, 부모 맥락·기획 요약 첨부, 의존 = 앞 번호 카드), 부모는 Review 칸에서 하위 기다림.
function splitCard(root: string, parent: CrewTask) {
  say(root, { from: "human", kind: "decision", taskId: parent.id, taskTitle: parent.title, ...tx("crewchat.decision.approve") });
  const ids: string[] = [];
  const context = `${tr("crewsplit.parentContext", { title: parent.title })}\n${parent.body}${parent.gate?.text ? `\n\n${parent.gate.text}` : ""}`.slice(0, 6000);
  for (const s of parent.split ?? []) {
    const b = applyOp(root, { op: "create", title: s.title, body: `${s.body ?? ""}\n\n---\n${context}`.trim(), status: "ready", role: s.roles[0], pipeline: s.roles });
    const child = b.tasks[b.tasks.length - 1];
    const dependsOn = (s.after ?? []).map((i) => ids[i]).filter(Boolean);
    patchTask(root, child.id, { parentId: parent.id, ...(dependsOn.length ? { dependsOn } : {}) });
    ids.push(child.id);
  }
  const board = patchTask(root, parent.id, { children: ids, split: undefined, gate: undefined, status: "review" });
  say(root, { from: "board", kind: "gate", taskId: parent.id, taskTitle: parent.title, ...tx("crewsplit.created", { n: ids.length }) });
  return board;
}

// 하위가 전부 Done이면 부모도 Done(tick마다 — 머지 승인·보드에서 끌기 등 어느 경로로 끝나도)
function closeParents(root: string, tasks: CrewTask[]) {
  for (const p of tasks) {
    if (!p.children?.length || p.status === "done") continue;
    const { done, total } = childProgress(p, tasks);
    if (!total || done < total) continue;
    patchTask(root, p.id, { status: "done" });
    say(root, { from: "board", kind: "gate", taskId: p.id, taskTitle: p.title, ...tx("crewsplit.parentDone", { n: total }) });
  }
}

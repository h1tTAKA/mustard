// Crew 실행 엔진(#1100, 에픽 #1097) — 카드 하나를 담당 역할 에이전트로 실행. 서버 전용(Next 서버 프로세스 싱글톤).
// 흐름: 카드 → 실행 중 · worktree 준비 → SNA 세션(agent.start, cwd=worktree, 역할 지시문 + Crew 규약) → 이벤트로 실시간 상태
//       → complete = 리뷰 칸(세션 종료해 자리 반납) / error = 막힘 / 권한 요청 = 나 필요(사람 클릭으로만 승인).
// 상태는 SNA 세션 이벤트(기록)로 판정 — 화면 긁기 안 함(#979 교훈). 기록 = ~/.nunopi/crew/<sha>/runs.json.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getSnaClient } from "@mustard/core/sna";
import { applyOp, readBoard } from "./crewStore";
import { getRole } from "./crewRoleStore";
import { crewProtocol, type CrewRole } from "./crewRoleDefaults";
import { ensureWorktree } from "./crewWorktree";
import { decide } from "./crewPolicy";
import { narrationLocale } from "@/lib/narrationConfig";
import type { CrewStatus } from "./crewTypes";

export type RunState = "starting" | "running" | "needs-permission" | "done" | "failed" | "stopped";
export interface CrewRun {
  id: string; root: string; taskId: string; role: string; provider: string; model?: string;
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
type G = { runs: Map<string, CrewRun>; bySession: Map<string, string>; wired: boolean; reconciled: Set<string>; flush: Map<string, ReturnType<typeof setTimeout>>; tokens: Map<string, string>; pending: Map<string, Pending> };
const g = ((globalThis as unknown as { __mustardCrew?: G }).__mustardCrew ??= { runs: new Map(), bySession: new Map(), wired: false, reconciled: new Set(), flush: new Map(), tokens: new Map(), pending: new Map() });

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
      r.state = "failed"; r.error = "interrupted (app restarted)"; r.endedAt = Date.now(); changed = true;
      moveCard(root, r.taskId, "blocked");
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

const oneLine = (s: string, n = 140) => s.replace(/\s+/g, " ").trim().slice(-n);

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
      moveCard(run.root, run.taskId, "review");
      persist(run, true);
      void sna.agent.kill(session).catch(() => {}); // 세션 자리 반납(대화 기록은 SNA DB에 남음 — 넘겨받기·이어 하기는 에픽 4번)
      return;
    } else if (type === "error") {
      run.state = "failed"; run.endedAt = Date.now(); run.error = oneLine(msg || "agent error", 400);
      moveCard(run.root, run.taskId, "blocked");
      persist(run, true);
      return;
    } else if (type === "interrupted") {
      run.lastActivity = "interrupted";
    }
    persist(run);
  });
  sna.agent.onPermissionRequest(({ session, request, createdAt }) => {
    const id = g.bySession.get(session); const run = id ? g.runs.get(id) : undefined;
    if (!run || !ACTIVE.includes(run.state)) return;
    run.state = "needs-permission"; run.permission = { request, at: createdAt || Date.now() };
    moveCard(run.root, run.taskId, "needs-you");
    persist(run, true);
  });
  await sna.agent.subscribePermissions().catch(() => {});
}

function buildPrompt(title: string, body: string, role: CrewRole): string {
  return [
    `# Board card: ${title}`,
    body.trim() ? `\n${body.trim()}` : "",
    `\nYou are acting as role "${role.id}". Do your role's part for this card now.`,
  ].join("\n");
}

// ── 공개 API ─────────────────────────────────────────────────────────
export function listRuns(root: string): CrewRun[] {
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
  reconcile(root);
  const task = readBoard(root).tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("task not found");
  const active = [...g.runs.values()].filter((r) => ACTIVE.includes(r.state));
  if (active.some((r) => r.root === root && r.taskId === taskId)) throw new Error("already running");
  if (active.length >= MAX_CONCURRENT) throw new Error(`concurrency limit (${MAX_CONCURRENT})`);
  const role = getRole(task.role) ?? getRole("scope-planner")!; // 자동 배정 = 범위 기획자부터(나누기는 에픽 3번)

  moveCard(root, taskId, "running");
  const run: CrewRun = { id: randomUUID(), root, taskId, role: role.id, provider: role.provider, model: role.model, worktree: "", branch: "", base: "", state: "starting", startedAt: Date.now(), toolCount: 0, lastActivity: "preparing worktree" };
  g.runs.set(run.id, run);
  persist(run, true);
  try {
    const wt = await ensureWorktree(root, taskId, task.title);
    Object.assign(run, { worktree: wt.dir, branch: wt.branch, base: wt.base });
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
      provider: role.provider, ...(role.model ? { model: role.model } : {}), cwd: wt.dir,
      appendSystemPrompt: `${role.instructions}\n\n${crewProtocol(LANG[narrationLocale()] ?? "Korean")}`,
      prompt: buildPrompt(task.title, task.body, role),
      // Claude: SNA 훅 대신 Mustard 훅(정책 자동 허락·차단, 나머지만 사람에게). Codex·OpenCode: SNA 기본 승인 흐름(onPermissionRequest).
      permissionMode: isClaude ? "bypassPermissions" : "acceptEdits",
      ...(isClaude ? { providerOptions: { settings: { hooks: { PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: `node "${hookPath()}" --url=${origin} --run=${run.id} --token=${token}`, timeout: 900 }] }] } } } } : {}),
      disallowedTools: DISALLOWED,
      meta: { crew: true, runId: run.id },
    });
    run.state = "running"; run.lastActivity = "started";
    persist(run, true);
  } catch (e) {
    run.state = "failed"; run.endedAt = Date.now(); run.error = oneLine(String((e as Error)?.message ?? e), 400);
    moveCard(root, taskId, "blocked");
    persist(run, true);
  }
  return run;
}

const activeFor = (root: string, taskId: string) => [...g.runs.values()].find((r) => r.root === root && r.taskId === taskId && ACTIVE.includes(r.state));

export async function stopRun(root: string, taskId: string): Promise<CrewRun> {
  const run = activeFor(root, taskId);
  if (!run) throw new Error("not running");
  run.state = "stopped"; run.endedAt = Date.now(); run.error = "stopped by user"; run.permission = undefined;
  g.pending.get(run.id)?.resolve(false); // 기다리던 훅은 거부로 풀기
  if (run.sessionId) await (await getSnaClient()).agent.kill(run.sessionId).catch(() => {});
  moveCard(root, taskId, "blocked");
  persist(run, true);
  return run;
}

// 권한 요청 응답 — 화면 버튼(사람 클릭)에서만 옴. 에이전트가 전한 "승인됐다"는 받지 않음.
export async function respondPermission(root: string, taskId: string, approved: boolean): Promise<CrewRun> {
  const run = activeFor(root, taskId);
  if (!run || run.state !== "needs-permission") throw new Error("no pending permission");
  const hook = g.pending.get(run.id);
  if (hook) hook.resolve(approved); // Claude — Mustard 훅이 기다리는 중
  else if (run.sessionId) await (await getSnaClient()).agent.respondPermission(run.sessionId, approved); // Codex·OpenCode — SNA 승인
  else throw new Error("no pending permission");
  run.state = "running"; run.permission = undefined; run.lastActivity = approved ? "permission approved" : "permission denied";
  moveCard(root, taskId, "running");
  persist(run, true);
  return run;
}

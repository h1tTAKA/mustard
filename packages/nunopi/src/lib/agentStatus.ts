// 에이전트 상태 저장 + 변경 푸시(#764) — POST(훅 수신)·GET(조회)·SSE 스트림 라우트가 공유하는 서버 싱글턴.
// 훅이 상태를 POST하면 즉시 SSE 리스너로 fan-out → 화면은 폴링 없이 그 순간 갱신(푸시).
// globalThis 캐시로 dev 라우트 리로드에도 store/listeners 생존.

export type AgentState = "working" | "waiting" | "blocked" | "done";

export interface Entry {
  cwd: string;
  sessionId: string;
  agent: string;
  state: AgentState;
  tool?: string;
  toolInput?: string;
  prompt?: string;
  task?: string; // #968 세션 작업 제목(OSC 타이틀 요약) — 목록 행 텍스트
  updatedAt: number;
  stateStartedAt: number;
  hookAt?: number;   // #989 마지막 Claude 훅 수신 시각 — 있으면(신선하면) 화면 판정보다 훅이 권위
  silent?: boolean;  // #989 알림 없는 done(수동 /compact 종료 = 세션 경계)
}

export const HOOK_FRESH_MS = 30 * 60 * 1000; // 훅 신선도 30분

const TTL_MS = 10 * 60 * 1000;      // 갱신 없으면 폐기(유령 방지)
const DONE_TTL_MS = 3 * 60 * 1000;  // done(유휴)은 몇 분 유지 — 살아있는데 순삭 방지

const g = globalThis as unknown as { __nunopiStatusStore?: Map<string, Entry>; __nunopiStatusListeners?: Set<(cwd: string) => void> };
const store: Map<string, Entry> = g.__nunopiStatusStore ?? (g.__nunopiStatusStore = new Map());
const listeners: Set<(cwd: string) => void> = g.__nunopiStatusListeners ?? (g.__nunopiStatusListeners = new Set());

export const normPath = (p: string) => p.replace(/\/+$/, "");
const keyOf = (cwd: string, sessionId: string) => `${cwd} ${sessionId}`;

export function prune(now: number): void {
  for (const [k, e] of store) {
    const ttl = e.state === "done" ? DONE_TTL_MS : TTL_MS;
    if (now - e.updatedAt > ttl) store.delete(k);
  }
}

// 상태 upsert — state 바뀔 때만 stateStartedAt 리셋. 저장 후 cwd 반환(호출부가 emit).
export function upsert(fields: { cwd: string; sessionId: string; agent: string; state: AgentState; tool?: string; toolInput?: string; prompt?: string; task?: string; hook?: boolean; silent?: boolean }, now: number): void {
  const key = keyOf(fields.cwd, fields.sessionId);
  const prev = store.get(key);
  store.set(key, {
    cwd: fields.cwd,
    sessionId: fields.sessionId,
    agent: fields.agent,
    state: fields.state,
    tool: fields.state === "working" ? fields.tool : undefined,
    toolInput: fields.state === "working" ? fields.toolInput : undefined,
    prompt: fields.prompt ?? prev?.prompt,
    task: fields.task ?? prev?.task, // #968 제목은 state 무관 유지(빈 값이면 이전 것 보존)
    updatedAt: now,
    stateStartedAt: prev && prev.state === fields.state ? prev.stateStartedAt : now,
    hookAt: fields.hook ? now : prev?.hookAt,
    silent: fields.state === "done" ? (fields.silent ?? (prev?.state === "done" ? prev.silent : false)) : false, // 같은 done 유지 중엔 보존
  });
}

export function get(cwd: string, sessionId: string): Entry | undefined {
  return store.get(keyOf(cwd, sessionId));
}
// #989 훅은 터미널 id만 앎 → 화면 보고가 저장한 같은 세션 행의 cwd를 찾는다(레포 루트 기준 키 일치).
export function findBySession(sessionId: string): Entry | undefined {
  for (const e of store.values()) if (e.sessionId === sessionId) return e;
  return undefined;
}

// 레포 root의 상태 — #968 세션별 전부(목록). 예전엔 에이전트 타입별 1개로 합쳤으나
// 같은 repo에 세션 여럿(claude 여러 개)이면 다 보여야 해서 sessionId별로 전부 반환.
// 정렬: 상태 우선순위(working>waiting>blocked>done) 후 최근 갱신 순 — 바쁜 세션이 위로.
const STATE_ORDER: Record<AgentState, number> = { working: 0, waiting: 1, blocked: 2, done: 3 };
export function query(root: string, now: number): Array<{ sessionId: string; agent: string; state: AgentState; tool?: string; toolInput?: string; prompt?: string; task?: string; since: number; updatedAt: number; silent?: boolean }> {
  prune(now);
  const r = normPath(root);
  if (!r) return [];
  const inRepo = (cwd: string) => cwd === r || cwd.startsWith(r + "/");
  return [...store.values()]
    .filter((e) => inRepo(e.cwd))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.updatedAt - a.updatedAt)
    .map((e) => ({ sessionId: e.sessionId, agent: e.agent, state: e.state, tool: e.tool, toolInput: e.toolInput, prompt: e.prompt, task: e.task, since: e.stateStartedAt, updatedAt: e.updatedAt, silent: e.silent || undefined }));
}

// 세션 상태 제거(#765) — 에이전트가 종료(포그라운드가 셸로 복귀)하면 카드에서 즉시 사라지게.
export function remove(cwd: string, sessionId: string): boolean {
  return store.delete(keyOf(cwd, sessionId));
}

// SSE — 변경 리스너 등록(해제 함수 반환) / fan-out.
export function subscribe(fn: (cwd: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function emit(cwd: string): void {
  for (const fn of listeners) { try { fn(cwd); } catch { /* 개별 리스너 실패 무시 */ } }
}

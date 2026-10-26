// statusCheckRollup 정규화(#814) — CheckRun/StatusContext 혼재를 {name,state,url}로 통일.
// 서브3(브랜치 CI)·서브5(PR) 공용. state: success|failure|pending|neutral.
export type CheckState = "success" | "failure" | "pending" | "neutral";
export interface Check { name: string; state: CheckState; url?: string; workflow?: string; startedAt?: string; completedAt?: string; description?: string; runId?: string; checkRunId?: string }
export interface CheckSummary { pass: number; fail: number; pending: number; total: number }

function oneState(c: GhCheckRaw): CheckState {
  // StatusContext: state(SUCCESS|PENDING|FAILURE|ERROR|EXPECTED)
  if (c.state) {
    const s = c.state.toUpperCase();
    if (s === "SUCCESS") return "success";
    if (s === "FAILURE" || s === "ERROR") return "failure";
    if (s === "PENDING" || s === "EXPECTED") return "pending";
    return "neutral";
  }
  // CheckRun: status(QUEUED|IN_PROGRESS|COMPLETED) + conclusion(SUCCESS|FAILURE|...)
  if ((c.status || "").toUpperCase() !== "COMPLETED") return "pending";
  const con = (c.conclusion || "").toUpperCase();
  if (con === "SUCCESS") return "success";
  if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(con)) return "failure";
  return "neutral"; // SKIPPED, NEUTRAL 등
}

export function normalizeChecks(rollup: GhCheckRaw[] | undefined): Check[] {
  // 이름 dedup — 혼합 CI(Actions + 레거시 StatusContext)가 같은 이름을 중복 노출할 때
  // CheckRun을 우선 유지(더 정확한 status/conclusion). 이름 없으면 dedup 대상서 제외.
  const byName = new Map<string, Check>();
  const out: Check[] = [];
  for (const c of rollup || []) {
    const name = c.name || c.context || "check";
    // detailsUrl(.../actions/runs/<runId>/job/<jobId>)에서 작업흐름 id·체크(job) id 추출 — annotations 조회·표시용.
    const m = (c.detailsUrl || "").match(/\/actions\/runs\/(\d+)\/job\/(\d+)/);
    const item: Check = { name, state: oneState(c), url: c.detailsUrl || c.targetUrl, workflow: c.workflowName, startedAt: c.startedAt, completedAt: c.completedAt, description: c.description, runId: m?.[1], checkRunId: m?.[2] };
    const prev = byName.get(name);
    if (!prev) { byName.set(name, item); out.push(item); continue; }
    if (c.__typename === "CheckRun") { const i = out.indexOf(prev); if (i >= 0) out[i] = item; byName.set(name, item); } // CheckRun이 StatusContext 이김
  }
  return out;
}

export function summarize(checks: Check[]): CheckSummary {
  const s: CheckSummary = { pass: 0, fail: 0, pending: 0, total: checks.length };
  for (const c of checks) {
    if (c.state === "success") s.pass++;
    else if (c.state === "failure") s.fail++;
    else if (c.state === "pending") s.pending++;
  }
  return s;
}

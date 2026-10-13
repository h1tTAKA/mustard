// 에이전트 세션 기록 파싱(#1064) — 순수 함수(의존성 없음, check로 검증). 파일 읽기는 agentSessions.ts.
// 에이전트마다 기록 형식이 달라서 줄 하나 → 공통 메시지로 바꾸는 어댑터를 두고, "git commit" 호출을 경계로 구간을 자름.
export interface SessionMsg { role: "user" | "assistant" | "tool"; text: string; ts: number }
export type CallKind = "commit" | "merge" | "pull";
export interface ParsedLine { msgs: SessionMsg[]; ts: number; commitCall: boolean; callKind?: CallKind; mergeToo?: boolean; callIdx?: number; branch?: string; cwd?: string; result?: boolean; prompt?: boolean } // result = 도구 출력만 있는 줄, prompt = 사람이 입력한 프롬프트(턴 시작)
export type AgentKind = "claude" | "codex";

const MSG_MAX = 4000;  // 메시지 하나 상한(도구 출력이 수만 자일 수 있음)
// 커밋을 만드는 명령(출력이 압축돼 해시가 안 남아도 명령으로 알아봄, rtk·-C 포함).
//  commit = "git commit" / merge = "gh pr merge"·"git merge"(머지 커밋) / pull = "git pull"(머지 반영만 — 대화를 끊지 않음, #1064 유저 피드백)
const COMMIT_ONLY = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/, MERGE_ONLY = /\bgit\s+(?:-C\s+\S+\s+)?merge\b|\bgh\s+pr\s+merge\b/, PULL_ONLY = /\bgit\s+(?:-C\s+\S+\s+)?pull\b/;
export const COMMIT_RE = new RegExp(`${COMMIT_ONLY.source}|${MERGE_ONLY.source}|${PULL_ONLY.source}`);
// 한 명령에 여럿이면 커밋 > 머지 > pull(예: "git commit && gh pr merge"는 커밋 호출이자 머지 호출 — 커밋으로 봄, 머지 대상 찾을 땐 merge도 인정)
export const callKindOf = (t: string): CallKind | undefined => COMMIT_ONLY.test(t) ? "commit" : MERGE_ONLY.test(t) ? "merge" : PULL_ONLY.test(t) ? "pull" : undefined;

const clip = (s: string) => (s.length > MSG_MAX ? s.slice(0, MSG_MAX) + "…" : s);
const tsOf = (v: unknown) => { const n = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : 0; };
const textOf = (c: unknown): string => typeof c === "string" ? c
  : Array.isArray(c) ? c.map((x) => (x && typeof x === "object" && "text" in x && typeof (x as { text: unknown }).text === "string" ? (x as { text: string }).text : "")).filter(Boolean).join("\n") : "";
const toolLine = (name: string, input: unknown) => {
  const i = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const main = typeof i.command === "string" ? i.command : typeof i.cmd === "string" ? i.cmd : typeof input === "string" ? input : JSON.stringify(input ?? "");
  return `▸ ${name}: ${main}`;
};

// Claude Code — {type: user|assistant, message.content, timestamp, gitBranch, cwd}. 서브에이전트(사이드체인)는 제외.
export function parseClaudeLine(line: string): ParsedLine | null {
  let o: Record<string, unknown>; try { o = JSON.parse(line); } catch { return null; }
  if ((o.type !== "user" && o.type !== "assistant") || o.isSidechain) return null;
  const ts = tsOf(o.timestamp); const content = (o.message as { content?: unknown } | undefined)?.content;
  const msgs: SessionMsg[] = []; let commitCall = false; const kinds: CallKind[] = []; const kindText: string[] = []; let callIdx: number | undefined; // 경계 호출 메시지 위치(뒤에 글이 더 붙어도 정확히, #1064 리뷰)
  if (typeof content === "string") { if (content.trim()) msgs.push({ role: o.type === "user" ? "user" : "assistant", text: clip(content), ts }); }
  else if (Array.isArray(content)) for (const p of content as Record<string, unknown>[]) {
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) msgs.push({ role: o.type === "user" ? "user" : "assistant", text: clip(p.text), ts });
    else if (p.type === "tool_use") { const t = toolLine(String(p.name ?? "tool"), p.input); const k = callKindOf(t); if (k) { commitCall = true; kinds.push(k); kindText.push(t); callIdx = msgs.length; } msgs.push({ role: "tool", text: clip(t), ts }); }
    else if (p.type === "tool_result") { const t = textOf(p.content); if (t.trim()) msgs.push({ role: "tool", text: clip(t), ts }); }
  }
  const result = o.type === "user" && Array.isArray(content) && content.length > 0 && (content as Record<string, unknown>[]).every((p) => p.type === "tool_result");
  // 사람이 친 프롬프트만 턴 시작 — 시스템이 끼워 넣는 user 줄(<task-notification>·서브에이전트 보고·중단 표시·메타)은 제외
  const firstUser = msgs.find((m) => m.role === "user")?.text.trimStart() ?? "";
  const prompt = o.type === "user" && !o.isMeta && !!firstUser && !/^(<|\[Request interrupted|Another Claude session sent a message|This session is being continued)/.test(firstUser);
  const callKind: CallKind | undefined = kinds.includes("commit") ? "commit" : kinds.includes("merge") ? "merge" : kinds[0];
  return { msgs, ts, commitCall, callKind, mergeToo: kindText.some((t) => MERGE_ONLY.test(t)), callIdx, result, prompt, branch: typeof o.gitBranch === "string" ? o.gitBranch : undefined, cwd: typeof o.cwd === "string" ? o.cwd : undefined };
}

// Codex — {timestamp, type: session_meta|event_msg|response_item, payload}. 대화는 event_msg, 도구는 response_item.
export function parseCodexLine(line: string): ParsedLine | null {
  let o: Record<string, unknown>; try { o = JSON.parse(line); } catch { return null; }
  const p = (o.payload ?? {}) as Record<string, unknown>; const ts = tsOf(o.timestamp);
  if (o.type === "session_meta") return { msgs: [], ts, commitCall: false, cwd: typeof p.cwd === "string" ? p.cwd : undefined, branch: typeof (p.git as { branch?: unknown } | undefined)?.branch === "string" ? (p.git as { branch: string }).branch : undefined };
  if (o.type === "event_msg") {
    if (p.type === "user_message" && typeof p.message === "string" && p.message.trim()) return { msgs: [{ role: "user", text: clip(p.message), ts }], ts, commitCall: false, prompt: true };
    if (p.type === "agent_message" && typeof p.message === "string" && p.message.trim()) return { msgs: [{ role: "assistant", text: clip(p.message), ts }], ts, commitCall: false };
    return null;
  }
  if (o.type === "response_item") {
    if (p.type === "function_call" || p.type === "custom_tool_call") {
      const args = p.type === "function_call" ? (() => { try { return JSON.parse(String(p.arguments ?? "")); } catch { return p.arguments; } })() : p.input;
      const t = toolLine(String(p.name ?? "tool"), args);
      const k = callKindOf(t);
      return { msgs: [{ role: "tool", text: clip(t), ts }], ts, commitCall: !!k, callKind: k, mergeToo: MERGE_ONLY.test(t) };
    }
    if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const t = typeof p.output === "string" ? p.output : textOf(p.output);
      return t.trim() ? { msgs: [{ role: "tool", text: clip(t), ts }], ts, commitCall: false, result: true } : null;
    }
  }
  return null;
}

// 줄들 → 커밋(또는 머지) 하나의 대화 구간(#1064, 턴 단위, 상한 없음). 턴 = 사람 프롬프트 ~ 다음 프롬프트 직전.
// 경계 = 커밋·머지 호출만(git pull은 경계 아님 — 사이 대화가 다음 커밋에 그대로 남게).
//  시작 = 이전 경계가 든 턴 다음의 첫 프롬프트(같은 턴에 이전 경계가 있으면 그 결과 다음부터)
//  끝 = 대상 호출이 든 턴의 끝("~했고 커밋했어요"까지). 같은 턴에 다음 경계가 있으면 대상 호출 결과까지.
//  대상 호출 = 커밋 시각 직전(2초 여유~15분 전)의 마지막 호출 — 일반 커밋은 커밋 호출, 머지 커밋은 머지 호출(없으면 pull).
export function segmentForCommit(lines: string[], parse: (l: string) => ParsedLine | null, commitSec: number, isMerge = false): { msgs: SessionMsg[]; branch?: string; cwd?: string; callTs: number; closed: boolean } | null {
  const commitMs = commitSec * 1000;
  type Call = { at: number; ts: number; kind: CallKind; mergeToo: boolean; branch?: string };
  type Turn = { msgs: SessionMsg[]; calls: Call[] }; // at = 그 호출 메시지 위치
  const turns: Turn[] = []; let cur: Turn = { msgs: [], calls: [] };
  let branch: string | undefined, cwd: string | undefined;
  for (const l of lines) {
    const p = parse(l); if (!p) continue;
    if (p.branch) branch = p.branch; if (p.cwd) cwd ??= p.cwd;
    if (p.prompt && cur.msgs.length) { turns.push(cur); cur = { msgs: [], calls: [] }; }
    if (p.callKind) cur.calls.push({ at: cur.msgs.length + (p.callIdx ?? Math.max(0, p.msgs.length - 1)), ts: p.ts, kind: p.callKind, mergeToo: !!p.mergeToo, branch });
    cur.msgs.push(...p.msgs);
  }
  turns.push(cur);
  const bound = (c: Call) => c.kind !== "pull"; // 대화를 끊는 경계
  const inWin = (c: Call) => c.ts <= commitMs + 2000 && c.ts >= commitMs - 15 * 60_000;
  const pick = (ok: (c: Call) => boolean) => { let r: [number, number] | null = null;
    turns.forEach((t, i) => t.calls.forEach((c, j) => { if (inWin(c) && ok(c) && (!r || c.ts >= turns[r[0]].calls[r[1]].ts)) r = [i, j]; })); return r as [number, number] | null; };
  const hit = isMerge ? pick((c) => c.kind === "merge" || c.mergeToo) ?? pick((c) => c.kind === "pull") : pick((c) => c.kind === "commit");
  if (!hit) return null;
  const [ti, ci] = hit; const T = turns[ti], call = T.calls[ci];
  const prevIn = T.calls.slice(0, ci).filter(bound).at(-1);
  const nextIn = T.calls.slice(ci + 1).find(bound);
  // 호출 다음 ~ 그 결과(첫 도구 출력)까지는 그 호출 몫 — 같은 응답에 호출 뒤 글이 붙어도 함께(#1064 리뷰)
  const afterResult = (at: number, limit: number) => { let e = at + 1; while (e < limit && T.msgs[e].role !== "tool") e++; return e < limit ? e + 1 : limit; };
  const end = nextIn ? afterResult(call.at, nextIn.at) : T.msgs.length;
  let msgs: SessionMsg[];
  if (prevIn) msgs = T.msgs.slice(afterResult(prevIn.at, call.at), end);
  else {
    let k = ti - 1; while (k >= 0 && !turns[k].calls.some(bound)) k--; // 이전 경계가 든 턴 다음 턴부터
    msgs = [...turns.slice(k + 1, ti).flatMap((t) => t.msgs), ...T.msgs.slice(0, end)];
  }
  return { msgs, branch: call.branch ?? branch, cwd, callTs: call.ts, closed: ti < turns.length - 1 || !!nextIn };
}

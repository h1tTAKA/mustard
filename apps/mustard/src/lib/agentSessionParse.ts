// 에이전트 세션 기록 파싱(#1064) — 순수 함수(의존성 없음, check로 검증). 파일 읽기는 agentSessions.ts.
// 에이전트마다 기록 형식이 달라서 줄 하나 → 공통 메시지로 바꾸는 어댑터를 두고, "git commit" 호출을 경계로 구간을 자름.
export interface SessionMsg { role: "user" | "assistant" | "tool"; text: string; ts: number }
export interface ParsedLine { msgs: SessionMsg[]; ts: number; commitCall: boolean; branch?: string; cwd?: string; result?: boolean } // result = 도구 출력만 있는 줄
export type AgentKind = "claude" | "codex";

const MSG_MAX = 4000;  // 메시지 하나 상한(도구 출력이 수만 자일 수 있음)
const SEG_MAX = 300;   // 구간 메시지 상한(최근 것 유지)
// 커밋을 만드는 명령 — "git commit"(rtk·-C 포함), 머지("git merge", "gh pr merge", 머지 반영 "git pull"). 출력이 압축돼
// 해시가 안 남아도 명령으로 알아봄. 이 호출들이 구간 경계(#1064 머지 세션도 저장 — 커밋 이후 리뷰·머지까지 오간 대화).
export const COMMIT_RE = /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|merge|pull)\b|\bgh\s+pr\s+merge\b/;

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
  const msgs: SessionMsg[] = []; let commitCall = false;
  if (typeof content === "string") { if (content.trim()) msgs.push({ role: o.type === "user" ? "user" : "assistant", text: clip(content), ts }); }
  else if (Array.isArray(content)) for (const p of content as Record<string, unknown>[]) {
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) msgs.push({ role: o.type === "user" ? "user" : "assistant", text: clip(p.text), ts });
    else if (p.type === "tool_use") { const t = toolLine(String(p.name ?? "tool"), p.input); if (COMMIT_RE.test(t)) commitCall = true; msgs.push({ role: "tool", text: clip(t), ts }); }
    else if (p.type === "tool_result") { const t = textOf(p.content); if (t.trim()) msgs.push({ role: "tool", text: clip(t), ts }); }
  }
  const result = o.type === "user" && Array.isArray(content) && content.length > 0 && (content as Record<string, unknown>[]).every((p) => p.type === "tool_result");
  return { msgs, ts, commitCall, result, branch: typeof o.gitBranch === "string" ? o.gitBranch : undefined, cwd: typeof o.cwd === "string" ? o.cwd : undefined };
}

// Codex — {timestamp, type: session_meta|event_msg|response_item, payload}. 대화는 event_msg, 도구는 response_item.
export function parseCodexLine(line: string): ParsedLine | null {
  let o: Record<string, unknown>; try { o = JSON.parse(line); } catch { return null; }
  const p = (o.payload ?? {}) as Record<string, unknown>; const ts = tsOf(o.timestamp);
  if (o.type === "session_meta") return { msgs: [], ts, commitCall: false, cwd: typeof p.cwd === "string" ? p.cwd : undefined, branch: typeof (p.git as { branch?: unknown } | undefined)?.branch === "string" ? (p.git as { branch: string }).branch : undefined };
  if (o.type === "event_msg") {
    if (p.type === "user_message" && typeof p.message === "string" && p.message.trim()) return { msgs: [{ role: "user", text: clip(p.message), ts }], ts, commitCall: false };
    if (p.type === "agent_message" && typeof p.message === "string" && p.message.trim()) return { msgs: [{ role: "assistant", text: clip(p.message), ts }], ts, commitCall: false };
    return null;
  }
  if (o.type === "response_item") {
    if (p.type === "function_call" || p.type === "custom_tool_call") {
      const args = p.type === "function_call" ? (() => { try { return JSON.parse(String(p.arguments ?? "")); } catch { return p.arguments; } })() : p.input;
      const t = toolLine(String(p.name ?? "tool"), args);
      return { msgs: [{ role: "tool", text: clip(t), ts }], ts, commitCall: COMMIT_RE.test(t) };
    }
    if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const t = typeof p.output === "string" ? p.output : textOf(p.output);
      return t.trim() ? { msgs: [{ role: "tool", text: clip(t), ts }], ts, commitCall: false, result: true } : null;
    }
  }
  return null;
}

// 줄들 → 커밋(초) 직전 "git commit" 호출까지의 구간(이전 커밋 호출 이후 ~ 이 호출 + 바로 뒤 도구 출력).
// 커밋 시각보다 늦게 시작된 호출은 다른 커밋. 너무 이른(15분 전) 호출도 제외. 없으면 null.
export function segmentForCommit(lines: string[], parse: (l: string) => ParsedLine | null, commitSec: number): { msgs: SessionMsg[]; branch?: string; cwd?: string; callTs: number } | null {
  const commitMs = commitSec * 1000;
  let buf: SessionMsg[] = []; let best: { msgs: SessionMsg[]; branch?: string; callTs: number } | null = null; let open: SessionMsg[] | null = null;
  let branch: string | undefined, cwd: string | undefined;
  for (const l of lines) {
    const p = parse(l); if (!p) continue;
    if (p.branch) branch = p.branch; if (p.cwd) cwd ??= p.cwd;
    if (open) { if (p.result) { open.push(...p.msgs); open = null; continue; } if (p.msgs.length) open = null; } // 커밋 호출의 출력(바로 다음 결과 줄 하나)만 붙임
    if (p.commitCall) {
      const seg = [...buf, ...p.msgs].slice(-SEG_MAX); buf = [];
      if (p.ts <= commitMs + 5000 && p.ts >= commitMs - 15 * 60_000) { best = { msgs: seg, branch, callTs: p.ts }; open = seg; }
      continue;
    }
    if (p.ts > commitMs + 120_000 && best) break; // 지난 뒤 — 더 볼 필요 없음
    buf.push(...p.msgs); if (buf.length > SEG_MAX * 2) buf = buf.slice(-SEG_MAX);
  }
  return best ? { ...best, cwd } : null;
}

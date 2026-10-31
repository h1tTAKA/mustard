// 에이전트 세션 기록 파싱(#1064) — 순수 함수(의존성 없음, check로 검증). 파일 읽기는 agentSessions.ts.
// 에이전트마다 기록 형식이 달라서 줄 하나 → 공통 메시지로 바꾸는 어댑터를 두고, "git commit" 호출을 경계로 구간을 자름.
export interface SessionMsg { role: "user" | "assistant" | "tool"; text: string; ts: number }
export type CallKind = "commit" | "merge" | "pull";
// #1068 도구 호출(이름·입력) — 꺼진 동안 활동 재생(편집·명령어 카드)용. Codex는 Claude 이름으로 맞춤(exec_command→Bash, apply_patch→Edit).
export interface ToolUse { name: string; input: unknown }
export interface ParsedLine { msgs: SessionMsg[]; ts: number; commitCall: boolean; tools?: ToolUse[]; callKind?: CallKind; mergeToo?: boolean; callIdx?: number; branch?: string; cwd?: string; result?: boolean; prompt?: boolean } // result = 도구 출력만 있는 줄, prompt = 사람이 입력한 프롬프트(턴 시작)
export type AgentKind = "claude" | "codex" | "cursor" | "antigravity"; // #1086 Cursor·Antigravity(SQLite 기록)

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
  const msgs: SessionMsg[] = []; let commitCall = false; const kinds: CallKind[] = []; const kindText: string[] = []; let callIdx: number | undefined; const tools: ToolUse[] = []; // 경계 호출 메시지 위치(뒤에 글이 더 붙어도 정확히, #1064 리뷰)
  if (typeof content === "string") { if (content.trim()) msgs.push({ role: o.type === "user" ? "user" : "assistant", text: clip(content), ts }); }
  else if (Array.isArray(content)) for (const p of content as Record<string, unknown>[]) {
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) msgs.push({ role: o.type === "user" ? "user" : "assistant", text: clip(p.text), ts });
    else if (p.type === "tool_use") { tools.push({ name: String(p.name ?? "tool"), input: p.input }); const t = toolLine(String(p.name ?? "tool"), p.input); const k = callKindOf(t); if (k) { commitCall = true; kinds.push(k); kindText.push(t); callIdx = msgs.length; } msgs.push({ role: "tool", text: clip(t), ts }); }
    else if (p.type === "tool_result") { const t = textOf(p.content); if (t.trim()) msgs.push({ role: "tool", text: clip(t), ts }); }
  }
  const result = o.type === "user" && Array.isArray(content) && content.length > 0 && (content as Record<string, unknown>[]).every((p) => p.type === "tool_result");
  // 사람이 친 프롬프트만 턴 시작 — 시스템이 끼워 넣는 user 줄(<task-notification>·서브에이전트 보고·중단 표시·메타)은 제외
  const firstUser = msgs.find((m) => m.role === "user")?.text.trimStart() ?? "";
  const prompt = o.type === "user" && !o.isMeta && !!firstUser && !/^(<|\[Request interrupted|Another Claude session sent a message|This session is being continued)/.test(firstUser);
  const callKind: CallKind | undefined = kinds.includes("commit") ? "commit" : kinds.includes("merge") ? "merge" : kinds[0];
  return { msgs, ts, commitCall, tools, callKind, mergeToo: kindText.some((t) => MERGE_ONLY.test(t)), callIdx, result, prompt, branch: typeof o.gitBranch === "string" ? o.gitBranch : undefined, cwd: typeof o.cwd === "string" ? o.cwd : undefined };
}

function codexTools(name: string, args: unknown): ToolUse[] {
  const a = args && typeof args === "object" ? args as Record<string, unknown> : {};
  if (name === "exec_command" || name === "shell" || name === "local_shell") {
    const c = a.cmd ?? a.command; // exec_command {cmd} / shell {command: ["bash","-lc","…"]}
    const command = typeof c === "string" ? c : Array.isArray(c) ? String(c.at(-1) ?? "") : "";
    return command ? [{ name: "Bash", input: { command } }] : [];
  }
  if (name === "apply_patch") { // 패치 글 안의 파일마다 편집 1건
    const files = [...String(typeof args === "string" ? args : a.input ?? "").matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)].map((m) => m[1].trim());
    return files.map((file_path) => ({ name: "Edit", input: { file_path } }));
  }
  return [{ name, input: args }];
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
      return { msgs: [{ role: "tool", text: clip(t), ts }], ts, commitCall: !!k, callKind: k, mergeToo: MERGE_ONLY.test(t), tools: codexTools(String(p.name ?? "tool"), args) };
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
export const CALL_WINDOW_MS = 15 * 60_000; // 커밋 시각 전 이만큼 안의 호출만 그 커밋 호출로 봄
// #1269 머지는 'CI 기다렸다 머지'처럼 호출 시작이 머지보다 한참 앞설 수 있어 더 넓게(세션 파일 거르기도 같은 창 — 도는 동안 기록이 안 바뀜)
export const MERGE_WINDOW_MS = 60 * 60_000; // 한계: 머지 호출 시작이 60분보다 앞서면 여전히 놓침 — 그 이상 기다리는 명령이 생기면 늘림
export function segmentForCommit<L>(lines: L[], parse: (l: L) => ParsedLine | null, commitSec: number, isMerge = false): { msgs: SessionMsg[]; branch?: string; cwd?: string; callTs: number; closed: boolean } | null {
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
  // #1269 머지 호출만 60분 — pull 대체는 15분 그대로(웹에서 머지 후 사람이 pull한 머지에 멈춘 세션의 옛 pull이 붙지 않게, 리뷰)
  const inWin = (c: Call) => c.ts <= commitMs + 2000 && c.ts >= commitMs - (isMerge && c.kind !== "pull" ? MERGE_WINDOW_MS : CALL_WINDOW_MS);
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

// #1068 꺼진 동안 활동 — [fromMs, toMs] 안 줄들만: 도구 호출(원래 시각) + 해설 재료 덩어리(턴마다, chunkMax자씩, 원래 시각).
export interface WindowActivity { tools: (ToolUse & { ts: number })[]; chunks: { ts: number; text: string }[]; cwd?: string }
const ROLE_LABEL: Record<SessionMsg["role"], string> = { user: "User", assistant: "Agent", tool: "Tool" };
export function activityInWindow<L>(lines: L[], parse: (l: L) => ParsedLine | null, fromMs: number, toMs: number, chunkMax = 5000): WindowActivity {
  const tools: WindowActivity["tools"] = []; const chunks: WindowActivity["chunks"] = [];
  let cwd: string | undefined, cur: { ts: number; text: string } | null = null;
  const flush = () => { if (cur?.text.trim()) chunks.push(cur); cur = null; };
  for (const l of lines) {
    const p = parse(l); if (!p) continue;
    if (p.cwd) cwd ??= p.cwd;
    if (!p.ts || p.ts < fromMs || p.ts > toMs) continue;
    for (const t of p.tools ?? []) tools.push({ ...t, ts: p.ts });
    if (p.prompt) flush(); // 턴 경계
    for (const m of p.msgs) {
      const line = `${ROLE_LABEL[m.role]}: ${m.role === "tool" ? m.text.slice(0, 600) : m.text}\n`; // 도구 출력은 앞부분만(해설 재료)
      if (cur && cur.text.length + line.length > chunkMax) flush();
      cur ??= { ts: m.ts || p.ts, text: "" };
      cur.text += line.slice(0, chunkMax);
    }
  }
  flush();
  return { tools, chunks, cwd };
}

// ── #1086 Cursor·Antigravity — 기록이 SQLite라 서버가 행을 읽어 넘기고, 여기서 ParsedLine으로(이후는 위 구간 로직 그대로).
// 줄 단위 parse 대신 이미 만든 ParsedLine 배열을 넘기므로 parse = 그대로 반환.
export const asIs = (p: ParsedLine) => p;
const fileOf = (args: Record<string, unknown>) => String(args.file_path ?? args.path ?? args.TargetFile ?? args.AbsolutePath ?? "");

// Cursor CLI — 루트 blob 순서의 메시지 {role, content}. 시각은 메시지별로 없어 사람 입력의 <timestamp>(분 단위)를 그 턴 전체에 씀.
const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
export function cursorTimestamp(s: string): number {
  const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) (AM|PM) \(UTC([+-]\d{1,2})(?::(\d{2}))?\)/.exec(s);
  if (!m || MON[m[1]] === undefined) return 0;
  const h = (Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0);
  const off = (Number(m[7]) * 60 + Math.sign(Number(m[7]) || 1) * Number(m[8] ?? 0)) * 60_000;
  return Date.UTC(Number(m[3]), MON[m[1]], Number(m[2]), h, Number(m[5])) - off;
}
type CursorPart = { type?: string; text?: string; toolName?: string; args?: Record<string, unknown>; result?: unknown };
export function parseCursorMessages(msgs: { role?: string; content?: unknown }[], fallbackTs: number): ParsedLine[] {
  const out: ParsedLine[] = []; let ts = fallbackTs;
  for (const m of msgs) {
    const parts: CursorPart[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? (m.content as CursorPart[]) : [];
    if (m.role === "user") {
      const raw = parts.map((p) => p.text ?? "").join("\n");
      if (raw.trimStart().startsWith("<user_info>")) continue; // 환경 정보(시스템이 끼움) — 턴 아님
      const t = cursorTimestamp(raw); if (t) ts = t;
      const q = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(raw)?.[1] ?? raw.replace(/<timestamp>[\s\S]*?<\/timestamp>/, "").trim();
      if (q) out.push({ msgs: [{ role: "user", text: clip(q), ts }], ts, commitCall: false, prompt: true });
    } else if (m.role === "assistant") {
      const line: ParsedLine = { msgs: [], ts, commitCall: false, tools: [] }; const kinds: CallKind[] = []; const texts: string[] = [];
      for (const p of parts) {
        if (p.type === "text" && p.text?.trim()) line.msgs.push({ role: "assistant", text: clip(p.text), ts });
        else if (p.type === "tool-call") {
          const args = p.args ?? {}; const name = String(p.toolName ?? "tool");
          const t = toolLine(name, typeof args.command === "string" ? { command: args.command } : fileOf(args) || args);
          const k = callKindOf(t); if (k) { line.commitCall = true; kinds.push(k); texts.push(t); line.callIdx = line.msgs.length; }
          line.msgs.push({ role: "tool", text: clip(t), ts });
          line.tools!.push(name === "Shell" ? { name: "Bash", input: { command: args.command } } : /^(Write|Edit|StrReplace|MultiEdit|Delete)/.test(name) ? { name: "Edit", input: { file_path: fileOf(args) } } : { name, input: args });
        }
      }
      line.callKind = kinds.includes("commit") ? "commit" : kinds.includes("merge") ? "merge" : kinds[0];
      line.mergeToo = texts.some((t) => MERGE_ONLY.test(t));
      if (line.msgs.length) out.push(line);
    } else if (m.role === "tool") {
      const t = parts.map((p) => (typeof p.result === "string" ? p.result : p.result ? JSON.stringify(p.result) : "")).join("\n");
      if (t.trim()) out.push({ msgs: [{ role: "tool", text: clip(t), ts }], ts, commitCall: false, result: true });
    }
  }
  return out;
}

// Antigravity CLI — steps 테이블(protobuf). 필요한 필드만 읽는 작은 디코더(스키마 없음, 실측 경로).
type PB = Map<number, (number | Uint8Array)[]>;
export function pbFields(buf: Uint8Array): PB {
  const out: PB = new Map(); let i = 0;
  // varint — 시각(초)·필드 번호만 쓰므로 Number로 충분(2^53 넘는 값은 근사, 쓰지 않음)
  const rv = () => { let r = 0, mul = 1, b: number; do { b = buf[i++]; r += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80 && i < buf.length); return r; };
  while (i < buf.length) {
    const key = rv(); const f = Math.floor(key / 8), w = key % 8; let v: number | Uint8Array;
    if (w === 0) v = rv(); else if (w === 2) { const n = rv(); v = buf.subarray(i, i + n); i += n; } else if (w === 1) { i += 8; continue; } else if (w === 5) { i += 4; continue; } else break;
    const arr = out.get(f) ?? []; arr.push(v); out.set(f, arr);
  }
  return out;
}
const dec = new TextDecoder();
const sub = (pb: PB | null, f: number, n = 0): PB | null => { const v = pb?.get(f)?.[n]; return v instanceof Uint8Array ? pbFields(v) : null; };
const str = (pb: PB | null, f: number, n = 0): string => { const v = pb?.get(f)?.[n]; return v instanceof Uint8Array ? dec.decode(v) : ""; };
const num = (pb: PB | null, f: number): number => { const v = pb?.get(f)?.[0]; return typeof v === "number" ? v : 0; };
export interface AntigravityStep { idx: number; type: number; metadata: Uint8Array | null; payload: Uint8Array | null }
// type 14 = 사람 입력(payload 19.2), 15 = 모델(20.1 답 / 20.3 작업 설명, 20.7 도구 호출 {1 id, 2 이름, 3 JSON}), 132 = 도구 실행(140.2.1 출력). 시각 = metadata 1.1(초).
export function parseAntigravitySteps(steps: AntigravityStep[]): { lines: ParsedLine[]; cwd?: string } {
  const lines: ParsedLine[] = []; let cwd: string | undefined; let lastTs = 0;
  for (const st of steps) {
    const meta = st.metadata ? pbFields(st.metadata) : null; const pay = st.payload ? pbFields(st.payload) : null;
    const ts = num(sub(meta, 1), 1) * 1000 || lastTs; lastTs = ts;
    if (st.type === 14) {
      const u = sub(pay, 19); const text = str(u, 2);
      const ws = str(sub(u, 12), 12); if (ws.startsWith("file://") && !cwd) cwd = decodeURIComponent(ws.slice(7));
      if (text.trim()) lines.push({ msgs: [{ role: "user", text: clip(text), ts }], ts, commitCall: false, prompt: true, cwd });
    } else if (st.type === 15) {
      const r = sub(pay, 20); const line: ParsedLine = { msgs: [], ts, commitCall: false, tools: [] }; const kinds: CallKind[] = []; const texts: string[] = [];
      const said = str(r, 1) || str(r, 3); if (said.trim()) line.msgs.push({ role: "assistant", text: clip(said), ts }); // 20.1 = 답, 20.3 = 작업 중 설명(답 없을 때)
      for (let n = 0; n < (r?.get(7)?.length ?? 0); n++) {
        const c = sub(r, 7, n); const name = str(c, 2); let args: Record<string, unknown> = {}; try { args = JSON.parse(str(c, 3) || "{}"); } catch { /* 깨진 인자 */ }
        if (typeof args.Cwd === "string" && !cwd) cwd = args.Cwd;
        const command = typeof args.CommandLine === "string" ? args.CommandLine : undefined;
        const t = toolLine(name, command ? { command } : fileOf(args) || args);
        const k = callKindOf(t); if (k) { line.commitCall = true; kinds.push(k); texts.push(t); line.callIdx = line.msgs.length; }
        line.msgs.push({ role: "tool", text: clip(t), ts });
        line.tools!.push(command ? { name: "Bash", input: { command } } : /write_to_file|replace_file_content/.test(name) ? { name: "Edit", input: { file_path: fileOf(args) } } : { name, input: args });
      }
      line.callKind = kinds.includes("commit") ? "commit" : kinds.includes("merge") ? "merge" : kinds[0];
      line.mergeToo = texts.some((t) => MERGE_ONLY.test(t));
      if (line.msgs.length) lines.push(line);
    } else if (st.type === 132) { // 도구 실행 결과(140.2.1) — 커밋 결과 등 원본 대화에 보이게
      const out = str(sub(pay, 140), 2) ? str(sub(sub(pay, 140), 2), 1) : "";
      if (out.trim()) lines.push({ msgs: [{ role: "tool", text: clip(out.trim()), ts }], ts, commitCall: false, result: true });
    }
  }
  return { lines, cwd };
}

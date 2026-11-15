// 실시간 해설 재료 = 에이전트 대화 기록(#1359) — 터미널 화면 글자(스피너·훅 상태 줄 같은 잡음) 대신 CLI가 남기는 기록 파일에서
// 방금 새로 쌓인 줄만 읽어 유저 요청·에이전트가 한 말·한 작업(명령·편집과 결과 일부)으로. 서버 전용(node fs).
// Claude = ~/.claude/projects/<레포 경로>/*.jsonl, Codex = ~/.codex/sessions/YYYY/MM/DD/*.jsonl(첫 줄 session_meta.cwd로 레포 확인).
// 파일마다 읽은 위치를 기억(프로세스 메모리). 처음 보는 파일은 끝 256KB에서 최근 3분 것만 — 옛 대화를 다시 해설하지 않게.
// 한계: 앱(서버)을 다시 켜면 읽은 위치를 잊고 최근 3분부터. Cursor·Antigravity(SQLite)는 아직 터미널 글자로.
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectDirFor } from "@/lib/subagents";
import { parseClaudeLine, parseCodexLine, type ParsedLine, type SessionMsg } from "@/lib/agentSessionParse";

const FRESH_MS = 3 * 60_000, FIRST_BYTES = 256 * 1024, MAX_READ = 4 * 1024 * 1024;
type G = { offsets: Map<string, number>; codexCwd: Map<string, string> };
const g = ((globalThis as unknown as { __mustardLiveTx?: G }).__mustardLiveTx ??= { offsets: new Map(), codexCwd: new Map() } as G);

async function fresh(dir: string, since: number): Promise<string[]> {
  let names: string[]; try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl")); } catch { return []; }
  const st = await Promise.all(names.map(async (n) => { try { return { p: join(dir, n), m: (await fs.stat(join(dir, n))).mtimeMs }; } catch { return null; } }));
  return st.filter((x): x is { p: string; m: number } => !!x && x.m >= since).map((x) => x.p);
}
// 읽은 위치부터 끝까지(마지막 줄이 덜 쓰였으면 그 앞까지만 — 다음에 이어 읽음)
async function newLines(file: string): Promise<{ lines: string[]; first: boolean }> {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    const known = g.offsets.get(file);
    const first = known === undefined;
    let from = first ? Math.max(0, size - FIRST_BYTES) : Math.min(known!, size);
    if (size - from > MAX_READ) from = size - MAX_READ; // 한꺼번에 너무 많이 쌓였으면 뒤쪽만
    if (size <= from) { g.offsets.set(file, size); return { lines: [], first }; }
    const buf = Buffer.alloc(size - from);
    await fh.read(buf, 0, buf.length, from);
    const text = buf.toString("utf8");
    const end = text.lastIndexOf("\n");
    if (end < 0) { if (first) g.offsets.set(file, from); return { lines: [], first }; }
    g.offsets.set(file, from + Buffer.byteLength(text.slice(0, end + 1)));
    const lines = text.slice(0, end).split("\n");
    return { lines: (first && from > 0) ? lines.slice(1) : lines, first }; // 중간부터 읽었으면 잘린 첫 줄 버림
  } finally { await fh.close(); }
}
const under = (cwd: string, root: string) => (cwd.replace(/\/+$/, "") + "/").startsWith(root.replace(/\/+$/, "") + "/");
async function codexCwd(file: string): Promise<string> {
  const hit = g.codexCwd.get(file); if (hit !== undefined) return hit;
  let cwd = "";
  try { const fh = await fs.open(file, "r"); try { const b = Buffer.alloc(64 * 1024); const { bytesRead } = await fh.read(b, 0, b.length, 0); cwd = parseCodexLine(b.subarray(0, bytesRead).toString("utf8").split("\n")[0])?.cwd ?? ""; } finally { await fh.close(); } } catch { /* 없음 */ }
  g.codexCwd.set(file, cwd);
  return cwd;
}

export interface LiveTranscript { agent: "claude" | "codex"; msgs: SessionMsg[]; prompt?: string; found: boolean }
// 이 레포에서 방금 쌓인 대화 — found = 최근에 바뀐 기록 파일이 있었는지(없으면 호출부가 터미널 글자로 대신)
export async function readNewMessages(root: string): Promise<LiveTranscript> {
  const now = Date.now(), since = now - FRESH_MS;
  const out: { agent: "claude" | "codex"; p: ParsedLine }[] = [];
  let found = false;
  const take = async (agent: "claude" | "codex", file: string, parse: (l: string) => ParsedLine | null) => {
    found = true;
    const { lines, first } = await newLines(file);
    for (const l of lines) { const p = parse(l); if (p && (!first || p.ts >= since)) out.push({ agent, p }); }
  };
  for (const f of await fresh(projectDirFor(root), since)) await take("claude", f, parseClaudeLine);
  const day = (d: Date) => join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  for (const d of [new Date(now), new Date(now - 86_400_000)]) for (const f of await fresh(day(d), since)) { if (under(await codexCwd(f), root)) await take("codex", f, parseCodexLine); }
  out.sort((a, b) => a.p.ts - b.p.ts);
  const msgs = out.flatMap((x) => x.p.msgs);
  const prompt = [...out].reverse().find((x) => x.p.prompt)?.p.msgs.find((m) => m.role === "user")?.text;
  return { agent: out.find((x) => x.agent === "codex") && !out.find((x) => x.agent === "claude") ? "codex" : "claude", msgs, ...(prompt ? { prompt } : {}), found };
}

// 해설 재료 글 — 유저 요청 + 시간순 [에이전트]/[작업]/[결과]. 결과는 앞 300자만(출력이 수만 자일 수 있음).
// 에이전트 내부 도구(도구 검색·기억 조회)는 뺌 — 해설할 작업이 아님(#1359 실측: 훅·메모리 조회를 4번 해설).
const INTERNAL = /▸ (ToolSearch|TodoWrite|mcp__plugin_loom|mcp__.*memory|Skill)\b/;
export function materialOf(msgs: SessionMsg[], prompt?: string): string {
  const lines: string[] = [];
  let skipResult = false;
  for (const m of msgs) {
    if (m.role === "user") { lines.push(`[유저] ${m.text.slice(0, 600)}`); continue; }
    if (m.role === "assistant") { lines.push(`[에이전트] ${m.text.slice(0, 1500)}`); continue; }
    const isCall = m.text.startsWith("▸ ");
    if (isCall) { skipResult = INTERNAL.test(m.text); if (!skipResult) lines.push(`[작업] ${m.text.slice(2, 400)}`); }
    else if (!skipResult) lines.push(`[결과] ${m.text.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  const body = lines.join("\n").slice(-9000);
  return `${prompt ? `## 유저가 맡긴 일(최근 요청)\n> ${prompt.replace(/\s+/g, " ").slice(0, 600)}\n\n` : ""}## 에이전트가 방금 한 말·작업(시간순)\n${body}`;
}
export const hasSubstance = (msgs: SessionMsg[]) => msgs.some((m) => m.role === "assistant" && m.text.trim().length > 20) || msgs.filter((m) => m.role === "tool" && m.text.startsWith("▸ ") && !INTERNAL.test(m.text)).length >= 3;

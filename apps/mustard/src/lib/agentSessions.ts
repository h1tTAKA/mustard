// 커밋을 만든 에이전트 세션 찾기(#1064) — 서버 전용(node fs). 파싱·구간은 agentSessionParse(순수).
// 기록 파일은 수백MB~GB라 끝부분(TAIL_BYTES)만 읽음 — 커밋은 방금 일어난 일이라 끝 쪽에 있음.
import { promises as fs, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectDirFor } from "@/lib/subagents";
import { parseClaudeLine, parseCodexLine, segmentForCommit, activityInWindow, parseCursorMessages, parseAntigravitySteps, asIs, type AgentKind, type SessionMsg, type WindowActivity, type ParsedLine } from "@/lib/agentSessionParse";
import { DatabaseSync } from "node:sqlite"; // #1086 Cursor·Antigravity 기록(SQLite) — Node 22+/Electron 내장, 추가 의존성 없음

const TAIL_BYTES = 8 * 1024 * 1024;   // 보통은 끝 8MB — 방금 커밋이라 끝에 있음
const WIDE_BYTES = 64 * 1024 * 1024;  // 못 찾으면 64MB까지 넓혀 한 번 더(앱이 꺼져 있다 나중에 몰아 처리할 때, #1064 정합성 점검)
const MAX_FILES = 6;
export interface CommitSession { agent: AgentKind; sessionId: string; branch?: string; messages: SessionMsg[]; callTs: number; closed: boolean } // closed = 그 턴이 끝남

async function tailLines(path: string, bytes = TAIL_BYTES): Promise<string[]> {
  const fh = await fs.open(path, "r");
  try {
    const { size } = await fh.stat(); const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len); await fh.read(buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    return size > len ? lines.slice(1) : lines; // 잘린 첫 줄 버림
  } finally { await fh.close(); }
}
// 첫 줄(앞 256KB 안) — 파일 전체를 읽지 않음(GB 단위 기록, #1064 리뷰).
async function headLine(path: string): Promise<string> {
  const fh = await fs.open(path, "r");
  try { const buf = Buffer.alloc(256 * 1024); const { bytesRead } = await fh.read(buf, 0, buf.length, 0); return buf.subarray(0, bytesRead).toString("utf8").split("\n")[0]; }
  catch { return ""; } finally { await fh.close(); }
}
// 커밋 뒤에 수정된(=커밋 시점에 살아 있던) 기록 파일, 최근 것부터.
const IDLE_MS = 2 * 60_000; // 기록이 이만큼 안 바뀌면 턴이 끝난 것으로(에이전트 멈춤·사람 자리 비움)
const mtimeOf = async (f: string) => { try { return (await fs.stat(f)).mtimeMs; } catch { return 0; } };
async function recentFiles(dir: string, sinceMs: number, max = MAX_FILES): Promise<string[]> {
  let names: string[]; try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl")); } catch { return []; }
  const st = await Promise.all(names.map(async (n) => { try { return { p: join(dir, n), m: (await fs.stat(join(dir, n))).mtimeMs }; } catch { return null; } }));
  return st.filter((x): x is { p: string; m: number } => !!x && x.m >= sinceMs).sort((a, b) => b.m - a.m).slice(0, max).map((x) => x.p);
}
const under = (a: string, b: string) => { const x = a.replace(/\/+$/, ""), y = b.replace(/\/+$/, ""); return x === y || x.startsWith(y + "/") || y.startsWith(x + "/"); };

// ── #1086 SQLite 기록 에이전트(Cursor·Antigravity) — 레포(cwd)가 맞고 sinceMs 이후 바뀐 대화만, 공통 ParsedLine 배열로.
const underRoot = (cwd: string, root: string) => (cwd.replace(/\/+$/, "") + "/").startsWith(root.replace(/\/+$/, "") + "/");
type SqlSession = { agent: AgentKind; sessionId: string; lines: ParsedLine[]; mtime: number };
async function sqlSessions(root: string, sinceMs: number): Promise<SqlSession[]> {
  const out: SqlSession[] = []; const home = homedir();
  // Cursor CLI: ~/.cursor/chats/<hash>/<agentId>/{meta.json(cwd), store.db}
  const cbase = join(home, ".cursor", "chats");
  for (const h of await fs.readdir(cbase).catch(() => [] as string[])) for (const a of await fs.readdir(join(cbase, h)).catch(() => [] as string[])) {
    const dir = join(cbase, h, a);
    try {
      const meta = JSON.parse(await fs.readFile(join(dir, "meta.json"), "utf8")) as { cwd?: string; createdAtMs?: number };
      const mtime = await mtimeOf(join(dir, "store.db"));
      if (!meta.cwd || !underRoot(meta.cwd, root) || mtime < sinceMs) continue;
      const db = new DatabaseSync(join(dir, "store.db"), { readOnly: true });
      try {
        const head = JSON.parse(Buffer.from(String((db.prepare("select value from meta limit 1").get() as { value: string }).value), "hex").toString()) as { latestRootBlobId?: string };
        const blob = (id: string) => { const r = db.prepare("select data from blobs where id = ?").get(id) as { data: Uint8Array } | undefined; return r ? Buffer.from(r.data) : null; };
        const rootBlob = head.latestRootBlobId ? blob(head.latestRootBlobId) : null; if (!rootBlob) continue;
        const msgs: { role?: string; content?: unknown }[] = [];
        for (let i = 0; i < rootBlob.length;) { // 루트 = field 1 반복(메시지 blob id 32바이트) — 대화 순서
          const tag = rootBlob[i++]; let len = 0, mul = 1, b: number; do { b = rootBlob[i++]; len += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
          if (tag === 0x0a) { const m = blob(rootBlob.subarray(i, i + len).toString("hex")); if (m) { try { msgs.push(JSON.parse(m.toString())); } catch { /* 메시지 아닌 blob */ } } }
          i += len;
        }
        out.push({ agent: "cursor", sessionId: a, lines: parseCursorMessages(msgs, meta.createdAtMs ?? mtime), mtime });
      } finally { db.close(); }
    } catch { /* 깨진·잠긴 대화 — 건너뜀 */ }
  }
  // Antigravity CLI: ~/.gemini/antigravity-cli/conversations/<id>.db (WAL이라 -wal 시각도 봄)
  const abase = join(home, ".gemini", "antigravity-cli", "conversations");
  for (const f of (await fs.readdir(abase).catch(() => [] as string[])).filter((n) => n.endsWith(".db"))) {
    const p = join(abase, f); const mtime = Math.max(await mtimeOf(p), await mtimeOf(p + "-wal"));
    if (mtime < sinceMs) continue;
    try {
      const db = new DatabaseSync(p, { readOnly: true });
      try {
        const rows = db.prepare("select idx, step_type as type, metadata, step_payload as payload from steps order by idx").all() as { idx: number; type: number; metadata: Uint8Array | null; payload: Uint8Array | null }[];
        const { lines, cwd } = parseAntigravitySteps(rows);
        if (cwd && underRoot(cwd, root)) out.push({ agent: "antigravity", sessionId: f.replace(/\.db$/, ""), lines, mtime });
      } finally { db.close(); }
    } catch { /* 쓰는 중·스키마 다름 — 건너뜀 */ }
  }
  return out;
}

export async function findCommitSession(root: string, commitSec: number, isMerge = false): Promise<CommitSession | null> {
  const sinceMs = commitSec * 1000 - 1000;
  const found: CommitSession[] = [];
  // Claude Code — 레포 경로별 폴더
  for (const f of await recentFiles(projectDirFor(root), sinceMs)) {
    const seg = segmentForCommit(await tailLines(f), parseClaudeLine, commitSec, isMerge) ?? segmentForCommit(await tailLines(f, WIDE_BYTES), parseClaudeLine, commitSec, isMerge);
    if (seg?.msgs.length) found.push({ agent: "claude", sessionId: f.split("/").pop()!.replace(/\.jsonl$/, ""), branch: seg.branch, messages: seg.msgs, callTs: seg.callTs, closed: seg.closed || Date.now() - await mtimeOf(f) > IDLE_MS });
  }
  // Codex — 날짜 폴더(커밋 날짜·전날, 자정 넘긴 세션), session_meta.cwd로 레포 확인
  const day = (d: Date) => join(homedir(), ".codex", "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  const c = new Date(commitSec * 1000);
  for (const dir of [day(c), day(new Date(c.getTime() - 86_400_000))]) for (const f of await recentFiles(dir, sinceMs)) {
    const seg = segmentForCommit(await tailLines(f), parseCodexLine, commitSec, isMerge) ?? segmentForCommit(await tailLines(f, WIDE_BYTES), parseCodexLine, commitSec, isMerge);
    let cwd = seg?.cwd;
    if (seg && !cwd) cwd = parseCodexLine(await headLine(f))?.cwd; // 끝부분에 session_meta가 없으면 파일 첫 줄에서
    if (seg?.msgs.length && cwd && under(cwd, root)) found.push({ agent: "codex", sessionId: f.split("/").pop()!.replace(/\.jsonl$/, ""), branch: seg.branch, messages: seg.msgs, callTs: seg.callTs, closed: seg.closed || Date.now() - await mtimeOf(f) > IDLE_MS });
  }
  // 커밋 시각에 가장 가까운 git commit 호출
  // #1086 Cursor·Antigravity
  for (const q of await sqlSessions(root, sinceMs)) {
    const seg = segmentForCommit(q.lines, asIs, commitSec, isMerge);
    if (seg?.msgs.length) found.push({ agent: q.agent, sessionId: q.sessionId, branch: seg.branch, messages: seg.msgs, callTs: seg.callTs, closed: seg.closed || Date.now() - q.mtime > IDLE_MS });
  }
  return found.sort((a, b) => Math.abs(a.callTs - commitSec * 1000) - Math.abs(b.callTs - commitSec * 1000))[0] ?? null;
}

// #1068 기록 끝에서 fromMs 이전 줄이 나올 때까지 넓혀 읽음(8MB → 64MB → 256MB). 기록이 GB라 통째로는 못 읽음(문자열 한계 512MB).
// ponytail: 256MB 넘게 쌓일 만큼 오래·많이 꺼져 있었으면 그 앞은 놓침 — 필요하면 줄 단위 역방향 스트리밍으로.
async function linesSince(path: string, fromMs: number, parse: (l: string) => { ts: number } | null): Promise<string[]> {
  let lines: string[] = [];
  for (const bytes of [TAIL_BYTES, WIDE_BYTES, 256 * 1024 * 1024]) {
    lines = await tailLines(path, bytes);
    const first = lines.slice(0, 50).map((l) => parse(l)?.ts ?? 0).find((t) => t > 0) ?? 0; // 사이드체인·메타 줄은 null일 수 있어 앞 몇 줄에서
    if ((first && first <= fromMs) || (await fs.stat(path)).size <= bytes) break;
  }
  return lines;
}
// #1068 꺼진 구간 [fromMs, toMs]에 이 레포에서 에이전트가 한 일 — 세션별(도구 호출 + 해설 재료). 구간에 수정된 기록 파일만.
export async function activityForRoot(root: string, fromMs: number, toMs: number): Promise<(WindowActivity & { agent: AgentKind; sessionId: string })[]> {
  const out: (WindowActivity & { agent: AgentKind; sessionId: string })[] = [];
  const id = (f: string) => f.split("/").pop()!.replace(/\.jsonl$/, "");
  const keep = (w: WindowActivity) => w.tools.length > 0 || w.chunks.length > 0;
  for (const f of await recentFiles(projectDirFor(root), fromMs, 50)) {
    const w = activityInWindow(await linesSince(f, fromMs, parseClaudeLine), parseClaudeLine, fromMs, toMs);
    if (keep(w)) out.push({ ...w, agent: "claude", sessionId: id(f) });
  }
  const day = (d: Date) => join(homedir(), ".codex", "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  for (let t = fromMs - 7 * 86_400_000; t <= toMs + 86_400_000; t += 86_400_000) for (const f of await recentFiles(day(new Date(t)), fromMs, 50)) { // 폴더 = 세션 시작일 → 며칠 이어진 세션도(최근 7일 시작분)
    const w = activityInWindow(await linesSince(f, fromMs, parseCodexLine), parseCodexLine, fromMs, toMs);
    const cwd = w.cwd ?? parseCodexLine(await headLine(f))?.cwd;
    if (keep(w) && cwd && (cwd.replace(/\/+$/, "") + "/").startsWith(root.replace(/\/+$/, "") + "/")) out.push({ ...w, agent: "codex", sessionId: id(f) });
  }
  for (const q of await sqlSessions(root, fromMs)) { // #1086
    const w = activityInWindow(q.lines, asIs, fromMs, toMs);
    if (keep(w)) out.push({ ...w, agent: q.agent, sessionId: q.sessionId });
  }
  return out;
}

// #1078 질문 화면 에이전트가 참조할 이 레포의 에이전트 대화 기록 폴더(있는 것만). 캐치업이 1차, 이건 대조·보충용.
// Claude·Grok·Gemini는 레포별 폴더, Codex는 날짜 폴더 전체라 session_meta.cwd로 걸러야 함(안내문에 명시).
export function agentTranscriptDirs(root: string): { agent: string; dir: string; hint: string }[] {
  const r = root.replace(/\/+$/, "");
  const home = homedir();
  const cands = [
    { agent: "Claude Code", dir: projectDirFor(r), hint: "<session>.jsonl per session; lines have type user/assistant, message.content, timestamp, gitBranch" },
    { agent: "Codex", dir: join(process.env.CODEX_HOME?.trim() || join(home, ".codex"), "sessions"), hint: `YYYY/MM/DD/rollout-*.jsonl for ALL repos — only use files whose first line (session_meta) has cwd "${r}" or a subfolder` },
    { agent: "Grok Build", dir: join(home, ".grok", "sessions", encodeURIComponent(r)), hint: "<session>/chat_history.jsonl per session" },
    { agent: "Gemini CLI", dir: join(home, ".gemini", "tmp", createHash("sha256").update(r).digest("hex")), hint: "chats/*.json per session" },
  ];
  return cands.filter((c) => existsSync(c.dir));
}

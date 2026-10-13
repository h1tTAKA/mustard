// 커밋을 만든 에이전트 세션 찾기(#1064) — 서버 전용(node fs). 파싱·구간은 agentSessionParse(순수).
// 기록 파일은 수백MB~GB라 끝부분(TAIL_BYTES)만 읽음 — 커밋은 방금 일어난 일이라 끝 쪽에 있음.
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectDirFor } from "@/lib/subagents";
import { parseClaudeLine, parseCodexLine, segmentForCommit, type AgentKind, type SessionMsg } from "@/lib/agentSessionParse";

const TAIL_BYTES = 8 * 1024 * 1024; // ponytail: 끝 8MB만 — 커밋 전 작업이 이보다 길면 앞부분이 잘림(상한 있는 기록이라 허용)
const MAX_FILES = 6;
export interface CommitSession { agent: AgentKind; sessionId: string; branch?: string; messages: SessionMsg[]; callTs: number; closed: boolean } // closed = 그 턴이 끝남

async function tailLines(path: string): Promise<string[]> {
  const fh = await fs.open(path, "r");
  try {
    const { size } = await fh.stat(); const len = Math.min(size, TAIL_BYTES);
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
async function recentFiles(dir: string, sinceMs: number): Promise<string[]> {
  let names: string[]; try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl")); } catch { return []; }
  const st = await Promise.all(names.map(async (n) => { try { return { p: join(dir, n), m: (await fs.stat(join(dir, n))).mtimeMs }; } catch { return null; } }));
  return st.filter((x): x is { p: string; m: number } => !!x && x.m >= sinceMs).sort((a, b) => b.m - a.m).slice(0, MAX_FILES).map((x) => x.p);
}
const under = (a: string, b: string) => { const x = a.replace(/\/+$/, ""), y = b.replace(/\/+$/, ""); return x === y || x.startsWith(y + "/") || y.startsWith(x + "/"); };

export async function findCommitSession(root: string, commitSec: number): Promise<CommitSession | null> {
  const sinceMs = commitSec * 1000 - 1000;
  const found: CommitSession[] = [];
  // Claude Code — 레포 경로별 폴더
  for (const f of await recentFiles(projectDirFor(root), sinceMs)) {
    const seg = segmentForCommit(await tailLines(f), parseClaudeLine, commitSec);
    if (seg?.msgs.length) found.push({ agent: "claude", sessionId: f.split("/").pop()!.replace(/\.jsonl$/, ""), branch: seg.branch, messages: seg.msgs, callTs: seg.callTs, closed: seg.closed || Date.now() - await mtimeOf(f) > IDLE_MS });
  }
  // Codex — 날짜 폴더(커밋 날짜·전날, 자정 넘긴 세션), session_meta.cwd로 레포 확인
  const day = (d: Date) => join(homedir(), ".codex", "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  const c = new Date(commitSec * 1000);
  for (const dir of [day(c), day(new Date(c.getTime() - 86_400_000))]) for (const f of await recentFiles(dir, sinceMs)) {
    const lines = await tailLines(f);
    const seg = segmentForCommit(lines, parseCodexLine, commitSec);
    let cwd = seg?.cwd;
    if (seg && !cwd) cwd = parseCodexLine(await headLine(f))?.cwd; // 끝부분에 session_meta가 없으면 파일 첫 줄에서
    if (seg?.msgs.length && cwd && under(cwd, root)) found.push({ agent: "codex", sessionId: f.split("/").pop()!.replace(/\.jsonl$/, ""), branch: seg.branch, messages: seg.msgs, callTs: seg.callTs, closed: seg.closed || Date.now() - await mtimeOf(f) > IDLE_MS });
  }
  // 커밋 시각에 가장 가까운 git commit 호출
  return found.sort((a, b) => Math.abs(a.callTs - commitSec * 1000) - Math.abs(b.callTs - commitSec * 1000))[0] ?? null;
}

// #977 서브에이전트 트리 — Claude Code 트랜스크립트(~/.claude/projects)서 세션의 서브에이전트 목록 추출.
// 메인 jsonl은 GB 단위라 tail만 읽는다. 서버(API route) 전용(node fs).
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SubagentInfo { id: string; agentType: string; description: string; depth: number; running: boolean; startedAt: number; updatedAt: number }

const DONE_LINGER_MS = 10 * 1000;      // 완료 후 이만큼만 체크로 보였다 사라짐(orca式)
const STALE_MS = 5 * 60 * 1000;        // 미완료인데 이만큼 갱신 없으면 중단(스테일)으로 간주
const MAX_ITEMS = 20;
const META_ONLY_MS = 2 * 60 * 1000;    // jsonl 없는(meta만) 서브 표시 창 — #979 env 수정 후엔 생성 직후 찰나뿐. 길면 죽은 세션 잔상이 스피너로 남음

// Claude Code 프로젝트 폴더명 — cwd의 영숫자 외 문자를 "-"로(예: /Users/a/b c → -Users-a-b-c).
export const projectDirFor = (cwd: string) => join(homedir(), ".claude", "projects", cwd.replace(/\/+$/, "").replace(/[^a-zA-Z0-9]/g, "-"));

// tail 텍스트서 마지막 ai-title(세션 제목). 없으면 "".
export function lastAiTitle(tail: string): string {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.includes('"ai-title"')) continue;
    try { const d = JSON.parse(l); if (d.type === "ai-title" && typeof d.aiTitle === "string") return d.aiTitle; } catch { /* 잘린 첫 줄 등 */ }
  }
  return "";
}

// 서브 jsonl tail서 마지막 "대화" 레코드(user/assistant)가 assistant + end_turn이면 완료.
// #979 끝난 뒤에도 attachment 등 비대화 레코드가 뒤에 붙어서, 단순 마지막 줄로 보면 영원히 실행중으로 보였음.
export function isDone(tail: string): boolean {
  const lines = tail.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let d: { type?: string; message?: { stop_reason?: string } };
    try { d = JSON.parse(lines[i]); } catch { continue; } // 잘린 첫 줄 등
    if (d.type !== "user" && d.type !== "assistant") continue; // attachment·system 등 건너뜀
    return d.type === "assistant" && d.message?.stop_reason === "end_turn";
  }
  return false;
}

// #979 부모 트랜스크립트 tail서 끝난 서브(백그라운드) toolUseId — queue-operation의 <task-notification>에
// <tool-use-id>…</tool-use-id> + <status>completed|failed|killed</status>. 중지(killed)된 서브는 end_turn이 없어 이게 유일한 종료 신호.
export function endedToolUseIds(tail: string): Set<string> {
  const out = new Set<string>();
  for (const l of tail.split("\n")) {
    if (!l.includes("task-notification")) continue;
    try {
      const d = JSON.parse(l);
      const c = typeof d.content === "string" ? d.content : "";
      const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(c)?.[1];
      if (id && /<status>(completed|failed|killed)<\/status>/.test(c)) out.add(id);
    } catch { /* 잘린 줄 */ }
  }
  return out;
}

async function readTail(path: string, bytes: number): Promise<string> {
  const fh = await fs.open(path, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally { await fh.close(); }
}

// 세션 선택 — 최근 24h 수정된 jsonl 중 ai-title == title, 없으면 최신.
async function pickSession(dir: string, title: string): Promise<{ sid: string; tail: string } | null> {
  let names: string[];
  try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl")); } catch { return null; }
  const now = Date.now();
  const cands = (await Promise.all(names.map(async (n) => {
    try { const st = await fs.stat(join(dir, n)); return { n, m: st.mtimeMs }; } catch { return null; }
  }))).filter((x): x is { n: string; m: number } => !!x && now - x.m < 24 * 3600 * 1000).sort((a, b) => b.m - a.m);
  const want = title.trim();
  if (!cands.length || !want) return null;
  for (const c of cands) {
    try {
      const tail = await readTail(join(dir, c.n), 512 * 1024);
      const t = lastAiTitle(tail).trim();
      // 정확 또는 접두 일치(OSC 타이틀이 잘렸을 수 있음). 최신 폴백은 안 함 — 같은 cwd 다른 세션 서브를 잘못 보여주는 것보다 안 보여주는 게 낫다(리뷰 🟡).
      if (t && (t === want || t.startsWith(want) || want.startsWith(t))) return { sid: c.n.slice(0, -6), tail };
    } catch { /* skip */ }
  }
  return null;
}

export async function listSubagents(cwd: string, title: string): Promise<SubagentInfo[]> {
  const dir = projectDirFor(cwd);
  const picked = await pickSession(dir, title);
  if (!picked) return [];
  const ended = endedToolUseIds(picked.tail);
  const sub = join(dir, picked.sid, "subagents");
  let metas: string[];
  try { metas = (await fs.readdir(sub)).filter((n) => n.endsWith(".meta.json")); } catch { return []; }
  const now = Date.now();
  // 한계: 서브 수천 개면 전부 stat(수 ms). 느려지면 mtime 인덱스 캐시.
  const out = (await Promise.all(metas.map(async (m): Promise<SubagentInfo | null> => {
    const id = m.slice(0, -".meta.json".length);
    const jl = join(sub, id + ".jsonl");
    try {
      // #979 jsonl이 없고 meta만 있는 경우(트랜스크립트 저장 꺼진 세션·생성 직후) — meta 시각으로 대체, 완료 판정 불가라 last="".
      const hasJl = await fs.stat(jl).then(() => true, () => false);
      const st = await fs.stat(hasJl ? jl : join(sub, m));
      const age = now - st.mtimeMs;
      if (age > (hasJl ? STALE_MS : META_ONLY_MS)) return null; // 오래 조용한 건 읽기 전에 컷(실행중이면 계속 기록해 여기 안 걸림)
      const last = hasJl ? await readTail(jl, 64 * 1024) : "";
      const meta = JSON.parse(await fs.readFile(join(sub, m), "utf8"));
      const done = (hasJl && isDone(last)) || ended.has(String(meta.toolUseId ?? "")); // end_turn 또는 부모 알림(완료·실패·중지)
      if (done && age > DONE_LINGER_MS) return null; // 완료는 잠깐만 표시 후 숨김
      return {
        id: id.replace(/^agent-/, ""),
        agentType: String(meta.agentType ?? ""),
        description: String(meta.description ?? ""),
        depth: Number(meta.spawnDepth) || 1,
        running: !done, // meta만(jsonl 없음)은 완료 판정 불가 → META_ONLY_MS 창 동안 실행중 간주
        startedAt: st.birthtimeMs || st.mtimeMs,
        updatedAt: st.mtimeMs,
      };
    } catch { return null; }
  }))).filter((x): x is SubagentInfo => !!x);
  // 한계: 부모 링크 대신 depth 들여쓰기 + 시작순. depth≥2 드묾 — 필요 시 toolUseId로 부모 jsonl 역추적.
  return out.sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_ITEMS);
}

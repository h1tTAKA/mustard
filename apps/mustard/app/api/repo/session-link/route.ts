// 커밋 ↔ 에이전트 세션(#1064) — POST {root, hash, ts}: 그 커밋을 만든 세션 구간을 찾아 저장·반환. GET ?root&hash: 저장된 원본.
import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { findCommitSession } from "@/lib/agentSessions";
import { readSession, writeSession } from "@/lib/catchupStore";
import { crewDirForBranch } from "@/lib/crew/crewWorktree";
import { readMsgs } from "@/lib/crew/crewChat";
import { readBoard } from "@/lib/crew/crewStore";
import { listRuns } from "@/lib/crew/crewRunner";

export const runtime = "nodejs";
const HASH_RE = /^[0-9a-f]{7,64}$/i;

export async function POST(req: Request): Promise<Response> {
  let body: { root?: unknown; hash?: unknown; ts?: unknown; merge?: unknown; branch?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const root = typeof body.root === "string" ? body.root : "", hash = typeof body.hash === "string" ? body.hash : "";
  if (!isAbsolute(root) || !HASH_RE.test(hash) || typeof body.ts !== "number" || !Number.isFinite(body.ts)) return Response.json({ error: "root/hash/ts required" }, { status: 400 });
  try {
    // #1135 Crew 커밋(crew/<id8> 브랜치) — 에이전트 기록은 레포가 아니라 그 카드 worktree 경로 기준 폴더에 있음.
    //  + 그 카드에서 역할끼리 주고받은 대화방 글(누가 누구에게 무엇을 지시·질문했나) — 왜 이렇게 했는지 기록.
    const c0 = typeof body.branch === "string" ? crewDirForBranch(root, body.branch) : null;
    const crew = c0 && existsSync(c0.dir) ? c0 : null; // 실제 Crew 작업 폴더가 있을 때만(사람이 crew/… 이름으로 만든 브랜치 제외, 리뷰)
    const found = await findCommitSession(crew?.dir ?? root, body.ts, body.merge === true); // 머지 커밋은 머지 호출 기준
    // 대화방 전체 기록에서(최근 400개만 보면 오래된 카드 대화가 빠짐, 리뷰) 이 카드 글만, 최근 쪽부터 합쳐 6000자까지
    const talk: { from: string; kind: string; to: string[]; text: string; ts: number }[] = [];
    if (crew) {
      let room = 6000;
      for (const m of readMsgs(root, 0, 100_000).filter((m) => m.taskId?.replace(/[^a-z0-9]/gi, "").toLowerCase().startsWith(crew.id8) && m.kind !== "permission").reverse()) {
        if (room <= 0) break;
        const text = m.text.slice(0, Math.min(1500, room)); if (!text) continue; // 빈 글은 건너뜀(그 앞 글까지 버리지 않게, 재리뷰)
        talk.unshift({ from: m.from, kind: m.kind, to: m.mentions ?? [], text, ts: m.ts }); room -= text.length;
      }
    }
    // 사람이 처음 내린 지시 = 카드(제목·본문·맡긴 역할). 대화방에서 만든 카드도 그 글엔 카드 id가 없고, 보드에서 만든 카드는 글 자체가 없음.
    //  기록이나 대화가 있을 때만(지시만으로 카드 만들지 않게, 리뷰). 보드는 읽기만.
    // #1281 크루 작업 기록 — 칸반 카드(제목·상태·단계)와 그 카드 실행(역할별 시작·끝·결과·토큰). 실행 목록은 읽기만(peek, 자동 실행 대상 등록 안 함)
    let crewTask: { id: string; title: string; status: string; pipeline?: string[]; role?: string } | undefined;
    let crewRuns: { role: string; stage?: number; state: string; startedAt: number; endedAt?: number; summary?: string; error?: string; toolCount: number; tokens?: { input: number; output: number } }[] = [];
    if (crew) {
      const pre = readBoard(root, false).tasks.filter((t) => t.id.replace(/[^a-z0-9]/gi, "").toLowerCase().startsWith(crew.id8));
      if (pre.length === 1) {
        const t = pre[0];
        crewTask = { id: t.id, title: t.title, status: t.status, ...(t.pipeline?.length ? { pipeline: t.pipeline } : {}), ...(t.role ? { role: t.role } : {}) };
        crewRuns = listRuns(root, undefined, true).filter((r) => r.taskId === t.id && r.startedAt <= (body.ts as number) * 1000 + 60_000 && !["starting", "running", "needs-permission"].includes(r.state)) // 끝난 실행만 — 카드는 한 번 저장되어 "실행 중"으로 굳지 않게(리뷰) // 이 커밋까지의 실행(뒤 단계는 다음 커밋 기록). ts = 커밋 초(findCommitSession과 같음), 실행 시각 = ms
          .map((r) => ({ role: r.role, stage: r.stage, state: r.state, startedAt: r.startedAt, endedAt: r.endedAt, summary: r.summary?.slice(0, 600), error: r.error?.slice(0, 300), toolCount: r.toolCount, tokens: r.tokens }));
        // 사람이 처음 내린 지시 = 카드(제목·본문·맡긴 역할). 기록·대화·실행이 있을 때만(지시만으로 카드 만들지 않게, 리뷰)
        if (found || talk.length || crewRuns.length) talk.unshift({ from: "human", kind: "task", to: t.pipeline?.length ? t.pipeline : t.role ? [t.role] : [], text: [t.title, t.body].filter(Boolean).join("\n").slice(0, 800), ts: t.createdAt });
      }
    }
    const extra = { ...(talk.length ? { crew: talk } : {}), ...(crewTask ? { crewTask } : {}), ...(crewRuns.length ? { crewRuns } : {}) };
    const s = found ? { ...found, ...extra } : talk.length || crewRuns.length ? { agent: "crew", sessionId: "", messages: [], ...extra, closed: true } : null;
    if (!s) return Response.json({ ok: true, session: null });
    writeSession(root, hash, s);
    return Response.json({ ok: true, session: s });
  } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 }); }
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams; const root = sp.get("root") ?? "", hash = sp.get("hash") ?? "";
  if (!isAbsolute(root) || !HASH_RE.test(hash)) return Response.json({ error: "root/hash required" }, { status: 400 });
  return Response.json({ ok: true, session: readSession(root, hash) });
}

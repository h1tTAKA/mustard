// 커밋 ↔ 에이전트 세션(#1064) — POST {root, hash, ts}: 그 커밋을 만든 세션 구간을 찾아 저장·반환. GET ?root&hash: 저장된 원본.
import { isAbsolute } from "node:path";
import { findCommitSession } from "@/lib/agentSessions";
import { readSession, writeSession } from "@/lib/catchupStore";
import { crewDirForBranch } from "@/lib/crew/crewWorktree";
import { readMsgs } from "@/lib/crew/crewChat";

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
    const crew = typeof body.branch === "string" ? crewDirForBranch(root, body.branch) : null;
    const found = await findCommitSession(crew?.dir ?? root, body.ts, body.merge === true); // 머지 커밋은 머지 호출 기준
    const talk = crew ? readMsgs(root).filter((m) => m.taskId?.replace(/[^a-z0-9]/gi, "").toLowerCase().startsWith(crew.id8) && m.kind !== "permission")
      .slice(-30).map((m) => ({ from: m.from, kind: m.kind, to: m.mentions ?? [], text: m.text.slice(0, 1500), ts: m.ts })) : [];
    const s = found ? { ...found, ...(talk.length ? { crew: talk } : {}) } : talk.length ? { agent: "crew", sessionId: "", messages: [], crew: talk, closed: true } : null;
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

// 커밋 ↔ 에이전트 세션(#1064) — POST {root, hash, ts}: 그 커밋을 만든 세션 구간을 찾아 저장·반환. GET ?root&hash: 저장된 원본.
import { isAbsolute } from "node:path";
import { findCommitSession } from "@/lib/agentSessions";
import { readSession, writeSession } from "@/lib/catchupStore";

export const runtime = "nodejs";
const HASH_RE = /^[0-9a-f]{7,64}$/i;

export async function POST(req: Request): Promise<Response> {
  let body: { root?: unknown; hash?: unknown; ts?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const root = typeof body.root === "string" ? body.root : "", hash = typeof body.hash === "string" ? body.hash : "";
  if (!isAbsolute(root) || !HASH_RE.test(hash) || typeof body.ts !== "number" || !Number.isFinite(body.ts)) return Response.json({ error: "root/hash/ts required" }, { status: 400 });
  try {
    const s = await findCommitSession(root, body.ts);
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

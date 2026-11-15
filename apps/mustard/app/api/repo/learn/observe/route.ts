// 실시간 해설(#870 → #1359) — main이 터미널 에이전트가 일하는 신호(화면 델타)를 보내면, 그 레포의 **대화 기록**(Claude·Codex jsonl)에서
// 새로 쌓인 말·작업을 모아 두었다가 덩어리로 해설(에이전트가 말했거나 작업이 3개 넘게 쌓이고, 지난 해설에서 20초 넘게 지났을 때).
// 신호가 더 안 와도(턴이 끝남) 모인 게 있으면 타이머로 마저 해설. 기록 파일이 없는 에이전트는 예전처럼 터미널 글자로.
import { isNarrationOn } from "@/lib/narrationConfig";
import { narrate } from "@/lib/narrate";
import { readNewMessages, materialOf, hasSubstance } from "@/lib/liveTranscript";
import type { SessionMsg } from "@/lib/agentSessionParse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAP_MS = 20_000, LATE_MS = 25_000;
type Pending = { msgs: SessionMsg[]; prompt?: string; agent: string; diff: string; diffHash: number; last: number; busy: boolean; timer?: ReturnType<typeof setTimeout> };
const djb2 = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
const g = ((globalThis as unknown as { __mustardObserve?: Map<string, Pending> }).__mustardObserve ??= new Map());

async function flush(cwd: string, providerId: unknown) {
  const st = g.get(cwd);
  if (!st || st.busy || !st.msgs.length) return;
  if (st.timer) { clearTimeout(st.timer); st.timer = undefined; }
  if (!hasSubstance(st.msgs)) return; // 해설할 거리(말·작업)가 아직 없음 — 더 모음
  const msgs = st.msgs; st.msgs = []; st.last = Date.now(); st.busy = true;
  const diff = st.diff; st.diff = ""; // 이번에 넘긴 diff는 소비(바뀐 때만 다시 — 리뷰: 옛 diff가 매번 가서 반복 가드가 꺼지던 문제)
  try { await narrate(cwd, st.agent, "", diff, Date.now(), { providerId, material: materialOf(msgs, st.prompt), timeoutMs: 60_000 }); }
  catch { if (diff && !st.diff) st.diff = diff; } // 실패 — diff는 다음 묶음에 다시(리뷰). 구독 미가용·시간 초과는 조용히
  finally {
    st.busy = false;
    if (!st.timer && hasSubstance(st.msgs)) st.timer = setTimeout(() => { st.timer = undefined; void flush(cwd, providerId); }, GAP_MS); // 해설하는 동안 쌓인 것(리뷰)
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: { cwd?: unknown; agent?: unknown; delta?: unknown; diff?: unknown; providerId?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  const agent = typeof body.agent === "string" && body.agent ? body.agent : "agent";
  const delta = typeof body.delta === "string" ? body.delta.slice(0, 6000) : "";
  const diff = typeof body.diff === "string" ? body.diff.slice(0, 6500) : "";
  if (!cwd) return Response.json({ ok: false, reason: "no cwd" });
  if (!isNarrationOn()) return Response.json({ ok: true, skipped: "off" }); // #1062 설정 > 캐치업 > 해설 분석 꺼짐

  // 1) 대화 기록에서 새 말·작업
  const tx = await readNewMessages(cwd).catch(() => null);
  if (tx?.found) {
    let st = g.get(cwd);
    if (!st) g.set(cwd, (st = { msgs: [], agent, diff: "", diffHash: 0, last: 0, busy: false }));
    st.msgs.push(...tx.msgs); st.msgs = st.msgs.slice(-200);
    if (tx.prompt) st.prompt = tx.prompt;
    st.agent = agent;
    if (diff) { const h = djb2(diff); if (h !== st.diffHash) { st.diffHash = h; st.diff = diff; } } // 바뀐 때만
    const wait = Math.max(0, st.last + GAP_MS - Date.now());
    if (!wait && hasSubstance(st.msgs)) { await flush(cwd, body.providerId); return Response.json({ ok: true, source: "transcript" }); }
    if (!st.timer && st.msgs.length) st.timer = setTimeout(() => { if (g.get(cwd)) g.get(cwd)!.timer = undefined; void flush(cwd, body.providerId); }, Math.max(wait, LATE_MS)); // 신호가 끊겨도 모인 건 해설
    return Response.json({ ok: true, waiting: st.msgs.length });
  }
  // 2) 기록 파일이 없는 에이전트 — 터미널 글자로(예전 방식)
  if (delta.trim().length < 40) return Response.json({ ok: false, reason: "no delta" });
  try {
    await narrate(cwd, agent, delta, diff, Date.now(), { providerId: body.providerId, signal: req.signal });
    return Response.json({ ok: true, source: "terminal" });
  } catch (e) {
    return Response.json({ ok: false, reason: String((e as Error)?.message || e) }); // 구독 미가용·레이트리밋 등 — 다음 델타서 재시도
  }
}

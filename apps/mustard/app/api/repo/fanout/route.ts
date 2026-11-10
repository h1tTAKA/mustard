import { existsSync, statSync } from "node:fs";
import { mainRoot } from "@/lib/repo/workspaces";
import { adoptFanout, candidateDiff, createFanout, discardFanout, dropLosers, getFanout, listFanouts, setTabs } from "@/lib/repo/fanout";
import { crossSite } from "@/lib/crew/crewPolicy";
import { startJudge, startTrial } from "@/lib/repo/fanoutJudgeRun";
import { pickModels } from "@/lib/repo/fanoutJudge";

// 겨루기(#1174) — 후보 만들기·기록 보기·후보 diff. path = 레포 탭 경로 → 메인 worktree 기준으로 저장(작업공간 API와 같음). 서버 전용.
export const runtime = "nodejs";
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ ok: false, error: "cross-site" }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return Response.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  const path = str(b.path).trim();
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) return Response.json({ ok: false, error: "not a directory" }, { status: 400 });
  try {
    const root = await mainRoot(path);
    switch (b.action) {
      case "create": {
        const agents = Array.isArray(b.agents) ? b.agents.filter((x): x is string => typeof x === "string") : [];
        const models = Array.isArray(b.models) ? b.models.map((x) => (typeof x === "string" ? x : "")) : [];
        const f = await createFanout(root, { name: str(b.name), prompt: str(b.prompt), agents, models, base: str(b.base) || undefined, prefix: str(b.prefix) });
        return Response.json({ ok: true, fanout: f });
      }
      case "list": return Response.json({ ok: true, fanouts: listFanouts(root) });
      case "judge": return Response.json({ ok: true, verdict: startJudge(root, str(b.id), pickModels(b.models)) }); // 뒤에서 돎 — 결과는 list로 다시 읽음
      case "trial": return Response.json({ ok: true, trial: startTrial(root, str(b.id), pickModels(b.models)) }); // 판정 1·2위 재판(뒤에서 돎)
      case "adopt": return Response.json({ ok: true, ...(await adoptFanout(root, str(b.id), Number(b.winner))) }); // 승자 커밋·push·draft PR
      case "drop-losers": return Response.json({ ok: true, ...(await dropLosers(root, str(b.id))) }); // 채택 뒤 나머지 지우기
      case "discard": return Response.json({ ok: true, ...(await discardFanout(root, str(b.id))) });
      case "tabs": setTabs(root, str(b.id), Array.isArray(b.tabIds) ? b.tabIds : []); return Response.json({ ok: true });
      case "diff": { // 후보 하나의 diff·파일별 줄 수
        const f = getFanout(root, str(b.id));
        const c = f?.candidates[Number(b.index)];
        if (!c) return Response.json({ ok: false, error: "not found" }, { status: 404 });
        return Response.json({ ok: true, ...(await candidateDiff(c)) });
      }
      default: return Response.json({ ok: false, error: "bad action" }, { status: 400 });
    }
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return Response.json({ ok: false, error: (err.stderr || err.message || "failed").trim().slice(0, 500) });
  }
}

// 아키텍처 분석 결과 저장소(#1320) — 기능 목록·기능별 흐름을 서버 파일에(archStore). MCP·Crew·대화 맥락이 같은 걸 읽음.
// POST {op:"get", path, kind:"cats"|"flow", feature?, diff?} → { data, diff }  (diff:true일 때만 저장 뒤 바뀐 파일 계산 — 그래프 맞추느라 느릴 수 있음)
// POST {op:"put", path, kind, feature?, data, legacy?}    → 지금 파일 스냅샷과 함께 저장(legacy=옛 브라우저 저장분 이전 → 스냅샷 없이)
// POST {op:"skeleton", path, data: files[]}              → 파일별 심볼 뼈대 텍스트(차분 갱신 프롬프트용)
// POST {op:"patch", path, kind:"flow", feature, data:{overviews?, tour?}} → 흐름 덧붙임만 합침(스냅샷·노드 그대로, #1322)
//   put에 keepExtras:true면 저장돼 있던 덧붙임을 서버에서 그대로 이어 붙임(구조 변화 없는 갱신), 아니면 버림(흐름이 바뀐 저장).
// POST {op:"begin", path}                               → {token} 분석 시작 시점 스냅샷 표(put에 token으로 넘기면 그 스냅샷으로 저장)
//   get에 diff:true·token:true면 같은 표도 같이 줌(갱신만 요청 — 낡음 표시용 조회는 표를 안 만들어 보관함을 안 밀어냄)
import { existsSync, statSync } from "node:fs";
import { crossSite } from "@/lib/crew/crewPolicy";
import { readArch, writeArch, currentSnap, diffFrom, fileSkeletons, getFlow, setFlow, beginSnap, takeSnap, cleanExtras, type ArchCategory, type ArchSection } from "@/lib/repo/archStore";

export async function POST(request: Request): Promise<Response> {
  if (crossSite(request)) return Response.json({ error: "cross-site" }, { status: 403 }); // 다른 사이트가 몰래 저장·스캔 못 하게(리뷰)
  let b: { op?: unknown; path?: unknown; kind?: unknown; feature?: unknown; data?: unknown; diff?: unknown; legacy?: unknown; token?: unknown; wantToken?: unknown; keepExtras?: unknown };
  try { b = await request.json(); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (!b || typeof b !== "object") return Response.json({ error: "invalid body" }, { status: 400 });
  const { op, path, kind, feature } = b;
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });

  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
    if (op === "skeleton") {
      const files = Array.isArray(b.data) ? (b.data as unknown[]).filter((x): x is string => typeof x === "string") : [];
      return Response.json({ text: await fileSkeletons(path, files) });
    }
    if (op === "begin") return Response.json({ token: beginSnap(await currentSnap(path)) });
    if (kind !== "cats" && kind !== "flow") return Response.json({ error: "kind must be cats|flow" }, { status: 400 });
    if (kind === "flow" && (typeof feature !== "string" || !feature.trim())) return Response.json({ error: "feature required" }, { status: 400 });
    const name = feature as string;

    if (op === "get") {
      const f = readArch(path);
      const saved = kind === "cats" ? f.cats : getFlow(f, name);
      if (!saved) return Response.json({ data: null, diff: null });
      const fl = getFlow(f, name);
      const data = kind === "cats" ? f.cats!.items : { sections: fl!.sections, overview: fl!.overview, ...cleanExtras(fl) }; // 읽을 때도 모양 검사(옛·손상 파일, 리뷰)
      if (b.diff !== true) return Response.json({ data, diff: null });
      const cur = await currentSnap(path);
      return Response.json({ data, diff: diffFrom(saved, cur), ...(b.wantToken === true ? { token: beginSnap(cur) } : {}) });
    }
    if (op === "patch") {
      if (kind !== "flow") return Response.json({ error: "patch is flow only" }, { status: 400 });
      const x = cleanExtras(b.data);
      const f = readArch(path);
      const fl = getFlow(f, name);
      if (!fl) return Response.json({ error: "no flow" }, { status: 404 });
      if (x.overviews) fl.overviews = { ...cleanExtras(fl).overviews, ...x.overviews };
      if (x.tour) fl.tour = x.tour;
      writeArch(path, f);
      return Response.json({ ok: true });
    }
    if (op === "put") {
      // 스냅샷(그래프 맞추기, await)을 먼저 — 읽고-고치고-쓰기 사이에 await가 없어야 동시 저장끼리 서로 안 지움(리뷰).
      const snap = b.legacy === true ? undefined : (takeSnap(b.token) ?? await currentSnap(path));
      const at = Date.now();
      if (kind === "cats" && !Array.isArray(b.data)) return Response.json({ error: "data must be an array" }, { status: 400 });
      const d = b.data as { sections?: unknown; overview?: unknown } | null;
      if (kind === "flow" && (!d || !Array.isArray(d.sections))) return Response.json({ error: "data.sections must be an array" }, { status: 400 });
      const f = readArch(path);
      if (kind === "cats") f.cats = { items: b.data as ArchCategory[], snap, at };
      // 덧붙임은 클라가 보낸 게 아니라 지금 파일에 있는 걸 이어 붙임 — 설명 쓰기(patch)와 갱신이 겹쳐도 새 설명이 안 지워지게(리뷰).
      else setFlow(f, name, { sections: d!.sections as ArchSection[], overview: typeof d!.overview === "string" ? d!.overview : null, snap, at,
        ...(b.keepExtras === true ? cleanExtras(getFlow(f, name)) : {}) });
      writeArch(path, f);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "op must be get|put|patch|skeleton|begin" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

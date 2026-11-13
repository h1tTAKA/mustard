// 아키텍처 분석 결과 저장소(#1320) — 기능 목록·기능별 흐름을 서버 파일에(archStore). MCP·Crew·대화 맥락이 같은 걸 읽음.
// POST {op:"get", path, kind:"cats"|"flow", feature?} → { data, diff }  (diff = 저장 뒤 바뀐 파일, 저장분 없으면 null)
// POST {op:"put", path, kind, feature?, data}        → 지금 파일 스냅샷과 함께 저장
// POST {op:"skeleton", path, data: files[]}                 → 파일별 심볼 뼈대 텍스트(차분 갱신 프롬프트용)
// 한계: 읽고-고치고-쓰기라 같은 레포에 put 두 개가 동시에 오면 늦은 쪽이 이김(사람 손 속도에선 드묾).
import { existsSync, statSync } from "node:fs";
import { readArch, writeArch, currentSnap, diffFrom, fileSkeletons, type ArchCategory, type ArchSection } from "@/lib/repo/archStore";

export async function POST(request: Request): Promise<Response> {
  let b: { op?: unknown; path?: unknown; kind?: unknown; feature?: unknown; data?: unknown };
  try { b = await request.json(); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  const { op, path, kind, feature } = b;
  if (typeof path !== "string" || !path.trim()) return Response.json({ error: "path required" }, { status: 400 });
  if (op === "skeleton") {
    const files = Array.isArray(b.data) ? (b.data as unknown[]).filter((x): x is string => typeof x === "string") : [];
    try { return Response.json({ text: await fileSkeletons(path, files) }); }
    catch (e) { return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 }); }
  }
  if (kind !== "cats" && kind !== "flow") return Response.json({ error: "kind must be cats|flow" }, { status: 400 });
  if (kind === "flow" && (typeof feature !== "string" || !feature.trim())) return Response.json({ error: "feature required" }, { status: 400 });

  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
    const f = readArch(path);
    if (op === "get") {
      const saved = kind === "cats" ? f.cats : f.flows[feature as string];
      if (!saved) return Response.json({ data: null, diff: null });
      const diff = diffFrom(saved, await currentSnap(path));
      const data = kind === "cats" ? f.cats!.items : { sections: f.flows[feature as string].sections, overview: f.flows[feature as string].overview };
      return Response.json({ data, diff });
    }
    if (op === "put") {
      const snap = await currentSnap(path);
      const at = Date.now();
      if (kind === "cats") {
        if (!Array.isArray(b.data)) return Response.json({ error: "data must be an array" }, { status: 400 });
        f.cats = { items: b.data as ArchCategory[], snap, at };
      } else {
        const d = b.data as { sections?: unknown; overview?: unknown } | null;
        if (!d || !Array.isArray(d.sections)) return Response.json({ error: "data.sections must be an array" }, { status: 400 });
        f.flows[feature as string] = { sections: d.sections as ArchSection[], overview: typeof d.overview === "string" ? d.overview : null, snap, at };
      }
      writeArch(path, f);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "op must be get|put" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

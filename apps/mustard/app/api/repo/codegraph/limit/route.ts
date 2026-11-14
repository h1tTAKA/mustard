// 코드 그래프 파일 수 상한(#1338) — 설정 화면이 읽고 씀. 값은 서버 파일(graphLimit.ts).
import { graphMaxFiles, setGraphMaxFiles, LIMIT_DEFAULT, LIMIT_MIN, LIMIT_MAX } from "@/lib/repo/graphLimit";

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, maxFiles: graphMaxFiles(), default: LIMIT_DEFAULT, min: LIMIT_MIN, max: LIMIT_MAX });
}
export async function POST(request: Request): Promise<Response> {
  let n: unknown;
  try { ({ maxFiles: n } = await request.json()); } catch { return Response.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  if (typeof n !== "number" || !Number.isFinite(n)) return Response.json({ ok: false, error: "maxFiles number required" }, { status: 400 });
  return Response.json({ ok: true, maxFiles: setGraphMaxFiles(n) });
}

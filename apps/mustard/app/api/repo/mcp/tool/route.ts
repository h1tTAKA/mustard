// 코드그래프 MCP 툴 실행 라우트(#853) — Mustard MCP(electron/mustard-mcp.cjs, #1070)가 호출.
// GET: 툴 정의(name/description/inputSchema) — MCP tools/list용. POST {root,name,args}: 툴 실행.
// 툴은 Next 안에서 돌아 lib 해석 정상. 서브7 seam: 여기서 툴콜 이벤트를 앱으로 흘릴 수 있음(미구현).
import { existsSync, statSync } from "node:fs";
import { TOOLS, callTool } from "@/lib/repo/mcp/tools";
import { emitToolCall } from "@/lib/mcpActivity";

export async function GET(): Promise<Response> {
  return Response.json({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
}

export async function POST(request: Request): Promise<Response> {
  let root: unknown, name: unknown, args: unknown;
  try { ({ root, name, args } = await request.json()); } catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
  if (typeof root !== "string" || !root.trim()) return Response.json({ error: "root required" }, { status: 400 });
  if (typeof name !== "string" || !name) return Response.json({ error: "name required" }, { status: 400 });
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) return Response.json({ error: "not a directory" }, { status: 400 });
    const callArgs = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const r = await callTool(root, name, callArgs);
    // 서브7: 툴콜을 활동 버스로 방출(실시간 학습 브릿지). emit 실패가 응답 막지 않게.
    try { emitToolCall(root, name, callArgs, !!r.isError, Date.now()); } catch { /* 무시 */ }
    return Response.json({ ok: true, text: r.text, isError: !!r.isError });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

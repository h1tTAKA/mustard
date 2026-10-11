// MCP 툴콜 활동 SSE 스트림(#855) — 에이전트가 코드그래프 툴 부를 때마다 그 개념을 root별로 화면에 push.
// ?root= 로 자기 워크스페이스 이벤트만. 최근 이벤트 먼저 흘려 초기 표시, 이후 실시간. (agent-status SSE 패턴)
import { subscribe, recent, matchesRoot, type ActivityEvent } from "@/lib/mcpActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const root = (new URL(request.url).searchParams.get("root") ?? "").replace(/\/+$/, "");
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { /* 닫힌 스트림 */ } };
      push(": connected\n\n");
      if (root) for (const e of recent(root, 100)) push(`data: ${JSON.stringify(e)}\n\n`); // 초기(최근) — 끊겼다 다시 붙을 때 놓친 활동을 넉넉히(#1043)
      const unsub = subscribe((e: ActivityEvent) => { if (!root || matchesRoot(e.root, root)) push(`data: ${JSON.stringify(e)}\n\n`); });
      const hb = setInterval(() => push(": hb\n\n"), 25000);
      cleanup = () => { clearInterval(hb); unsub(); };
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

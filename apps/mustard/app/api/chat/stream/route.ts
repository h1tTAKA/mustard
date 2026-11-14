// 채팅 실시간(#1341) — GET ?root=&id= SSE. 처음에 지금까지 타임라인(snapshot), 뒤로는 바뀐 항목·흘러오는 글·일하는 중 여부.
import { isAbsolute } from "node:path";
import { subscribe } from "@/lib/chat/chatSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const root = sp.get("root") ?? "", id = sp.get("id") ?? "";
  if (!isAbsolute(root) || !id) return new Response("bad request", { status: 400 });
  const enc = new TextEncoder();
  let off: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (p: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
      off = subscribe(root, id, send);
      if (!off) { send({ type: "gone" }); ctrl.close(); return; }
      ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { /* 닫힘 */ } }, 20_000);
      request.signal.addEventListener("abort", () => { off?.(); clearInterval(ping); try { ctrl.close(); } catch { /* 이미 닫힘 */ } });
    },
    cancel() { off?.(); clearInterval(ping); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

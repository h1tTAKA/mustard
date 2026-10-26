// 에이전트 상태 SSE 스트림(#764) — 훅 POST가 상태를 바꾸면 그 순간 구독 중인 화면(레포탭·호버 카드)으로
// 변경된 cwd를 밀어준다. 화면은 이 신호를 받고 해당 root만 즉시 재조회(폴링 대기 제거 = 즉각).
import { subscribe } from "@mustard/nunopi/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { /* 닫힌 스트림 */ } };
      push(": connected\n\n");
      const unsub = subscribe((cwd) => push(`data: ${JSON.stringify({ cwd })}\n\n`));
      const hb = setInterval(() => push(": hb\n\n"), 25000); // 유휴 타임아웃 방지 하트비트
      cleanup = () => { clearInterval(hb); unsub(); };
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

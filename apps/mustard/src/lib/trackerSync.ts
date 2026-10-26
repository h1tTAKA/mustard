// 트래커 상태 동기화 요청(#1172) — Crew(Next 서버)는 토큰이 없으니 main에 파일로 부탁(main이 확인하고 설정 켜진 것만 처리).
// 한 줄 = { event: "start"|"pr"|"done", provider, key, url? }. 실패해도 Crew 흐름은 계속(동기화는 덤).
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function requestTrackerSync(event: "start" | "pr" | "done", issue: { provider: "linear" | "jira"; key: string } | undefined, url?: string) {
  if (!issue) return;
  try {
    const dir = join(homedir(), ".nunopi");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "tracker-sync.jsonl"), `${JSON.stringify({ event, provider: issue.provider, key: issue.key, ...(url ? { url } : {}), at: Date.now() })}\n`);
  } catch { /* 동기화는 덤 — 못 써도 그만 */ }
}

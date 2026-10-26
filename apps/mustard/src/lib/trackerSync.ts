// 트래커 상태 동기화 요청(#1172) — Crew(Next 서버)는 토큰이 없으니 main에 파일로 부탁(main이 확인하고 설정 켜진 것만 처리).
// 한 줄 = { event: "start"|"pr"|"done", provider, key, url? }. 실패해도 Crew 흐름은 계속(동기화는 덤).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
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

// main이 1분마다 쓰는 "나에게 배정된 안 끝난 이슈"(#1172, Crew 트리거용) — 10분 넘게 안 바뀌었으면 null
export function readTrackerAssigned(provider: "linear" | "jira"): { key: string; title: string; url: string; body?: string }[] | null {
  try {
    const j = JSON.parse(readFileSync(join(homedir(), ".nunopi", `tracker-assigned-${provider}.json`), "utf8")) as { at?: number; issues?: { key: string; title: string; url: string }[] };
    if (!j.at || Date.now() - j.at > 10 * 60_000 || !Array.isArray(j.issues)) return null;
    return j.issues.filter((i) => typeof i?.key === "string" && typeof i.title === "string" && typeof i.url === "string" && /^https:\/\//.test(i.url));
  } catch { return null; }
}

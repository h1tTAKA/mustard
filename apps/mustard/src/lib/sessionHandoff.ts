// 캐치업 세션 → 에이전트 터미널로 넘기기(#1064) — 인앱 브라우저 피드백(#1037)과 같은 경로(sendToAgent).
// 요약 + 브랜치·커밋 + 원본 대화(최근 쪽, 길이 상한)를 마크다운 한 덩어리로. 붙여넣기 안전 처리는 sanitizePaste.
import type { SessionMsg } from "./agentSessionParse.ts";
import { sanitizePaste } from "./browser/feedback.ts";

const TOOL_CLIP = 600, RAW_MAX = 12_000;

export function formatSessionHandoff(o: { request: string; subject: string; hash: string; branch: string; agent: string; summary: string; messages: SessionMsg[] }): string {
  const raw = o.messages.map((m) => `[${m.role === "user" ? "User" : m.role === "assistant" ? "Agent" : "Tool"}] ${m.role === "tool" ? m.text.slice(0, TOOL_CLIP) : m.text}`).join("\n");
  const rawCut = raw.length > RAW_MAX ? "…(앞부분 생략)\n" + raw.slice(-RAW_MAX) : raw;
  const fence = "`".repeat(Math.max(3, ...[...rawCut.matchAll(/`+/g)].map((x) => x[0].length + 1)));
  return sanitizePaste([
    `## Catch-up session: ${o.subject}`,
    "",
    o.request.trim() ? `**Request:** ${o.request.trim()}` : "아래 세션 내용을 참고하세요(이 커밋을 만든 작업).",
    "",
    `- Commit: ${o.hash} (${o.subject})`,
    o.branch ? `- Branch: ${o.branch}` : "",
    o.agent ? `- Agent: ${o.agent}` : "",
    "",
    "### Summary",
    o.summary.trim(),
    "",
    "### Original conversation (since the previous commit in that session)",
    fence, rawCut, fence,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"));
}

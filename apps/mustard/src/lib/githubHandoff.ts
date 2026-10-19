// GitHub 이슈·PR·댓글 → 에이전트(터미널·Crew)로 보내는 글(#1129). 세션 넘기기(#1064)와 같은 모양, 붙여넣기 안전 처리는 sanitizePaste.
// 머리말은 영어(에이전트가 읽음), 덧붙인 말(유저 요청)이 있으면 맨 위.
import { sanitizePaste } from "./browser/feedback.ts";

export interface GhHandoff {
  kind: "issue" | "pr";
  number: number;
  title: string;
  part: "body" | "comment" | "review"; // review = PR 줄 리뷰 댓글
  url?: string;
  author?: string;
  file?: string;
  line?: number | null;
  body: string;
}

const BODY_MAX = 6000; // 터미널 붙여넣기·Crew 메시지(8000자) 상한 안쪽

export function formatGithubHandoff(h: GhHandoff, note = ""): string {
  const what = `${h.kind === "pr" ? "PR" : "Issue"} #${h.number}${h.part === "comment" ? " comment" : h.part === "review" ? " review comment" : ""}`;
  const body = h.body.length > BODY_MAX ? `${h.body.slice(0, BODY_MAX)}\n…(truncated)` : h.body;
  const fence = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1))); // 본문 안 ``` 보다 길게
  const lines = [
    note.trim() ? `**Request:** ${note.trim()}` : "Please look at this and handle it: investigate, then propose or make the change.",
    "",
    `## GitHub ${what}: ${h.title}`,
    ...(h.url ? [`- Link: ${h.url}`] : []),
    ...(h.file ? [`- File: ${h.file}${h.line ? `:${h.line}` : ""}`] : []),
    ...(h.author ? [`- Author: @${h.author}`] : []),
    "",
    fence, body.trim() || "(empty)", fence,
  ];
  return sanitizePaste(lines.join("\n"));
}

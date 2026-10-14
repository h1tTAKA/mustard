// 캐치업 카드 → 마크다운 복사(#1078) — 순수 조립(check로 검증). 코드·원본 대화 가져오기는 호출부(RepoLearnStream).
import type { SessionMsg } from "./agentSessionParse.ts";

const fenceFor = (body: string, min = 3) => "`".repeat(Math.max(min, ...[...body.matchAll(/`+/g)].map((x) => x[0].length + 1)));
const block = (lang: string, body: string) => { const f = fenceFor(body); return `${f}${lang}\n${body}\n${f}`; };
const stamp = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const tidy = (lines: string[]) => lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim() + "\n";

// diff 카드 — 구간마다 [줄 범위 · 바뀐 코드 · 설명]. sections 없으면(옛 카드) 설명 통째 + 코드 전부.
export function diffCardMarkdown(o: { path: string; hash: string; branch: string; subject: string; ts: number; expl: string;
  sections: { from: number; to: number; text: string; code?: string }[] | null; codes?: string[] }): string {
  const head = [`## ${o.path} @${o.hash.slice(0, 7)}`, "", [o.branch && `- Branch: ${o.branch}`, o.subject && `- Commit: ${o.subject}`, `- Time: ${stamp(o.ts)}`].filter(Boolean).join("\n"), ""];
  const body = o.sections
    ? o.sections.flatMap((s) => [`### Lines ${s.from === s.to ? s.from : `${s.from}–${s.to}`}`, "", ...(s.code ? [block("diff", s.code), ""] : []), s.text.trim(), ""])
    : [...(o.codes ?? []).flatMap((c) => [block("diff", c), ""]), o.expl.trim()];
  return tidy([...head, ...body]);
}

// 세션 카드 — 요약 + 원본 대화 전체(복사는 상한 없음, 에이전트 공유와 다름).
export function sessionCardMarkdown(o: { subject: string; hash: string; branch: string; agent: string; ts: number; summary: string; messages: SessionMsg[] }): string {
  const raw = o.messages.map((m) => `[${m.role === "user" ? "User" : m.role === "assistant" ? "Agent" : "Tool"}] ${m.text}`).join("\n\n");
  return tidy([`## ${o.subject} @${o.hash.slice(0, 7)}`, "",
    [o.agent && `- Agent: ${o.agent}`, o.branch && `- Branch: ${o.branch}`, `- Time: ${stamp(o.ts)}`].filter(Boolean).join("\n"), "",
    "### Summary", "", o.summary.trim(), "",
    ...(raw ? ["### Conversation", "", block("text", raw)] : [])]);
}

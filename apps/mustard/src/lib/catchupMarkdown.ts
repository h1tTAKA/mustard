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
// #1238 원본 대화만(요약·머리말 없이) — 다른 에이전트·문서에 그대로 붙이기용. Crew 대화방 글이 있으면 앞에.
export function sessionRawText(messages: SessionMsg[], crew: { from: string; to: string[]; text: string }[] = []): string {
  const talk = crew.map((c) => `[@${c.from}${c.to.length ? ` → ${c.to.map((x) => `@${x}`).join(" ")}` : ""}] ${c.text}`);
  return [...talk, ...messages.map((m) => `[${m.role === "user" ? "User" : m.role === "assistant" ? "Agent" : "Tool"}] ${m.text}`)].join("\n\n");
}

export function sessionCardMarkdown(o: { subject: string; hash: string; branch: string; agent: string; ts: number; summary: string; messages: SessionMsg[] }): string {
  const raw = sessionRawText(o.messages);
  return tidy([`## ${o.subject} @${o.hash.slice(0, 7)}`, "",
    [o.agent && `- Agent: ${o.agent}`, o.branch && `- Branch: ${o.branch}`, `- Time: ${stamp(o.ts)}`].filter(Boolean).join("\n"), "",
    "### Summary", "", o.summary.trim(), "",
    ...(raw ? ["### Conversation", "", block("text", raw)] : [])]);
}

// #1081 답변에 나온 커밋 해시(링크로 안 단 것) — 앱이 "관련 카드"를 붙일 대상. 이미 catchup 링크가 있는 해시는 뺌.
export function commitHashesIn(answer: string): string[] {
  const linked = new Set([...answer.matchAll(/catchup:(?:diff|session)\|([0-9a-f]{7,40})/gi)].map((m) => m[1].toLowerCase().slice(0, 7)));
  const found = [...answer.matchAll(/(?<![0-9a-zA-Z_/#-])[0-9a-f]{7,40}(?![0-9a-zA-Z_-])/g)].map((m) => m[0].toLowerCase())
    .filter((h) => /[a-f]/.test(h) && /\d/.test(h)); // 숫자만·글자만인 단어 제외(해시 오탐 줄이기)
  return [...new Set(found.map((h) => h.slice(0, 7)))].filter((h) => !linked.has(h));
}
// 관련 카드 목록을 답변 끝에(카드 제안 블록이 있으면 그 앞에) 붙임.
export function withRelatedCards(answer: string, items: { key: string; kind: string; target: string }[], title: string): string {
  if (!items.length) return answer;
  const lines = items.map((x) => `- [${x.kind === "session" ? "💬 " : ""}${x.target.replace(/[[\]]/g, "")}](<catchup:${x.key}>)`).join("\n");
  const footer = `\n\n**${title}**\n${lines}\n`;
  const at = answer.indexOf("```nunopi-cards");
  return at >= 0 ? answer.slice(0, at).trimEnd() + footer + "\n" + answer.slice(at) : answer.trimEnd() + footer;
}

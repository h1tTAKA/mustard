// 캐치업 항목 질문 컨텍스트(#998) — 채팅 요청의 code 자리에 넣을 텍스트. 우선순위(유저 합의):
// ① 그 항목(제목+해설) ② 캐치업 이력(최근 요약 + 기록 폴더 grep) ③ 레포(코드그래프 지도 + 읽기 전용 도구).
// 순수 조립만(import 없음 — check 스크립트로 검증). 서버에서 모으는 건 catchupAskGather.ts.

export interface AskItem { key: string; target: string; expl: string; ts: number; kind: string }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const stamp = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export function buildCatchupContext({ repo, item, recent, digest }: { repo: string; item: AskItem; recent: AskItem[]; digest: string | null }): string {
  const history = recent
    .filter((x) => x.key !== item.key)
    .map((x) => `- [${stamp(x.ts)}] ${x.target}: ${clip(x.expl.replace(/\s+/g, " "), 220)}`)
    .join("\n");
  return [
    `Repository: ${repo}`,
    "You are answering a question about one item of \"Catch-up\" — a live feed that explains what an AI coding agent did in this repository.",
    "",
    "How to answer (in this priority):",
    "1. Use the FOCUSED ITEM below first.",
    "2. Then the CATCH-UP HISTORY. Older days and past Q&A are files in the additional readable directory (one YYYY-MM-DD.jsonl per day, ask/*.json for past questions) — Grep them when the question refers to earlier work.",
    "3. Only if 1–2 are not enough, look at the repository itself (the REPO MAP below, then Read/Grep/Glob inside the repo). Mention the files you actually checked.",
    "Never claim you read a file you did not open. If tools are unavailable, answer from the text here and say what you could not verify.",
    "",
    `## FOCUSED ITEM — ${item.target} (${stamp(item.ts)})`,
    clip(item.expl, 8000),
    "",
    "## CATCH-UP HISTORY (recent, newest first)",
    clip(history || "(none)", 8000),
    "",
    "## REPO MAP (code-graph digest)",
    clip(digest?.trim() || "(not built yet)", 6000),
  ].join("\n");
}

// #1078 레포 전체 질문(캐치업 안 질문 화면)에 붙일 작업 기록 — 최근 항목 요약 + 전체 기록 파일 안내. "오늘 뭐 했지" 류 질문용.
// #1081 줄마다 카드 ref(key) + 지금 시각·시간대 + 링크 규칙 → 답변에서 카드로 이동, "어제 2시쯤" 같은 시간대 질문.
export function buildWorkHistory(recent: AskItem[], now = Date.now(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  if (!recent.length) return "";
  const off = -new Date(now).getTimezoneOffset(); const sign = off >= 0 ? "+" : "-";
  const zone = `${tz}, UTC${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  const lines = recent.map((x) => `- [${stamp(x.ts)}] (${x.kind}) ${x.target}: ${clip(x.expl.replace(/\s+/g, " "), 160)} — ref: catchup:${x.key}`).join("\n");
  return [
    "## WORK HISTORY (Catch-up records, newest first)",
    `Now: ${stamp(now)} (${zone}). All times below are local. Resolve "today/yesterday/around 2pm" against this.`,
    "This is what AI coding agents did in this repository (live narration, commands, commit diffs (kind diff), agent sessions per commit (kind session)). Use it for questions like \"what did I work on today / since yesterday\" or \"what did I do around 2pm yesterday\".",
    "For a time-window question, gather the commits (diff + session items) closest to that time, plus nearby narration, and explain them together: what changed in code (diff), what the user asked and why the agent did it (session).",
    "TIMING: diff/session times are the commit time and command/edit times are when the agent ran them (accurate), but narration times are when the catch-up AI finished writing the note — usually seconds to a minute AFTER the real activity. For exact timing, cross-check the agent transcripts' own timestamps (ISO, usually UTC \"Z\" — convert to the local zone above before comparing).",
    "LINKS: whenever you mention a specific card, link it so the user can jump to it: [short label](<catchup:KEY>) with KEY exactly as its ref (keep the angle brackets). For lists of changed code, give one linked bullet per diff card. Never invent keys.",
    "Older days are in the additional readable directory: one YYYY-MM-DD.jsonl per day (fields key, kind, target, expl, ts in ms); sessions/<hash>.json are raw agent transcripts per commit. Grep/Read them when the question needs more than the recent items below — use each record's key field for links.",
    clip(lines, 16000),
  ].join("\n");
}

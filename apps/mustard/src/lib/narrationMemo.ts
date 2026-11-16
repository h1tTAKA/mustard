// 실시간 해설 기억(#1359) — 같은 레포의 최근 해설에서 제목·설명한 개념을 뽑아 다음 해설 프롬프트에 넘기고(반복 말고 흐름 잇기),
// 그래도 새것이 없는 카드는 버림. 개념 = 본문의 **굵은 말**(괄호 영문은 떼고 소문자) — 해설 틀이 개념을 굵게 쓰도록 되어 있음.
// 순수 함수(점검: narrationMemo.check.ts).

export interface PastNarration { ts: number; title: string; expl: string }

const norm = (s: string) => s.replace(/\(.*?\)/g, "").replace(/[`*_]/g, "").trim().toLowerCase();
// '이 작업의 이름들' 칸(브랜치·localhost·레포 함수 이름) — 개념이 아니라 반복 판정·기억에서 뺌(리뷰). 해설 틀(narrate.ts)도 이 이름을 씀.
export const NAMES_HEADS = { ko: "이 작업의 이름들", ja: "この作業の名前", en: "Names in this work" } as const;
const isNamesHead = (l: string) => { const x = l.trim(); return (/^#{1,6}\s/.test(x) || /^\*\*[^*]+\*\*\s*[:：]?$/.test(x)) && Object.values(NAMES_HEADS).some((h) => x.replace(/^#{1,6}\s*/, "").replace(/\*/g, "").replace(/[:：]\s*$/, "").trim() === h); };
const withoutNames = (expl: string) => {
  let skip = false;
  return expl.split("\n").filter((l) => { if (isNamesHead(l)) { skip = true; return false; } if (skip && (/^#{1,6}\s/.test(l.trim()) || /^\*\*[^*]+\*\*\s*[:：]?$/.test(l.trim()))) skip = false; return !skip; }).join("\n"); // 다음 소제목(### 또는 **굵은 줄**)에서 끝
};
// 본문 속 굵은 말 → 개념 이름 집합
export function conceptsOf(expl: string): Set<string> {
  const out = new Set<string>();
  for (const m of withoutNames(expl).matchAll(/\*\*([^*\n]{1,40})\*\*/g)) { const k = norm(m[1]); if (k && k.length <= 30) out.add(k); }
  return out;
}
// 프롬프트에 넣을 '앞서 해설한 것' 줄들 — 오래된 것부터, 개념은 최대 6개
export function memoLines(past: PastNarration[], fmt: (ts: number) => string): string[] {
  return past.map((p) => { const c = [...conceptsOf(p.expl)].slice(0, 6); return `- [${fmt(p.ts)}] ${p.title}${c.length ? ` — 설명한 개념: ${c.join(", ")}` : ""}`; });
}
const titleKey = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); // 글자·숫자만(기호·띄어쓰기 무시)
// 새 카드가 반복인지 — 제목이 최근 것과 같거나, 코드 변경 없이 새 개념이 하나도 없으면(이미 다 설명한 것만) 반복
export function isRepeat(title: string, expl: string, past: PastNarration[], hasDiff: boolean): boolean {
  const seen = new Set<string>();
  for (const p of past) for (const c of conceptsOf(p.expl)) seen.add(c);
  const mine = conceptsOf(expl);
  const noNew = [...mine].every((c) => seen.has(c)); // 개념이 없거나 전부 이미 설명함
  const tk = titleKey(title);
  if (past.some((p) => titleKey(p.title) === tk) && noNew && !hasDiff) return true; // 같은 제목 + 새 개념 없음(기본 제목끼리 겹쳐도 새 개념이 있으면 통과 — 리뷰)
  if (hasDiff || !mine.size) return false; // 진짜 코드가 바뀌었으면 해설할 거리가 있음
  return noNew;
}

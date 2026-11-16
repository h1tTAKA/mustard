// 실시간 해설 기억(#1359) — 같은 레포의 최근 해설(제목·요지)을 다음 해설 프롬프트에 넘기고(같은 작업 이야기 대신 흐름 잇기),
// 그래도 같은 작업 이야기를 되풀이한 카드는 버림. 반복 판정 = 작업 내용(제목·첫 문단) 기준 — 용어 풀이는 겹쳐도 됨
// (유저: 같은 용어를 여러 번 접하며 익히는 게 좋음). 비교 대상은 최근 30분이라 한참 뒤 비슷한 작업은 다시 해설됨.
// 순수 함수(점검: narrationMemo.check.ts).

export interface PastNarration { ts: number; title: string; expl: string }

// '이 작업의 이름들' 칸 이름 — 해설 틀(narrate.ts)이 씀. '용어'가 안 들어가야 용어집·칩에서 빠짐.
export const NAMES_HEADS = { ko: "이 작업의 이름들", ja: "この作業の名前", en: "Names in this work" } as const;

// 첫 문단(제목 밑, 첫 소제목 전) = 지금 무슨 작업 얘기인지
export function leadOf(expl: string): string {
  const out: string[] = [];
  let seen = false; // 소제목으로 시작하면 그 밑 글부터 — 둘째 소제목(용어 풀이 등)까지는 안 넘어감(리뷰)
  for (const l of expl.split("\n")) { const x = l.trim(); if (/^#{1,6}\s/.test(x) || /^\*\*[^*]+\*\*\s*[:：]?$/.test(x)) { if (out.length || seen) break; seen = true; continue; } if (x) out.push(x); }
  return out.join(" ").replace(/[`*_]/g, "");
}
// 글자 두 개씩 묶음의 겹침(0~1) — 말을 조금 바꿔도 같은 얘기면 높음
const grams = (s: string) => { const t = s.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); const g = new Set<string>(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
export function similarity(a: string, b: string): number {
  const x = grams(a), y = grams(b); if (!x.size || !y.size) return 0;
  let n = 0; for (const k of x) if (y.has(k)) n++;
  return n / (x.size + y.size - n);
}
// 프롬프트에 넣을 '앞서 해설한 것' 줄들 — 오래된 것부터, 제목 + 요지(첫 문단 앞부분)
export function memoLines(past: PastNarration[], fmt: (ts: number) => string): string[] {
  return past.map((p) => { const l = leadOf(p.expl).slice(0, 90); return `- [${fmt(p.ts)}] ${p.title}${l ? ` — ${l}` : ""}`; });
}
const titleKey = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); // 글자·숫자만(기호·띄어쓰기 무시)
const SAME = 0.4, MIN_LEAD = 40; // 짧은 문장끼리는 겹침이 부풀어(리뷰) 둘 다 40자 넘을 때만 비교. 한계: 문턱은 한국어 카드로만 잼(일·영 미검증).
// 실측(11-15~16 해설 110쌍): 다른 작업끼리 최대 0.19, 말만 바꾼 같은 얘기 0.8대. 한계: 문턱 하나 — 너무 많이/적게 버려지면 조정
// 새 카드가 반복인지 — 코드가 안 바뀌었는데 최근 해설과 첫 문단(작업 이야기)이 거의 같거나, 제목이 같고 첫 문단도 조금이라도 겹치면 반복
export function isRepeat(title: string, expl: string, past: PastNarration[], hasDiff: boolean): boolean {
  if (hasDiff) return false; // 진짜 코드가 바뀌었으면 해설할 거리가 있음
  const tk = titleKey(title), lead = leadOf(expl);
  return past.some((p) => {
    const pl = leadOf(p.expl);
    if (lead.length >= 12 && lead === pl) return true; // 첫 문단이 글자 그대로 같으면 짧아도 반복(리뷰)
    const sim = lead.length >= MIN_LEAD && pl.length >= MIN_LEAD ? similarity(lead, pl) : -1;
    if (titleKey(p.title) === tk) return sim < 0 ? !lead || !pl : sim >= 0.2; // 같은 제목 — 첫 문단을 비교할 수 있으면 조금이라도 겹칠 때만, 짧아서 못 재면 둘 다 비었을 때만 반복('작업 중' 같은 기본 제목끼리, 리뷰)
    return sim >= SAME;
  });
}

// 캐치업 용어집 보조(#1051) — 실시간 해설(narration) 본문의 "용어" 목록을 용어집으로 + 중복 판정.
export interface Term { term: string; def: string }

// "용어" 제목 줄(## 용어 / ### 핵심 용어 / **용어**: / 용어:) 아래 글머리들. 다른 소제목이 나오면 끝.
// 모델 표기 흔들림 허용(#1051 리뷰): "- **이름** — 뜻" / "- **이름 — 뜻**" / "- 이름 — 뜻"(구분자 — – :).
const KEYWORD = /(용어|用語|terms?|glossary)/i;
const isHeading = (l: string) => /^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*\s*:?$/.test(l) || /^[^-*•>#\s][^:]{0,20}:$/.test(l);
export function parseNarrationTerms(note: string): Term[] {
  const out: Term[] = [];
  let inSection = false;
  for (const raw of String(note || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) { inSection = KEYWORD.test(line); continue; }
    if (!inSection) continue;
    if (/^>/.test(line)) { inSection = false; continue; } // 인용(팁 등)이면 끝
    const item = line.match(/^[-*•]\s+(.+)$/);
    if (!item) continue;
    const body = item[1];
    const bold = body.match(/^\*\*(.+?)\*\*\s*[—–:-]\s*(.+)$/); // 이름만 굵게(하이픈 구분도 허용)
    const plain = bold ? null : body.replace(/\*\*/g, "").match(/^(.+?)\s+[—–]\s+(.+)$|^([^:]+?):\s+(.+)$/); // 통째 굵게·굵게 없음
    const term = bold ? bold[1] : plain ? (plain[1] ?? plain[3]) : "";
    const def = bold ? bold[2] : plain ? (plain[2] ?? plain[4]) : "";
    if (term.trim() && def.trim()) out.push({ term: term.trim(), def: def.replace(/\*\*/g, "").trim() });
  }
  return out;
}

// 새 용어 중 기존에 없는 것만(대소문자·공백 무시, 새 목록 안 중복도 제거).
export function mergeTerms(prev: Term[], add: Term[], key: (s: string) => string): Term[] {
  const seen = new Set(prev.map((x) => key(x.term)));
  const fresh: Term[] = [];
  for (const raw of add) {
    const x = { term: raw.term.replace(/`/g, "").trim(), def: raw.def.trim() }; // 모델이 붙인 코드 백틱 제거(`tsconfig.json`)
    const k = key(x.term); if (!k || seen.has(k)) continue; seen.add(k); fresh.push(x);
  }
  return fresh.length ? [...fresh, ...prev] : prev;
}

// 캐치업 용어집 보조(#1051) — 실시간 해설(narration) 본문의 "용어" 목록을 용어집으로 + 중복 판정.
export interface Term { term: string; def: string }

// "용어" 제목 줄(## 용어 / **용어** / 용어:) 아래의 "- **이름** — 뜻" 줄들. 다른 굵은 글머리(본문 설명)는 안 집음.
export function parseNarrationTerms(note: string): Term[] {
  const out: Term[] = [];
  let inSection = false;
  for (const raw of String(note || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(#{1,6}\s*|\*\*)?\s*(용어|用語|terms?)\s*(\*\*)?\s*:?\s*$/i.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    const m = line.match(/^[-*•]\s*\*\*(.+?)\*\*\s*[—–:-]\s*(.+)$/);
    if (m) { out.push({ term: m[1].trim(), def: m[2].trim() }); continue; }
    if (/^#{1,6}\s/.test(line) || /^>/.test(line)) inSection = false; // 다음 소제목·인용이면 끝
  }
  return out;
}

// 새 용어 중 기존에 없는 것만(대소문자·공백 무시, 새 목록 안 중복도 제거).
export function mergeTerms(prev: Term[], add: Term[], key: (s: string) => string): Term[] {
  const seen = new Set(prev.map((x) => key(x.term)));
  const fresh: Term[] = [];
  for (const x of add) { const k = key(x.term); if (!k || seen.has(k)) continue; seen.add(k); fresh.push(x); }
  return fresh.length ? [...fresh, ...prev] : prev;
}

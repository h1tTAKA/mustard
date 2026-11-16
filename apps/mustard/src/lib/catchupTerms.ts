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

// #1359 해설 끝 '카드로 남길 개념' 칸 — 화면은 이 칸을 글로 안 보이고 카드 맨 아래 칩 줄로(누르면 nunopi 카드). 칸 이름은 해설 언어별.
export const CARD_HEADS = { ko: "카드로 남길 개념", ja: "カードにする概念", en: "Concepts to keep" } as const;
const isCardHead = (l: string) => /^#{1,6}\s/.test(l) && Object.values(CARD_HEADS).some((h) => l.replace(/^#{1,6}\s*/, "").replace(/\*/g, "").trim() === h);
// 본문 → { body: 그 칸을 뺀 본문, names: 칸 속 이름들 }. 칸이 없으면(옛 카드) names 빈 배열.
export function splitCardSection(note: string): { body: string; names: string[] } {
  const lines = String(note || "").split("\n");
  const start = lines.findIndex((l) => isCardHead(l.trim()));
  if (start < 0) return { body: String(note || ""), names: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i].trim())) { end = i; break; }
  const names = lines.slice(start + 1, end).map((l) => l.trim().match(/^[-*•]\s+(.+)$/)?.[1].replace(/[*`]/g, "").split(/\s+[—–]\s+/)[0].trim() ?? "").filter(Boolean);
  return { body: [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim(), names };
}

// #1359 카드로 남길 만한 일반 개념인지 — 포트·이슈 번호·경로·파일 이름·해시 같은 이 작업만의 값은 칩 아님(유저 지적: localhost:8797, #68 브랜치)
export function isCardWorthy(term: string): boolean {
  const x = term.trim();
  if (/^(?=[0-9a-f]*\d)[0-9a-f]{7,40}$/i.test(x)) return false; // 커밋 해시
  if (/#\d|:\d/.test(x)) return false; // 이슈 번호·포트
  if (/^\d+$/.test(x)) return false; // 숫자만(포트·상태 번호)
  if (/\.(tsx?|jsx|json|md|py|sh|ya?ml|lock|swift|dart|go|rs)$/i.test(x)) return false; // 파일 이름(README.md·RepoLearnStream.tsx도)
  if (/^[a-z0-9._-]+\.[cm]?js$/.test(x)) return false; // .js는 전부 소문자일 때만 파일 — Node.js·Next.js는 개념(한계: three.js 같은 소문자 라이브러리 이름도 빠짐)
  if (/^(\.{0,2}\/|~\/)|^[a-z0-9._-]+(\/[a-z0-9._-]+)+$/.test(x)) return false; // 경로·브랜치(소문자 a/b — CI/CD·HTTP/2는 개념)
  return true; // 한계: 'main 브랜치'처럼 숫자·기호 없는 이 작업만의 이름은 못 거름 — 해설 틀이 용어 칸에 안 넣게 지시
}

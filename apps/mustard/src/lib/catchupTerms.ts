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

// #1359 해설 카드의 용어 칸을 칩으로 그리려고 본문을 [용어 칸 앞(소제목 포함) | 용어들 | 뒤]로 나눔.
// 용어 칸에 목록 아닌 줄이 섞였거나 용어가 없으면 null(호출부는 마크다운 그대로).
// 한계: 첫 용어 칸만 칩 — 용어 칸이 두 번 나오면 둘째는 마크다운 글자로(내용은 그대로, 용어집은 둘 다 모음).
export function splitTermsSection(note: string): { before: string; terms: Term[]; after: string } | null {
  const lines = String(note || "").split("\n");
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (start < 0) { if (l && isHeading(l) && KEYWORD.test(l)) start = i + 1; continue; }
    if (l && (isHeading(l) || /^>/.test(l))) { end = i; break; }
  }
  if (start < 0) return null;
  const sec = lines.slice(start, end).filter((l) => l.trim());
  const terms = parseNarrationTerms([lines[start - 1], ...sec].join("\n"));
  if (!terms.length || terms.length !== sec.length) return null;
  return { before: lines.slice(0, start).join("\n").trim(), terms, after: lines.slice(end).join("\n").trim() };
}

// #1359 해설 끝 '카드로 남길 개념' 칸 — 위 용어 풀이에 없는 배경 개념(- **이름** — 뜻). 화면은 이 칸을 글로 안 보이고 카드 맨 아래 칩 줄로(누르면 nunopi 카드). 칸 이름은 해설 언어별.
export const CARD_HEADS = { ko: "카드로 남길 개념", ja: "カードにする概念", en: "Concepts to keep" } as const;
// "### 이름" / "**이름**" / 끝에 ":" 붙은 것까지(모델 표기 흔들림, 리뷰)
const isCardHead = (l: string) => (/^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*\s*[:：]?$/.test(l)) && Object.values(CARD_HEADS).some((h) => l.replace(/^#{1,6}\s*/, "").replace(/\*/g, "").replace(/[:：]\s*$/, "").trim() === h);
// 본문 → { body: 그 칸을 뺀 본문, items: 칸 속 이름·뜻(뜻 없으면 "") }. 칸이 없으면(옛 카드) 빈 배열.
export function splitCardSection(note: string): { body: string; items: Term[] } {
  const lines = String(note || "").split("\n");
  const start = lines.findLastIndex((l) => isCardHead(l.trim())); // 칸은 해설 끝 — 앞 문장 속 굵은 같은 말에 안 걸리게 마지막 것(리뷰)
  if (start < 0) return { body: String(note || ""), items: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const l = lines[i].trim(); if (l && !/^[-*•]\s/.test(l) && !/^\s/.test(lines[i])) { end = i; break; } } // 목록 아닌 줄(다음 소제목·팁)에서 끝 — 그 줄은 본문에 남김(리뷰)
  const items = lines.slice(start + 1, end).map((l) => {
    const raw = l.trim().match(/^[-*•]\s+(.+)$/)?.[1].replace(/\*/g, "").trim() ?? ""; // 백틱은 남김(코드 이름 표시 — cardKindOf)
    const m = raw.match(/^(.+?)(?:\s+[—–]\s+|[:：](?:\s+|$))([\s\S]*)$/); // 이름 — 뜻 / 이름: 뜻 / 이름:
    return m ? { term: m[1].trim(), def: m[2].trim() } : { term: raw, def: "" };
  }).filter((x) => x.term);
  return { body: [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim(), items };
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

// #1359 칩으로 만드는 카드 종류 — 코드에 쓰는 이름이면 토큰 카드, 아니면 IT용어/개념 카드(유저 지적: PageController·dispose가 IT용어로 들어감).
// 해설 틀이 코드 이름을 `백틱`으로 감싸게 함 → 그게 1순위. 백틱이 빠졌으면 생김새(점·괄호·밑줄·소문자로 시작하는 camelCase)로.
// 한계: 백틱 없는 PascalCase(PageController vs JavaScript)·한 단어 소문자(dispose vs viewport)는 생김새로 못 가려 IT용어로.
export function cardKindOf(raw: string): "token" | "term" {
  const x = raw.trim();
  if (/^`[^`]+`$/.test(x)) return "token";
  const t = x.replace(/`/g, "");
  if (/\s/.test(t) || /\.(js|ts)$/i.test(t)) return "term"; // 띄어쓰기 있는 말, Node.js 같은 이름
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*(\(\))?$/.test(t)) return "term";
  return /\.|\(\)$|_|^[a-z]{2,}[A-Z]/.test(t) ? "token" : "term";
}

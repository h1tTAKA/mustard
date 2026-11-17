// 캐치업 용어집 보조(#1051) — 실시간 해설(narration) 본문의 "용어" 목록을 용어집으로 + 중복 판정.
export interface Term { term: string; def: string; code?: boolean } // code = 원래 `백틱`으로 감싼 코드 이름(토큰 카드, #1359)

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
    const x = { term: raw.term.replace(/`/g, "").trim(), def: raw.def.trim(), ...(/^`[^`]+`$/.test(raw.term.trim()) ? { code: true } : {}) }; // 모델이 붙인 코드 백틱 제거(`tsconfig.json`)
    const k = key(x.term); if (!k || seen.has(k)) continue; seen.add(k); fresh.push(x);
  }
  return fresh.length ? [...fresh, ...prev] : prev;
}

// #1359 해설 카드의 용어 칸을 칩으로 그리려고 본문을 [용어 칸 앞(소제목 포함) | 용어들 | 뒤]로 나눔.
// 용어 칸에 목록 아닌 줄이 섞였거나 용어가 없으면 null(호출부는 마크다운 그대로).
// 한계: 첫 용어 칸만 칩 — 용어 칸이 두 번 나오면 둘째는 마크다운 글자로(내용은 그대로, 용어집은 둘 다 모음).
// #1364 "이름 — 뜻" 꼴이 아닌 목록 줄(모델 사족 등)은 칸 전체를 버리지 않고 rest로 따로(화면이 아는 용어가 든 줄은 숨김). 목록 아닌 글이 섞이면 여전히 null.
export function splitTermsSection(note: string): { before: string; terms: Term[]; after: string; rest: string[] } | null {
  const lines = String(note || "").split("\n");
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (start < 0) { if (l && isHeading(l) && KEYWORD.test(l)) start = i + 1; continue; }
    if (l && (isHeading(l) || /^>/.test(l))) { end = i; break; }
  }
  if (start < 0) return null;
  const sec = lines.slice(start, end).filter((l) => l.trim());
  const terms: Term[] = [], rest: string[] = [];
  for (const l of sec) {
    const t = parseNarrationTerms(`${lines[start - 1]}\n${l}`);
    if (t.length && (/^\s*[-*•]\s+\*\*[^*]+\*\*\s*[—–:-]/.test(l) || (!/\s/.test(t[0].term) && /\s[—–]\s/.test(l)))) terms.push(t[0]); // 굵은 이름이거나 "한 단어 — 뜻"만 — "- 결과: 성공" 같은 글이 칩이 되지 않게(리뷰)
    else if (/^\s*[-*•]\s+/.test(l)) rest.push(l.trim().replace(/^[-*•]\s+/, ""));
    else return null;
  }
  if (!terms.length) return null;
  return { before: lines.slice(0, start).join("\n").trim(), terms, after: lines.slice(end).join("\n").trim(), rest };
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
    return m ? { term: m[1].trim(), def: m[2].replace(/`/g, "").trim() } : { term: raw, def: "" }; // 백틱은 이름에만(뜻은 카드 설명이라 지움, 리뷰)
  }).filter((x) => x.term);
  return { body: [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim(), items };
}

// #1364 한 항목에 이름 둘("`drag` / `fling`") → 따로 칩. CI/CD처럼 띄어쓰기 없는 /는 한 이름.
export function splitNames(term: string): string[] {
  const xs = term.split(/\s+\/\s+/).map((x) => x.trim()).filter(Boolean);
  return xs.length > 1 && xs.every((x) => x.length <= 40 && (x.match(/`/g) ?? []).length % 2 === 0) ? xs : [term]; // 백틱 안의 /(`git add -p / --patch`)는 안 나눔(리뷰)
}

// #1359 카드로 남길 만한 일반 개념인지 — 포트·이슈 번호·경로·파일 이름·해시 같은 이 작업만의 값은 칩 아님(유저 지적: localhost:8797, #68 브랜치)
export function isCardWorthy(term: string): boolean {
  const x = term.trim();
  if (/^(?=[0-9a-f]*\d)[0-9a-f]{7,40}$/i.test(x)) return false; // 커밋 해시
  if (/#\d|:\d/.test(x)) return false; // 이슈 번호·포트
  if (/^\d+$/.test(x)) return false; // 숫자만(포트·상태 번호)
  if (/\.(tsx?|jsx|json|md|py|sh|ya?ml|lock|swift|dart|go|rs)$/i.test(x)) return false; // 파일 이름(README.md·RepoLearnStream.tsx도)
  if (/^[a-z0-9._-]+\.[cm]?js$/.test(x)) return false; // .js는 전부 소문자일 때만 파일 — Node.js·Next.js는 개념(한계: three.js 같은 소문자 라이브러리 이름도 빠짐)
  if (/^(feat|feature|fix|bugfix|hotfix|chore|docs|refactor|release|test|style|perf|ci|build)\//.test(x)) return false; // 브랜치 이름(소문자 — CI/CD는 개념, feat/cart, 리뷰)
  if (/^(\.{0,2}\/|~\/)/.test(x) || (/^[a-z0-9._-]+(\/[a-z0-9._-]+)+$/.test(x) && /[-_.\d]|\/.*\//.test(x))) return false; // 경로·브랜치(소문자 a/b에 -·_·.·숫자 또는 / 둘 이상 — client/server·CI/CD·HTTP/2는 개념, 리뷰)
  if (/[A-Za-z0-9_)`]의\s/.test(x)) return false; // #1364 "Icon의 size" — 특정 위젯·함수의 속성
  if (/\d+,\d+|\s-{1,2}[A-Za-z][\w-]*\s+\d/.test(x)) return false; // #1364 이번 작업의 값이 붙은 명령(sed -n 282,400p, head -n 20) — 이름은 일반형이어야 다른 작업에도 쓰임
  return true; // 한계: 'main 브랜치'처럼 숫자·기호 없는 이 작업만의 이름은 못 거름 — 해설 틀이 용어 칸에 안 넣게 지시
}

// #1359 칩으로 만드는 카드 종류 — 코드에 쓰는 이름이면 토큰 카드, 아니면 IT용어 카드(유저 지적: PageController·dispose가 IT용어로 들어감).
// 해설 틀이 코드 이름을 `백틱`으로 감싸게 함 → 그게 1순위. 백틱이 빠지면(자주 빠짐, #1369) 이름 생김새 + 뜻(def) 낱말로.
// ponytail: 낱말 목록 휴리스틱 — 뜻 문장이 애매하면 틀릴 수 있음. 더 정확히 하려면 해설 AI가 카드 종류를 직접 표시하게.
const CODE_DEF = /함수|메서드|메소드|훅|클래스|위젯|컴포넌트|속성|프로퍼티|\bprops?\b|타입|명령|연산자|키워드|설정 파일|객체|생성자|옵션|인자|매개변수|파라미터|예외|에러 클래스|상수|변수|API|모듈|컨트롤러|컨테이너/i;
// 제품 이름(JavaScript·GitHub·Stripe·iOS) — 뜻 첫 문장이 "…언어/서비스/운영체제"로 끝날 때만(머리말). "JavaScript 언어의 내장 함수"(Object.keys)·"서비스 워커"는 해당 없음(리뷰)
// 라이브러리·프레임워크도 머리말로만 — socket.io·PyTorch "…라이브러리" → IT용어, debounce "…라이브러리 기능" → 토큰(리뷰)
const PRODUCT_HEAD = /(언어|서비스|플랫폼|프로토콜|데이터베이스|운영체제|회사|브라우저 엔진|라이브러리|프레임워크)(이에요|예요|입니다|이다|다)?\s*[.。!]?$/;
const head = (def: string) => { // 뜻 첫 문장(괄호 풀이 뗌 — 중첩도 안쪽부터, 리뷰)
  let d = def.replace(/`/g, "");
  while (/\([^()]*\)/.test(d)) d = d.replace(/\s*\([^()]*\)/g, "");
  return d.trim().split(/(?<=[.。!?])\s+|\n/)[0].trim();
};
const product = (def: string) => PRODUCT_HEAD.test(head(def)); // 제품: 첫 문장이 "…언어/서비스/운영체제"로 끝남
// 한 단어 이름(dispose·children·Promise)은 뜻 첫 문장이 구체적인 코드 종류로 끝날 때만 토큰. "…함수"는 너무 흔해 뺌 — callback·middleware("…함수")·closure·state 같은 개념이 토큰으로 가지 않게(리뷰)
const CODE_HEAD = /(메서드|메소드|훅|명령|명령어|명령줄 도구|키워드|연산자|props?|속성|프로퍼티|위젯|컴포넌트|클래스|생성자|객체|옵션|플래그|예약어)(이에요|예요|입니다|이다|다|야)?\s*[.。!]?$/i;
function codeKindOne(name: string, def: string): boolean {
  const t = name.replace(/\s*\([^)]+\)\s*$/, "").trim(); // 끝 "(풀이)" 떼기 — assert(단언) → assert, HLS(.m3u8) → HLS. 빈 괄호 dispose()는 그대로
  if (!t || !/^[\x21-\x7e]+( [\x21-\x7e]+)*$/.test(t)) return false; // 한글 섞임·빈 이름 → IT용어
  if (/\.(js|ts)$/i.test(t) && !/[/_]/.test(t) && /^[A-Z]/.test(t)) return false; // Node.js·Next.js 같은 이름
  const def0 = def.replace(/`/g, "");
  if (/\s/.test(t)) return /^[A-Za-z_$][\w$]*(<|:\s)/.test(t) // 여러 단어: 타입·스타일 꼴(Record<K, V>·flex: 1)
    || (/^[a-z.][\w.-]*(\s|$)/.test(t) && (/\s--?[a-z]/i.test(t) || CODE_DEF.test(def0))); // 소문자로 시작하는 명령·구문(git log·tsc --noEmit·import type)
  if (/[.()<>_:$\[\]]|^-/.test(t)) return !product(def0); // 점·괄호·밑줄 등 — 코드 생김새(PageView.builder·dispose()·Record<K, V>)
  if (/^[a-z][a-z0-9]*[A-Z]/.test(t)) return !product(def0); // camelCase(useState·jumpToPage) — iOS·macOS는 뜻에 운영체제
  if (/^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(t)) return !product(def0); // PascalCase(ScrollView) — JavaScript·GitHub 같은 이름은 뜻에 언어·서비스 → IT용어
  if (/^[A-Z0-9]+$/.test(t)) return false; // 전부 대문자 약어(TTS·CI)
  return CODE_HEAD.test(head(def0)) && !product(def0); // 한 단어(dispose·split·Promise) — 뜻에 함수·메서드·위젯 같은 말이 있어야
}
export function cardKindOf(raw: string, def = ""): "token" | "term" {
  const x = raw.trim();
  if (/^`[\x20-\x7e]+`$/.test(x) && !/^`[^`]*`[^`]/.test(x)) return product(def) ? "term" : "token"; // `Java`·`socket.io` — 언어·라이브러리도 백틱으로 올 수 있음(리뷰) // 백틱으로 감싼 영문 이름. 한글이 든 것(`정적 파일(static file)`)은 아래 규칙으로
  const parts = x.replace(/`/g, "").split(/\s+\/\s+/); // "Promise / setTimeout" → 조각마다
  const defs = def.split(/\s+\/\s+/); // 뜻도 같은 수로 나뉘면 짝지어("…객체 / …타이머")
  return parts.every((p, i) => codeKindOne(p, defs.length === parts.length ? defs[i] : def)) ? "token" : "term"; // 짝 뜻만 — 전체 뜻으로 넘어가면 다른 조각의 "위젯"을 빌려 씀(리뷰). 한계: "하나라도 / 전부 …메서드"처럼 뜻이 엇갈려 나뉘면 IT용어
}

// 인라인 코드 역할 분류(#1325) — 설명 글의 `백틱` 조각이 무엇인지 모양으로 판단해 색 약속을 입힘.
// AI 출력 형식을 바꾸지 않고 공용 Markdown 한곳에서. 확실하지 않으면 "plain"(기존 회색 그대로).
// 색은 4가지만 — 읽는 사람이 그 조각으로 "무엇을 하나" 기준(실제 캐치업·아키텍처 설명 9.4만 조각 분석):
//   path 파일·경로(열어 볼 곳) / cmd 명령어·옵션(터미널에 칠 것) / sym 코드 이름(함수·변수·타입·키워드·상수 — 코드 안의 이름은 전부 한 색) / val 값(숫자·색·문자열·불린)
// 같은 것은 늘 같은 색: fieldLine(변수)·Color()(함수)·static(키워드)이 서로 다른 색이던 것을 sym 하나로(유저 피드백 "뒤죽박죽").
// 순서가 중요: 값 → 명령어 → 경로 → 코드 이름.
export type CodeKind = "path" | "cmd" | "sym" | "val" | "plain";
export const CODE_KINDS: Exclude<CodeKind, "plain">[] = ["path", "cmd", "sym", "val"];

const KW = new Set([
  "import", "export", "from", "return", "await", "async", "static", "const", "let", "var", "final", "late", "class", "struct", "enum", "interface",
  "extends", "implements", "override", "super", "self", "this", "new", "public", "private", "protected", "internal", "func", "function", "def", "fn",
  "if", "else", "for", "while", "switch", "case", "try", "catch", "throw", "throws", "yield", "typeof", "instanceof", "void", "abstract", "mixin",
  "required", "as", "mut", "pub", "impl", "trait", "use", "package", "namespace", "using", "lambda", "guard", "defer", "default", "type",
]);

// 터미널 명령 — 첫 단어가 흔한 CLI면 명령어(뒤에 인자가 붙어도). 한계: 목록에 없는 도구는 코드 이름으로 보임.
// 변수·메서드 이름으로도 흔한 것(env·open·find…)은 뒤에 인자가 있을 때만 명령어(리뷰) — 혼자면 코드 이름.
const CLI_AMBIG = new Set("open find head tail sort diff patch make source env which say tee echo cat kill touch go uv bundle gem".split(" "));
const CLI = new Set(("git gh npm npx pnpm yarn bun node deno python python3 pip pip3 uv grep rg sed awk cat ls cd mkdir rm cp mv touch curl wget open echo "
  + "find head tail wc sort chmod chown kill pkill ps lsof brew flutter dart pod xcodebuild xcrun swift cargo rustc go docker kubectl tsc eslint jest vitest "
  + "playwright make expo rtk claude codex ssh scp tar zip unzip source sudo jq tee diff patch which env say ffmpeg gradle mvn rails bundle gem").split(" "));

const EXT = new Set(("ts tsx js jsx mjs cjs json jsonc md mdx dart swift kt kts java py rb go rs c h cc cpp hpp m mm cs fs php plist xml yaml yml toml lock gradle "
  + "html htm css scss sass less vue svelte astro sh bash zsh fish ps1 txt log csv sql proto graphql gql env ini conf cfg properties lua ex exs erl hs ml scala clj "
  + "storyboard xib xcscheme xcconfig entitlements pbxproj podspec gemspec csproj sln resx xaml png jpg jpeg gif webp svg ico pdf wasm zip dockerfile tf hcl nix vim").split(" "));

// 파일처럼 생겼지만 아닌 것 — 라이브러리 이름(Node.js), 객체 멤버(console.log·process.env). app.tsx·App.js 같은 진짜 파일은 그대로(리뷰).
const LIBJS = new Set(["node", "vue", "next", "nuxt", "express", "chart", "three", "d3", "react", "angular", "ember", "backbone", "moment", "p5", "socket", "alpine", "nest", "deno", "bun"]);
const MEMBER = new Set(["console", "process", "this", "self", "window", "document", "req", "res", "ctx", "logger"]); // .log·.env가 붙는 흔한 객체(app은 파일로 둠)
// 한계: 소문자 "chart.js"는 라이브러리 이름인지 파일인지 모양으로 못 가려 경로로 둠.
const notFile = (s: string, ext: string) => {
  const parts = s.split(".");
  if (parts.length !== 2) return false;
  const [base] = parts;
  return (ext === "js" && /^[A-Z]/.test(base) && LIBJS.has(base.toLowerCase())) || ((ext === "log" || ext === "env") && MEMBER.has(base));
};
// 슬래시가 있어도 경로가 아닌 것 — "and/or"·"GET/POST"·"try/catch" 같은 짝말, "0/5" 같은 분수
const PAIR = new Set(["and", "or", "on", "off", "yes", "no", "true", "false", "read", "write", "input", "output", "get", "set", "in", "out", "open", "close", "start", "stop",
  "show", "hide", "enable", "disable", "try", "catch", "async", "await", "if", "else", "before", "after", "client", "server", "key", "value", "ok", "ng", "push", "pull"]);
const notPath = (s: string) => {
  const p = s.split("/");
  return /^\d+\/\d+$/.test(s) || (p.length === 2 && p.every((x) => /^[A-Z]+$/.test(x) || PAIR.has(x.toLowerCase())));
};

const isSym = (s: string): boolean => {
  // 함수·메서드 호출 — 이름 뒤 괄호(인자 포함 가능)
  if (/^\.?[\w$.@:<>]+\s*\(.*\)$/.test(s)) return true;
  // 이름 하나 — 변수·함수·타입·상수·키워드(fieldLine, useEffect, AppDelegate, MAX_FILES, static), 제네릭(List<String>), 멤버 접근(console.log, catchup.enabled)
  if (/^[A-Za-z_$][\w$]*(<[\w, <>[\]|]+>)?(\??\.[A-Za-z_$][\w$]*)*(\[\])?$/.test(s)) return /[a-z]/.test(s) || s.includes("_"); // API·JSON 같은 약어는 회색
  if (/^@[A-Za-z]\w*$/.test(s)) return true; // @main·@override 어노테이션
  // JSX·태그 이름 — <Text>, <input>, </View>, <true/>
  if (/^<\/?[A-Za-z][\w.:-]*\s*\/?>$/.test(s)) return true;
  // 키워드로 시작하는 코드 조각 — "static const fieldLine", "import type", "export default"
  const w = s.split(/\s+/);
  if (w.length > 1 && KW.has(w[0]) && !/[가-힣ぁ-んァ-ン一-龥]/.test(s)) return true; // import { ... } from '...'·as const도
  // 스프레드·구조분해 — ...ex1, { ko, ja, hl }
  if (/^\.\.\.[A-Za-z_$][\w$.]*$/.test(s) || /^\{\s*[A-Za-z_$][\w$]*(\s*[,:]\s*[A-Za-z_$][\w$]*)*\s*\}$/.test(s)) return true;
  // 연산자 하나만 — ?. ?? && || => === !== ...(스프레드)
  if (/^(\?\.|\?\?|&&|\|\||=>|===|!==|\.\.\.)$/.test(s)) return true;
  // 속성: 값 — "flex: 1", "flexDirection: 'row'"(한글 "키: 값"은 설명이라 회색)
  if (/^[A-Za-z_$][\w$-]*:\s+\S.*$/.test(s) && !/[가-힣ぁ-んァ-ン一-龥]/.test(s) && s.length <= 60) return true;
  // 연산자가 들어간 짧은 식 — "b === 0", "a ?? b", "x => x.id" (한글·문장 아님)
  if (!/[가-힣ぁ-んァ-ン一-龥]/.test(s) && /[A-Za-z_$]/.test(s) && /(===|!==|==|!=|=>|\?\?|\?\.|&&|\|\||->|::|\+=|<=|>=)/.test(s) && s.length <= 60) return true;
  return false;
};

export function codeKind(raw: string): CodeKind {
  const s = raw.trim();
  if (!s || s.length > 120) return "plain";
  // 값·리터럴 — 숫자·색·16진수·문자열·불린/null·$(빌드변수), 숫자가 섞인 6·8자리 16진 색(D1D6DB)
  if (/^-?\d+(\.\d+)?(px|ms|s|%|em|rem|vh|vw|x|pt|dp)?$/.test(s) || /^#[0-9a-f]{3,8}$/i.test(s) || /^0x[0-9a-f]+$/i.test(s)
    || (/^[0-9A-F]{6}([0-9A-F]{2})?$/.test(s) && /\d/.test(s) && /[A-F]/.test(s))
    || /^(["'`]).*\1$/.test(s) || /^(true|false|null|nil|undefined|None|True|False|NaN)$/.test(s) || /^\$\(.+\)$/.test(s)) return "val";
  // 명령어·옵션 — 흔한 CLI로 시작, --플래그·-q, 셸 리다이렉트(2>&1, 2>/dev/null)
  const first = s.split(/\s+/)[0];
  if ((CLI.has(first) && (first !== s || !CLI_AMBIG.has(s))) || /^--?[a-z][\w-]*(=\S+|\s+\S+)?$/i.test(s) || /^(\d?>&?(\d|\/dev\/null)\s*)+$/.test(s) || /^s\/.+\/.*\/g?$/.test(s)) return "cmd"; // 마지막은 sed 치환식(s/옛/새/)
  // 점으로 시작 — .gitignore·.tsx(파일·확장자)는 경로, .map·.ex1(멤버)은 코드 이름
  if (/^\.[A-Za-z][\w-]*$/.test(s)) return EXT.has(s.slice(1).toLowerCase()) || /^\.(git|env|npm|prettier|eslint|editor|docker|nvm|vscode|claude)/.test(s) ? "path" : "sym";
  // 파일·경로 — 슬래시가 있고 공백 없음, 또는 이름.확장자(+줄 번호)
  if (!/\s/.test(s) && !s.includes("(") && !s.startsWith("<")) { // "<true/>" 같은 태그는 경로 아님
    if (/\//.test(s) && /[\w.-]/.test(s) && !notPath(s)) return "path";
    if (/^[A-Za-z]:?[\w.-]*(\\[\w.-]+)+$/.test(s)) return "path"; // 윈도 경로(src\\a.ts·C:\\x) — "\\n" 같은 이스케이프는 제외
    const m = s.match(/^[\w@.-]*[\w-]\.([a-z][a-z0-9]{0,9})(:\d+(-\d+)?)?$/i);
    if (m && (EXT.has(m[1].toLowerCase()) || m[2]) && !notFile(s, m[1].toLowerCase())) return "path"; // 아는 확장자이거나 줄 번호가 붙을 때만("catchup.enabled" 같은 키와 구분)
  }
  return isSym(s) ? "sym" : "plain";
}

// 툴팁용 세부 종류 — 색은 4가지 그대로, 마우스를 올리면 "메서드 호출"·"옵션"·"폴더"처럼 무엇인지 더 자세히(유저 요청).
export type CodeSub =
  | "file" | "fileLine" | "dir" | "url" | "route" | "path"
  | "command" | "flag" | "redirect"
  | "method" | "fn" | "type" | "const" | "keyword" | "annotation" | "tag" | "member" | "logic" | "snippet" | "name"
  | "color" | "number" | "string" | "bool" | "buildVar";
const HAN = /[가-힣ぁ-んァ-ン一-龥]/;
export function codeSub(raw: string, kind: CodeKind = codeKind(raw)): CodeSub | null {
  const s = raw.trim();
  if (kind === "path") {
    if (/:\/\//.test(s)) return "url";
    if (/:\d+(-\d+)?$/.test(s)) return "fileLine";
    if (/\/$/.test(s)) return "dir";
    const last = s.split(/[\\/]/).pop() ?? s;
    if (/\.[A-Za-z][\w]*$/.test(last) || /^\.[A-Za-z]/.test(last)) return "file";
    if (s.startsWith("/") && !s.startsWith("/Users") && !s.startsWith("/tmp") && !s.startsWith("/private") && !s.startsWith("/dev")) return "route"; // /api/tasks 같은 주소 경로
    return "path";
  }
  if (kind === "cmd") return /^-/.test(s) ? "flag" : /^\d?>/.test(s) ? "redirect" : "command";
  if (kind === "val") {
    if (/^#|^[0-9A-F]{6}([0-9A-F]{2})?$|^0x[0-9a-f]{6,8}$/i.test(s)) return "color";
    if (/^-?\d|^0x/i.test(s) || s === "NaN") return "number";
    if (/^\$\(/.test(s)) return "buildVar";
    if (/^(true|false|null|nil|undefined|None|True|False)$/.test(s)) return "bool";
    return "string";
  }
  if (kind !== "sym") return null;
  if (/\(.*\)$/.test(s) && !/\s(===|!==|=>|&&|\|\|)\s/.test(s)) return /[\w)]\??\.[\w$]+\s*\(/.test(s) || s.startsWith(".") ? "method" : "fn";
  if (/^@\w/.test(s)) return "annotation";
  if (/^<\/?[A-Za-z]/.test(s) && s.endsWith(">")) return "tag";
  if (KW.has(s)) return "keyword";
  if (/\s/.test(s) && KW.has(s.split(/\s+/)[0]) && !HAN.test(s)) return "snippet";
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s)) return "const";
  if (/^[A-Z][A-Za-z0-9]*(<.+>)?(\[\])?$/.test(s)) return "type";
  if (/^\.?[A-Za-z_$][\w$]*(\??\.[A-Za-z_$][\w$]*)+$/.test(s) || /^\.[A-Za-z_$][\w$]*$/.test(s)) return "member";
  if (/^[A-Za-z_$][\w$]*$/.test(s)) return "name";
  return "logic"; // 연산자 식·스프레드·구조분해·속성: 값
}

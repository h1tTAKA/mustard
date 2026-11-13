// 인라인 코드 역할 분류(#1325) — 설명 글의 `백틱` 조각이 무엇인지 모양으로 판단해 색 약속을 입힘.
// AI 출력 형식을 바꾸지 않고 공용 Markdown 한곳에서. 확실하지 않으면 "plain"(기존 회색 그대로).
// 순서가 중요: 값 → 경로 → 함수 → 키워드 → 설정 키 → 타입.
export type CodeKind = "path" | "fn" | "type" | "key" | "val" | "kw" | "plain";
export const CODE_KINDS: Exclude<CodeKind, "plain">[] = ["path", "fn", "type", "key", "val", "kw"];

const KW = new Set([
  "import", "export", "from", "return", "await", "async", "static", "const", "let", "var", "final", "late", "class", "struct", "enum", "interface",
  "extends", "implements", "override", "super", "self", "this", "new", "public", "private", "protected", "internal", "func", "function", "def", "fn",
  "if", "else", "for", "while", "switch", "case", "try", "catch", "throw", "throws", "yield", "typeof", "instanceof", "void", "abstract", "mixin",
  "@main", "@objc", "@override", "required", "mut", "pub", "impl", "trait", "use", "package", "namespace", "using", "lambda", "guard", "defer",
]);

const EXT = new Set(("ts tsx js jsx mjs cjs json jsonc md mdx dart swift kt kts java py rb go rs c h cc cpp hpp m mm cs fs php plist xml yaml yml toml lock gradle "
  + "html htm css scss sass less vue svelte astro sh bash zsh fish ps1 txt log csv sql proto graphql gql env ini conf cfg properties lua ex exs erl hs ml scala clj "
  + "storyboard xib xcscheme xcconfig entitlements pbxproj podspec gemspec csproj sln resx xaml png jpg jpeg gif webp svg ico pdf wasm zip dockerfile tf hcl nix vim").split(" "));

// 파일처럼 생겼지만 아닌 것 — 라이브러리 이름(Node.js), 객체 멤버(console.log·process.env). app.tsx·App.js 같은 진짜 파일은 그대로(리뷰).
const LIBJS = new Set(["node", "vue", "next", "nuxt", "express", "chart", "three", "d3", "react", "angular", "ember", "backbone", "moment", "p5", "socket", "alpine", "nest", "deno", "bun"]);
// 딱 두 조각일 때만: "Node.js"(대문자 시작 라이브러리 이름)·"console.log"/"process.env". next.config.js·express.js·app.log 같은 파일은 경로(리뷰).
const MEMBER = new Set(["console", "process", "this", "self", "window", "document", "req", "res", "ctx", "logger"]); // .log·.env가 붙는 흔한 객체(app은 파일로 둠)
// 한계: 소문자 "chart.js"는 라이브러리 이름인지 파일인지 모양으로 못 가려 경로로 둠.
const notFile = (s: string, ext: string) => {
  const parts = s.split(".");
  if (parts.length !== 2) return false;
  const [base] = parts;
  return (ext === "js" && /^[A-Z]/.test(base) && LIBJS.has(base.toLowerCase())) || ((ext === "log" || ext === "env") && MEMBER.has(base));
};
// "and/or", "GET/POST", "on/off" — 슬래시가 있어도 경로가 아닌 짝말(한 번 나뉘고 양쪽이 대문자 약어거나 흔한 짝말)
const PAIR = new Set(["and", "or", "on", "off", "yes", "no", "true", "false", "read", "write", "input", "output", "get", "set", "in", "out", "open", "close", "start", "stop", "show", "hide", "enable", "disable"]);
const SLASH_WORDS = (s: string) => { const p = s.split("/"); return p.length === 2 && p.every((x) => /^[A-Z]+$/.test(x) || PAIR.has(x.toLowerCase())); };

export function codeKind(raw: string): CodeKind {
  const s = raw.trim();
  if (!s || s.length > 120) return "plain";
  // 값·리터럴 — 숫자·색·16진수·문자열·불린/null·$(빌드변수)
  if (/^-?\d+(\.\d+)?(px|ms|s|%|em|rem|vh|vw|x)?$/.test(s) || /^#[0-9a-f]{3,8}$/i.test(s) || /^0x[0-9a-f]+$/i.test(s)
    || /^(["'`]).*\1$/.test(s) || /^(true|false|null|nil|undefined|None|True|False|NaN)$/.test(s) || /^\$\(.+\)$/.test(s)) return "val";
  // 파일·경로 — 슬래시가 있고 공백 없음, 또는 이름.확장자(+줄 번호)
  if (!/\s/.test(s) && !s.includes("(") && !s.startsWith("<")) { // "<true/>" 같은 태그는 경로 아님
    if (/[\\/]/.test(s) && /[\w.-]/.test(s) && !SLASH_WORDS(s)) return "path";
    const m = s.match(/^[\w@.-]*[\w-]\.([a-z][a-z0-9]{0,9})(:\d+(-\d+)?)?$/i);
    if (m && (EXT.has(m[1].toLowerCase()) || m[2]) && !notFile(s, m[1].toLowerCase())) return "path"; // Node.js·Vue.js 같은 이름 제외 // 이름.확장자 — 아는 확장자이거나 줄 번호가 붙을 때만("catchup.enabled" 같은 키와 구분)
  }
  // 함수·메서드 — 이름 뒤 괄호(인자 포함 가능)
  if (/^[\w$.@:<>]+\s*\(.*\)$/.test(s) || /^[\w$]+(\.[\w$]+)*\(_?:?.*\)$/.test(s)) return "fn";
  if (KW.has(s)) return "kw";
  // 설정 키 — 대문자_밑줄, --플래그, <태그>("user.name"·"console.log" 같은 점 이음은 멤버 접근과 구분이 안 돼 회색)
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s) || /^--?[a-z][\w-]*$/.test(s) || /^<\/?[\w:-]+\/?>$/.test(s)) return "key";
  // 타입·클래스 — 대문자로 시작하는 한 단어(제네릭 허용)
  if (/^[A-Z][A-Za-z0-9]*(<[\w, <>]+>)?$/.test(s) && /[a-z]/.test(s)) return "type"; // API·JSON 같은 약어는 제외
  return "plain";
}

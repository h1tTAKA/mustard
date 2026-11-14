// tree-sitter 로더 — 서버(Node) 전용. WASM grammar를 런타임 로드해 소스 → 구문트리(AST).
// web-tree-sitter@0.20(런타임) + tree-sitter-wasms(prebuilt grammar, tree-sitter 0.20 ABI). 심볼 추출(symbols.ts)의 파싱 계층.
// 초기화·언어 로드는 1회만(캐시). native build 없음(전부 WASM).
// 버전 주의: grammar가 tree-sitter-cli 0.20으로 빌드돼 web-tree-sitter도 0.20이어야 ABI 맞음(신버전은 로드 실패).
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type Parser from "web-tree-sitter"; // 타입만(런타임 erase) — 값은 아래 require로.

// external 패키지라 import.meta.url이 번들러 가상 경로가 됨 → 실제 node_modules 기준으로 resolve.
// 이름을 require로 두면 Turbopack이 번들러 require 호출로 오인해 외부 CJS를 interop/빈 객체로 감쌈 → nodeReq로.
// #1000 기준 = 서버 진입 파일(process.argv[1]). 패키징 앱은 standalone/apps/mustard/server.js → 위로 올라가며
// standalone/node_modules(copy-standalone-assets가 넣음). dev는 next bin → 레포 node_modules. cwd는 폴백 —
// 앱을 open/Dock으로 띄우면 서버 cwd가 "/"라 cwd 기준만으론 못 찾았음.
function makeReq(): NodeRequire {
  const bases = [process.argv[1], join(process.cwd(), "package.json")].filter((p): p is string => !!p && existsSync(p));
  for (const b of bases) {
    const r = createRequire(b);
    try { r.resolve("web-tree-sitter/package.json"); return r; } catch { /* 다음 후보 */ }
  }
  return createRequire(join(process.cwd(), "package.json"));
}
let reqCache: NodeRequire | null = null;
const nodeReq = () => (reqCache ??= makeReq());

// web-tree-sitter@0.20 footgun: tree-sitter.js가 `Parser.init()` 호출 시 `module.exports=Module`(Emscripten
// 모듈)로 **덮어씀**. 그래서 init 이후 재-require하면 Parser 클래스가 아니라 Module(init 없음)이 와서
// "TS.init is not a function"으로 깨짐(#849 첫 호출만 되던 이유). → require 캐시를 버스트하고 신선 로드해
// module.exports 원형(Parser 클래스, init/Language 보유)을 확보. globalThis에 1회 캐싱(모듈 재평가·중복 로드 방지).
// 스펙은 split/join으로 조립해 Turbopack 정적 require 변형도 회피.
const wtsSpec = "web-tree-sitter".split("").join("");
function loadParser(): typeof import("web-tree-sitter") {
  const req = nodeReq();
  try { delete req.cache[req.resolve(wtsSpec)]; } catch { /* 캐시 없음 — 무시 */ }
  const fresh = req(wtsSpec) as unknown as Record<string, unknown>; // init 전이라 module.exports=Parser 클래스
  return (typeof fresh.init === "function" ? fresh : (fresh.default ?? fresh)) as typeof import("web-tree-sitter");
}
const g = globalThis as unknown as { __nunopiWTS?: typeof import("web-tree-sitter") };
// #1000 지연 로드 — 예전엔 모듈 최상위에서 require해 import 시점에 throw → 라우트 try/catch 밖 → 원인 없는 500.
// 이제 첫 파싱 때 로드, 실패하면 원인 담은 에러를 던져 라우트가 JSON으로 전달("심볼 없음"과 구분).
function getTS(): typeof import("web-tree-sitter") {
  if (g.__nunopiWTS) return g.__nunopiWTS;
  try { return (g.__nunopiWTS = loadParser()); }
  catch (e) { throw new Error(`tree-sitter unavailable (symbol parser not bundled?): ${String((e as Error)?.message ?? e)}`); }
}

// 패키지 위치 기준으로 .wasm 경로를 런타임에 조립(번들러가 .wasm을 정적 분석·번들하지 않게 —
// require.resolve로 직접 .wasm을 가리키면 Turbopack이 grammar wasm을 파싱하려다 깨진다).
const runtimeWasmPath = () => join(dirname(nodeReq().resolve("web-tree-sitter/package.json")), "tree-sitter.wasm");
const grammarWasmPath = (grammar: string) => join(dirname(nodeReq().resolve("tree-sitter-wasms/package.json")), "out", `tree-sitter-${grammar}.wasm`);

// 확장자 → tree-sitter-wasms grammar 이름(out/tree-sitter-{이름}.wasm).
// LANGS(langs.ts)와 짝 — import 그래프는 정규식/컴파일러, 심볼은 tree-sitter.
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "javascript",
  ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
  ".cs": "c_sharp", ".rs": "rust", ".php": "php", // .rb 없음 — 이 런타임(0.20)에서 ruby 문법 로드가 깨져 그래프 전체가 실패했음(#1331). import는 정규식
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp",
  ".hpp": "cpp", ".hh": "cpp", ".hxx": "cpp", ".swift": "swift",
};

function extOf(file: string): string {
  const i = file.lastIndexOf(".");
  return i < 0 ? "" : file.slice(i).toLowerCase();
}

// 파일 → grammar 이름(심볼 추출 지원 언어면), 아니면 null.
export function grammarForFile(file: string): string | null {
  return EXT_TO_GRAMMAR[extOf(file)] ?? null;
}

let initPromise: Promise<void> | null = null;
const langCache = new Map<string, Parser.Language>();

// WASM 런타임 1회 초기화. locateFile로 tree-sitter.wasm 실제 경로 지정(Node).
async function ensureInit(): Promise<void> {
  if (!initPromise) {
    const runtimeWasm = runtimeWasmPath();
    initPromise = getTS().init({ locateFile: () => runtimeWasm });
    initPromise.catch(() => { initPromise = null; }); // 실패하면 다음 호출에 재시도
  }
  await initPromise;
}

// grammar 이름 → Language(캐시). wasm 경로를 로더에 전달(Node서 파일 읽음).
async function loadLanguage(grammar: string): Promise<Parser.Language> {
  const cached = langCache.get(grammar);
  if (cached) return cached;
  const wasmPath = grammarWasmPath(grammar);
  const lang = await getTS().Language.load(wasmPath);
  langCache.set(grammar, lang);
  return lang;
}

// 소스 → 구문트리. 미지원 언어면 null. (파서는 매 호출 새로 — 언어 캐시가 무거운 부분.)
export async function parseFile(text: string, file: string): Promise<{ tree: Parser.Tree; grammar: string } | null> {
  const grammar = grammarForFile(file);
  if (!grammar) return null;
  await ensureInit();
  const lang = await loadLanguage(grammar);
  const parser = new (getTS())();
  parser.setLanguage(lang);
  const tree = parser.parse(text);
  parser.delete(); // WASM 힙 객체 — GC 안 됨. tree는 파서와 독립이라 여기서 파서 해제(호출자가 tree.delete()).
  return { tree, grammar };
}

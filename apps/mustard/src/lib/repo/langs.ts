// 언어 레지스트리 — 서버(Node) 전용. 확장자→언어 매핑 + 언어별 import 추출기.
// TS/JS는 TypeScript 컴파일러 API(정확), 나머지는 경량 정규식. 언어 추가 = LANGS에 항목 1개.
import ts from "typescript";

export interface LangDef {
  lang: string;                        // 표시용 이름
  exts: string[];                      // 담당 확장자(소문자, 점 포함)
  extract: (text: string) => string[]; // 소스 → raw import 지정자 목록(정규화된 형태 권장)
}

// TS/JS/TSX — 컴파일러 API가 import/require/dynamic import 다 잡음.
function extractTsJs(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((i) => i.fileName);
}

// Python 모듈명(점 표기) → 해석용 지정자. 선행 점 = 상대 레벨.
//   "a.b.c" → "a/b/c" (절대)   ".mod" → "./mod"   "..pkg" → "../pkg"
function pyModuleToSpec(mod: string): string {
  const m = /^(\.*)(.*)$/.exec(mod)!;
  const dots = m[1].length;
  const rest = m[2].replace(/\./g, "/");
  if (dots === 0) return rest;
  return (dots === 1 ? "./" : "../".repeat(dots - 1)) + rest;
}

// Python — `import a.b`, `from a.b import c`, 상대 `from .mod import x`.
function extractPython(text: string): string[] {
  const specs: string[] = [];
  for (const line of text.split("\n")) {
    let m = /^\s*from\s+([.\w]+)\s+import\s+/.exec(line);
    if (m) { specs.push(pyModuleToSpec(m[1])); continue; }
    m = /^\s*import\s+(.+)$/.exec(line);
    if (m) {
      for (const part of m[1].split(",")) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim();
        if (mod && /^[.\w]+$/.test(mod)) specs.push(pyModuleToSpec(mod));
      }
    }
  }
  return specs;
}

// Go — 단일 `import "x"` + 블록 `import ( "a" alias "b" )`. 지정자는 패키지 경로.
function extractGo(text: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  const block = /import\s*\(([\s\S]*?)\)/g;
  while ((m = block.exec(text))) {
    for (const line of m[1].split("\n")) {
      const q = /"([^"]+)"/.exec(line);
      if (q) specs.push(q[1]);
    }
  }
  const single = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
  while ((m = single.exec(text))) specs.push(m[1]);
  return specs;
}

const dotsToSlash = (s: string) => s.replace(/\./g, "/");

// Java / Kotlin — `import com.foo.Bar;`(자바 세미콜론, 코틀린 없음). static 포함.
function extractJavaKotlin(text: string): string[] {
  const specs: string[] = [];
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) specs.push(dotsToSlash(m[1]));
  return specs;
}

// C# — `using Foo.Bar;` (네임스페이스, 파일 매핑 best-effort).
function extractCSharp(text: string): string[] {
  const specs: string[] = [];
  const re = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) specs.push(dotsToSlash(m[1]));
  return specs;
}

// Ruby — `require_relative "x"`(상대), `require "x"`(모듈).
function extractRuby(text: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  const rel = /require_relative\s+['"]([^'"]+)['"]/g;
  while ((m = rel.exec(text))) specs.push("./" + m[1]);
  const req = /(?:^|[^_])\brequire\s+['"]([^'"]+)['"]/g;
  while ((m = req.exec(text))) specs.push(m[1]);
  return specs;
}

// Rust — `mod name;`(형제 파일/디렉터리), `use crate::a::b::Item`(마지막 조각=아이템 제거).
function extractRust(text: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  const mod = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
  while ((m = mod.exec(text))) specs.push("./" + m[1]);
  const use = /^\s*(?:pub\s+)?use\s+((?:crate|self|super|\w+)(?:::\w+)+)/gm;
  while ((m = use.exec(text))) {
    const parts = m[1].split("::").filter((p) => p && p !== "crate" && p !== "self" && p !== "super");
    if (parts.length > 1) parts.pop(); // 끝 = 타입/함수일 확률 → 모듈 경로만
    if (parts.length) specs.push(parts.join("/"));
  }
  return specs;
}

// PHP — `require/include "x"`(경로), `use Namespace\Class;`(백슬래시→슬래시).
function extractPhp(text: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  const inc = /(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g;
  while ((m = inc.exec(text))) specs.push(m[1].startsWith(".") ? m[1] : "./" + m[1]);
  const use = /^\s*use\s+([\w\\]+)\s*;/gm;
  while ((m = use.exec(text))) specs.push(m[1].replace(/\\/g, "/"));
  return specs;
}

// C/C++ — `#include "x.h"`(로컬만; `<...>`=시스템은 스킵). 파일 기준 상대로 해석.
function extractC(text: string): string[] {
  const specs: string[] = [];
  // 라인 시작 앵커 — `// #include ...` 주석 오탐 배제(전처리기는 항상 라인 시작).
  const re = /^\s*#\s*include\s*"([^"]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) specs.push("./" + m[1]);
  return specs;
}

// Swift — `import Module`(모듈명, 파일 매핑 best-effort).
function extractSwift(text: string): string[] {
  const specs: string[] = [];
  const re = /^\s*import\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) specs.push(m[1]);
  return specs;
}

// Dart(#1331) — `import/export/part 'x';`(조건부 import의 대체 경로도). `dart:`는 SDK라 버림, `package:`는 그대로(해석은 pubspec 이름),
// 그 밖은 파일 기준 상대.
function extractDart(text: string): string[] {
  const specs: string[] = [];
  const re = /^\s*(?:import|export|part(?:\s+of)?)\s+([^;]+);/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
      const s = q[1];
      if (s.startsWith("dart:")) continue;
      specs.push(s.startsWith("package:") || s.startsWith(".") || s.startsWith("/") ? s : "./" + s);
    }
  }
  return specs;
}

export const LANGS: LangDef[] = [
  { lang: "ts/js", exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], extract: extractTsJs },
  { lang: "python", exts: [".py"], extract: extractPython },
  { lang: "go", exts: [".go"], extract: extractGo },
  { lang: "java", exts: [".java"], extract: extractJavaKotlin },
  { lang: "kotlin", exts: [".kt", ".kts"], extract: extractJavaKotlin },
  { lang: "csharp", exts: [".cs"], extract: extractCSharp },
  { lang: "ruby", exts: [".rb"], extract: extractRuby },
  { lang: "rust", exts: [".rs"], extract: extractRust },
  { lang: "php", exts: [".php"], extract: extractPhp },
  { lang: "c/c++", exts: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"], extract: extractC },
  { lang: "swift", exts: [".swift"], extract: extractSwift },
  { lang: "dart", exts: [".dart"], extract: extractDart },
];

const EXT_TO_LANG = new Map<string, LangDef>();
for (const l of LANGS) for (const e of l.exts) EXT_TO_LANG.set(e, l);

// scan이 수집할 확장자 집합(레지스트리서 파생 — 단일 소스).
export const SUPPORTED_EXTS = new Set(EXT_TO_LANG.keys());

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

// 파일명 → 담당 LangDef(없으면 null).
export function detectLang(file: string): LangDef | null {
  return EXT_TO_LANG.get(extOf(file)) ?? null;
}

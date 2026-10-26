// C# 타입 참조 → 정의 파일(#1005). C#은 `using`이 네임스페이스라 파일 import가 없고, 같은 네임스페이스 타입은
// using 없이 이름만 씀 → import 기반 그래프에서 C# 파일이 전부 섬(cooing 221/221). 본문에서 쓰인 타입 이름을
// 레포 전체 타입 인덱스(이름 → 정의 파일)와 맞춰 파일 간 references 엣지를 만든다. 순수 함수(import 없음, check 가능).
// 한계: 정규식 근사(제네릭·using alias·partial class 다파일은 이름 매칭 수준). 정확 해석은 Roslyn급 — 범위 밖.

export interface TypeDef { name: string; file: string; namespace: string | null }

// 주석·문자열·문자 리터럴 제거 — 문자열 안 단어("Player")를 타입 참조로 오인하지 않게.
// 한 번에 앞에서부터 훑는 스캐너(#1006 리뷰): 정규식 체인은 $"{f("x")}"(보간 안 따옴표)에서 일찍 끊기고, "http://x"의 //를 주석으로 오인.
// 지운 구간의 줄바꿈은 남김 → 줄 번호 유지(네임스페이스↔심볼 행 매칭에 씀).
export function stripCsharp(text: string): string {
  let out = "";
  let i = 0;
  const keepNl = (from: number, to: number) => text.slice(from, to).replace(/[^\n]/g, "");
  while (i < text.length) {
    const c = text[i], d = text[i + 1];
    if (c === "/" && d === "/") { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e; out += " "; continue; }
    if (c === "/" && d === "*") { const e = text.indexOf("*/", i + 2); const end = e < 0 ? text.length : e + 2; out += " " + keepNl(i, end); i = end; continue; }
    if (c === "'") { const end = skipChar(text, i); if (end > 0) { out += "''"; i = end; continue; } }
    if (c === '"' || ((c === "$" || c === "@") && /^[$@]*"/.test(text.slice(i, i + 5)))) {
      const end = skipString(text, i); out += '""' + keepNl(i, end); i = end; continue;
    }
    out += c; i++;
  }
  return out;
}
// 'a' '\n' '\u0041' — 닫는 따옴표 끝 위치, 문자 리터럴 아니면 -1.
function skipChar(t: string, i: number): number {
  const e = t.indexOf("'", t[i + 1] === "\\" ? i + 3 : i + 2);
  return e > i && e - i <= 10 && !t.slice(i, e).includes("\n") ? e + 1 : -1;
}
// i = 접두($·@) 또는 여는 따옴표. 반환 = 문자열 끝 다음 위치. 일반·verbatim(@)·보간($, {..} 중첩)·raw(""") 처리.
function skipString(t: string, i: number): number {
  let k = i, interp = false, verbatim = false;
  while (t[k] === "$" || t[k] === "@") { if (t[k] === "$") interp = true; else verbatim = true; k++; }
  if (t.startsWith('"""', k)) { // raw string: 여는 따옴표 개수만큼 닫는 따옴표
    let q = 0; while (t[k + q] === '"') q++;
    const e = t.indexOf('"'.repeat(q), k + q);
    return e < 0 ? t.length : e + q;
  }
  let j = k + 1;
  while (j < t.length) {
    const ch = t[j];
    if (ch === '"') { if (verbatim && t[j + 1] === '"') { j += 2; continue; } return j + 1; }
    if (ch === "\\" && !verbatim) { j += 2; continue; }
    if (ch === "\n" && !verbatim) return j; // 닫히지 않은 일반 문자열 — 줄에서 끊음
    if (ch === "{" && interp) { if (t[j + 1] === "{") { j += 2; continue; } j = skipBraces(t, j); continue; }
    j++;
  }
  return j;
}
// 보간 {..} — 중첩 중괄호·안쪽 문자열·문자 리터럴 건너뜀.
function skipBraces(t: string, j: number): number {
  let depth = 0;
  while (j < t.length) {
    const ch = t[j];
    if (ch === "{") depth++;
    else if (ch === "}") { if (--depth === 0) return j + 1; }
    else if (ch === '"' || ((ch === "$" || ch === "@") && /^[$@]*"/.test(t.slice(j, j + 5)))) { j = skipString(t, j); continue; }
    else if (ch === "'") { const e = skipChar(t, j); if (e > 0) { j = e; continue; } }
    j++;
  }
  return j;
}

// 선언 네임스페이스(블록·파일 범위 `namespace X;` 첫 것) + using 네임스페이스들.
export function csharpNamespaces(text: string): { declared: string | null; usings: string[] } {
  const declared = /^\s*namespace\s+([\w.]+)/m.exec(text)?.[1] ?? null;
  const usings: string[] = [];
  const re = /^\s*using\s+(?!static\b)(?:\w+\s*=\s*)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) usings.push(m[1]);
  return { declared, usings };
}

// 행(0-based) → 그 행에 적용되는 선언 네임스페이스. 한 파일에 namespace 블록이 여럿이면(#1006 리뷰) 첫 것만 쓰면 오분류.
// 한계: "그 행 이전 마지막 namespace 선언" 근사 — 중첩 namespace(A { namespace B })·블록 닫힌 뒤 전역 타입은 부정확.
export function csharpNamespaceAt(stripped: string): (row: number) => string | null {
  const decls: { row: number; ns: string }[] = [];
  for (const m of stripped.matchAll(/^\s*namespace\s+([\w.]+)/gm)) {
    const at = m.index! + m[0].length - m[1].length;
    decls.push({ row: stripped.slice(0, at).split("\n").length - 1, ns: m[1] });
  }
  return (row) => { let ns: string | null = null; for (const d of decls) { if (d.row > row) break; ns = d.ns; } return ns; };
}

// 엔진 API를 흉내 낸 스텁 파일(라이선스 없이 컴파일 검사용 등) — 진짜 엔진은 DLL이라 레포 밖. 스텁 타입을 인덱스에 넣으면
// MonoBehaviour·GameObject 쓰는 모든 스크립트가 스텁 한 파일로 몰림(#1005 cooing: 상속 39개 전부·calls 227개). 선언 ns 하나라도 엔진 ns면 스텁.
const ENGINE_NS = /^(UnityEngine|UnityEditor|Godot)(\.|$)/;
export function isEngineStub(text: string): boolean {
  for (const m of text.matchAll(/^\s*namespace\s+([\w.]+)/gm)) if (ENGINE_NS.test(m[1])) return true;
  return false;
}

const commonPrefixLen = (a: string, b: string) => { const x = a.split("/"), y = b.split("/"); let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; return i; };

// 같은 이름 타입이 여러 파일에 있으면: 보이는 네임스페이스(같은 ns·부모 ns·using) 우선 → 경로 공통 접두 긴 순 → 경로순.
function pick(file: string, defs: TypeDef[], ns: { declared: string | null; usings: string[] }): string {
  const visible = (d: TypeDef) => !d.namespace || d.namespace === ns.declared || ns.usings.includes(d.namespace)
    || (!!ns.declared && (ns.declared === d.namespace || ns.declared.startsWith(d.namespace + ".")));
  const pool = defs.filter(visible).length ? defs.filter(visible) : defs;
  return [...pool].sort((a, b) => commonPrefixLen(file, b.file) - commonPrefixLen(file, a.file) || a.file.localeCompare(b.file))[0].file;
}

// 이 파일이 참조하는 다른 파일들(중복 없음). index: 타입 이름 → 정의들.
export function csharpTypeRefs(file: string, text: string, index: Map<string, TypeDef[]>): string[] {
  const body = stripCsharp(text);
  const ns = csharpNamespaces(body);
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const m of body.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
    const name = m[0];
    if (seen.has(name)) continue;
    seen.add(name);
    const defs = index.get(name)?.filter((d) => d.file !== file);
    if (!defs?.length) continue; // 레포에 없는 타입(Unity·BCL 등) 또는 자기 파일 정의
    out.add(pick(file, defs, ns));
  }
  return [...out];
}

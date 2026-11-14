// 문법(tree-sitter)이 없거나 이 런타임에서 안 열리는 언어용 심볼 추출(#1331) — Dart·Ruby. 정규식 근사.
// 선언(class·mixin·extension·enum·함수·메서드) → 심볼 노드 + contains, 본문 안의 `이름(` → 원시 호출(resolveCalls가
// 실제 있는 심볼만 이어 줌 → Flutter 위젯 생성 `MyWidget(...)`도 연결), extends/with/implements·`<` → 상속.
// 한계: 문자열 안 중괄호·주석의 선언 흉내는 일부 오인할 수 있음(문자열·주석은 지우고 셈).
import type { RepoNode, RepoEdge, RepoNodeKind } from "./types";
import type { SymbolInfo, RawCall, RawHeritage } from "./symbols";

type Out = { symbols: SymbolInfo[]; nodes: RepoNode[]; contains: RepoEdge[]; calls: RawCall[]; heritage: RawHeritage[] };
const EMPTY = (): Out => ({ symbols: [], nodes: [], contains: [], calls: [], heritage: [] });

const KW = new Set(["if", "for", "while", "switch", "catch", "return", "super", "this", "new", "throw", "assert", "await", "print", "sizeof", "typeof", "else", "do", "try", "case", "when", "elsif", "unless", "until", "yield", "puts", "require", "require_relative", "include", "extend", "raise"]);

// 문자열·주석을 같은 길이의 공백으로 — 위치는 그대로 두고 중괄호·선언 오인 줄이기. 한 번 훑는 상태 기계
// (주석 안 따옴표·문자열 안 // 나 /* 를 서로 헷갈리지 않게, 리뷰). 문자열은 따옴표만 남기고 속을 비움.
function blank(text: string, hashComments: boolean): string {
  const out = text.split("");
  const n = text.length;
  const wipe = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  let i = 0;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (!hashComments && c === "/" && d === "/") { const e = text.indexOf("\n", i); const end = e < 0 ? n : e; wipe(i, end); i = end; continue; }
    if (hashComments && c === "#" && d !== "{") { const e = text.indexOf("\n", i); const end = e < 0 ? n : e; wipe(i, end); i = end; continue; }
    if (!hashComments && c === "/" && d === "*") { const e = text.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; wipe(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      const triple = text.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      const raw = i > 0 && text[i - 1] === "r"; // Dart r'..' — 이스케이프 없음
      let k = i + q.length;
      while (k < n) {
        if (!raw && text[k] === "\\") { k += 2; continue; }
        if (text.startsWith(q, k)) break;
        if (!triple && text[k] === "\n") break; // 닫히지 않은 한 줄 문자열 — 줄 끝까지만
        k++;
      }
      wipe(i + q.length, Math.min(k, n));
      i = Math.min(k + q.length, n);
      continue;
    }
    i++;
  }
  return out.join("");
}

// 여는 중괄호부터 짝 맞는 닫는 중괄호 끝(없으면 텍스트 끝).
function braceEnd(src: string, open: number): number {
  let d = 0;
  for (let i = open; i < src.length; i++) { const c = src[i]; if (c === "{") d++; else if (c === "}" && --d === 0) return i + 1; }
  return src.length;
}

export function regexSymbols(text: string, file: string): Out {
  const lower = file.toLowerCase();
  if (lower.endsWith(".dart")) return dart(text, file);
  if (lower.endsWith(".rb")) return ruby(text, file);
  return EMPTY();
}

function finish(file: string, src: string, symbols: SymbolInfo[], heritage: RawHeritage[]): Out {
  // 시작 순서로 훑으며 열린 심볼 스택 — 최내곽 소속·호출자를 한 번에(전엔 호출마다 전체 심볼을 훑어 큰 파일에서 느렸음, 리뷰)
  const byStart = [...symbols].sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
  const starts = new Set(symbols.map((s) => s.startIndex));
  { const stack: SymbolInfo[] = []; for (const s of byStart) { while (stack.length && stack[stack.length - 1].endIndex <= s.startIndex) stack.pop(); for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === "class") { s.owner = stack[k].name; break; } stack.push(s); } }
  // 호출 — 함수·메서드 본문 안 `이름(`. 최내곽 심볼이 호출한 것으로.
  const calls: RawCall[] = [], seen = new Set<string>();
  const re = /\b([A-Za-z_]\w*)\s*\(/g;
  const stack: SymbolInfo[] = [];
  let si = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const at = m.index, name = m[1];
    while (si < byStart.length && byStart[si].startIndex < at) { const s = byStart[si++]; while (stack.length && stack[stack.length - 1].endIndex <= s.startIndex) stack.pop(); stack.push(s); }
    while (stack.length && stack[stack.length - 1].endIndex <= at) stack.pop();
    if (KW.has(name) || starts.has(at)) continue; // 선언 자리의 자기 이름(함수 머리)은 호출 아님
    const caller = stack[stack.length - 1]?.id;
    if (!caller) continue;
    const k = `${caller}|${name}`;
    if (!seen.has(k)) { seen.add(k); calls.push({ callerId: caller, calleeName: name, member: false }); }
  }
  const nodes: RepoNode[] = symbols.map((s) => ({ id: s.id, label: s.name, file, kind: s.kind, line: s.startRow + 1, ...(s.owner ? { owner: s.owner } : {}), ...(s.signature ? { signature: s.signature } : {}) }));
  const contains: RepoEdge[] = symbols.map((s) => ({ source: file, target: s.id, relation: "contains" }));
  return { symbols, nodes, contains, calls, heritage };
}

function adder(file: string, src: string) {
  const symbols: SymbolInfo[] = [], used = new Set<string>();
  const rowAt = (i: number) => { let r = 0; for (let j = 0; j < i; j++) if (src.charCodeAt(j) === 10) r++; return r; };
  const add = (name: string, kind: RepoNodeKind, start: number, end: number, signature?: string) => {
    let id = `${file}#${name}`;
    if (used.has(id)) { let n = 2; while (used.has(`${id}:${n}`)) n++; id = `${id}:${n}`; }
    used.add(id);
    const s: SymbolInfo = { id, name, kind, startIndex: start, endIndex: end, startRow: rowAt(start), ...(signature ? { signature: signature.slice(0, 200) } : {}) };
    symbols.push(s);
    return s;
  };
  return { symbols, add };
}

function dart(text: string, file: string): Out {
  const src = blank(text, false);
  const { symbols, add } = adder(file, src);
  const heritage: RawHeritage[] = [];
  // 타입 선언
  const typeRe = /^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:abstract|sealed|base|final|interface|mixin)\s+)*(class|mixin|enum|extension(?:\s+type)?)\s+(?:(?!on\b)(\w+))?([^{;]*)\{/gm; // 이름 없는 extension on X는 이름 자리에 on이 잡히지 않게(리뷰)
  let m: RegExpExecArray | null;
  while ((m = typeRe.exec(src))) {
    const open = m.index + m[0].length - 1;
    const name = m[2] ?? `extension@${m.index}`;
    const s = add(name, "class", m.index + m[0].indexOf(m[1]), braceEnd(src, open));
    const tail = m[3] ?? "";
    for (const [kw, rel] of [["extends", "extends"], ["with", "implements"], ["implements", "implements"], ["on", "implements"]] as const) {
      const h = new RegExp(`\\b${kw}\\s+([\\w<>,\\s.?]+?)(?=\\b(?:extends|with|implements|on)\\b|$)`).exec(tail);
      if (h) for (const b of h[1].split(",")) { const bn = b.trim().replace(/<.*$/, "").split(".").pop()!; if (/^\w+$/.test(bn)) heritage.push({ classId: s.id, baseName: bn, relation: rel }); }
    }
  }
  // 함수·메서드 — `타입? 이름(파라미터) [async] {` 또는 `=> 식;`. 생성자·getter 포함.
  const fnRe = /^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:static|external|factory|const|late|final|override|abstract)\s+)*(\w[\w<>?,.[\] ]*?\s+)(?:get\s+|set\s+)?([A-Za-z_]\w*(?:\.\w+)?)\s*(\([^;{]*?\))?\s*(?:async\*?|sync\*)?\s*(\{|=>)/gm; // 앞에 반환 타입 필수 — test(…)·SizedBox(…) 같은 호출과 구분
  while ((m = fnRe.exec(src))) {
    const name = m[2];
    const lead = m[1].trim().split(/\s+/)[0];
    if (KW.has(name) || /^(class|mixin|enum|extension|return|else)$/.test(name) || /^(return|await|throw|yield|else|new|case|final|var|const)$/.test(lead)) continue; // 반환 타입 자리가 실은 문장 키워드면 호출
    if (!m[3] && !/\bget\s+\w/.test(m[0])) continue; // 괄호 없으면 getter만
    const at = m.index + m[0].lastIndexOf(name, m[0].length - (m[3] ?? "").length - 1);
    const end = m[4] === "{" ? braceEnd(src, m.index + m[0].length - 1) : Math.max(src.indexOf(";", at), at + name.length);
    add(name.includes(".") ? name.split(".").pop()! : name, "function", at, end, `${name}${(m[3] ?? "").replace(/\s+/g, " ")}`);
  }
  return finish(file, src, symbols, heritage);
}

function ruby(text: string, file: string): Out {
  const src = blank(text, true);
  const { symbols, add } = adder(file, src);
  const heritage: RawHeritage[] = [];
  const lines = src.split("\n");
  const starts: number[] = []; { let o = 0; for (const l of lines) { starts.push(o); o += l.length + 1; } }
  // 블록 끝 = 같은 들여쓰기의 `end` 줄(관례적 서식 가정).
  const endOf = (row: number, indent: number) => { for (let r = row + 1; r < lines.length; r++) { const l = lines[r]; const ind = l.length - l.trimStart().length; if (ind === indent && /^\s*end\b/.test(l)) return starts[r] + l.length; } return src.length; };
  lines.forEach((l, r) => {
    const indent = l.length - l.trimStart().length;
    let m = /^\s*(class|module)\s+([\w:]+)(?:\s*<\s*([\w:]+))?/.exec(l);
    if (m) { const s = add(m[2].split("::").pop()!, "class", starts[r] + indent, endOf(r, indent)); if (m[3]) heritage.push({ classId: s.id, baseName: m[3].split("::").pop()!, relation: "extends" }); return; }
    m = /^\s*def\s+(?:self\.)?([\w]+[?!=]?)(\([^)]*\))?/.exec(l);
    if (m) add(m[1], "function", starts[r] + indent, endOf(r, indent), `${m[1]}${m[2] ?? ""}`);
  });
  return finish(file, src, symbols, heritage);
}

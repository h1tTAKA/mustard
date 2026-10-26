// 터미널 한 줄에서 링크 찾기(#1193) — 웹 주소(http·https, localhost:포트)와 파일 경로(줄:칸 허용).
// 결과 = { kind, text(원문 그대로), start(0부터, 줄 안 글자 위치), url | path·line·col }. 끝 문장부호·짝 없는 닫는 괄호는 뺌.
export type TerminalLink =
  | { kind: "url"; text: string; start: number; url: string }
  | { kind: "file"; text: string; start: number; path: string; line?: number; col?: number };

const URL_RE = /\b(?:https?:\/\/[^\s<>"'`]+|(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}(?:\/[^\s<>"'`]*)?)/g;
// 파일: ./ ../ / ~/ 로 시작하거나, 폴더/…/이름.확장자. 뒤에 :줄(:칸) 또는 (줄,칸)
const FILE_RE = /(?:^|(?<=[\s"'`(\[]))((?:\.{1,2}\/|~\/|\/)?(?:[\w@.+-]+\/)*[\w@.+-]+\.[A-Za-z][\w]{0,9})(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))?/g;

// 끝에 붙은 문장부호·짝 없는 닫는 괄호 떼기
function trimEnd(s: string) {
  let t = s.replace(/[.,;:!?'"`]+$/, "");
  for (const [o, c] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (t.endsWith(c) && t.split(o).length < t.split(c).length) t = t.slice(0, -1);
  }
  return t;
}

export function findLinks(line: string): TerminalLink[] {
  const out: TerminalLink[] = [];
  const taken: [number, number][] = [];
  for (const m of line.matchAll(URL_RE)) {
    const text = trimEnd(m[0]);
    if (!text) continue;
    const url = /^https?:\/\//.test(text) ? text : `http://${text}`;
    out.push({ kind: "url", text, start: m.index!, url });
    taken.push([m.index!, m.index! + text.length]);
  }
  for (const m of line.matchAll(FILE_RE)) {
    const path = m[1];
    const start = m.index! + m[0].indexOf(path);
    if (taken.some(([a, b]) => start < b && start + m[0].length > a)) continue; // 주소 안의 글자는 파일로 안 봄
    if (!path.includes("/") && !/^\.{1,2}\//.test(path) && !m[2] && !m[4]) continue; // "foo.ts" 홀로는 너무 흔함(버전 1.2.3 등) — 폴더나 줄 번호가 있을 때만
    if (/^\d+(\.\d+)+$/.test(path)) continue; // 버전 숫자
    const line_ = Number(m[2] ?? m[4]) || undefined, col = Number(m[3] ?? m[5]) || undefined;
    const text = line.slice(start, m.index! + m[0].length);
    out.push({ kind: "file", text, start, path, ...(line_ ? { line: line_ } : {}), ...(col ? { col } : {}) });
  }
  return out.sort((a, b) => a.start - b.start);
}

// 터미널 폴더(cwd) 기준 경로 → 절대 경로(posix, `.`·`..` 정리). `~/`는 화면에서 홈을 모르니 null.
export function resolvePath(cwd: string, p: string): string | null {
  if (p.startsWith("~/")) return null;
  const parts: string[] = [];
  for (const seg of (p.startsWith("/") ? p : `${cwd}/${p}`).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop(); else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}
// 레포 안 파일이면 레포 기준 경로, 아니면 null
export function repoRelative(repo: string, abs: string): string | null {
  const r = repo.replace(/\/+$/, "");
  return abs.startsWith(`${r}/`) ? abs.slice(r.length + 1) : null;
}

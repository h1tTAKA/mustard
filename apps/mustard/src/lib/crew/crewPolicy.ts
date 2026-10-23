// Crew 도구 권한 정책(#1100) — Claude 역할 세션의 PreToolUse 훅이 Mustard 서버에 묻고, 여기서 결정. 순수 모듈(점검 가능).
// 원칙(에픽 자율 4단계): worktree 안 읽기·수정·테스트·커밋 = 자동 허락 / push·머지·파괴적 git = 차단 / 그 밖 = 사람에게 묻기(카드 '나 필요').
// 경계(#1159 리뷰): 글자 규칙이라 '명령 글자'만 봄. worktree 파일을 실행하는 것(npm test의 package.json 스크립트·make·node x.js)은
// 그 안에 숨긴 git push·API 호출을 못 봄 — 진짜 막는 건 OS 샌드박스·서버 쪽 인증(#1157 보류, Crew API 토큰은 별도 이슈).
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { lstatSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";

export type Decision = "allow" | "deny" | "ask";

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "TodoRead", "ToolSearch", "WebSearch", "WebFetch", "Task", "Agent", "BashOutput", "KillShell", "ExitPlanMode"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
// 항상 막는 git·파괴 명령(규약·disallowedTools와 같은 목록 + 위험 rm)
const DENY_RE = /\bgit\b(?:\s+-{1,2}[\w.-]+(?:[ =]\S+)?)*\s+(push|merge|rebase|reset\s+--hard|branch\s+-[dD]|worktree\s+(remove|prune)|clean\s+-[a-z]*f|checkout\s+(main|master)\b|switch\s+(main|master)\b)|\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)|\bsudo\b/;
// 자동 허락하는 명령의 첫 단어(파이프·연결 각 부분이 전부 이 목록이어야 함)
const SAFE_CMD = new Set(["git", "npm", "pnpm", "yarn", "bun", "npx", "node", "tsc", "eslint", "prettier", "vitest", "jest", "pytest", "python", "python3", "go", "cargo", "make",
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "sed", "awk", "sort", "uniq", "diff", "echo", "printf", "pwd", "mkdir", "touch", "cp", "mv", "test", "true", "which", "jq", "tree", "cd"]);
// git 하위 명령 중 자동 허락
const SAFE_GIT = new Set(["status", "diff", "log", "show", "add", "commit", "restore", "stash", "branch", "rev-parse", "ls-files", "blame", "grep", "mv", "rm", "checkout", "switch"]); // config 제외 — core.pager·editor·sshCommand로 다음 git 때 코드 실행 가능(보안 리뷰)

// #1159 비밀 경로 — 읽기(Read류 도구·셸 인자)를 사람에게. 모델 문맥에 들어가면 커밋·push로 밖에 나갈 수 있음.
// ~/.nunopi는 비밀(설정·기록)이지만 그 아래 worktrees(역할 작업 폴더 자신)는 예외. macOS·Windows는 대소문자 무시(~/.SSH = ~/.ssh, 리뷰).
const HOME = homedir();
const FOLD = process.platform === "darwin" || process.platform === "win32";
const fold = (p: string) => (FOLD ? p.toLowerCase() : p);
const SECRET_REL = [".ssh", ".aws", ".gnupg", ".config/gh", ".config/gcloud", ".azure", ".nunopi", ".claude", ".codex", ".netrc", ".npmrc", ".pypirc", ".git-credentials",
  ".docker", ".kube", ".m2", ".gradle", ".cargo/credentials", ".cargo/credentials.toml", ".gem/credentials", ".password-store", ".bash_history", ".zsh_history", ".env",
  "Library/Keychains", "Library/Application Support", "Library/Cookies"];
// 이름만 봐도 비밀 — 경로를 해석하지 않고 글자 어디서든(따옴표·옵션 값·cd 뒤 상대 경로도, 리뷰)
const SECRET_NAMES = /(^|[^\w.-])(\.ssh|\.aws|\.gnupg|\.netrc|\.git-credentials|\.pypirc|\.password-store|\.kube|\.azure|gcloud|keychains|\.bash_history|\.zsh_history|\.credentials\.json)(?=$|[^\w-])/i;
const SECRET_EXCEPT = [join(HOME, ".nunopi", "worktrees")];
const under = (p: string, d: string) => { const a = fold(p), b = fold(d); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };
// 실제 경로 — 맨 위부터 한 조각씩, 링크(끊긴 것·/var 같은 시스템 링크 포함)를 만나면 대상으로 갈아탐. 없는 조각은 그대로 붙임.
// (realpathSync는 끊긴 링크에서 실패해 링크 이름을 그냥 붙였음 → Write가 링크 따라 밖에 새 파일, 리뷰)
export function realish(p: string, depth = 0): string {
  if (depth > 40) return sep; // 링크 사슬이 너무 김 = 판정 포기 → 루트(어디의 안도 아님 = 막는 쪽, 리뷰)
  const abs = resolve(p), { root } = parse(abs); // Windows는 C:\ 부터(sep로 쪼개면 첫 조각이 C:라 링크를 못 따라감, 리뷰)
  const segs = abs.slice(root.length).split(sep).filter(Boolean);
  let cur: string = root;
  for (let i = 0; i < segs.length; i++) {
    const next = join(cur, segs[i]);
    let link: string | null = null;
    try { if (lstatSync(next).isSymbolicLink()) link = readlinkSync(next); } catch { /* 없음 */ }
    if (link !== null) return realish(join(resolve(cur, link), ...segs.slice(i + 1)), depth + 1);
    cur = next;
  }
  return cur;
}
const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, HOME).replace(/^\$\{?HOME\}?(?=$|\/)/, HOME);
let secretDirs: string[] | null = null; // 실제 경로 포함(~/.ssh가 링크일 수도)
const secrets = () => (secretDirs ??= [...new Set(SECRET_REL.flatMap((d) => [join(HOME, d), realish(join(HOME, d))]))]);
const excepts = () => [...SECRET_EXCEPT, ...SECRET_EXCEPT.map((e) => realish(e))];
const homes = () => [HOME, realish(HOME)];
export function isSecretPath(p: string, base: string): boolean {
  const a = resolve(base, expandHome(p));
  return [a, realish(a)].some((x) => secrets().some((d) => under(x, d)) && !excepts().some((e) => under(x, e)));
}
// 홈(또는 그 위)을 통째로 — grep -r ../../../../ 처럼 비밀 폴더까지 훑음(리뷰)
const coversHome = (p: string, base: string) => { const a = resolve(base, expandHome(p)); return [a, realish(a)].some((x) => homes().some((h) => under(h, x))); };
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 셸 글자에서 비밀 경로(~/.ssh·$HOME/.ssh·/Users/me/.ssh) — 자기 worktree 절대 경로는 비밀 아님
const SECRET_TEXT = new RegExp(`(?:~|\\$\\{?HOME\\}?|${esc(HOME)})/(?:${SECRET_REL.map((d) => esc(d) + (d === ".nunopi" ? "(?!/worktrees(?:/|$))" : "")).join("|")})(?=$|[/\\s"'])`, FOLD ? "i" : "");
// 셸 명령 — 따옴표 걷은 글자를 빈칸·=·: 로 자른 조각 전부를 경로로 확인(따옴표 안·--opt=값·-f값도). cd 뒤 상대 경로(..)는 위치를 못 따라가 사람에게.
function shellSecret(raw: string, worktree: string): boolean {
  const text = unquote(raw);
  if (SECRET_TEXT.test(text) || SECRET_NAMES.test(text)) return true;
  if (/(^|[\s;&|(])cd(\s|$)/.test(text) && /(^|[\s/=])\.\.(\/|\s|$)/.test(text)) return true;
  for (let tok of text.split(/[\s=:,]+/)) {
    tok = tok.replace(/^-[A-Za-z]+(?=[./~$])/, ""); // -f../x 처럼 붙은 짧은 옵션 값
    if (!tok || tok.startsWith("-") || !/[/~]|^\.\.?$|^\$/.test(tok)) continue; // 경로처럼 생긴 것만
    if (isSecretPath(tok, worktree) || coversHome(tok, worktree)) return true;
  }
  return false;
}
// 경로 있는 읽기 도구 — 도구마다 경로 칸이 다름(Grep pattern은 검색어라 제외, glob은 경로). 와일드카드 앞 고정 부분으로 판정.
const READ_PATH_FIELDS: Record<string, string[]> = { Read: ["file_path"], NotebookRead: ["notebook_path"], LS: ["path"], Glob: ["path", "pattern"], Grep: ["path", "glob"] };
function toolSecret(tool: string, input: Record<string, unknown>, worktree: string): boolean {
  for (const k of READ_PATH_FIELDS[tool] ?? []) {
    const v = input[k];
    if (typeof v !== "string" || !v) continue;
    if (SECRET_TEXT.test(v) || SECRET_NAMES.test(v)) return true;
    const head = v.replace(/[*?[{].*$/, "");
    const stat = head === v ? v : head.replace(/[^/]*$/, "") || "."; // 와일드카드 있으면 그 조각 앞 폴더까지만(/Users/x/.s*/ → /Users/x/)
    if (isSecretPath(stat, worktree) || coversHome(stat, worktree)) return true;
  }
  return false;
}

const inside = (dir: string, p: string) => { const r = relative(dir, resolve(dir, p)); return !!dir && !r.startsWith("..") && !isAbsolute(r); };

// #1137 사람에게(hold) — 셸·코드 실행·네트워크·권한·지속성. 'ask'와 같지만 이유를 구분해 둠(샌드박스 위 '전부 알아서'가 생겨도 이건 묻기).
const HOLD_CMD = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "eval", "exec", "env", "xargs", "source", ".", "su", "doas", "perl", "ruby", "php", "osascript", "awk", "gawk",
  "ssh", "scp", "sftp", "rsync", "nc", "ncat", "socat", "curl", "wget", "open", "launchctl", "crontab", "defaults", "security", "chmod", "chown", "ln", "dd", "kill", "killall", "pkill", "gh", "tee", "install"]);
const SAFE_NPX = new Set(["tsc", "eslint", "prettier", "vitest", "jest", "tsx", "playwright", "next"]); // npx는 모르는 패키지를 받아 실행 → 이것만
const SAFE_ENV = /^(CI|NODE_ENV|FORCE_COLOR|NO_COLOR|TZ|LANG|LC_\w+|DEBUG|PORT|TERM)$/; // 앞에 붙는 VAR=값 중 허용(GIT_*·PATH·NODE_OPTIONS 등은 코드 실행 통로)
const WRITERS = new Set(["cp", "mv", "touch", "mkdir", "rm", "rmdir", "sed"]); // 경로 인자를 씀 → worktree 밖이면 hold
type Inner = Decision | "hold";
// 자동 허락하는 MCP 도구(서버 이름까지) — Mustard 코드 그래프·인앱 브라우저 읽기, Loom 기억 읽기. 그 밖은 사람(크루가 쓰면 그때 추가)
const MCP_READ_NAMES = /^mcp__mustard__(katchup_(check_freshness|file_api|find_all|find_code|repo_map|search|trace_calls)|browser_(read|console|status|screenshot))$|^mcp__plugin_loom-memory_loom(-memory)?__memory_(search|read|status)$/;

// 판단 전에 걷어내기(실사용 오탐 — node -e "…", git commit -m "$(cat <<'EOF' …)", cat >> f <<'EOF' …):
// ① heredoc 본문 → <<H  ② 명령 치환은 `cat <<H`만 허용(그 밖은 실제 실행되는 코드라 null = 묻기)  ③ 따옴표 안 글자 → §
function strip(cmd: string): string | null {
  let bad = false;
  const c = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\s*(?=\n|$)/g, (m, q, _w, body, at: number) => {
    if (quoteStateAt(cmd, at)) return m; // 따옴표·주석 안의 "<<X"는 heredoc 아님 — 지우면 다음 줄 명령이 감춰짐(리뷰)
    if (!q && /\$\(|`/.test(body)) bad = true; // 따옴표 없는 heredoc은 본문의 $(…)도 실행됨(리뷰)
    return m.slice(0, m.indexOf("\n")).replace(/<<-?\s*(['"]?)\w+\1/, "<<H");
  });
  if (bad) return null;
  const subs = [...c.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)];
  if (subs.some((m) => !/^\s*cat\s+<<H\s*$/.test((m[1] ?? m[2] ?? "").trim() ? (m[1] ?? m[2] ?? "") : "x"))) return null;
  if (/\$\(|`/.test(c.replace(/\$\(\s*cat\s+<<H\s*\)/g, ""))) return null; // 짝 안 맞는 치환
  return quoteScan(c.replace(/\$\(\s*cat\s+<<H\s*\)/g, "§"));
}
// 따옴표를 왼쪽부터 셸처럼 읽어 덩어리마다 § — "…" 안의 '는 글자, '…' 안의 \는 글자, 따옴표 밖 \x는 글자 하나(꾸밈) = §.
// 정규식 두 개로 따로 걷으면 "it's" 의 '가 뒤의 '와 짝지어 사이 명령(git push)을 감춤(리뷰). 안 닫힌 따옴표 = null(묻기).
function quoteScan(c: string): string | null {
  // ws = 바로 앞이 '이스케이프 안 된' 공백·;|& 또는 맨 앞 — 그때만 #가 주석 시작(a\ #x·a\<줄>#x는 글자, 리뷰)
  let out = "", i = 0, ws = true;
  while (i < c.length) {
    const ch = c[i];
    if (ch === "#" && ws) { while (i < c.length && c[i] !== "\n") i++; continue; } // 주석 — 안의 '는 따옴표 아님(리뷰)
    if (ch === "\\") { if (c[i + 1] !== "\n") { out += "§"; ws = false; } i += 2; continue; } // 줄 이음(\+줄바꿈)은 bash처럼 둘 다 지움 — 앞뒤가 붙음
    if (ch === "'" || (ch === "$" && c[i + 1] === "'")) {
      const ansi = ch === "$"; i += ansi ? 2 : 1;
      while (i < c.length && c[i] !== "'") i += ansi && c[i] === "\\" ? 2 : 1;
      if (i >= c.length) return null;
      i++; out += "§"; ws = false; continue;
    }
    if (ch === '"') {
      i++;
      while (i < c.length && c[i] !== '"') i += c[i] === "\\" ? 2 : 1;
      if (i >= c.length) return null;
      i++; out += "§"; ws = false; continue;
    }
    out += ch; ws = /[ \t\n;|&]/.test(ch); i++; // bash의 공백은 띄어쓰기·탭·줄바꿈만(NBSP 등은 글자)
  }
  return out;
}
// idx 위치가 따옴표·주석 안인가(heredoc 표시 판정용) — quoteScan과 같은 규칙
function quoteStateAt(c: string, idx: number): boolean {
  let i = 0, ws = true;
  while (i < idx) {
    const ch = c[i];
    if (ch === "#" && ws) { while (i < c.length && c[i] !== "\n") { if (i === idx) return true; i++; } continue; }
    if (ch === "\\") { if (i + 1 === idx) return true; if (c[i + 1] !== "\n") ws = false; i += 2; continue; } // \<<X = 글자 <, heredoc 아님(리뷰)
    if (ch === "'" || (ch === "$" && c[i + 1] === "'")) { const ansi = ch === "$"; i += ansi ? 2 : 1; while (i < c.length && c[i] !== "'") { if (i >= idx) return true; i += ansi && c[i] === "\\" ? 2 : 1; } i++; ws = false; continue; }
    if (ch === '"') { // "…" 안의 $(…)는 명령 자리(git commit -m "$(cat <<'EOF' …)") — 그 안은 따옴표 아님
      i++; let sub = 0;
      while (i < c.length && (c[i] !== '"' || sub > 0)) {
        if (i >= idx) return sub === 0;
        if (c[i] === "$" && c[i + 1] === "(") { sub++; i += 2; continue; }
        if (c[i] === ")" && sub > 0) { sub--; i++; continue; }
        i += c[i] === "\\" ? 2 : 1;
      }
      i++; ws = false; continue;
    }
    ws = /[ \t\n;|&]/.test(ch); i++; // bash의 공백은 띄어쓰기·탭·줄바꿈만(NBSP 등은 글자)
  }
  return false;
}
// 따옴표·백슬래시를 셸처럼 걷어낸 원문 — Crew API 주소 감추기 검사용. (`git "push"`·`su""do`·`pu\sh`·`$'push'`처럼 명령 이름을 꾸민 건 아래에서 hold)
const unquote = (raw: string) => raw.replace(/\$'/g, "'").replace(/\\(.)/g, "$1").replace(/["']/g, "");
// 경로 인자가 worktree 밖(~·$·절대·..)인가
const outside = (worktree: string, p: string) => /^~|\$/.test(p) || !inside(worktree, p);
// #1159 worktree 안이어도 쓰면 안 되는 것 — 다음 역할 시작·사람의 git·npm이 샌드박스 없이 읽고 실행(훅·MCP 서버·설정)
const PROTECTED_DIRS = new Set([".git", ".claude", ".codex", ".cursor", ".vscode", ".husky", ".githooks"]);
const PROTECTED_FILES = new Set([".mcp.json", ".npmrc", ".yarnrc", ".yarnrc.yml", ".envrc"]);
// 쓰기 판정 — 글자상 밖이거나, 실제 경로(링크 따라감)가 밖이거나, 보호 파일이면 안 됨
function unsafeWrite(worktree: string, p: string): boolean {
  if (outside(worktree, p)) return true;
  const real = realish(resolve(worktree, p)), realWt = realish(worktree);
  if (!under(real, realWt)) return true; // worktree 안 링크(끊긴 것도)가 ~/.zshrc 등을 가리킴
  // 보호 이름 — 글자 경로와 실제 경로 둘 다(링크 hooks-link → .git/hooks, 리뷰), 대소문자 무시(.Git·.Claude)
  for (const rel of [relative(worktree, resolve(worktree, p)), relative(realWt, real)]) {
    const segs = rel.split(sep).map((x) => x.toLowerCase());
    if (segs.some((x) => PROTECTED_DIRS.has(x)) || PROTECTED_FILES.has(segs[segs.length - 1])) return true;
  }
  return false;
}

function bashDecision(raw: string, worktree: string): Inner {
  // Mustard Crew API를 에이전트가 직접 부르기(권한 허락 등) = 차단 — 따옴표로 쪼개 감춰도(리뷰)
  if (/\/api\/crew\b/.test(unquote(raw))) return "deny";
  if (/[^\S \t\n]|[\0-\x08\x0e-\x1f\x7f]/.test(raw)) return DENY_RE.test(raw) ? "deny" : "hold"; // CR·NBSP·전각 공백·NUL 등 제어 문자 — JS와 bash가 띄어쓰기로 보는 게 달라 판정이 어긋남(리뷰)
  const cmd = strip(raw);
  if (cmd === null) return DENY_RE.test(raw) ? "deny" : "hold"; // 명령 치환 등 — 실제로 실행되는 코드가 숨어 있음
  if (DENY_RE.test(cmd)) return "deny";
  if (shellSecret(raw, worktree)) return "hold"; // #1159 비밀 경로 읽기·복사·홈 통째 훑기(따옴표·옵션 값·상대 경로도) — 금지 판정 다음
  const c = cmd.replace(/\d*>&\d+/g, " "); // 2>&1 같은 연결은 나누기 전에 걷어냄
  if (/[(){}]/.test(c)) return "hold"; // 서브셸·그룹·함수
  // 리다이렉트로 쓰기 — worktree 밖(~·$ 포함)이면 hold
  const outRedirect = [...c.matchAll(/(?:&?>{1,2}&?|>\|)\s*([^\s|&;]+)/g)].map((m) => m[1]); // >&파일 = 출력·에러를 파일로(리뷰)
  if (outRedirect.some((p) => p !== "/dev/null" && (p.includes("§") || unsafeWrite(worktree, p)))) return "hold"; // 따옴표 경로는 확인 불가
  let res: Inner = "allow";
  // 연결(&&, ||, ;, |, &, 줄바꿈) 단위로 나눠 각 부분 확인
  for (const part of c.split(/&&|\|\||[;|&\n]/)) {
    const all = part.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    for (; i < all.length && /^\w+=/.test(all[i]); i++) if (!SAFE_ENV.test(all[i].slice(0, all[i].indexOf("=")))) return "hold";
    const words = all.slice(i), w0 = words[0];
    if (!w0) continue;
    if (!/^[\w./-]+$/.test(w0)) return "hold"; // 따옴표·변수·백슬래시로 꾸민 명령 이름(su""do → su§do)
    const base = w0.split("/").pop()!;
    if (HOLD_CMD.has(base)) return "hold";
    const args = words.slice(1).filter((a) => !a.startsWith("-"));
    const writes = WRITERS.has(base) && (base !== "sed" || words.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))); // sed는 -i일 때만 씀
    // sed는 첫 인자 = 스크립트 → 빼고 파일만. -i 바로 뒤에 §가 둘이면 앞 것 = 백업 접미사(macOS -i '') → 그것도 뺌(리뷰: 접미사 없을 때 파일이 빠지던 것)
    const sedArgs = (() => { const w = words.slice(1); const k = w.findIndex((a) => /^-[a-zA-Z]*i$/.test(a)); return k >= 0 && w[k + 1] === "§" && w[k + 2] === "§" ? [...w.slice(0, k + 1), ...w.slice(k + 2)] : w; })();
    const files = base !== "sed" ? args : (words.some((a) => /^(-e|--expression|-f)/.test(a)) ? sedArgs.filter((a) => !a.startsWith("-")) : sedArgs.filter((a) => !a.startsWith("-")).slice(1));
    if (writes && files.some((a) => a.includes("§") || unsafeWrite(worktree, a))) return "hold"; // 따옴표 경로는 확인 불가 → 사람
    if (base === "cd" && words[1] && (words[1].includes("§") || outside(worktree, words[1]) || !under(realish(resolve(worktree, words[1])), realish(worktree)))) return "hold"; // 링크 폴더로 cd(리뷰)
    if (base === "find" && words.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fls)/.test(a))) return "hold"; // -fprint0·-fprintf·-fls = 파일로 씀
    // 다른 명령을 대신 실행하는 옵션 — 안전한 명령에 붙여 금지 명령을 돌림(git grep -O'sh -c "git push"', rg --pre, sort --compress-program, 리뷰)
    if (words.slice(1).some((a) => /^(-O|--open-files-in-pager|--pre(=|$)|--pre-glob|--compress-program|--exec|--command)/.test(a))) return "hold";
    // 인터프리터 — 인라인 코드(-e0·--eval=·--import·--require), 파이프·heredoc으로 받은 코드(스크립트 파일 없음)는 사람(리뷰)
    if (/^(node|bun|deno|python3?|tsx|ts-node)$/.test(base)) {
      if (words.slice(1).some((a) => /^(-[epcr]|--eval|--print|--import|--require|--loader|--experimental-loader|eval$)/.test(a)) || /<</.test(part)) return "hold";
      if (!args.length && !words.some((a) => /^(--test|--version|-v|-V|--help)$/.test(a))) return "hold";
    }
    if (base === "npx" && (!SAFE_NPX.has(words.find((a, k) => k > 0 && !a.startsWith("-")) ?? "") || words.some((a) => /^(-p|--package)/.test(a)))) return "hold";
    if (/^(npm|pnpm|yarn|bun)$/.test(base) && /^(publish|exec|x|dlx|unpublish|login|adduser|token|owner|access|global)$/.test(words[1] ?? "")) return "hold";
    if (/^(npm|pnpm|yarn|bun)$/.test(base) && words.some((a) => /^(-g|--global|--location=global)$/.test(a))) return "hold"; // 전역 설치 = 밖에 쓰기 + 설치 스크립트
    // 결과를 파일로 쓰는 옵션(sort -o, git diff --output=, mv --target-directory= …) — 사람(리뷰)
    if (words.some((a) => /^(--output|--target-directory|--out-file)\b/.test(a)) || ((base === "sort" || base === "tree") && words.includes("-o")) || (base === "uniq" && args.length > 1)) return "hold";
    // sed 스크립트의 w(파일 쓰기)·e(실행) — 따옴표 안이라 원문에서 확인(리뷰)
    if (base === "sed" && [...raw.matchAll(/'([^']*)'|"([^"]*)"/g)].some((m) => /(^|[;\s}!$\d,\/])[wW]\s+\S|\/[gpiImM0-9]*w\s+\S|(^|[;\s}!$\d,])e(\s|;|$)/.test(m[1] ?? m[2] ?? ""))) return "hold"; // 주소(1w·$w)·s///w 포함
    if (base === "git") {
      const sub = words[1] ?? "";
      if (sub && !/^[a-z][a-z-]*$/.test(sub)) return "hold"; // -c·-C·변수 — 설정 주입·우회
      // 옵션 순서를 바꾼 파괴적 git(reset HEAD --hard, clean -d -f, checkout -B main) — 정규식은 붙은 순서만 봄(리뷰)
      const rest = words.slice(2);
      if (sub === "reset" && rest.includes("--hard")) return "deny";
      if (sub === "clean" && rest.some((a) => /^(-[a-zA-Z]*f|--force)$/.test(a))) return "deny";
      if ((sub === "checkout" || sub === "switch") && rest.some((a) => /^(main|master)$/.test(a))) return "deny";
      if (sub === "branch" && rest.some((a) => /^(-[a-zA-Z]*[dDfmMcC]|--(delete|force|move|copy))$/.test(a))) return "hold";
      if (sub && !SAFE_GIT.has(sub)) res = "ask";
      continue;
    }
    if (!SAFE_CMD.has(base)) res = "ask";
  }
  return res;
}

export function decide(tool: string, input: Record<string, unknown>, worktree: string): Decision {
  const d = decideBase(tool, input, worktree);
  return d === "hold" ? "ask" : d;
}

// #1137 Codex·OpenCode(SNA 승인 흐름) 요청 → 정책 입력. Codex는 shell 명령을 `/bin/zsh -lc '…'`로 감싸 보냄 → 벗겨서 Bash로 판정.
// 플래그 조합(-ilc, -l -c, -ec)도. 못 벗기면 원문 그대로 → 첫 단어가 셸이라 hold(사람).
export function fromAgentRequest(req: Record<string, unknown>): { tool: string; input: Record<string, unknown> } {
  const tool = String(req.tool_name ?? req.tool ?? "");
  // 배열 꼴 ["/bin/zsh","-lc","npm test"] — 셸 + -…c 플래그면 마지막 = 명령(합치면 포장을 못 벗김, 리뷰)
  const arr = Array.isArray(req.command) ? req.command.map(String) : null;
  if (arr && arr.length >= 3 && /(^|\/)(zsh|bash|sh)$/.test(arr[0]) && arr.slice(1, -1).every((a) => /^-[a-zA-Z]+$/.test(a)) && /c$/.test(arr[arr.length - 2]) && /^(shell|exec|exec_command|bash|Bash|local_shell)$/.test(String(req.tool_name ?? req.tool ?? ""))) return { tool: "Bash", input: { command: arr[arr.length - 1] } };
  const command = typeof req.command === "string" ? req.command : arr ? arr.join(" ") : "";
  if (!command || !/^(shell|exec|exec_command|bash|Bash|local_shell)$/.test(tool)) return { tool, input: req };
  const m = /^\s*(?:\/usr)?(?:\/bin\/)?(?:zsh|bash|sh)\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c\s+(?:'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)")\s*$/.exec(command);
  const inner = m ? (m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2].replace(/\\(["\\$`])/g, "$1")) : command;
  return { tool: "Bash", input: { command: inner } };
}

// Codex apply_patch — 바꾸는 파일들(*** Add/Update/Delete File: 경로, *** Move to: 경로)
const patchPaths = (input: Record<string, unknown>) => [...String(input.patch ?? input.input ?? input.command ?? "").matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)].map((m) => m[1].trim());

function decideBase(tool: string, input: Record<string, unknown>, worktree: string): Inner {
  if (tool === "WebFetch") return "hold"; // 밖으로 데이터를 실어 보낼 수 있음(?d=비밀) — 사람(리뷰)
  // 사용자 MCP — 서버까지 맞춘 알려진 읽기 도구만 자동, 나머지는 사람. 이름 단어로 읽기·쓰기를 가르는 건 매번 빠짐(리뷰: query_sql·fetch_url·eval_code)
  if (tool.startsWith("mcp__")) return MCP_READ_NAMES.test(tool) ? "allow" : "hold";
  if (toolSecret(tool, input, worktree)) return "hold"; // #1159 경로 있는 읽기 — 비밀·홈 통째면 사람(링크·상대 경로·대소문자도)
  if (READ_TOOLS.has(tool)) return "allow";
  if (EDIT_TOOLS.has(tool)) {
    const p = String(input.file_path ?? input.notebook_path ?? input.path ?? "");
    return p && !unsafeWrite(worktree, p) ? "allow" : "hold"; // worktree 밖·링크로 밖·보호 파일 수정 = 사람(셸 설정·자동 실행 파일 보호)
  }
  if (tool === "apply_patch") { const ps = patchPaths(input); return ps.length && ps.every((p) => !unsafeWrite(worktree, p)) ? "allow" : "hold"; }
  if (tool === "Bash") return bashDecision(String(input.command ?? ""), worktree);
  return "hold"; // 모르는 도구 — 사람
}

// #1137 Crew API는 같은 출처(앱 화면)에서만 — 다른 사이트가 폼 POST로 카드를 만들거나 권한을 허락하지 못하게(리뷰). 브라우저 밖 호출은 샌드박스 이슈에서
// #1159 강화 — Sec-Fetch-Site가 없으면(옛 브라우저·일부 웹뷰) Origin이 이 서버와 같은지, 그리고 POST는 JSON만:
// 폼·text/plain 같은 '단순 요청'은 사전 확인 없이 다른 사이트에서 보낼 수 있지만 application/json은 사전 확인(CORS)이 막음.
// 브라우저 밖 호출(Origin·Sec-Fetch-Site 둘 다 없음, 예: 로컬 스크립트)은 통과 — 그건 이 검사의 대상이 아님.
export const crossSite = (req: Request) => {
  const s = req.headers.get("sec-fetch-site");
  if (s && s !== "same-origin" && s !== "none") return true;
  const o = req.headers.get("origin");
  if (!s && o && o !== "null") { try { if (new URL(o).host !== req.headers.get("host")) return true; } catch { return true; } }
  if (!s && o === "null") return true; // 샌드박스 iframe·file:// 등 출처 숨긴 요청
  return req.method !== "GET" && req.method !== "HEAD" && !/^application\/json\b/i.test(req.headers.get("content-type") ?? "");
};

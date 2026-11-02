// Crew 도구 권한 정책(#1100) — Claude 역할 세션의 PreToolUse 훅이 Mustard 서버에 묻고, 여기서 결정. 순수 모듈(점검 가능).
// 원칙(에픽 자율 4단계): worktree 안 읽기·수정·테스트·커밋 = 자동 허락 / push·머지·파괴적 git = 차단 / 그 밖 = 사람에게 묻기(카드 '나 필요').
// 경계(#1159 리뷰): 글자 규칙이라 '명령 글자'만 봄. worktree 파일을 실행하는 것(npm test의 package.json 스크립트·make·node x.js)은
// 그 안에 숨긴 git push·API 호출을 못 봄 — 진짜 막는 건 OS 샌드박스·서버 쪽 인증(#1157 보류, Crew API 토큰은 #1161).
// #1279 유저가 켠 항목(처음 보는 명령·코드 실행 등)은 경로 인자를 모름 — tar -C ~/x·unzip -d ~·node -e 조립 경로처럼 밖에 쓰는 것도 통과(한계, 설정 화면 문구에 명시).
// 비밀 파일은 '이름·경로'로만 잡음 — 이름을 안 대는 내용 검색(grep -r PRIVATE . 이 id_rsa·credentials.json 안까지)은 못 막음.
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { lstatSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { timingSafeEqual } from "node:crypto";
import type { CrewPermCat, CrewPerms } from "./crewTypes.ts";

export type Decision = "allow" | "deny" | "ask";

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "TodoRead", "ToolSearch", "WebSearch", "WebFetch", "Task", "Agent", "BashOutput", "KillShell", "ExitPlanMode", "Skill"]); // Skill = 지침 불러오기(실행은 그 뒤 도구가 따로 판정)
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
// 항상 막는 git·파괴 명령(규약·disallowedTools와 같은 목록 + 위험 rm)
const DENY_RE = /\bgit\b(?:\s+-{1,2}[\w.-]+(?:[ =]\S+)?)*\s+(push|merge|rebase|reset\s+--hard|branch\s+-[dD]|worktree\s+(remove|prune)|clean\s+-[a-z]*f|checkout\s+(main|master)\b|switch\s+(main|master)\b)(?![\w-])|\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)\/?(\s|$)|\bsudo\b/;
// sed는 뺌(#1159) — w·e·r 명령, $'…'·변수·heredoc으로 쓰기·셸 실행을 숨기는 길이 끝없어 글자로 못 막음(리뷰 5번) → 항상 사람. 파일 수정은 Edit·apply_patch로.
// 자동 허락하는 명령의 첫 단어(파이프·연결 각 부분이 전부 이 목록이어야 함)
const SAFE_CMD = new Set(["git", "npm", "pnpm", "yarn", "bun", "npx", "node", "tsc", "eslint", "prettier", "vitest", "jest", "pytest", "python", "python3", "go", "cargo", "make",
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "awk", "sort", "uniq", "diff", "echo", "printf", "pwd", "mkdir", "touch", "cp", "mv", "test", "true", "which", "jq", "tree", "cd"]);
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
// 레포(worktree) 안 비밀 파일 — 이름으로(유저 결정 10-23: 읽기도 묻기). .env.example·.sample·.template은 예시라 괜찮음.
const PROJECT_SECRET = /(^|[\s/"'=:(@])(\.env(?!\.(example|sample|template|dist)\b)(\.[\w.-]+)?|[\w.-]+\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|\.netrc|\.npmrc|\.pypirc|credentials\.json|service-account[\w.-]*\.json)(?=$|[\s"';|&)<>*?])/i; // 끝에 와일드카드(.env*)도
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
  if (realish(a) === sep && a !== sep) return true; // 링크 사슬 너무 김 = 판정 포기 → 비밀로(읽기도 막는 쪽, 리뷰)
  return [a, realish(a)].some((x) => secrets().some((d) => under(x, d)) && !excepts().some((e) => under(x, e)));
}
// 홈(또는 그 위)을 통째로 — grep -r ../../../../ 처럼 비밀 폴더까지 훑음(리뷰)
const coversHome = (p: string, base: string) => { const a = resolve(base, expandHome(p)); return [a, realish(a)].some((x) => homes().some((h) => under(h, x))); };
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 셸 글자에서 비밀 경로(~/.ssh·$HOME/.ssh·/Users/me/.ssh) — 자기 worktree 절대 경로는 비밀 아님
const SECRET_TEXT = new RegExp(`(?:~|\\$\\{?HOME\\}?|${esc(HOME)})/(?:${SECRET_REL.map((d) => esc(d) + (d === ".nunopi" ? "(?!/worktrees(?:/|$))" : "")).join("|")})(?=$|[/\\s"'])`, FOLD ? "i" : "");
// 셸 명령 — 따옴표 걷은 글자를 빈칸·=·: 로 자른 조각 전부를 경로로 확인(따옴표 안·--opt=값·-f값도). cd 뒤 상대 경로(..)는 위치를 못 따라가 사람에게.
function shellSecret(raw: string, worktree: string): boolean {
  if (SECRET_TEXT.test(unquote(raw)) || SECRET_NAMES.test(unquote(raw)) || PROJECT_SECRET.test(unquote(raw))) return true; // 비밀 이름은 heredoc 본문까지
  raw = dropHeredocs(raw).c; // 경로 조각 검사는 본문 빼고 — cat > f <<'EOF' 로 쓰는 코드의 // 주석이 "/"(홈 통째)로 걸림(앱 확인)
  const text = unquote(raw);
  if (/(^|[\s/])\.[^\s/]*[*?[{]/.test(unquote(globOff(raw))) || /\$'[^']*\\(x|u|U|[0-7])/.test(raw)) return true; // .en?·.[e]nv·~/.a?s — 점 이름 와일드카드, $'\x65' 숨긴 글자(리뷰)
  if (/(^|[\s;&|(])cd(\s|$)/.test(text) && /(^|[\s/=])\.\.(\/|\s|$)/.test(text)) return true;
  for (let tok of text.split(/[\s=:,]+/)) {
    tok = tok.replace(/^-[A-Za-z]+(?=[./~$])/, ""); // -f../x 처럼 붙은 짧은 옵션 값
    if (!tok || tok.startsWith("-") || !/[/~]|^\.\.?$|^\$/.test(tok)) continue; // 경로처럼 생긴 것만
    if (isSecretPath(tok, worktree) || coversHome(tok, worktree)) return true;
  }
  return false;
}
// glob → 정규식(*·?·[..]·{a,b}) — 대표 비밀 파일 이름에 맞아떨어지는지 직접 시험(*.env·{.env,x}·.e[n]v·id_* 등, 리뷰)
// credentials.json·service-account.json은 이름 그대로일 때만(PROJECT_SECRET) — 표본에 넣으면 **/*.json 이 전부 걸림(리뷰)
const SECRET_SAMPLES = [".env", ".env.local", ".env.production", "id_rsa", "id_ed25519", "server.pem", "private.key", "cert.p12", "cert.pfx", "store.jks", "app.keystore", ".npmrc", ".netrc", ".pypirc", ".git-credentials"];
const reEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// glob 한 조각 → 정규식 본문. {a,b} 안의 각 갈래도 같은 규칙(* ? [..])으로(리뷰: {.en?,x})
function globRe(g: string): string {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") re += "[^/]*"; else if (c === "?") re += "[^/]";
    else if (c === "[") { const e = g.indexOf("]", i + 1); if (e < 0) { re += "\\["; continue; } re += "[" + g.slice(i + 1, e).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]"; i = e; }
    else if (c === "{") { const e = g.indexOf("}", i + 1); if (e < 0) { re += "\\{"; continue; } re += "(" + g.slice(i + 1, e).split(",").map(globRe).join("|") + ")"; i = e; }
    else re += reEsc(c);
  }
  return re;
}
// glob이 대표 비밀 파일 이름에 맞아떨어지는지 직접 시험(*.env·{.env,x}·.e[n]v·id_* 등, 리뷰)
function globHitsSecret(glob: string): boolean {
  const last = glob.split("/").pop() ?? glob;
  if (!/[*?[{]/.test(last)) return false;
  if (!last.replace(/[*?[\]{},.]/g, "")) return false; // 글자 없는 순수 와일드카드(*·**/*) = 이름 안 대는 내용 검색 — 받아들인 한계(경계 주석)
  try { const r = new RegExp(`^${globRe(last)}$`, FOLD ? "i" : ""); return SECRET_SAMPLES.some((n) => r.test(n)); } catch { return true; } // 못 읽는 패턴 = 막는 쪽
}
// 경로 있는 읽기 도구 — 도구마다 경로 칸이 다름(Grep pattern은 검색어라 제외, glob은 경로). 와일드카드 앞 고정 부분으로 판정.
const READ_PATH_FIELDS: Record<string, string[]> = { Read: ["file_path"], NotebookRead: ["notebook_path"], LS: ["path"], Glob: ["path", "pattern"], Grep: ["path", "glob"] };
function toolSecret(tool: string, input: Record<string, unknown>, worktree: string): boolean {
  for (const k of READ_PATH_FIELDS[tool] ?? []) {
    const v = input[k];
    if (typeof v !== "string" || !v) continue;
    if (SECRET_TEXT.test(v) || SECRET_NAMES.test(v) || PROJECT_SECRET.test(v) || globHitsSecret(v)) return true; // glob은 비밀 이름에 맞는지 직접(리뷰)
    const head = v.replace(/[*?[{].*$/, "");
    const stat = head === v ? v : head.replace(/[^/]*$/, "") || "."; // 와일드카드 있으면 그 조각 앞 폴더까지만(/Users/x/.s*/ → /Users/x/)
    if (isSecretPath(stat, worktree) || coversHome(stat, worktree)) return true;
  }
  return false;
}

const inside = (dir: string, p: string) => { const r = relative(dir, resolve(dir, p)); return !!dir && !r.startsWith("..") && !isAbsolute(r); };

// #1137 사람에게(hold) — 셸·코드 실행·네트워크·권한·지속성. 'ask'와 같지만 이유를 구분해 둠(샌드박스 위 '전부 알아서'가 생겨도 이건 묻기).
// #1279 유저 설정 항목으로 옮긴 것(code·network·system) — 설정에서 '알아서 허용'이면 자동. 남은 HOLD_CMD = 권한 올리기·밖에 쓰기라 항상 사람.
const GH_READ = /^(issue|pr|run|release|repo|workflow|label) (list|view|status|diff|checks)$|^(status|search \w+)/;
const HOLD_CMD = new Set(["su", "doas", "chmod", "chown", "ln", "dd", "tee", "install", "sed", "gh", "security", "osascript", "defaults", "crontab", "launchctl", "ssh", "scp", "sftp", "rsync", "nc", "ncat", "socat"]); // gh = pr merge·토큰 출력, security = 키체인, osascript·defaults·crontab·launchctl = 임의 실행·지속(리뷰)
const CMD_CAT: Record<string, CrewPermCat> = Object.fromEntries([
  ...["sh", "bash", "zsh", "fish", "dash", "ksh", "eval", "exec", "env", "xargs", "source", ".", "perl", "ruby", "php", "awk", "gawk"].map((c) => [c, "code"]),
  ...["curl", "wget"].map((c) => [c, "network"]), // ssh·scp·rsync·nc·socat은 설정·원격 셸·로컬 실행 옵션이 끝없어 항상 사람(리뷰 4회)
  ...["open", "kill", "killall", "pkill"].map((c) => [c, "system"]),
]);
const SAFE_NPX = new Set(["tsc", "eslint", "prettier", "vitest", "jest", "tsx", "playwright", "next"]); // npx는 모르는 패키지를 받아 실행 → 이것만
const SAFE_ENV = /^(CI|NODE_ENV|FORCE_COLOR|NO_COLOR|TZ|LANG|LC_\w+|DEBUG|PORT|TERM)$/; // 앞에 붙는 VAR=값 중 허용(GIT_*·PATH·NODE_OPTIONS 등은 코드 실행 통로)
const WRITERS = new Set(["cp", "mv", "touch", "mkdir", "rm", "rmdir"]); // 경로 인자를 씀 → worktree 밖이면 hold
type Inner = Decision | "hold" | CrewPermCat[]; // 배열 = 그 항목들 때문에 묻기(#1279 — 전부 유저가 허용한 항목이면 자동)
// 자동 허락하는 MCP 도구(서버 이름까지) — Mustard 코드 그래프·인앱 브라우저 읽기, Loom 기억 읽기. 그 밖은 사람(크루가 쓰면 그때 추가)
const MCP_READ_NAMES = /^mcp__mustard__(katchup_(check_freshness|file_api|find_all|find_code|repo_map|search|trace_calls)|browser_(read|console|status|screenshot))$|^mcp__plugin_loom-memory_loom(-memory)?__memory_(search|read|status)$/;

// 판단 전에 걷어내기(실사용 오탐 — node -e "…", git commit -m "$(cat <<'EOF' …)", cat >> f <<'EOF' …):
// ① heredoc 본문 → <<H  ② 명령 치환은 `cat <<H`만 허용(그 밖은 실제 실행되는 코드라 null = 묻기)  ③ 따옴표 안 글자 → §
// heredoc 본문 → <<H. bad = 따옴표 없는 본문에 $(…)(실행됨)
function dropHeredocs(cmd: string): { c: string; bad: boolean } {
  let bad = false;
  const c = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\s*(?=\n|$)/g, (m, q, _w, body, at: number) => {
    if (quoteStateAt(cmd, at)) return m; // 따옴표·주석 안의 "<<X"는 heredoc 아님 — 지우면 다음 줄 명령이 감춰짐(리뷰)
    if (!q && /\$\(|`/.test(body)) bad = true; // 따옴표 없는 heredoc은 본문의 $(…)도 실행됨(리뷰)
    return m.slice(0, m.indexOf("\n")).replace(/<<-?\s*(['"]?)\w+\1/, "<<H");
  });
  return { c, bad };
}
function strip(cmd: string): string | null {
  const { c, bad } = dropHeredocs(cmd);
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
// %xx 풀기(여러 겹도) — 못 풀면 원문(그래도 원문 검사는 따로 함)
const pctDecode = (t: string) => { let x = t; for (let i = 0; i < 3; i++) { try { const y = decodeURIComponent(x); if (y === x) break; x = y; } catch { break; } } return x; };
const unquote = (raw: string) => raw.replace(/\$'/g, "'").replace(/\\(.)/g, "$1").replace(/["']/g, "");
// 경로 인자가 worktree 밖(~·$·절대·..)인가
// cd 허용 범위 — 같은 레포의 다른 크루 작업 폴더(<base>/<레포>/<id>)까지. 앞 카드 브랜치를 보러 자주 감(앱 확인)
//  한계: cd 뒤 상대 경로 쓰기는 여전히 자기 폴더 기준으로 판정(이름 기반 보호 폴더·밖 경로는 그대로 걸림)
const crewRoom = (wt: string) => (/[/\\]worktrees[/\\][^/\\]+[/\\][^/\\]+[/\\]?$/.test(wt) ? resolve(wt, "..") : wt);
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

// #1279 인터넷 항목으로 자동 허락하는 curl·wget — 아는 옵션만(허용 목록). 모르는 옵션·따옴표로 꾸민 옵션(-"K")·파일 올리기(@)·
//  밖·보호 경로 저장·받은 이름 그대로 저장(-O, 보호 파일 .mcp.json 등)이면 사람. 옵션을 쫓아 막는 방식은 리뷰마다 새 우회가 나와서 뒤집음.
const CURL_FLAGS = /^-[sSLfiIkv]+$/;
const CURL_VAL = new Set(["-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--json", "-w", "--write-out", "-o", "--output", "-m", "--max-time", "--connect-timeout", "--retry", "-u", "--user", "-A", "--user-agent", "--compressed"]);
const WGET_FLAGS = new Set(["-q", "--quiet", "-nv", "--no-verbose", "-c", "--continue"]);
const WGET_VAL = new Set(["-O", "--output-document", "-T", "--timeout", "-t", "--tries"]);
// 따옴표 벗긴 원문에서 그 명령 뒤 인자들(다음 연결 기호 전까지). 한 줄에 같은 명령이 여러 번이면 전부 합쳐 봄(안전한 쪽)
// 따옴표 밖의 ;|&() 앞뒤에 공백 — "a;b" 안은 그대로(안을 자르면 뒤 옵션이 검사에서 빠짐, 리뷰)
function spaceOps(raw: string): string {
  let out = "", q = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (q === "$") { if (ch === "\\") { out += ch + (raw[i + 1] ?? ""); i++; continue; } if (ch === "'") q = ""; out += ch; continue; } // $'…' 안은 \'가 글자(리뷰)
    if (ch === "\\" && q !== "'") { const n = raw[i + 1] ?? ""; out += !q && /[;|&()]/.test(n) ? "§" : ch + n; i++; continue; } // 따옴표 밖 \; = 글자 — unquote가 맨 ;로 바꾸지 않게(리뷰)
    if (q) { if (ch === q) q = ""; out += ch; continue; }
    if (ch === "$" && raw[i + 1] === "'") { q = "$"; out += "$'"; i++; continue; }
    if (ch === "'" || ch === '"') { q = ch; out += ch; continue; }
    out += /[;|&()]/.test(ch) && !(ch === "&" && /[<>]/.test(`${raw[i - 1] ?? ""}${raw[i + 1] ?? ""}`)) ? ` ${ch} ` : ch; // 2>&1·&> 의 &는 리다이렉트(리뷰)
  }
  return out;
}
// 따옴표 안·\ 뒤의 *?[{ → _ — 셸이 펼치지 않는 글자(grep "^lib/.*//" 정규식이 .* 점 이름 와일드카드로 걸림, 앱 확인)
function globOff(raw: string): string {
  let out = "", q = "";
  const g = (ch: string) => (/[*?[{]/.test(ch) ? "_" : ch);
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (q === "$") { if (ch === "\\") { out += ch + g(raw[i + 1] ?? ""); i++; continue; } if (ch === "'") q = ""; out += g(ch); continue; }
    if (ch === "\\" && q !== "'") { out += ch + g(raw[i + 1] ?? ""); i++; continue; }
    if (q) { if (ch === q) q = ""; out += g(ch); continue; }
    if (ch === "$" && raw[i + 1] === "'") { q = "$"; out += "$'"; i++; continue; }
    if (ch === "'" || ch === '"') q = ch;
    out += ch;
  }
  return out;
}
function rawArgs(raw: string, base: string): string[] {
  const out: string[] = []; let on = false;
  for (const t of unquote(spaceOps(raw)).split(/\s+/)) { // ls;curl·(curl 처럼 붙여 쓴 구분자도 끊음
    if (/^(\||&&|\|\||;|&|\(|\))$/.test(t)) { on = false; continue; }
    if (on) out.push(t);
    else if (t.split("/").pop() === base) on = true;
  }
  return out;
}
function plainFetch(base: string, args: string[], worktree: string): boolean {
  for (let i = 0; i < args.length; i++) {
    let a = args[i], v: string | undefined;
    if (!a.startsWith("-")) { if (base === "wget" && /\/\.[^/§]*$/.test(a)) return false; continue; } // 주소(따옴표 § 포함 가능). wget이 점 이름(.mcp.json)으로 저장하면 사람
    if (a === "--compressed" || (base === "curl" ? CURL_FLAGS.test(a) : WGET_FLAGS.has(a))) continue;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) { v = a.slice(eq + 1); a = a.slice(0, eq); }
    const cl = base === "curl" ? /^-[sSLfiIkv]*([oXHdwmuA])(.*)$/.exec(a) : null; // 묶음·붙여 쓰기: -sSo out.json, -fsSLo x, -oout.json
    if (cl) { a = `-${cl[1]}`; v = cl[2] || undefined; }
    if (!(base === "curl" ? CURL_VAL : WGET_VAL).has(a)) return false;
    if (v === undefined) v = args[++i];
    if (v === undefined) return false;
    if (/^(-d|--data|--data-raw|--data-binary|--json|-H|--header|-w|--write-out)$/.test(a) && v.startsWith("@")) return false; // 파일 읽어 올리기·헤더·출력(리뷰)
    if (/^(-o|--output|-O|--output-document)$/.test(a)) { if (v !== "/dev/null" && v !== "-" && (v.includes("§") || unsafeWrite(worktree, v))) return false; }
  }
  return true;
}

// sed 스크립트 하나 — 출력(N,Mp·/re/,/re/p) 또는 치환(s/…/…/ 플래그 g·I·p·숫자만: w·e 없음). 따옴표 스크립트는 원문에 sed가 하나일 때 원문으로 확인
const SED_ADDR = String.raw`(\d+|\$|/(?:\\[^\n]|[^/\n\\])*/)`;
const SED_PRINT = new RegExp(`^${SED_ADDR}(,${SED_ADDR})?p$`);
const SED_SUB = /^s([^\w\s\\])(?:\\[^\n]|(?!\1)[^\n\\])*\1(?:\\[^\n]|(?!\1)[^\n\\])*\1[gIp0-9]*$/;
function sedOk(words: string[], raw: string, worktree: string): boolean {
  const opts = words.slice(1).filter((a) => a.startsWith("-"));
  if (opts.some((o) => !/^-[niEr]$/.test(o))) return false; // -i.bak·-f 파일·-e 여러 개 등은 사람
  const inPlace = opts.includes("-i");
  let rest = words.slice(1).filter((a) => !a.startsWith("-"));
  if (inPlace && rest[0] === "§" && /\s-i\s+(''|"")(\s|$)/.test(raw)) rest = rest.slice(1); // BSD sed -i '' = 백업 없음
  const [script, ...files] = rest;
  const ok = (x: string) => SED_PRINT.test(x) || SED_SUB.test(x);
  let scriptOk = false;
  if (script === "§") {
    const m = (raw.match(/(^|[^\w./-])sed\s/g) ?? []).length === 1 ? raw.match(/(?:^|[^\w./-])sed\s+(?:(?:-[niEr]|''|"")\s+)*(['"])((?:(?!\1)[^\n])*)\1(?=\s|$)/) : null;
    scriptOk = !!m && !(m[1] === '"' && /[$`]/.test(m[2])) && ok(m[2]); // "…" 안 $·` 는 펼쳐짐
  } else if (script) scriptOk = !/\$[\w{]/.test(script) && ok(script);
  if (!scriptOk || (inPlace && !files.length)) return false;
  return files.every((f) => !/^-|§/.test(f) && (inPlace ? !unsafeWrite(worktree, f) : !outside(worktree, f)));
}
function bashDecision(raw0: string, worktree: string): Inner {
  const raw = raw0.replace(/\\\n/g, ""); // 줄 이어 쓰기(\ + 줄바꿈)는 bash가 지움 — 먼저 붙여서 판정(s\⏎ed → sed, 리뷰)
  // Mustard Crew API를 에이전트가 직접 부르기(권한 허락 등) = 차단 — 따옴표로 쪼개 감춰도(리뷰)
  if (/\/api\/crew\b/.test(unquote(raw)) || /\/api\/crew\b/i.test(pctDecode(raw))) return "deny"; // %61pi·api%2Fcrew 같은 인코딩도(리뷰)
  if (/[^\S \t\n]|[\0-\x08\x0e-\x1f\x7f]/.test(raw)) return DENY_RE.test(raw) ? "deny" : "hold"; // CR·NBSP·전각 공백·NUL 등 제어 문자 — JS와 bash가 띄어쓰기로 보는 게 달라 판정이 어긋남(리뷰)
  const cmd = strip(raw);
  if (cmd === null) return DENY_RE.test(raw) ? "deny" : "hold"; // 명령 치환 등 — 실제로 실행되는 코드가 숨어 있음
  if (DENY_RE.test(cmd)) return "deny";
  if (shellSecret(raw, worktree)) return "hold"; // #1159 비밀 경로 읽기·복사·홈 통째 훑기(따옴표·옵션 값·상대 경로도) — 금지 판정 다음
  const c = cmd.replace(/\d*>&\d+/g, " ").replace(/@\{[\w.-]*\}/g, "@u"); // 2>&1 같은 연결은 나누기 전에 걷어냄. @{u}·HEAD@{1} = git 이름(그룹 아님)
  if (/[{}]/.test(c)) return "hold"; // 그룹·함수 — {a,b} 펼치기가 인자 경로 검사를 비켜 감
  // 리다이렉트로 쓰기 — worktree 밖(~·$ 포함)이면 hold
  const outRedirect = [...c.matchAll(/(?:&?>{1,2}&?|>\|)\s*([^\s|&;]+)/g)].map((m) => m[1]); // >&파일 = 출력·에러를 파일로(리뷰)
  if (outRedirect.some((p) => p !== "/dev/null" && (p.includes("§") || unsafeWrite(worktree, p)))) return "hold"; // 따옴표 경로는 확인 불가
  const cats: CrewPermCat[] = [];
  // 연결(&&, ||, ;, |, &, 줄바꿈) 단위로 나눠 각 부분 확인. ( … ) 서브셸 괄호도 경계로 — 안의 명령을 하나씩 똑같이 봄(앱 확인: (flutter pub add … | tail)로 계속 멈춤)
  for (const part of c.split(/&&|\|\||[;|&\n()]/)) {
    const all = part.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    for (; i < all.length && /^\w+=/.test(all[i]); i++) if (!SAFE_ENV.test(all[i].slice(0, all[i].indexOf("=")))) return "hold";
    const words = all.slice(i), w0 = words[0];
    if (!w0) continue;
    if (!/^[\w./-]+$/.test(w0)) return "hold"; // 따옴표·변수·백슬래시로 꾸민 명령 이름(su""do → su§do)
    const base = w0.split("/").pop()!;
    // gh 읽기(이슈·PR·실행 보기)는 인터넷 항목 — 앱 확인에서 크루가 gh issue list로 계속 멈춤. 쓰기(pr merge·create·api·auth token 등)는 그대로 사람
    if (base === "gh" && GH_READ.test(`${words[1] ?? ""} ${words[2] ?? ""}`) && !words.some((a) => /^(--web(=|$)|-w$|-O|--pre|--exec|--output|--out-file)|(^|=)@/.test(a)) && !/(^|[\s=])@/.test(unquote(raw))) { cats.push("network"); continue; }
    // sed는 -i·w·e로 파일을 쓰거나 실행해서 고정 사람 — 줄 범위 출력(-n 125,135p)·치환(s/a/b/g, -i 포함)만 통과(앱 확인에서 계속 멈춤)
    if (base === "sed" && sedOk(words, raw, worktree)) continue;
    if (HOLD_CMD.has(base)) return "hold";
    // #1279 인터넷 항목 = 아는 옵션만 쓴 curl·wget. 따옴표를 벗긴 원문 토큰으로 봄 — "-o"·"@file"처럼 따옴표로 감싼 옵션·값도(리뷰)
    if ((base === "curl" || base === "wget") && !plainFetch(base, rawArgs(raw, base), worktree)) return "hold";
    if (base === "env" && /(^|\s)(-[a-zA-Z]*C|--chdir)/.test(unquote(raw))) return "hold"; // 다른 폴더에서 실행(리뷰)
    if (Object.hasOwn(CMD_CAT, base)) { cats.push(CMD_CAT[base]); continue; }
    const args = words.slice(1).filter((a) => !a.startsWith("-"));
    const writes = WRITERS.has(base), files = args;
    if (writes && files.some((a) => a.includes("§") || unsafeWrite(worktree, a))) return "hold"; // 따옴표 경로는 확인 불가 → 사람
    const dest = base === "cd" ? words.slice(1).find((a) => a !== "--" && !/^-[LPe@]+$/.test(a)) : undefined; // cd -P·cd -- = 목적지 없음 = 홈(리뷰)
    if (base === "cd" && (!dest || dest === "-" || dest.includes("§") || /\$/.test(dest) || !inside(crewRoom(worktree), expandHome(dest)) || !under(realish(resolve(worktree, expandHome(dest))), realish(crewRoom(worktree))))) return "hold"; // 링크 폴더로 cd(리뷰)
    if (base === "find" && words.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fls)/.test(a))) return "hold"; // -fprint0·-fprintf·-fls = 파일로 씀
    // 다른 명령을 대신 실행하는 옵션 — 안전한 명령에 붙여 금지 명령을 돌림(git grep -O'sh -c "git push"', rg --pre, sort --compress-program, 리뷰)
    if (words.slice(1).some((a) => /^(-O|--open-files-in-pager|--pre(=|$)|--pre-glob|--compress-program|--exec|--command)/.test(a))) return "hold";
    // 인터프리터 — 인라인 코드(-e0·--eval=·--import·--require), 파이프·heredoc으로 받은 코드(스크립트 파일 없음)는 사람(리뷰)
    if (/^(node|bun|deno|python3?|tsx|ts-node)$/.test(base)) {
      if (words.slice(1).some((a) => /^(-[epcr]|--eval|--print|--import|--require|--loader|--experimental-loader|eval$)/.test(a)) || /<</.test(part)) { cats.push("code"); continue; }
      if (!args.length && !words.some((a) => /^(--test|--version|-v|-V|--help)$/.test(a))) { cats.push("code"); continue; }
    }
    if (base === "npx" && (!SAFE_NPX.has(words.find((a, k) => k > 0 && !a.startsWith("-")) ?? "") || words.some((a) => /^(-p|--package)/.test(a)))) { cats.push("code"); continue; }
    if (/^(npm|pnpm|yarn|bun)$/.test(base) && /^(publish|exec|x|dlx|unpublish|login|adduser|token|owner|access|global)$/.test(words[1] ?? "")) { cats.push("publish"); continue; }
    if (/^(npm|pnpm|yarn|bun)$/.test(base) && words.some((a) => /^(-g|--global|--location=global)$/.test(a))) { cats.push("publish"); continue; } // 전역 설치 = 밖에 쓰기 + 설치 스크립트
    // 결과를 파일로 쓰는 옵션(sort -o, git diff --output=, mv --target-directory= …) — 사람(리뷰)
    if (words.some((a) => /^(--output|--target-directory|--out-file)\b/.test(a)) || ((base === "sort" || base === "tree") && words.includes("-o")) || (base === "uniq" && args.length > 1)) return "hold";
    // sed 스크립트의 w(파일 쓰기)·e(실행) — 따옴표 안이라 원문에서 확인(리뷰)
    if (base === "git") {
      const sub = words[1] ?? "";
      if (sub && !/^[a-z][a-z-]*$/.test(sub)) return "hold"; // -c·-C·변수 — 설정 주입·우회
      // 옵션 순서를 바꾼 파괴적 git(reset HEAD --hard, clean -d -f, checkout -B main) — 정규식은 붙은 순서만 봄(리뷰)
      const rest = words.slice(2);
      if (sub === "reset" && rest.includes("--hard")) return "deny";
      if (sub === "clean" && rest.some((a) => /^(-[a-zA-Z]*f|--force)$/.test(a))) return "deny";
      if ((sub === "checkout" || sub === "switch") && rest.some((a) => /^(main|master)$/.test(a))) return "deny";
      if (sub === "branch" && rest.some((a) => /^(-[a-zA-Z]*[dDfmMcC]|--(delete|force|move|copy))$/.test(a))) return "hold";
      if (sub && !SAFE_GIT.has(sub)) cats.push("git");
      continue;
    }
    if (!SAFE_CMD.has(base)) cats.push("unknownCmd");
  }
  return cats.length ? cats : "allow";
}

// perms = 유저 설정(#1279, 항목마다 true = 알아서 허용). 기본 {} = 전부 묻기(예전과 같음).
export function decide(tool: string, input: Record<string, unknown>, worktree: string, perms: CrewPerms = {}): Decision {
  const d = decideBase(tool, input, worktree);
  if (!Array.isArray(d)) return d === "hold" ? "ask" : d;
  if (!d.every((c) => perms[c] === true)) return "ask"; // 한 명령이 여러 항목이면 전부 허용일 때만
  // 항목 명령은 따옴표 안 명령을 못 봄(bash -c 'git push', npm exec -- sh -c …, ssh host "…") — 따옴표 벗긴 원문에 금지 명령이 보이면 사람(리뷰)
  // 한계: 코드 실행(node -e 'gi'+'t push', 스크립트 파일)은 글자로 못 막음 — 진짜 막는 건 OS 샌드박스(#1157). 켜기 전부터 node x.js로 같은 일이 됐음.
  if (DENY_RE.test(unquote(String(input.command ?? "")))) return "ask";
  return "allow";
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
  if ((tool === "WebFetch" || tool.startsWith("mcp__")) && /\/api\/crew\b/i.test(pctDecode(unquote(JSON.stringify(input ?? {}))))) return "deny"; // Crew API는 HTTP를 보낼 수 있는 도구로도 금지(Bash는 bashDecision). 파일 읽기·수정은 경로에 api/crew가 있어도 됨(리뷰)
  if (tool === "WebFetch") return ["network"]; // 밖으로 데이터를 실어 보낼 수 있음(?d=비밀) — 인터넷 항목(#1279, 기본 묻기)
  // 사용자 MCP — 서버까지 맞춘 알려진 읽기 도구만 자동, 나머지는 사람. 이름 단어로 읽기·쓰기를 가르는 건 매번 빠짐(리뷰: query_sql·fetch_url·eval_code)
  if (tool.startsWith("mcp__")) return MCP_READ_NAMES.test(tool) ? "allow" : ["mcp"]; // #1279 다른 MCP 항목(기본 묻기)
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
// #1161 브라우저 밖 호출(로컬 스크립트)은 헤더로 못 가림 → 앱 화면 비밀값: main이 앱 창 쿠키(mustard_ui)와 서버에만 주고
//  instrumentation이 서버 메모리로 옮겨 둠. 값이 있으면 쿠키가 같아야 통과(에이전트가 스크립트로 자기 권한을 승인하지 못하게).
//  dev(next dev 따로 기동)는 값이 없어 헤더 검사만(훅 토큰과 같은 규칙).
const fromAppWindow = (req: Request) => {
  const want = (globalThis as { __mustardUiToken?: string }).__mustardUiToken;
  if (want === undefined) return !process.env.MUSTARD_UI_TOKEN_FD; // dev(값 없음) 통과. 패키지 서버인데 아직 못 받았으면 막음(리뷰: 열린 채로 두지 않기)
  if (!want) return false; // 받기 실패 — 막음
  const got = /(?:^|;\s*)mustard_ui=([^;]*)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
};
export const crossSite = (req: Request) => {
  if (!fromAppWindow(req)) return true;
  const s = req.headers.get("sec-fetch-site");
  if (s && s !== "same-origin" && s !== "none") return true;
  const o = req.headers.get("origin");
  if (!s && o && o !== "null") { try { if (new URL(o).host !== req.headers.get("host")) return true; } catch { return true; } }
  if (!s && o === "null") return true; // 샌드박스 iframe·file:// 등 출처 숨긴 요청
  return req.method !== "GET" && req.method !== "HEAD" && !/^application\/json\b/i.test(req.headers.get("content-type") ?? "");
};

// Crew 도구 권한 정책(#1100) — Claude 역할 세션의 PreToolUse 훅이 Mustard 서버에 묻고, 여기서 결정. 순수 모듈(점검 가능).
// 원칙(에픽 자율 4단계): worktree 안 읽기·수정·테스트·커밋 = 자동 허락 / push·머지·파괴적 git = 차단 / 그 밖 = 사람에게 묻기(카드 '나 필요').
import { isAbsolute, relative, resolve } from "node:path";

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

const inside = (dir: string, p: string) => { const r = relative(dir, resolve(dir, p)); return !!dir && !r.startsWith("..") && !isAbsolute(r); };

// #1137 사람에게(hold) — 셸·코드 실행·네트워크·권한·지속성. 'ask'와 같지만 이유를 구분해 둠(샌드박스 위 '전부 알아서'가 생겨도 이건 묻기).
const HOLD_CMD = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "eval", "exec", "env", "xargs", "source", ".", "su", "doas", "perl", "ruby", "php", "osascript", "awk", "gawk",
  "ssh", "scp", "sftp", "rsync", "nc", "ncat", "socat", "curl", "wget", "open", "launchctl", "crontab", "defaults", "security", "chmod", "chown", "ln", "dd", "kill", "killall", "pkill", "gh", "tee", "install"]);
const SAFE_NPX = new Set(["tsc", "eslint", "prettier", "vitest", "jest", "tsx", "playwright", "next"]); // npx는 모르는 패키지를 받아 실행 → 이것만
const SAFE_ENV = /^(CI|NODE_ENV|FORCE_COLOR|NO_COLOR|TZ|LANG|LC_\w+|DEBUG|PORT|TERM)$/; // 앞에 붙는 VAR=값 중 허용(GIT_*·PATH·NODE_OPTIONS 등은 코드 실행 통로)
const WRITERS = new Set(["cp", "mv", "touch", "mkdir", "rm", "rmdir", "sed"]); // 경로 인자를 씀 → worktree 밖이면 hold
type Inner = Decision | "hold";

// 판단 전에 걷어내기(실사용 오탐 — node -e "…", git commit -m "$(cat <<'EOF' …)", cat >> f <<'EOF' …):
// ① heredoc 본문 → <<H  ② 명령 치환은 `cat <<H`만 허용(그 밖은 실제 실행되는 코드라 null = 묻기)  ③ 따옴표 안 글자 → §
function strip(cmd: string): string | null {
  let bad = false;
  let c = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\s*(?=\n|$)/g, (m, q, _w, body) => {
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
  let out = "", i = 0;
  while (i < c.length) {
    const ch = c[i];
    if (ch === "\\") { out += c[i + 1] === "\n" ? " " : "§"; i += 2; continue; } // 줄 이음은 띄어쓰기
    if (ch === "'" || (ch === "$" && c[i + 1] === "'")) {
      const ansi = ch === "$"; i += ansi ? 2 : 1;
      while (i < c.length && c[i] !== "'") i += ansi && c[i] === "\\" ? 2 : 1;
      if (i >= c.length) return null;
      i++; out += "§"; continue;
    }
    if (ch === '"') {
      i++;
      while (i < c.length && c[i] !== '"') i += c[i] === "\\" ? 2 : 1;
      if (i >= c.length) return null;
      i++; out += "§"; continue;
    }
    out += ch; i++;
  }
  return out;
}
// 따옴표·백슬래시를 셸처럼 걷어낸 원문 — Crew API 주소 감추기 검사용. (`git "push"`·`su""do`·`pu\sh`·`$'push'`처럼 명령 이름을 꾸민 건 아래에서 hold)
const unquote = (raw: string) => raw.replace(/\$'/g, "'").replace(/\\(.)/g, "$1").replace(/["']/g, "");
// 경로 인자가 worktree 밖(~·$·절대·..)인가
const outside = (worktree: string, p: string) => /^~|\$/.test(p) || !inside(worktree, p);

function bashDecision(raw: string, worktree: string): Inner {
  // Mustard Crew API를 에이전트가 직접 부르기(자동 모드 켜기·권한 허락) = 차단 — 따옴표로 쪼개 감춰도(리뷰)
  if (/\/api\/crew\b/.test(unquote(raw))) return "deny";
  const cmd = strip(raw);
  if (cmd === null) return DENY_RE.test(raw) ? "deny" : "hold"; // 명령 치환 등 — 실제로 실행되는 코드가 숨어 있음
  if (DENY_RE.test(cmd)) return "deny";
  const c = cmd.replace(/\d*>&\d+/g, " "); // 2>&1 같은 연결은 나누기 전에 걷어냄
  if (/[(){}]/.test(c)) return "hold"; // 서브셸·그룹·함수
  // 리다이렉트로 쓰기 — worktree 밖(~·$ 포함)이면 hold
  const outRedirect = [...c.matchAll(/(?:&?>{1,2}&?|>\|)\s*([^\s|&;]+)/g)].map((m) => m[1]); // >&파일 = 출력·에러를 파일로(리뷰)
  if (outRedirect.some((p) => p !== "/dev/null" && (p.includes("§") || outside(worktree, p)))) return "hold"; // 따옴표 경로는 확인 불가
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
    if (writes && files.some((a) => a.includes("§") || outside(worktree, a))) return "hold"; // 따옴표 경로는 확인 불가 → 사람
    if (base === "cd" && words[1] && (words[1].includes("§") || outside(worktree, words[1]))) return "hold";
    if (base === "find" && words.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint)/.test(a))) return "hold";
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
  // 사용자 MCP — 읽기 도구(get·list·search·read·find…)만 자동, 나머지(머지·편집·이동·전송…)는 사람(리뷰: 쓰기 동사 목록은 늘 빠짐 → 읽기 목록으로)
  if (tool.startsWith("mcp__")) return /(^|_)(get|list|search|read|find|fetch|view|query|recall|status|describe|show|lookup|overview|map|trace|check|screenshot|console)(_|$)/i.test(tool.split("__").pop() ?? "") ? "allow" : "hold";
  if (READ_TOOLS.has(tool)) return "allow";
  if (EDIT_TOOLS.has(tool)) {
    const p = String(input.file_path ?? input.notebook_path ?? input.path ?? "");
    return p && !outside(worktree, p) ? "allow" : "hold"; // worktree 밖 수정 = 사람(셸 설정·자동 실행 파일 보호)
  }
  if (tool === "apply_patch") { const ps = patchPaths(input); return ps.length && ps.every((p) => !outside(worktree, p)) ? "allow" : "hold"; }
  if (tool === "Bash") return bashDecision(String(input.command ?? ""), worktree);
  return "hold"; // 모르는 도구 — 자동 모드여도 사람
}

// #1137 Crew API는 같은 출처(앱 화면)에서만 — 다른 사이트가 폼 POST로 '전부 알아서'를 켜거나 권한을 허락하지 못하게(리뷰)
export const crossSite = (req: Request) => { const s = req.headers.get("sec-fetch-site"); return !!s && s !== "same-origin" && s !== "none"; };

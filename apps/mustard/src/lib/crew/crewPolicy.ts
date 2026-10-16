// Crew 도구 권한 정책(#1100) — Claude 역할 세션의 PreToolUse 훅이 Mustard 서버에 묻고, 여기서 결정. 순수 모듈(점검 가능).
// 원칙(에픽 자율 4단계): worktree 안 읽기·수정·테스트·커밋 = 자동 허락 / push·머지·파괴적 git = 차단 / 그 밖 = 사람에게 묻기(카드 '나 필요').
import { isAbsolute, relative, resolve } from "node:path";

export type Decision = "allow" | "deny" | "ask";

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "TodoRead", "ToolSearch", "WebSearch", "WebFetch", "Task", "Agent", "BashOutput", "KillShell", "ExitPlanMode"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
// 항상 막는 git·파괴 명령(규약·disallowedTools와 같은 목록 + 위험 rm)
const DENY_RE = /\bgit\s+(push|merge|rebase|reset\s+--hard|branch\s+-[dD]|worktree\s+(remove|prune)|clean\s+-[a-z]*f|checkout\s+(main|master)\b|switch\s+(main|master)\b)|\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)|\bsudo\b/;
// 자동 허락하는 명령의 첫 단어(파이프·연결 각 부분이 전부 이 목록이어야 함)
const SAFE_CMD = new Set(["git", "npm", "pnpm", "yarn", "bun", "npx", "node", "tsc", "eslint", "prettier", "vitest", "jest", "pytest", "python", "python3", "go", "cargo", "make",
  "ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "sed", "awk", "sort", "uniq", "diff", "echo", "printf", "pwd", "mkdir", "touch", "cp", "mv", "test", "true", "which", "jq", "tree", "cd"]);
// git 하위 명령 중 자동 허락
const SAFE_GIT = new Set(["status", "diff", "log", "show", "add", "commit", "restore", "stash", "branch", "rev-parse", "ls-files", "blame", "grep", "mv", "rm", "checkout", "switch", "config"]);

const inside = (dir: string, p: string) => { const r = relative(dir, resolve(dir, p)); return !!dir && !r.startsWith("..") && !isAbsolute(r); };

// 판단 전에 걷어내기(실사용 오탐 — node -e "…", git commit -m "$(cat <<'EOF' …)", cat >> f <<'EOF' …):
// ① heredoc 본문 → <<H  ② 명령 치환은 `cat <<H`만 허용(그 밖은 실제 실행되는 코드라 null = 묻기)  ③ 따옴표 안 글자 → Q
function strip(cmd: string): string | null {
  let c = cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.slice(0, m.indexOf("\n")).replace(/<<-?\s*(['"]?)\w+\1/, "<<H"));
  const subs = [...c.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)];
  if (subs.some((m) => !/^\s*cat\s+<<H\s*$/.test((m[1] ?? m[2] ?? "").trim() ? (m[1] ?? m[2] ?? "") : "x"))) return null;
  if (/\$\(|`/.test(c.replace(/\$\(\s*cat\s+<<H\s*\)/g, ""))) return null; // 짝 안 맞는 치환
  c = c.replace(/\$\(\s*cat\s+<<H\s*\)/g, "Q").replace(/'[^']*'/g, "Q").replace(/"(?:[^"\\]|\\.)*"/g, "Q");
  return c;
}

function bashDecision(raw: string, worktree: string): Decision {
  const cmd = strip(raw);
  if (cmd === null) return DENY_RE.test(raw) ? "deny" : "ask";
  if (DENY_RE.test(cmd)) return "deny";
  // 연결(&&, ||, ;, |, 줄바꿈) 단위로 나눠 각 부분의 첫 단어 확인. 리다이렉트로 밖에 쓰기는 사람에게.
  const outRedirect = [...cmd.matchAll(/>{1,2}\s*([^\s|&;]+)/g)].map((m) => m[1]);
  if (outRedirect.some((p) => p !== "/dev/null" && !inside(worktree, p))) return "ask";
  for (const part of cmd.split(/&&|\|\||;|\||\n/)) {
    const words = part.trim().replace(/^(\w+=\S+\s+)+/, "").split(/\s+/); // 앞의 VAR=값 무시
    const w0 = words[0];
    if (!w0) continue;
    if (!SAFE_CMD.has(w0)) return "ask";
    if (w0 === "git" && words[1] && !SAFE_GIT.has(words[1])) return "ask";
    if (w0 === "cd" && words[1] && !inside(worktree, words[1])) return "ask";
  }
  return "allow";
}

export function decide(tool: string, input: Record<string, unknown>, worktree: string): Decision {
  if (READ_TOOLS.has(tool) || tool.startsWith("mcp__")) return "allow"; // 사용자 MCP(기억·도구)는 사용자가 이미 설치·허용한 것
  if (EDIT_TOOLS.has(tool)) {
    const p = String(input.file_path ?? input.notebook_path ?? input.path ?? "");
    return p && inside(worktree, p) ? "allow" : "ask"; // worktree 밖 수정은 사람에게
  }
  if (tool === "Bash") return bashDecision(String(input.command ?? ""), worktree);
  return "ask";
}

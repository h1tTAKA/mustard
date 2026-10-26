// 에이전트 CLI 찾기·확인(#1171, #1164 흡수) — 설치됐나, 그 경로가 진짜 실행되나, 로그인됐나.
// 터미널 실행은 손대지 않음(로그인 셸이라 PATH가 다 있음). 이건 상태 표시와 SNA(Crew·채팅 백그라운드)가 쓸 "확인된 경로"용.
// 다른 ADE 대조(소스 + 배포본):
//  - Orca: 로그인 셸 PATH를 `$SHELL -ilc`로 받아 합침(구분자로 배너 거름, 10초, 세션 캐시, 다시 확인 = 다시 받음) + 설치 폴더 폴백.
//          git/gh는 후보마다 --version을 돌려 "통과한 실제 경로를 고정"(죽은 shim을 다시 고르지 않게) — 이걸 에이전트에도 씀.
//  - Emdash: 로그인 = claude auth status · codex login status · opencode auth list(5초), API 키 env 먼저, 모르면 unknown. 설치 명령 표.
const { spawn } = require("node:child_process");
const { accessSync, constants, existsSync, lstatSync, readdirSync, realpathSync } = require("node:fs");
const { delimiter, join } = require("node:path");
const { homedir } = require("node:os");

// 지원 에이전트 — id는 main AGENT_DEFAULT_CMD·AgentLogo와 같음. bins = 실행 파일 이름(앞이 먼저).
// install = 공식 설치 명령(Emdash 표·각 공식 문서) — 앱은 복사만(남의 스크립트를 대신 돌리지 않음). 없으면 null.
// auth = 로그인 확인 인자(Emdash), keys = 있으면 로그인된 걸로 보는 API 키 env.
const AGENTS = [
  { id: "claude", label: "Claude Code", bins: ["claude"], install: "curl -fsSL https://claude.ai/install.sh | bash", auth: ["auth", "status"], keys: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"] },
  { id: "codex", label: "Codex", bins: ["codex"], install: "npm install -g @openai/codex", auth: ["login", "status"], keys: ["OPENAI_API_KEY"] },
  { id: "gemini", label: "Gemini CLI", bins: ["gemini"], install: "npm install -g @google/gemini-cli" },
  { id: "antigravity", label: "Antigravity CLI", bins: ["agy"], install: "curl -fsSL https://antigravity.google/cli/install.sh | bash" },
  { id: "opencode", label: "OpenCode", bins: ["opencode"], install: "npm install -g opencode-ai", auth: ["auth", "list"] },
  { id: "cursor", label: "Cursor CLI", bins: ["cursor-agent"], install: "curl https://cursor.com/install -fsS | bash" },
  { id: "grok", label: "Grok Build", bins: ["grok"], install: "curl -fsSL https://x.ai/cli/install.sh | bash" },
  { id: "copilot", label: "Copilot CLI", bins: ["copilot"], install: "npm install -g @github/copilot" },
  { id: "amp", label: "Amp", bins: ["amp"], install: "npm install -g @ampcode/cli" },
  { id: "aider", label: "Aider", bins: ["aider"], install: "python -m pip install aider-install && aider-install" },
  { id: "hermes", label: "Hermes Agent", bins: ["hermes"], install: null },
  { id: "omp", label: "omp", bins: ["omp"], install: null },
];

// Orca system-cli-install-dirs + local-agent-install-dir-detection(배포본 1.4.240과 같음) — PATH에 없을 때만 보는 설치 폴더
function fallbackDirs(home = homedir()) {
  const h = (...p) => join(home, ...p);
  const dirs = [
    h(".local", "bin"), h(".claude", "local"), h(".claude", "bin"), h(".volta", "bin"), h(".asdf", "shims"), h(".fnm", "aliases", "default", "bin"),
    h(".local", "share", "mise", "shims"), h("Library", "pnpm"), h(".yarn", "bin"), h(".bun", "bin"), h(".cargo", "bin"),
    h(".npm-global", "bin"), h(".opencode", "bin"), h(".grok", "bin"), h(".codex", "bin"),
    "/opt/homebrew/bin", "/usr/local/bin",
  ];
  try { for (const v of readdirSync(h(".nvm", "versions", "node")).sort().reverse()) dirs.push(h(".nvm", "versions", "node", v, "bin")); } catch { /* nvm 없음 */ }
  return dirs;
}

// 실행해서 결과 받기 — execFile은 stdout이 닫혀야(close) 끝나서, 프로필·CLI가 띄운 데몬이 stdout을 물고 있으면 영영 안 끝남(리뷰).
// 그래서 끝남(exit) 뒤 잠깐 기다려 받은 만큼으로 끝내고, 시간 넘으면 프로세스 그룹째 죽이고 끝냄. 결과 = { code, out, timedOut }.
function runCmd(file, args, timeout, env) {
  return new Promise((res) => {
    let out = "", done = false, child;
    const finish = (code, timedOut = false) => {
      if (done) return; done = true; clearTimeout(timer);
      child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref?.(); // 데몬이 물고 있던 파이프도 놓음(fd 안 샘, 리뷰)
      res({ code, out: out.trim(), timedOut });
    };
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* 이미 끝남 */ } } finish(-1, true); }, timeout);
    try { child = spawn(file, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] }); } catch { return finish(-1); }
    const take = (b) => { if (out.length < 1_000_000) out += b; };
    child.stdout.on("data", take); child.stderr.on("data", take);
    child.on("error", () => finish(-1));
    child.on("close", (code) => finish(typeof code === "number" ? code : -1));
    child.on("exit", (code) => setTimeout(() => finish(typeof code === "number" ? code : -1), 300));
  });
}

// 로그인 셸 PATH(Orca hydrate-shell-path) — 프로필이 찍는 배너를 구분자로 걸러냄. 실패면 null(실패는 캐시 안 함 — 다음에 다시).
const DELIM = "__MUSTARD_PATH__";
let shellPathPromise = null;
function shellPath({ force = false, timeout = 10_000, shell = process.env.SHELL || "/bin/zsh" } = {}) {
  if (shellPathPromise && !force) return shellPathPromise;
  const p = runCmd(shell, ["-ilc", `printf '${DELIM}'; printf '%s' "$PATH"; printf '${DELIM}'`], timeout, process.env).then(({ out }) => {
    const m = new RegExp(`${DELIM}([\\s\\S]*?)${DELIM}`).exec(out);
    return m && m[1].trim() ? m[1].trim() : null;
  });
  shellPathPromise = p;
  p.then((v) => { if (!v && shellPathPromise === p) shellPathPromise = null; });
  return p;
}
// 지금 PATH 뒤에 새 조각만(있는 건 그대로 — 유저 PATH 우선)
function mergePath(cur, extra) {
  const have = String(cur || "").split(delimiter).filter(Boolean);
  const add = String(extra || "").split(delimiter).filter((d) => d && !have.includes(d));
  return [...have, ...add].join(delimiter);
}

const isExec = (p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } };
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
// PATH를 직접 걸어(which 안 씀 — Orca) 후보 전부, 다음 설치 폴더. 같은 실제 파일은 한 번만.
function candidates(bins, pathStr, home) {
  const out = [], seen = new Set();
  for (const dir of [...String(pathStr || "").split(delimiter).filter(Boolean), ...fallbackDirs(home)]) {
    for (const b of bins) {
      const p = join(dir, b);
      // 깨진 링크(대상 지워짐 — Claude 업데이트 후 흔함)도 후보로 → --version이 실패해 "경로 깨짐"(못 찾음 아님, 리뷰)
      if (existsSync(p) ? !isExec(p) : !isLink(p)) continue;
      let key = p; try { key = realpathSync(p); } catch { /* 깨진 링크도 후보 — 실행해 보면 안다 */ }
      if (seen.has(key)) continue;
      seen.add(key); out.push(p);
    }
  }
  return out;
}

const versionOf = (out) => (/\d+\.\d+\.\d+(?:[-+.][\w.]+)?/.exec(out)?.[0] ?? out.split("\n")[0].slice(0, 60)) || null;

// 한 에이전트 — 후보마다 --version(10초 — Superset·Emdash와 같음, 동시에 여럿 돌리면 느린 CLI가 있음), 처음 통과한 경로를 씀. 다 실패면 "경로 깨짐"(찾긴 했는데 안 돎), 후보가 없으면 "설치 안 됨".
async function detectAgent(agent, { pathStr, home, env = process.env, run = runCmd } = {}) {
  const found = candidates(agent.bins, pathStr, home);
  const tried = [];
  for (const p of found) {
    const r = await run(p, ["--version"], 10_000, env);
    if (r.code === 0) return { id: agent.id, status: "ok", path: p, version: versionOf(r.out), tried };
    tried.push({ path: p, error: r.timedOut ? "timeout" : r.out.split("\n").slice(-2).join(" ").slice(0, 200) });
  }
  return found.length ? { id: agent.id, status: "broken", path: found[0], tried } : { id: agent.id, status: "missing", tried };
}

// 로그인(Emdash) — API 키 env가 있으면 로그인, 아니면 그 CLI에 물음. 모르는 건 unknown(로그인 필요로 띄우지 않음).
async function checkAuth(agent, path, { env = process.env, run = runCmd } = {}) {
  if ((agent.keys || []).some((k) => env[k])) return "authenticated";
  if (!agent.auth || !path) return "unknown";
  const r = await run(path, agent.auth, 5000, env);
  const t = r.out;
  if (agent.id === "opencode") { const m = /(\d+)\s+credentials?/i.exec(t); return m && Number(m[1]) > 0 ? "authenticated" : "unknown"; } // 0개여도 env 제공자 키로 돌 수 있음 — 로그인 필요로 단정 안 함(리뷰)
  if (/not (authenticated|logged in|signed in)|login required|logged out|not logged/i.test(t)) return "unauthenticated";
  if (agent.id === "claude" && /"apiProvider"\s*:\s*"(?!firstParty")/.test(t)) return "authenticated"; // Bedrock·Vertex 등 — 로그인 대신 클라우드 자격(리뷰)
  if (agent.id === "claude") { const m = /"loggedIn"\s*:\s*(true|false)/.exec(t); return m ? (m[1] === "true" ? "authenticated" : "unauthenticated") : r.code === 0 ? "authenticated" : "unknown"; } // JSON {"loggedIn": …}
  if (/authenticated|logged in|signed in/i.test(t)) return "authenticated";
  return "unknown";
}

// 전부 — 에이전트끼리 동시에, 결과 60초 캐시(Superset·Emdash처럼). force면 셸 PATH부터 다시.
// { list, sp, at } — at = 이 목록을 만든 때(캐시면 캐시 시각), sp = 이 목록을 만들 때 실제로 쓴 로그인 셸 PATH(없으면 null). 따로 shellPath()를 다시 부르면 그 사이 결과가 달라질 수 있음(리뷰).
let cache = null, gen = 0;
async function detectAll({ force = false, home = homedir(), env = process.env, run = runCmd, shell } = {}) {
  if (cache && !force && Date.now() - cache.at < 60_000) return { list: cache.list, sp: cache.sp, at: cache.at };
  const my = ++gen;
  const sp = await shellPath({ force, shell });
  const pathStr = mergePath(env.PATH, sp);
  const list = await Promise.all(AGENTS.map(async (a) => {
    const d = await detectAgent(a, { pathStr, home, env: { ...env, PATH: pathStr }, run });
    const auth = d.status === "ok" ? await checkAuth(a, d.path, { env: { ...env, PATH: pathStr }, run }) : "unknown";
    return { ...d, label: a.label, install: a.install, auth };
  }));
  const at = Date.now();
  if (my === gen) cache = { at, list, sp }; // 늦게 끝난 옛 실행이 새 캐시를 덮지 않게(리뷰)
  return { list, sp, at };
}

module.exports = { AGENTS, fallbackDirs, shellPath, mergePath, candidates, detectAgent, checkAuth, detectAll, versionOf };

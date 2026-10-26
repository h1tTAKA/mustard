// 에이전트 카탈로그(#1184) — 감지(agent-cli)·터미널 실행 조립(main)·설정 화면(IPC)이 함께 쓰는 한 곳.
// 순서 = 자동 고르기 순서. 항목마다:
//  - 목록·라벨·문서 링크
//  - 감지 명령·별칭·필수 동반·실행 명령
//  - 권한 플래그(auto·full·env, ask·acceptEdits)
//  - 권한 옵션(이미 있으면 플래그 안 붙임)
// claude-agent-teams는 뺌(tmux shim·창 분할 필요 — BACKLOG). install = 우리가 아는 공식 설치 명령(#1171), 없으면 문서 링크만.
// auth = 로그인 확인 인자(#1171), keys = 있으면 로그인된 걸로 보는 env.

// p = 권한 플래그 { ask, edits(acceptEdits), auto, full }, env = 전체 액세스 때 명령 앞에 붙는 env
const A = (id, label, cmd, url, o = {}) => ({ id, label, cmd, url, bins: [cmd.split(" ")[0], ...(o.alias || [])], ...o });
const CLAUDE_P = { ask: "--permission-mode default", edits: "--permission-mode acceptEdits", auto: "--permission-mode auto", full: "--dangerously-skip-permissions" };
const AGENTS = [
  A("claude", "Claude", "claude", "https://code.claude.com/docs", { p: CLAUDE_P, install: "curl -fsSL https://claude.ai/install.sh | bash", auth: ["auth", "status"], keys: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"] }),
  A("openclaude", "OpenClaude", "openclaude", "https://openclaude.gitlawb.com/", { p: { full: "--dangerously-skip-permissions" } }),
  A("codex", "Codex", "codex", "https://github.com/openai/codex", { p: { ask: "-a on-request -s workspace-write -c approvals_reviewer=user", auto: "--approve-for-me", full: "--dangerously-bypass-approvals-and-sandbox" }, install: "npm install -g @openai/codex", auth: ["login", "status"], keys: ["OPENAI_API_KEY"] }),
  A("grok", "Grok", "grok", "https://x.ai/cli", { p: { ask: "--permission-mode default", full: "--permission-mode bypassPermissions" }, install: "curl -fsSL https://x.ai/cli/install.sh | bash" }),
  A("copilot", "GitHub Copilot", "copilot", "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli", { p: { full: "--yolo" }, install: "npm install -g @github/copilot" }),
  A("opencode2", "OpenCode 2", "opencode2", "https://opencode.ai/v2/docs/", { launch: "opencode2 --standalone" }),
  A("opencode", "OpenCode", "opencode", "https://opencode.ai/docs/cli/", { install: "npm install -g opencode-ai", auth: ["auth", "list"] }),
  A("mimo-code", "MiMo Code", "mimo", "https://mimo.xiaomi.com/coder"),
  A("ante", "Ante", "ante", "https://github.com/AntigmaLabs/ante-preview", { p: { full: "--yolo" } }),
  A("trae", "Trae", "traecli", "https://docs.trae.cn/cli_get-started-with-trae-cli", { p: { full: "--yolo" } }),
  A("muse", "Muse", "muse", "https://dev.meta.ai/docs/muse-code", { launch: "muse --trust-workspace", p: { full: "--yolo" } }),
  A("dsh", "DeepSeek Harness", "dsh-tui", "https://deepseek-harness.github.io/deepseek-harness/", { alias: ["dst"], req: ["dsh"], launch: "dsh-tui ." }),
  A("qoder", "Qoder CLI", "qodercli", "https://docs.qoder.com/cli/overview", { alias: ["qoder"], p: { full: "--dangerously-skip-permissions" } }),
  A("qoder-cn", "Qoder CLI China", "qoderclicn", "https://docs.qoder.cn/cli/overview", { alias: ["qodercn"], p: { full: "--dangerously-skip-permissions" } }),
  A("zcode", "ZCode", "zcode", "https://zcode.z.ai/en/docs", { p: { full: "--mode yolo" } }),
  A("pi", "Pi", "pi", "https://pi.dev"),
  A("omp", "OMP", "omp", "https://omp.sh"),
  A("prime-agent", "Prime Agent", "prime-agent", "https://github.com/PrimeIntellect-ai/prime-agent"),
  A("gemini", "Gemini", "gemini", "https://github.com/google-gemini/gemini-cli", { p: { full: "--yolo" }, install: "npm install -g @google/gemini-cli" }),
  A("antigravity", "Antigravity", "agy", "https://antigravity.google/docs/cli-overview", { p: { full: "--dangerously-skip-permissions" }, install: "curl -fsSL https://antigravity.google/cli/install.sh | bash" }),
  A("aider", "Aider", "aider", "https://aider.chat/docs/", { p: { full: "--yes-always" }, install: "python -m pip install aider-install && aider-install" }),
  A("goose", "Goose", "goose", "https://block.github.io/goose/docs/quickstart/", { env: { GOOSE_MODE: "auto" } }),
  A("amp", "Amp", "amp", "https://ampcode.com/manual#install", { p: { full: "--dangerously-allow-all" }, install: "npm install -g @ampcode/cli" }),
  A("kilo", "Kilocode", "kilo", "https://kilo.ai/docs/cli"),
  A("kiro", "Kiro", "kiro-cli", "https://kiro.dev/docs/cli/", { launch: "kiro-cli chat --tui", p: { full: "--trust-all-tools" } }),
  A("crush", "Charm", "crush", "https://github.com/charmbracelet/crush", { p: { full: "--yolo" } }),
  A("aug", "Auggie", "auggie", "https://docs.augmentcode.com/cli/overview"),
  A("autohand", "Autohand Code", "autohand", "https://github.com/autohandai/code-cli", { p: { full: "--unrestricted" } }),
  A("cline", "Cline", "cline", "https://docs.cline.bot/cline-cli/overview", { p: { full: "--auto-approve true" } }),
  A("codebuff", "Codebuff", "codebuff", "https://www.codebuff.com/docs/help/quick-start"),
  A("freebuff", "Freebuff", "freebuff", "https://freebuff.com/cli"),
  A("command-code", "Command Code", "command-code", "https://commandcode.ai/docs/quickstart", { launch: "command-code --trust", p: { full: "--yolo" } }),
  A("continue", "Continue", "cn", "https://docs.continue.dev/guides/cli", { p: { full: '--allow "*"' } }),
  A("cursor", "Cursor", "cursor-agent", "https://cursor.com/cli", { p: { full: "--yolo" }, install: "curl https://cursor.com/install -fsS | bash" }),
  A("droid", "Droid", "droid", "https://docs.factory.ai/cli/getting-started/quickstart", { p: { full: "--auto high" } }),
  A("kimi", "Kimi", "kimi", "https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html", { alias: ["kimi-code"], p: { full: "--yolo" } }),
  A("mistral-vibe", "Mistral Vibe", "vibe", "https://github.com/mistralai/mistral-vibe", { alias: ["mistral-vibe"], p: { full: "--agent auto-approve" } }),
  A("qwen-code", "Qwen Code", "qwen", "https://github.com/QwenLM/qwen-code", { p: { full: "--approval-mode yolo" } }),
  A("rovo", "Rovo Dev", "acli", "https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/", { launch: "acli rovodev run", p: { full: "--yolo" } }),
  A("hermes", "Hermes", "hermes", "https://hermes-agent.nousresearch.com/docs/", { launch: "hermes --tui", p: { full: "--yolo" } }),
  A("devin", "Devin", "devin", "https://devin.ai/cli", { p: { full: "--permission-mode bypass --respect-workspace-trust false" } }),
  A("openclaw", "OpenClaw", "openclaw", "https://github.com/openclaw/openclaw"),
  A("codebuddy", "CodeBuddy", "codebuddy", "https://www.codebuddy.ai/cli", { alias: ["cbc"], p: { full: "--dangerously-skip-permissions" } }),
  A("jcode", "Jcode", "jcode", "https://github.com/1jehuang/jcode"),
];
const BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

// 권한 선택 — own = 플래그 안 붙임(그 CLI 자체 설정). 화면 순서 그대로.
const CHOICES = ["own", "ask", "accept-edits", "auto", "full-access"];
const KEY = { ask: "ask", "accept-edits": "edits", auto: "auto", "full-access": "full" };
const flagOf = (id, choice) => (choice === "own" ? "" : BY_ID.get(id)?.p?.[KEY[choice]] ?? "");
const envOf = (id, choice) => (choice === "full-access" ? BY_ID.get(id)?.env ?? null : null);
// 이 에이전트가 고를 수 있는 선택(own은 항상) — 고를 게 own뿐이면 화면에 권한 메뉴 없음
const choicesOf = (id) => CHOICES.filter((c) => c === "own" || flagOf(id, c) || envOf(id, c));

// 따옴표를 한 덩어리로 보는 간단한 토큰 나누기(명령 줄은 셸이 다시 해석 — 여기선 옵션 이름만 봄)
// 단어 중간 따옴표(--opt="a  b")도 한 덩어리, 짝 없는 따옴표(don't)도 글자로 남김(리뷰)
const tokens = (s) => String(s || "").match(/(?:[^\s"']|"[^"]*"|'[^']*'|["'])+/g) || [];
// 비교용 — 셸이 벗기는 따옴표를 벗김("--yolo"도 --yolo로 알아봄, 리뷰)
const unq = (s) => String(s).replace(/"([^"]*)"|'([^']*)'|\\(.)/g, (_, a, b, c) => a ?? b ?? c); // + 따옴표 밖 \ 이스케이프
const CLAUDE_OPTS = ["--permission-mode", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--permission-prompt-tool", "--permission-prompts", "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools"];
const EXTRA = { claude: CLAUDE_OPTS, codex: ["-a", "--ask-for-approval", "-s", "--sandbox", "--yolo", "--not-so-yolo", "--full-auto"], grok: ["--permission-mode", "--always-approve", "--yolo", "--dangerously-skip-permissions"], gemini: ["--approval-mode", "-y"] };
const CODEX_CFG = ["approval_policy", "sandbox_mode", "approvals_reviewer", "sandbox_workspace_write"];
// 이 에이전트의 권한 옵션 이름들 — 유저 인자에 있으면 플래그를 안 붙임(화면도 이걸로 "인자가 권한을 정함" 표시)
function carriersOf(id) {
  const c = new Set(EXTRA[id] || []);
  for (const ch of CHOICES) for (const tok of tokens(flagOf(id, ch))) if (tok.startsWith("-") && !(id === "codex" && tok === "-c")) c.add(tok.split("=")[0]);
  return [...c];
}
// 유저 인자에 이미 권한 옵션이 있나 — 있으면 플래그를 안 붙임(유저가 이김)
function hasPermissionOption(id, userArgs) {
  const t = tokens(userArgs);
  const carriers = new Set(carriersOf(id));
  return t.some((tok, i) => {
    const u = unq(tok);
    const name = id === "codex" && /^-[as].+/.test(u) ? u.slice(0, 2) : u.split("=")[0];
    if (carriers.has(name)) return true;
    if (id === "codex" && (u === "-c" || u === "--config")) return CODEX_CFG.includes(unq(t[i + 1] || "").split("=")[0].split(".")[0].trim());
    return false;
  });
}

// 터미널에 칠 명령 — env 앞붙임 + 실행 명령(또는 경로 지정) + 권한 플래그(앞) + 유저 인자.
// Mustard는 셸에 명령을 쳐 넣으니 env는 `KEY=값 명령` 앞붙임(Orca는 프로세스 env — 결과 같음).
function launchLine(id, { choice = "own", userArgs = "", cmd } = {}) {
  const a = BY_ID.get(id);
  if (!a) return null;
  const base = cmd || a.launch || a.cmd;
  const user = String(userArgs || "").trim();
  const flag = flagOf(id, choice);
  const args = !flag || hasPermissionOption(id, user) ? user : user ? `${flag} ${user}` : flag;
  const env = envOf(id, choice);
  const envPart = env && !Object.keys(env).some((k) => new RegExp(`(^|\\s)${k}=`).test(user)) ? `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ")} ` : "";
  return `${envPart}${base}${args ? ` ${args}` : ""}`;
}

// 유저가 인자에 알려진 권한 플래그를 쓰면 빼서 그 에이전트의 권한 선택으로 — { choice, rest } 또는 null
// 같은 뜻의 다른 표기(전체 액세스) — 인자로 넣어도 권한 선택으로 옮겨 확인창을 거치게(리뷰)
const FULL_ALIAS = { claude: ["--permission-mode bypassPermissions"], codex: ["--yolo"], gemini: ["-y", "--approval-mode yolo"], grok: ["--yolo", "--always-approve", "--dangerously-skip-permissions"] };
function liftPermission(id, userArgs) {
  // --opt=값도 --opt 값처럼 비교하되, 나머지는 원래 토큰 그대로 돌려줌(유저가 쓴 형태·따옴표 유지, 리뷰)
  const raw = tokens(userArgs);
  const t = raw.map(unq).flatMap((x, ri) => (/^--[^=]+=/.test(x) ? [[x.slice(0, x.indexOf("=")), ri], [x.slice(x.indexOf("=") + 1), ri]] : [[x, ri]]));
  const recipes = [...["full-access", "auto", "accept-edits", "ask"].map((c) => [c, flagOf(id, c)]), ...(FULL_ALIAS[id] || []).map((f) => ["full-access", f])];
  for (const [c, flag] of recipes) {
    const f = tokens(flag).map(unq);
    if (!f.length) continue;
    for (let i = 0; i + f.length <= t.length; i++) {
      if (!f.every((x, k) => t[i + k][0] === x)) continue;
      const used = new Set(t.slice(i, i + f.length).map(([, ri]) => ri));
      if (t.some(([, ri], k) => used.has(ri) && (k < i || k >= i + f.length))) continue; // --opt=값의 반쪽만 맞으면 건너뜀
      return { choice: c, rest: raw.filter((_, ri) => !used.has(ri)).join(" ") };
    }
  }
  return null;
}

// 신원(셸에 친 명령·포그라운드 프로세스 이름 → 에이전트)에 쓰는 이름 — 다른 도구와 겹치기 쉬운 짧은 이름은 뺌(리뷰: pi·cn·acli·dst)
const GENERIC = new Set(["pi", "cn", "acli", "dst"]);
const identityBins = () => AGENTS.flatMap((a) => a.bins.filter((b) => !GENERIC.has(b)).map((b) => [b, a.id]));
// 짧은 이름으로만 감지되는 에이전트 — 다른 도구일 수 있어 "자동" 고르기에선 뺌(직접 기본으로 고르거나 한 번 띄우면 OK, 리뷰)
const weakDetect = (id) => (BY_ID.get(id)?.bins ?? []).every((b) => GENERIC.has(b));

module.exports = { AGENTS, BY_ID, CHOICES, flagOf, envOf, choicesOf, carriersOf, hasPermissionOption, launchLine, liftPermission, identityBins, weakDetect };

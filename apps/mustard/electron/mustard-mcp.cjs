// Mustard MCP 서버(#1041 브라우저 → #1070 코드그래프 통합) — 에이전트(Claude/Codex)가 stdio로 띄움. 의존성 없음(혼자 복사돼 실행됨).
// 실행: ELECTRON_RUN_AS_NODE=1 <Mustard 실행파일> mustard-mcp.cjs <엔드포인트 파일>
// 엔드포인트 파일 = { url, token(브라우저 조작), appUrl(Next 앱) } — 매 요청마다 읽음(Mustard 재시작·포트 변경에도 계속 동작).
//  - browser_* → Mustard main의 browser-control. 어느 탭인지는 이 프로세스의 cwd(= 에이전트가 일하는 폴더)로 Mustard가 고름.
//  - katchup_*(코드그래프) → 앱의 /api/repo/mcp/tool. 레포 = cwd에서 위로 .git이 있는 폴더(없으면 cwd) — 레포마다 등록할 필요 없음.
const { readFileSync, existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const ENDPOINT_FILE = process.argv[2] || "";
const SERVER = { name: "mustard", version: "2.0.0" };

const TAB = { tabId: { type: "number", description: "Optional tab id from browser_status/browser_new_tab. Omit to use the visible tab." } };
const TOOLS = [
  { name: "browser_status", description: "List Mustard in-app browser tabs for this repo: tabId, url, title, visible, and which tab other tools use by default.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_new_tab", description: "Open a new in-app browser tab for this repo (opens the browser if needed) and make it visible. Returns its tabId. Use for side-by-side pages (e.g. monorepo apps on different ports).", inputSchema: { type: "object", properties: { url: { type: "string", description: "Optional http(s) URL; 'localhost:3000' or ':3000' work" } } } },
  { name: "browser_select_tab", description: "Make a tab visible in Mustard (needed before click/type on a background tab).", inputSchema: { type: "object", properties: { tabId: { type: "number" } }, required: ["tabId"] } },
  { name: "browser_close_tab", description: "Close an in-app browser tab.", inputSchema: { type: "object", properties: { tabId: { type: "number" } }, required: ["tabId"] } },
  { name: "browser_navigate", description: "Open a URL in the Mustard in-app browser for this repo (opens the browser if needed). http(s) only; 'localhost:3000' or ':3000' work.", inputSchema: { type: "object", properties: { ...TAB, url: { type: "string" } }, required: ["url"] } },
  { name: "browser_screenshot", description: "Screenshot of the current in-app browser tab (what the user sees). Use after edits to verify the UI.", inputSchema: { type: "object", properties: { ...TAB,} } },
  { name: "browser_read", description: "Current page URL, title, visible text, and a numbered list of clickable/typeable elements with CSS selectors for browser_click/browser_type.", inputSchema: { type: "object", properties: { ...TAB, maxChars: { type: "number", description: "Max text length (default 20000)" } } } },
  { name: "browser_console", description: "Recent console messages from the page (errors, warnings, logs).", inputSchema: { type: "object", properties: { ...TAB, limit: { type: "number", description: "Default 50, max 200" }, level: { type: "string", enum: ["error", "warning", "info", "verbose"] } } } },
  { name: "browser_click", description: "Click an element (real mouse event at its center) by CSS selector from browser_read.", inputSchema: { type: "object", properties: { ...TAB, selector: { type: "string" } }, required: ["selector"] } },
  { name: "browser_type", description: "Click an input by CSS selector, then type text. Optionally clear it first and press Enter.", inputSchema: { type: "object", properties: { ...TAB, selector: { type: "string" }, text: { type: "string" }, clear: { type: "boolean" }, submit: { type: "boolean" } }, required: ["selector", "text"] } },
  // 컴퓨터 사용(#1175) — 유저 컴퓨터의 데스크톱 앱. Mustard가 켜기·막는 앱·비상 정지·기록을 걸고 드라이버(cua-driver)로 넘김.
  { name: "computer_tools", description: "Desktop control of the user's real apps (outside Mustard). Lists the desktop driver's tools. Use only when the user asks you to operate a desktop app and no API/CLI/file route can do it. For the app you are building, use browser_* instead.", inputSchema: { type: "object", properties: {} } },
  { name: "computer_describe", description: "Show the argument schema of one desktop driver tool (from computer_tools).", inputSchema: { type: "object", properties: { tool: { type: "string" } }, required: ["tool"] } },
  { name: "computer_call", description: "Run one desktop driver tool. Loop: snapshot (window state) -> one action -> fresh snapshot to verify; never reuse element tokens/indexes after the screen changes. Prefer accessibility elements over pixel coordinates. Ask the user right before sending messages, submitting forms, publishing, buying, deleting, or changing accounts. Passwords, passkeys and MFA stay with the user. Leave windows, focus and clipboard as you found them. If Mustard says turned off, blocked or stopped, stop and tell the user.", inputSchema: { type: "object", properties: { tool: { type: "string", description: "Driver tool name from computer_tools" }, args: { type: "object", description: "Tool arguments (see computer_describe)" } }, required: ["tool"] } },
  // Crew 지시(#1277) — 이 레포의 역할 에이전트 보드. main이 허용 동작만 대신 부름(권한 승인·관문·삭제는 사람이 앱에서만).
  { name: "crew_board", description: "Read this repo's Mustard Crew board: cards (id, title, status, role, what is waiting for the user) with their latest run (state, last activity, summary) and recent Crew chat.", inputSchema: { type: "object", properties: {} } },
  { name: "crew_add_task", description: "Add a card to this repo's Mustard Crew board for the role agents to work on. Leave role empty to let the scope planner assign it. start=true starts it right away. Permission requests and gates are approved by the user in Mustard, not by you.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string", description: "Details / acceptance criteria" }, role: { type: "string", description: "Optional role id, e.g. app-builder, test-engineer, bug-fixer, doc-writer" }, start: { type: "boolean" } }, required: ["title"] } },
  { name: "crew_start", description: "Start a Crew card (taskId from crew_board).", inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] } },
  { name: "crew_stop", description: "Stop a running Crew card (taskId from crew_board).", inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] } },
  { name: "crew_chat", description: "Post a message to this repo's Crew chat as the user's lead agent. '@role-id text' creates a card for that role and starts it. Answers to questions and gate decisions are the user's, in Mustard. Read replies with crew_board.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
];

// 레포 루트 = cwd에서 위로 처음 .git(폴더·파일 모두 — worktree는 파일)이 나오는 곳. 없으면 cwd.
function repoRoot(from) {
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return from;
  }
}
const readEndpoint = () => { try { return JSON.parse(readFileSync(ENDPOINT_FILE, "utf8")); } catch { return null; } };
// 코드그래프 도구 목록 — 앱에서(도구 정의는 한 곳). 앱이 안 떠 있으면 브라우저 도구만.
async function graphTools() {
  const ep = readEndpoint();
  if (!ep?.appUrl) return [];
  try {
    const r = await fetch(`${ep.appUrl}/api/repo/mcp/tool`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return Array.isArray(d?.tools) ? d.tools : [];
  } catch { return []; }
}
async function callGraph(name, args) {
  const ep = readEndpoint();
  if (!ep?.appUrl) return failText("Mustard is not running. Open the Mustard app.");
  try {
    const r = await fetch(`${ep.appUrl}/api/repo/mcp/tool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: repoRoot(process.cwd()), name, args: args || {} }), signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return failText(d?.error || `Mustard code graph failed (HTTP ${r.status}).`);
    return { content: [{ type: "text", text: String(d.text ?? "") }], isError: !!d.isError };
  } catch (e) { return failText(`Could not reach Mustard: ${String(e?.message || e)}`); }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const failText = (t) => ({ content: [{ type: "text", text: t }], isError: true });

async function callMustard(name, args) {
  const ep = readEndpoint();
  if (!ep?.url) return failText("Mustard is not running (no browser endpoint). Open the Mustard app.");
  try {
    const r = await fetch(ep.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ep.token}` }, body: JSON.stringify({ tool: name, args: args || {}, cwd: process.cwd() }), signal: AbortSignal.timeout(name.startsWith("computer_") ? 75000 : 30000) }); // 드라이버는 60초까지
    if (!r.ok) return failText(`Mustard refused the request (HTTP ${r.status}). Restart the agent if Mustard was restarted.`);
    return await r.json();
  } catch (e) { return failText(`Could not reach Mustard: ${String(e?.message || e)}`); }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return reply(id, { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: SERVER,
    instructions: "Mustard tools. Code graph: before grepping files, use katchup_repo_map for structure, then katchup_find_code/trace_calls/find_all/file_api/search. In-app browser: browser_* to open, read, screenshot and click pages of the app you are building. Desktop apps (only when the user asks): computer_*. Crew (when the user asks to hand work to the role agents): crew_*." });
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: [...await graphTools(), ...TOOLS] });
  if (method === "tools/call") {
    const name = params?.name;
    if (TOOLS.some((t) => t.name === name)) return reply(id, await callMustard(name, params?.arguments));
    if (typeof name === "string" && name.startsWith("katchup_")) return reply(id, await callGraph(name, params?.arguments));
    return reply(id, failText(`Unknown tool: ${name}`));
  }
  if (id !== undefined && id !== null) error(id, -32601, `Method not found: ${method}`); // 알림(id 없음)은 답 안 함
}

// 줄 단위 JSON-RPC(stdio MCP). 한 줄씩 순서대로 처리. require(점검)일 땐 안 돎.
if (require.main === module) {
  let buf = "";
  let chain = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      chain = chain.then(() => handle(msg)).catch((e) => { if (msg.id != null) error(msg.id, -32603, String(e?.message || e)); });
    }
  });
  process.stdin.on("end", () => { chain.then(() => process.exit(0)); });
}

module.exports = { repoRoot }; // check용(실행 시엔 stdin 루프가 돎)

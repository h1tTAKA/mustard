// Mustard 인앱 브라우저 MCP 서버(#1041) — 에이전트(Claude/Codex)가 stdio로 띄움. 의존성 없음(혼자 복사돼 실행됨).
// 실행: ELECTRON_RUN_AS_NODE=1 <Mustard 실행파일> browser-mcp.cjs <엔드포인트 파일>
// 요청을 Mustard main의 browser-control 서버로 넘김. 주소·토큰은 매 요청마다 파일에서 읽음(Mustard 재시작에도 계속 동작).
// 어느 브라우저 탭인지는 이 프로세스의 cwd(= 에이전트가 일하는 폴더)로 Mustard가 고름.
const { readFileSync } = require("node:fs");

const ENDPOINT_FILE = process.argv[2] || "";
const SERVER = { name: "mustard-browser", version: "1.0.0" };

const TOOLS = [
  { name: "browser_status", description: "List Mustard in-app browser tabs for this repo (url, title, which one the other tools act on).", inputSchema: { type: "object", properties: {} } },
  { name: "browser_navigate", description: "Open a URL in the Mustard in-app browser for this repo (opens the browser if needed). http(s) only; 'localhost:3000' or ':3000' work.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_screenshot", description: "Screenshot of the current in-app browser tab (what the user sees). Use after edits to verify the UI.", inputSchema: { type: "object", properties: {} } },
  { name: "browser_read", description: "Current page URL, title, visible text, and a numbered list of clickable/typeable elements with CSS selectors for browser_click/browser_type.", inputSchema: { type: "object", properties: { maxChars: { type: "number", description: "Max text length (default 20000)" } } } },
  { name: "browser_console", description: "Recent console messages from the page (errors, warnings, logs).", inputSchema: { type: "object", properties: { limit: { type: "number", description: "Default 50, max 200" }, level: { type: "string", enum: ["error", "warning", "info", "verbose"] } } } },
  { name: "browser_click", description: "Click an element (real mouse event at its center) by CSS selector from browser_read.", inputSchema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  { name: "browser_type", description: "Click an input by CSS selector, then type text. Optionally clear it first and press Enter.", inputSchema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" }, clear: { type: "boolean" }, submit: { type: "boolean" } }, required: ["selector", "text"] } },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const failText = (t) => ({ content: [{ type: "text", text: t }], isError: true });

async function callMustard(name, args) {
  let ep;
  try { ep = JSON.parse(readFileSync(ENDPOINT_FILE, "utf8")); } catch { return failText("Mustard is not running (no browser endpoint). Open the Mustard app."); }
  try {
    const r = await fetch(ep.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ep.token}` }, body: JSON.stringify({ tool: name, args: args || {}, cwd: process.cwd() }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) return failText(`Mustard refused the request (HTTP ${r.status}). Restart the agent if Mustard was restarted.`);
    return await r.json();
  } catch (e) { return failText(`Could not reach Mustard: ${String(e?.message || e)}`); }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return reply(id, { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: SERVER });
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    if (!TOOLS.some((t) => t.name === name)) return reply(id, failText(`Unknown tool: ${name}`));
    return reply(id, await callMustard(name, params?.arguments));
  }
  if (id !== undefined && id !== null) error(id, -32601, `Method not found: ${method}`); // 알림(id 없음)은 답 안 함
}

// 줄 단위 JSON-RPC(stdio MCP). 한 줄씩 순서대로 처리.
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

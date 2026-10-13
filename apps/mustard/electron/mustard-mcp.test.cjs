// mustard-mcp.cjs 왕복 테스트 — 가짜 Mustard(브라우저 조작 + 앱 코드그래프 라우트) + MCP 프로세스 stdio. node electron/mustard-mcp.test.cjs
const assert = require("node:assert");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { writeFileSync, mkdtempSync, mkdirSync } = require("node:fs");
const { repoRoot } = require("./mustard-mcp.cjs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

(async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      if (req.url === "/api/repo/mcp/tool") { // 앱 코드그래프 라우트(인증 없음, 앱 로컬)
        if (req.method === "GET") return res.writeHead(200).end(JSON.stringify({ tools: [{ name: "katchup_repo_map", description: "map", inputSchema: { type: "object", properties: {} } }] }));
        const body = JSON.parse(b); seen.push({ graph: body });
        return res.writeHead(200).end(JSON.stringify({ ok: true, text: `graph ${body.name} @ ${body.root}`, isError: false }));
      }
      if (req.headers.authorization !== "Bearer tok") { res.writeHead(403).end(); return; }
      const body = JSON.parse(b); seen.push(body);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ content: [{ type: "text", text: `ok ${body.tool}` }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  const ep = join(dir, "ep.json");
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(ep, JSON.stringify({ url: `${base}/call`, token: "tok", appUrl: base }));

  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  mkdirSync(join(repo, ".git")); mkdirSync(join(repo, "apps", "web"), { recursive: true });
  const cwd = join(repo, "apps", "web"); // 레포 하위 폴더에서 에이전트가 돎
  const child = spawn(process.execPath, [join(__dirname, "mustard-mcp.cjs"), ep], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  const out = []; let pending = "";
  child.stdout.on("data", (d) => { pending += d; let i; while ((i = pending.indexOf("\n")) >= 0) { out.push(JSON.parse(pending.slice(0, i))); pending = pending.slice(i + 1); } });
  const sendLine = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const waitFor = async (id) => { for (let k = 0; k < 100; k++) { const m = out.find((x) => x.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 30)); } throw new Error("timeout " + id); };

  sendLine({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  const init = await waitFor(1);
  assert.strictEqual(init.result.protocolVersion, "2025-03-26");
  assert.ok(init.result.capabilities.tools);
  sendLine({ jsonrpc: "2.0", method: "notifications/initialized" }); // 알림 — 답 없음
  sendLine({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await waitFor(2);
  assert.deepStrictEqual(list.result.tools.map((t) => t.name), ["katchup_repo_map", "browser_status", "browser_new_tab", "browser_select_tab", "browser_close_tab", "browser_navigate", "browser_screenshot", "browser_read", "browser_console", "browser_click", "browser_type"]);
  assert.ok(list.result.tools.find((t) => t.name === "browser_click").inputSchema.properties.tabId, "tabId 받음");
  sendLine({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_click", arguments: { selector: "#a" } } });
  const call = await waitFor(3);
  assert.strictEqual(call.result.content[0].text, "ok browser_click");
  assert.deepStrictEqual(seen[0].args, { selector: "#a" });
  assert.ok(seen[0].cwd.endsWith("apps/web"), "cwd를 같이 보냄(어느 레포 탭인지)");
  sendLine({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "katchup_repo_map", arguments: {} } });
  const g = await waitFor(6);
  assert.ok(!g.result.isError && g.result.content[0].text.startsWith("graph katchup_repo_map @ "), "코드그래프는 앱 라우트로");
  assert.ok(seen.at(-1).graph.root.endsWith(repo.split("/").pop()), "레포 = cwd 위 .git 폴더");
  sendLine({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rm_rf", arguments: {} } });
  assert.ok((await waitFor(4)).result.isError, "모르는 도구");
  sendLine({ jsonrpc: "2.0", id: 5, method: "resources/list" });
  assert.strictEqual((await waitFor(5)).error.code, -32601);
  child.stdin.write("not json\n");
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(out.some((m) => m.error && m.error.code === -32700));
  assert.ok(!out.some((m) => m.id === undefined && m.result), "알림엔 답 안 함");

  // Mustard 꺼짐(엔드포인트 파일 없음) → 도구 에러로 알려줌(프로세스는 살아 있음)
  const child2 = spawn(process.execPath, [join(__dirname, "mustard-mcp.cjs"), join(dir, "none.json")], { stdio: ["pipe", "pipe", "inherit"] });
  const out2 = await new Promise((resolve) => { let s = ""; child2.stdout.on("data", (d) => { s += d; if (s.includes("\n")) resolve(JSON.parse(s.split("\n")[0])); }); child2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "browser_screenshot" } }) + "\n"); });
  assert.ok(out2.result.isError && out2.result.content[0].text.includes("not running"));

  child.stdin.end(); child2.stdin.end(); server.close();
    // repoRoot — worktree(.git 파일), .git 없음
  const wt = mkdtempSync(join(tmpdir(), "wt-")); writeFileSync(join(wt, ".git"), "gitdir: /x");
  assert.strictEqual(repoRoot(wt), wt);
  const plain = mkdtempSync(join(tmpdir(), "plain-"));
  assert.strictEqual(repoRoot(plain), plain, ".git 없으면 cwd 그대로");
  console.log("mustard-mcp ok");
})().catch((e) => { console.error(e); process.exit(1); });

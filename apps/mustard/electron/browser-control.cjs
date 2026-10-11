// 에이전트용 인앱 브라우저 조작(#1041) — main 안 작은 HTTP 서버. browser-mcp.cjs(에이전트가 띄운 MCP)가 여기에 요청.
// - 127.0.0.1만, 부팅마다 새 토큰, 엔드포인트 파일 0600. 인앱 브라우저 guest(페이지)만 다룸 — 앱 화면은 손댈 수 없음.
// - 어느 탭? 요청에 실린 에이전트 cwd → 그 레포에 등록된 탭(보이는 탭 우선, 다음은 최근 활동).
const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");

const norm = (p) => String(p || "").replace(/\/+$/, "");
// cwd가 레포 안이면(같거나 하위) 그 레포의 탭. 레포가 겹치면(모노레포 하위 레포 등) 더 긴 경로가 이김.
function pickGuest(entries, cwd) {
  const c = norm(cwd);
  const mine = entries.filter((e) => { const r = norm(e.repo); return r && (c === r || c.startsWith(r + "/")); });
  if (!mine.length) return null;
  const depth = Math.max(...mine.map((e) => norm(e.repo).length));
  return mine.filter((e) => norm(e.repo).length === depth).sort((a, b) => (b.visible - a.visible) || (b.at - a.at))[0];
}

// 주소 정리 — 렌더러 normalizeBrowserUrl과 같은 규칙(localhost·포트만 = http, 그 외 도메인 = https).
function normalizeUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^:\d{1,5}$/.test(s)) return `http://localhost${s}/`;
  if (/^https?:\/\//i.test(s)) { try { return new URL(s).href; } catch { return null; } }
  if (/\s/.test(s) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null;
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?([/?#]|$)/i.test(s);
  if (!local && !s.includes(".")) return null;
  try { return new URL(`${local ? "http" : "https"}://${s}`).href; } catch { return null; }
}

const LEVELS = { 0: "verbose", 1: "info", 2: "warning", 3: "error", debug: "verbose", info: "info", warning: "warning", error: "error" };
const levelOf = (l) => LEVELS[l] || "info";

// 페이지 글 + 클릭할 수 있는 요소 목록(번호·selector) — 에이전트가 click/type에 그 selector를 씀.
const READ_SCRIPT = (maxChars) => `(() => {
  const sel = (el) => {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id && document.querySelectorAll("#" + CSS.escape(n.id)).length === 1) { parts.unshift("#" + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sib.length > 1) p += ":nth-of-type(" + (sib.indexOf(n) + 1) + ")";
      parts.unshift(p);
    }
    return parts.join(" > ");
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const els = [...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')].filter(vis).slice(0, 80)
    .map((el, i) => ({ i, tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || "", text: (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 80), selector: sel(el) }));
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").slice(0, ${Number(maxChars) || 20000}), elements: els };
})()`;

// selector 요소를 화면 가운데로 스크롤하고 중앙 좌표(CSS px). 없거나 크기 0이면 error.
const CENTER_SCRIPT = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(String(selector))});
  if (!el) return { error: "no element matches selector" };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { error: "element has no size (hidden?)" };
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const text = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });

/**
 * @param deps.getGuest(id) → live webview webContents or null
 * @param deps.requestOpen(cwd, url) — 렌더러에 "그 레포 브라우저 열어줘"
 * @param deps.isAllowedUrl(url)
 */
function createBrowserControl(deps) {
  const registry = new Map(); // guestId → { guestId, repo, visible, at }
  const consoles = new Map(); // guestId → [{ level, message, source, line, at }]
  const wired = new WeakSet();
  const entries = () => [...registry.values()].filter((e) => deps.getGuest(e.guestId));

  function register(guest, { repo, visible }) {
    const id = guest.id;
    registry.set(id, { guestId: id, repo: String(repo || ""), visible: visible ? 1 : 0, at: Date.now() });
    if (wired.has(guest)) return;
    wired.add(guest);
    consoles.set(id, []);
    guest.on("console-message", (ev, level, message, line, sourceId) => {
      const d = ev && typeof ev === "object" && "message" in ev ? ev : { level, message, lineNumber: line, sourceId };
      const buf = consoles.get(id); if (!buf) return;
      buf.push({ level: levelOf(d.level), message: String(d.message).slice(0, 2000), source: d.sourceId || "", line: d.lineNumber || 0, at: Date.now() });
      if (buf.length > 200) buf.splice(0, buf.length - 200);
    });
    guest.on("did-navigate", () => { const e = registry.get(id); if (e) e.at = Date.now(); });
    guest.once("destroyed", () => { registry.delete(id); consoles.delete(id); });
  }
  function unregister(guestId) { registry.delete(Number(guestId)); }

  const target = (cwd) => { const e = pickGuest(entries(), cwd); return e ? deps.getGuest(e.guestId) : null; };
  const NONE = "No in-app browser tab is open for this repo in Mustard. Use browser_navigate to open one.";

  async function call(tool, args, cwd) {
    args = args || {};
    if (tool === "browser_status") {
      const c = norm(cwd);
      const mine = entries().filter((e) => { const r = norm(e.repo); return r && (c === r || c.startsWith(r + "/")); });
      const pick = pickGuest(mine, cwd);
      return text(mine.map((e) => { const g = deps.getGuest(e.guestId); return { url: g.getURL(), title: g.getTitle(), visible: !!e.visible, target: e === pick }; }));
    }
    if (tool === "browser_navigate") {
      const url = normalizeUrl(args.url);
      if (!url || !deps.isAllowedUrl(url)) return fail("Only http(s) URLs are allowed.");
      let g = target(cwd);
      if (!g) { // 브라우저가 안 열려 있으면 렌더러에 열어달라고 하고 등록될 때까지 기다림
        deps.requestOpen(cwd, url);
        for (let i = 0; i < 40 && !g; i++) { await new Promise((r) => setTimeout(r, 250)); g = target(cwd); }
        if (!g) return fail("Asked Mustard to open the in-app browser for this repo, but no tab appeared (is the repo open in Mustard?).");
        return text(`Opened ${url} in a new in-app browser tab.`);
      }
      await g.loadURL(url).catch(() => {}); // 실패 페이지도 페이지 — 결과는 status/read로
      return text(`Navigated to ${g.getURL()}`);
    }
    const g = target(cwd);
    if (!g) return fail(NONE);
    if (tool === "browser_screenshot") {
      let img = await g.capturePage();
      if (img.isEmpty()) return fail("Screenshot was empty (tab hidden or not painted yet).");
      if (img.getSize().width > 1600) img = img.resize({ width: 1600 });
      return { content: [{ type: "image", data: img.toPNG().toString("base64"), mimeType: "image/png" }, { type: "text", text: `URL: ${g.getURL()}` }] };
    }
    if (tool === "browser_read") return text(await g.executeJavaScript(READ_SCRIPT(Math.min(Number(args.maxChars) || 20000, 100000))));
    if (tool === "browser_console") {
      const lim = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
      const lv = args.level ? String(args.level) : null;
      const list = (consoles.get(g.id) || []).filter((m) => !lv || m.level === lv).slice(-lim);
      return text(list.length ? list.map((m) => `[${m.level}] ${m.message}${m.source ? `  (${m.source}:${m.line})` : ""}`).join("\n") : "(no console messages since the tab was opened)");
    }
    if (tool === "browser_click" || tool === "browser_type") {
      if (!args.selector) return fail("selector is required (get one from browser_read).");
      const pt = await g.executeJavaScript(CENTER_SCRIPT(args.selector));
      if (pt.error) return fail(pt.error);
      // 실제 마우스 이벤트(isTrusted) — 페이지가 막는 합성 click()이 아니라.
      g.sendInputEvent({ type: "mouseDown", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      g.sendInputEvent({ type: "mouseUp", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      if (tool === "browser_click") return text(`Clicked ${args.selector} at (${pt.x}, ${pt.y}).`);
      if (args.clear) await g.executeJavaScript(`(() => { const el = document.activeElement; if (el && "value" in el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); } })()`);
      await g.insertText(String(args.text ?? ""));
      if (args.submit) { g.sendInputEvent({ type: "keyDown", keyCode: "Enter" }); g.sendInputEvent({ type: "char", keyCode: "\r" }); g.sendInputEvent({ type: "keyUp", keyCode: "Enter" }); }
      return text(`Typed into ${args.selector}${args.submit ? " and pressed Enter" : ""}.`);
    }
    return fail(`Unknown tool: ${tool}`);
  }

  // HTTP: POST /call {tool, args, cwd}, Authorization: Bearer <token>
  function listen(token) {
    const want = Buffer.from(token);
    const server = http.createServer((req, res) => {
      const auth = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer /, ""));
      const ok = req.method === "POST" && req.url === "/call" && auth.length === want.length && timingSafeEqual(auth, want);
      if (!ok) { res.writeHead(403).end(); return; }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", async () => {
        let out;
        try { const { tool, args, cwd } = JSON.parse(body); out = await call(String(tool), args, String(cwd || "")); }
        catch (e) { out = fail(`Mustard browser error: ${String(e?.message || e)}`); }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
      });
    });
    return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })); });
  }

  return { register, unregister, call, listen };
}

module.exports = { createBrowserControl, pickGuest, normalizeUrl, READ_SCRIPT, CENTER_SCRIPT };

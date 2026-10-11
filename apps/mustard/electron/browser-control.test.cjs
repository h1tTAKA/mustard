const assert = require("node:assert");
const { createBrowserControl, pickGuest, normalizeUrl, READ_SCRIPT, CENTER_SCRIPT } = require("./browser-control.cjs");

// 탭 고르기 — cwd가 레포 안, 보이는 탭 우선, 다음은 최근, 겹치면 더 깊은 레포
const E = [
  { guestId: 1, repo: "/r/app", visible: 0, at: 5 },
  { guestId: 2, repo: "/r/app", visible: 1, at: 1 },
  { guestId: 3, repo: "/r/app/packages/web", visible: 0, at: 9 },
  { guestId: 4, repo: "/r/other", visible: 1, at: 9 },
];
assert.strictEqual(pickGuest(E, "/r/app").guestId, 2, "보이는 탭 우선");
assert.strictEqual(pickGuest(E, "/r/app/src/x").guestId, 2, "하위 폴더도 그 레포");
assert.strictEqual(pickGuest(E, "/r/app/packages/web").guestId, 3, "더 깊은 레포가 이김");
assert.strictEqual(pickGuest(E, "/r/apple"), null, "접두사만 같은 다른 폴더는 X");
assert.strictEqual(pickGuest(E.filter((e) => e.guestId === 1 || e.guestId === 3), "/r/app").guestId, 1);

assert.strictEqual(normalizeUrl("localhost:3000"), "http://localhost:3000/");
assert.strictEqual(normalizeUrl(":5173"), "http://localhost:5173/");
assert.strictEqual(normalizeUrl("example.com"), "https://example.com/");
for (const bad of ["", "file:///etc/passwd", "javascript:alert(1)", "foo"]) assert.strictEqual(normalizeUrl(bad), null, bad);

// 페이지 스크립트는 문법이 맞아야(문자열로 주입)
new Function("return " + READ_SCRIPT(100));
new Function("return " + CENTER_SCRIPT('a[href="x"]'));
assert.ok(CENTER_SCRIPT('"); alert(1); ("').includes('"\\"); alert(1); (\\""'), "selector는 JSON 문자열로 감쌈(주입 X)");

// 동작 — 가짜 guest
(async () => {
  const events = [];
  const fake = {
    id: 7, url: "http://localhost:3000/", handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; }, once(ev, fn) { this.handlers[ev] = fn; },
    getURL() { return this.url; }, getTitle() { return "T"; },
    loadURL(u) { this.url = u; return Promise.resolve(); },
    executeJavaScript(src) { return Promise.resolve(src.includes("scrollIntoView") ? { x: 10, y: 20 } : { url: this.url, title: "T", text: "hi", elements: [] }); },
    sendInputEvent(e) { events.push(e.type); }, insertText(t) { events.push("text:" + t); return Promise.resolve(); },
  };
  let opened = null; const cmds = [];
  const ctl = createBrowserControl({ getGuest: (id) => (id === 7 ? fake : null), requestOpen: (cwd, url) => { opened = [cwd, url]; }, isAllowedUrl: (u) => /^https?:/.test(u), tabCommand: (id, a) => cmds.push([id, a]) });
  // 등록 전: 이동 요청 → 렌더러에 열기 요청, 끝내 안 생기면 실패(10초 대기를 줄이려 바로 등록)
  const p = ctl.call("browser_navigate", { url: "localhost:3000" }, "/r/app");
  await new Promise((r) => setTimeout(r, 300));
  assert.deepStrictEqual(opened, ["/r/app", "http://localhost:3000/"]);
  ctl.register(fake, { repo: "/r/app", visible: true });
  assert.ok(!(await p).isError, "열린 뒤 성공");

  fake.handlers["console-message"]({ level: "error", message: "boom", lineNumber: 3, sourceId: "app.js" });
  fake.handlers["console-message"]({}, 1, "legacy", 4, "b.js");
  const con = await ctl.call("browser_console", { level: "error" }, "/r/app/src");
  assert.ok(con.content[0].text.includes("[error] boom  (app.js:3)") && !con.content[0].text.includes("legacy"));
  assert.ok((await ctl.call("browser_console", {}, "/r/app")).content[0].text.includes("[info] legacy"), "옛 시그니처");

  assert.ok((await ctl.call("browser_click", { selector: "#go" }, "/r/app")).content[0].text.includes("(10, 20)"));
  assert.deepStrictEqual(events.slice(0, 2), ["mouseDown", "mouseUp"]);
  await ctl.call("browser_type", { selector: "#q", text: "hello", submit: true }, "/r/app");
  assert.ok(events.includes("text:hello") && events.includes("keyDown"));
  assert.ok((await ctl.call("browser_click", {}, "/r/app")).isError, "selector 필수");
  assert.ok((await ctl.call("browser_navigate", { url: "file:///etc/passwd" }, "/r/app")).isError);
  assert.ok((await ctl.call("browser_read", {}, "/elsewhere")).isError, "다른 레포는 탭 없음");

  // 여러 탭(#1041): tabId 지정·고르기·닫기, 다른 레포 tabId는 거부
  assert.ok(!(await ctl.call("browser_read", { tabId: 7 }, "/r/app")).isError);
  assert.ok((await ctl.call("browser_read", { tabId: 99 }, "/r/app")).isError, "없는 탭");
  assert.ok((await ctl.call("browser_read", { tabId: 7 }, "/r/other")).isError, "다른 레포의 탭 X");
  await ctl.call("browser_select_tab", { tabId: 7 }, "/r/app"); await ctl.call("browser_close_tab", { tabId: 7 }, "/r/app");
  assert.deepStrictEqual(cmds, [[7, "select"], [7, "close"]]);
  assert.ok((await ctl.call("browser_new_tab", { url: "javascript:x" }, "/r/app")).isError);

  // HTTP — 토큰 없으면 403
  const { server, port } = await ctl.listen("secret-token");
  const post = (auth, body) => fetch(`http://127.0.0.1:${port}/call`, { method: "POST", headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: JSON.stringify(body) });
  assert.strictEqual((await post(null, {})).status, 403);
  assert.strictEqual((await post("wrong-token!", {})).status, 403);
  const ok = await (await post("secret-token", { tool: "browser_status", cwd: "/r/app" })).json();
  assert.ok(ok.content[0].text.includes('"defaultTarget": true') && ok.content[0].text.includes('"tabId": 7'));
  server.close();
  console.log("browser-control ok");
})().catch((e) => { console.error(e); process.exit(1); });

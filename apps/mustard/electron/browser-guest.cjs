// 인앱 브라우저(#1034) — <webview> 보안·guest 정책·단축키 전달.
// guest = 남의 웹페이지(dev 서버든 외부 사이트든)라 앱 권한을 절대 못 갖게 한다(orca 방식, fail-closed).
const PARTITION = "persist:mustard-browser"; // 앱 origin(학습 데이터)과 쿠키·저장소 분리

// http(s)·about:blank만 허용 — file:/javascript:/data: 등은 로컬 파일 읽기·스크립트 주입 통로.
function isAllowedUrl(url) {
  if (url === "about:blank") return true;
  try { const u = new URL(String(url)); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}

// will-attach-webview — 렌더러가 무슨 속성을 줬든 main이 덮어쓴다. 조건 안 맞으면 붙이기 자체 거부.
function hardenWebview(event, webPreferences, params) {
  if (!isAllowedUrl(params.src || "about:blank") || (params.partition && params.partition !== PARTITION)) { event.preventDefault(); return; }
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
  params.partition = PARTITION;
}

// 붙여넣기 쓰기·전체화면만 허용, 나머지(카메라·마이크·위치·알림 등) 거부.
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);
const hardenedSessions = new WeakSet();

// 앱 단축키 조합 — packages/core/src/shortcuts.ts chordFromEvent·tokenOf와 같은 규칙(바꾸면 같이). cjs라 import 불가.
// 창(호스트 렌더러)별 — 단축키 처리기가 있는 메인 창만 보냄. 분리 브라우저 창은 없음 → 그 창 페이지는 키를 그대로 받음.
const appChordsByHost = new Map(); // host webContents id → Set
function setAppChords(hostId, list) { appChordsByHost.set(hostId, new Set(Array.isArray(list) ? list.filter((c) => typeof c === "string") : [])); }
const CODE_TOKEN = {
  BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", Comma: ",", Period: ".", Slash: "/", Semicolon: ";",
  Quote: "'", Backquote: "`", Backslash: "\\", Enter: "Enter", Tab: "Tab", Space: "Space", Backspace: "Backspace", Escape: "Escape",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", NumpadAdd: "=", NumpadSubtract: "-",
};
function tokenOf(code) {
  const c = String(code || "");
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return c.slice(6);
  if (/^F([1-9]|1[0-2])$/.test(c)) return c;
  return CODE_TOKEN[c] ?? null;
}
function chordOf(input, isMac) {
  const key = tokenOf(input.code);
  if (!key) return null;
  const mods = [];
  if (isMac ? input.meta : input.control) mods.push("Mod");
  if (isMac && input.control) mods.push("Ctrl");
  if (input.alt) mods.push("Alt");
  if (input.shift) mods.push("Shift");
  return mods.length ? [...mods, key].join("+") : null;
}

function wireGuest(guest) {
  // 팝업(target=_blank·window.open) — 새 창 대신 같은 webview에서 이동.
  guest.setWindowOpenHandler(({ url }) => { if (isAllowedUrl(url)) void guest.loadURL(url); return { action: "deny" }; });
  guest.on("will-navigate", (e, url) => { if (!isAllowedUrl(url)) e.preventDefault(); });
  guest.on("will-redirect", (e, url) => { if (!isAllowedUrl(url)) e.preventDefault(); });
  const ses = guest.session;
  if (!hardenedSessions.has(ses)) {
    hardenedSessions.add(ses);
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOWED_PERMISSIONS.has(perm)));
    ses.setPermissionCheckHandler((_wc, perm) => ALLOWED_PERMISSIONS.has(perm));
  }
  // 포커스된 guest는 별도 Chromium 프로세스라 키가 앱 렌더러에 안 온다 → 앱 단축키 조합만 페이지 대신 앱으로(#1034 리뷰).
  // 나머지 키(⌘C·⌘F 등)는 페이지가 그대로 받음. 조합 목록은 렌더러가 설정(덮어쓰기) 반영해 보내줌(setAppChords).
  guest.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const host = guest.hostWebContents;
    if (!host || host.isDestroyed()) return;
    const chord = chordOf(input, process.platform === "darwin");
    if (!chord || !appChordsByHost.get(host.id)?.has(chord)) return;
    e.preventDefault();
    host.send("browser:key", { code: input.code, key: input.key, metaKey: !!input.meta, ctrlKey: !!input.control, altKey: !!input.alt, shiftKey: !!input.shift });
  });
}

// app.on("web-contents-created") 한 곳에 연결 — 모든 창(메인·모드·분리 브라우저 창)에 적용.
function installBrowserGuestPolicy(app) {
  app.on("web-contents-created", (_e, contents) => {
    if (contents.getType() === "webview") wireGuest(contents);
    else contents.on("will-attach-webview", hardenWebview);
  });
}

module.exports = { installBrowserGuestPolicy, hardenWebview, isAllowedUrl, setAppChords, chordOf, PARTITION };

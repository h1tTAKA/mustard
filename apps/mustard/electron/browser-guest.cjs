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
  // 포커스된 guest는 별도 Chromium 프로세스라 키가 앱 렌더러에 안 온다 → ⌘/Ctrl 조합만 복사해서 호스트에 전달.
  // preventDefault 안 함 — 페이지도 그대로 받음(⌘C 복사 등). 앱 단축키 dispatcher는 등록된 조합만 반응.
  guest.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || !(input.meta || input.control)) return;
    const host = guest.hostWebContents;
    if (!host || host.isDestroyed()) return;
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

module.exports = { installBrowserGuestPolicy, hardenWebview, isAllowedUrl, PARTITION };

// 일렉트론 셸 — nunopi(Next 앱)를 데스크톱 창으로 감싼다.
// dev: ELECTRON_START_URL(예: http://localhost:3000) 로드(next dev 병행, HMR).
// prod: .next/standalone/server.js를 동적 포트로 spawn 후 그 localhost 로드.
// #981 다른 require·spawn보다 먼저 — 이후 모든 자식(데몬·서버·SNA)이 정리된 env를 상속.
require("./claude-env.cjs").stripParentClaudeEnv(process.env);
const { app, BrowserWindow, Menu, shell, ipcMain, Notification, dialog, clipboard, safeStorage } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync } = require("node:fs");
const {
  startSnaServer,
  resolveClaudeCli,
  resolveCodexCli,
  resolveOpenCodeCli,
} = require("@sna-sdk/core/electron");
const { spawn } = require("node:child_process");
const { createDaemonClient } = require("./daemon-client.cjs");
const { removeRepoHooks } = require("./agent-hooks.cjs");
const { installClaudeHooks } = require("./claude-hooks.cjs");
const { getProviderUsage } = require("./provider-usage.cjs");
const { startWatch, stopWatch, stopAll: stopAllWatchers } = require("./repo-watcher.cjs");
const { seen: seenText, freshLines } = require("./narration-dedupe.cjs");
const { loadSeen, saveSeen } = require("./narration-seen-store.cjs"); // #1031 레포별 디스크 저장 // #1019 재그리기 중복 내레이션 방지
const { installBrowserGuestPolicy, isAllowedUrl: isBrowserUrl, setAppChords } = require("./browser-guest.cjs"); // #1034 인앱 브라우저
const githubBridge = require("./github-bridge.cjs"); // GitHub 패널(#809/#810) gh CLI 브릿지
const { join, dirname } = require("node:path");

// Mustard 리브랜딩(#900) — app 이름이 "nunopi"→"Mustard"로 바뀌며 userData 디렉터리도 바뀐다.
// 옛 "nunopi" userData(sqlite·Local Storage·설정)를 새 "Mustard" userData로 1회 복사해 데이터 보존.
// 이미 이관했거나(플래그) 새 쪽에 같은 파일이 있으면 덮지 않음(force:false). 실패해도 앱은 정상 기동.
function migrateUserData() {
  try {
    const cur = app.getPath("userData");           // 새(Mustard)
    const old = join(dirname(cur), "nunopi");       // 옛(nunopi)
    const flag = join(cur, ".migrated-from-nunopi");
    if (!existsSync(old) || existsSync(flag) || old === cur) return;
    mkdirSync(cur, { recursive: true });
    cpSync(old, cur, { recursive: true, force: false, errorOnExist: false });
    writeFileSync(flag, `migrated from ${old}\n`);
    console.log(`[migrate] userData ${old} → ${cur} 복사 완료`);
  } catch (e) {
    console.warn("[migrate] userData 이관 실패(무시, 앱은 정상 기동):", String(e?.message || e));
  }
}
const net = require("node:net");

// 빈 포트 하나 확보(패키지엔 devDep get-port가 없으므로 노드 net로 자체 구현).
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// 특정 포트가 비어 있는지 확인.
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

// Next 서버 포트는 origin(host:port)이 곧 IndexedDB/localStorage 저장소 키라
// 매 실행 같아야 이력·북마크가 유지된다. 첫 실행에 빈 포트를 잡아 userData에
// 영속하고 이후 재사용. (SNA 포트는 origin 무관이라 동적 유지.)
async function getStableAppPort() {
  const file = join(app.getPath("userData"), "app-port.json");
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"))?.port;
    if (Number.isInteger(saved) && (await isPortFree(saved))) return saved;
    if (Number.isInteger(saved)) {
      // 점유(외부 앱, 레어) — 새 포트로 갱신. origin이 바뀌어 기존 저장소와 분리되므로 경고.
      console.warn(`[electron] saved app port ${saved} in use — reallocating (stored data origin will change)`);
    }
  } catch { /* 첫 실행 */ }
  const port = await getFreePort();
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(file, JSON.stringify({ port }));
  } catch (e) { console.warn("[electron] app-port persist failed:", String(e)); }
  return port;
}

const DEV_URL = process.env.ELECTRON_START_URL; // 있으면 dev 모드
let serverProc = null;
let snaHandle = null;
let win = null;

// resolver 실패(미설치)를 삼켜 경로만 반환.
function safeResolve(fn) {
  try { const r = fn(); return r?.path; } catch { return undefined; }
}

// 유저가 설정 UI에서 지정한 런타임 CLI 경로 — userData/runtime-paths.json 영속.
// 부팅 시 saved > env(NUNOPI_*_COMMAND) > resolver 우선순위로 반영("재시작 후 적용").
const RUNTIME_PATH_KEYS = ["claudeCode", "codex", "opencode", "gh"]; // gh=GitHub CLI(#810), 설정서 경로 지정 가능(없으면 PATH의 gh)
function runtimePathsFile() {
  return join(app.getPath("userData"), "runtime-paths.json");
}
function loadSavedRuntimePaths() {
  try {
    const raw = JSON.parse(readFileSync(runtimePathsFile(), "utf8"));
    const out = {};
    for (const k of RUNTIME_PATH_KEYS) {
      if (typeof raw?.[k] === "string" && raw[k].trim()) out[k] = raw[k].trim();
    }
    return out;
  } catch (e) {
    // 파일 없음(첫 실행)은 정상. 그 외(손상 json 등)는 경고만 남기고 빈 설정으로.
    if (e?.code !== "ENOENT") console.warn("[runtime-paths] load failed:", String(e));
    return {};
  }
}
function saveRuntimePaths(paths) {
  const out = {};
  for (const k of RUNTIME_PATH_KEYS) {
    if (typeof paths?.[k] === "string" && paths[k].trim()) out[k] = paths[k].trim();
  }
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(runtimePathsFile(), JSON.stringify(out, null, 2));
  return out;
}

// 런타임 서버를 electron main이 소유(전체 node_modules + asar/native 자동 처리).
// standalone Next는 이 서버에 env로 연결(자체 임베드는 트레이스 누락으로 불가).
async function startRuntimeServer() {
  const saved = loadSavedRuntimePaths();
  const runtimePaths = {
    claudeCode: saved.claudeCode || process.env.NUNOPI_CLAUDE_COMMAND?.trim() || safeResolve(resolveClaudeCli),
    codex: saved.codex || process.env.NUNOPI_CODEX_COMMAND?.trim() || safeResolve(resolveCodexCli),
    opencode: saved.opencode || process.env.NUNOPI_OPENCODE_COMMAND?.trim() || safeResolve(resolveOpenCodeCli),
  };
  for (const k of Object.keys(runtimePaths)) if (!runtimePaths[k]) delete runtimePaths[k];
  console.log("[sna] runtimePaths:", JSON.stringify(runtimePaths));
  // 주의: forked 런타임 서버는 better-sqlite3(네이티브)를 로드한다. 패키징(③)에서
  // electron ABI로 rebuild한 뒤 { nativeBinding } 경로를 넘겨야 electron-owned 실행이 됨
  // (미rebuild면 "compiled for a different Node.js version"). ③에서 nativeBinding 추가.
  // 패키지 앱(asar:false): SNA fork(RUN_AS_NODE)가 로드할 better-sqlite3를 electron-ABI 앱 사본으로 명시(#684 ③).
  const nativeBinding = app.isPackaged
    ? join(process.resourcesPath, "app", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")
    : undefined;
  return startSnaServer({
    appId: "nunopi",
    port: await getFreePort(), // 3099 고정 대신 빈 포트(충돌 방지)
    dbPath: join(app.getPath("userData"), "sna.db"),
    runtimePaths,
    ...(nativeBinding ? { nativeBinding } : {}),
    onLog: (l) => { if (/ready|error|fail/i.test(l)) console.log("[sna]", l); },
  });
}

// standalone 서버 spawn(prod). extraEnv(런타임 커넥션)를 주입. 준비되면 baseUrl 반환.
async function startStandaloneServer(extraEnv) {
  const port = await getStableAppPort();
  // 패키지: standalone은 extraResources로 process.resourcesPath/standalone.
  // 미패키지(electron electron/main.cjs): <appRoot>/.next/standalone.
  // 모노레포 standalone은 앱별로 중첩 산출(#898): standalone/apps/mustard/server.js.
  const serverJs = app.isPackaged
    ? join(process.resourcesPath, "standalone", "apps", "mustard", "server.js")
    : join(__dirname, "..", ".next", "standalone", "apps", "mustard", "server.js");
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: dirname(serverJs), // #1000 open/Dock 실행 시 cwd="/" — cwd 기준 resolve가 엉뚱한 곳을 보지 않게(이중 안전)
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ELECTRON_RUN_AS_NODE: "1", // electron 바이너리를 순수 node로 실행
    },
    stdio: "inherit",
  });
  serverProc.on("exit", (code) => { if (code) console.error("[electron] standalone server exited", code); });

  const base = `http://127.0.0.1:${port}`;
  await waitReady(`${base}/api/sna/status`);
  return base;
}

async function waitReady(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 503) return; // 503=SNA 미기동이어도 서버 자체는 살아있음
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

// 창 공통 배선 — 외부 링크 처리 + 전체화면 통지(#779). 메인 창·모드 전용 창(#789) 공유.
function wireWindowCommon(w) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  w.on("enter-full-screen", () => w.webContents.send("window:fullscreen", true));
  w.on("leave-full-screen", () => w.webContents.send("window:fullscreen", false));
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    // 타이틀바 숨기고 신호등만 — 콘텐츠(탭 바)가 최상단까지(#779, Orca·옵시디언式).
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 13 }, // 탭 바 높이 세로 중앙에 신호등
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // #1034 인앱 브라우저 — guest 설정은 browser-guest.cjs가 강제
    },
  });
  win.loadURL(url);
  wireWindowCommon(win);
  // 메인 창 렌더러가 리로드/재네비게이트되면(새로고침·크래시 복구) 그 렌더러가 들고 있던 "탭" 모드 점유는
  // release 없이 사라져 stale로 남는다("이미 열려 있어요" 오탐). 실제 페이지 이동 시 탭 점유를 전부 해제(#872).
  // did-navigate는 SPA 내부 라우팅(did-navigate-in-page)엔 안 걸려 정상 탭 점유는 안 건드린다.
  win.webContents.on("did-navigate", () => clearModeTabClaims());
  win.on("closed", () => { win = null; });
}

// 모드 전용 창(#789) — 그 모드만 보이는 별도 창. appBase에 ?win=<kind> 를 붙여 로드.
// 렌더러(page.tsx)가 win 파라미터를 읽어 windowMode로 렌더한다. 반환된 창을 호출부가 추적.
function createModeWindow(kind, extra = {}) {
  const sep = appBase.includes("?") ? "&" : "?";
  const w = new BrowserWindow({
    width: 1100,
    height: 820,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // #1034 인앱 브라우저 — guest 설정은 browser-guest.cjs가 강제
    },
  });
  const qs = Object.entries(extra).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  w.loadURL(`${appBase}${sep}win=${encodeURIComponent(kind)}${qs}`);
  wireWindowCommon(w);
  return w;
}

// 크로스창 모드 중복 레지스트리(#789) — 한 모드(ask/code/text)는 탭으로든 창으로든 한 번만.
// 탭은 메인 창 렌더러 메모리, 창은 별도 프로세스라 서로 못 보므로 main이 단일 소스로 든다.
// 창 닫힘은 아래 mode-window:open에서 release로 자동 해제(크래시에도 누수 없음).
const openModes = new Map(); // kind -> "tab" | "window"
function broadcastModes() {
  const kinds = [...openModes.keys()];
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send("modes:changed", kinds); } catch { /* 창 파괴 중 무시 */ }
  }
}
function claimMode(kind, where) {
  if (openModes.has(kind)) return false;
  openModes.set(kind, where);
  broadcastModes();
  return true;
}
function releaseMode(kind) {
  if (openModes.delete(kind)) broadcastModes();
}
// 메인 창 리로드 시 "탭" 점유 전부 해제(#872) — 리로드된 렌더러가 실제로 가진 모드 탭은 마운트 시 재점유(mode:claim)한다.
// "window" 점유는 별도 창이라 안 건드림(창 닫힘 시 자체 해제).
function clearModeTabClaims() {
  let changed = false;
  for (const [k, where] of openModes) if (where === "tab") { openModes.delete(k); changed = true; }
  if (changed) broadcastModes();
}

// #989 관리형 Claude 훅 설치(비동기, 실패해도 앱 정상) — appBase 확정 후. 화면 긁기는 안전망으로 유지.
// 부팅 토큰 — standalone 서버 env(MUSTARD_HOOK_TOKEN)와 엔드포인트 파일에만. dev(next dev 별도 기동)는 env가 없어 검사 생략.
const HOOK_TOKEN = require("node:crypto").randomBytes(16).toString("hex");
function setupClaudeHooks(base, token) {
  const saved = loadSavedRuntimePaths();
  const cliPath = saved.claudeCode || process.env.NUNOPI_CLAUDE_COMMAND?.trim() || safeResolve(resolveClaudeCli);
  installClaudeHooks({ userData: app.getPath("userData"), appBase: base, cliPath, token })
    .then((r) => console.log("[claude-hooks]", JSON.stringify(r)))
    .catch((e) => console.warn("[claude-hooks] failed:", String(e?.message || e)));
}

async function boot() {
  migrateUserData(); // #900 리브랜딩 — 옛 nunopi userData 1회 이관(창·서버 뜨기 전)
  try { loadRegistry(); } catch { /* #864 재시작 생존 세션 신원 복원 */ }
  if (DEV_URL) {
    // dev: next dev가 자체 임베드(간섭 방지) → main은 SNA 안 띄움.
    appBase = DEV_URL; // #765 버퍼 드라이버 POST 대상
    setupClaudeHooks(DEV_URL, "");
    createWindow(DEV_URL);
    return;
  }
  // prod: main이 런타임 서버 소유 → 커넥션을 standalone Next에 env로 주입.
  snaHandle = await startRuntimeServer();
  const base = await startStandaloneServer({
    SNA_BASE_URL: snaHandle.connection.baseUrl,
    SNA_AUTH_TOKEN: snaHandle.connection.authToken,
    MUSTARD_HOOK_TOKEN: HOOK_TOKEN,
  });
  appBase = base; // #765 버퍼 드라이버 POST 대상
  setupClaudeHooks(base, HOOK_TOKEN);
  createWindow(base);
}

// 설정 UI(renderer) ↔ main IPC — 런타임 CLI 경로 저장/조회 + 재시작.
ipcMain.handle("window:isFullscreen", () => win?.isFullScreen() ?? false); // 초기 전체화면 상태(#779)
// 클립보드 이미지 → 임시 PNG 저장(#799) — 터미널 Cmd+V 이미지 붙여넣기. 경로를 렌더러가 터미널에 주입.
ipcMain.handle("clipboard:save-image", () => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { ok: false };
    const p = join(app.getPath("temp"), `nunopi-paste-${Date.now()}.png`);
    writeFileSync(p, img.toPNG());
    return { ok: true, path: p };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
// 모드 전용 창 열기(#789) — 유효 kind + 아직 어디에도 안 떠 있을 때만. 창 닫히면 자동 해제.
ipcMain.handle("mode-window:open", (_e, kind) => {
  if (kind !== "ask" && kind !== "code" && kind !== "text" && kind !== "memorize") return { ok: false, reason: "invalid" };
  if (!appBase) return { ok: false, reason: "not-ready" }; // boot() 전엔 URL 없음(가드; 실제론 렌더러 IPC가 항상 이후)
  if (!claimMode(kind, "window")) return { ok: false, reason: "exists" };
  try {
    const w = createModeWindow(kind);
    w.on("closed", () => releaseMode(kind));
  } catch (e) {
    releaseMode(kind); // 창 생성 실패 시 점유 해제 — 안 하면 영구 점유로 영영 못 엶.
    return { ok: false, reason: "error", error: String(e?.message || e) };
  }
  return { ok: true };
});
// 인앱 브라우저 분리 창(#1034) — 멀티 모니터. 같은 앱 페이지를 ?win=browser 로 띄우고 BrowserPane만 렌더.
// 모드 창과 달리 여러 개 허용(레포·사이트별로 여러 화면에 띄울 수 있게).
ipcMain.handle("browser-window:open", (_e, payload) => {
  const url = String(payload?.url || "");
  const repo = String(payload?.repo || "");
  if (url && !isBrowserUrl(url)) return { ok: false, reason: "invalid" };
  if (!appBase) return { ok: false, reason: "not-ready" };
  try {
    const w = createModeWindow("browser", { url, repo });
    w.setTitle("Browser");
  } catch (e) { return { ok: false, reason: "error", error: String(e?.message || e) }; }
  return { ok: true };
});
// 인앱 브라우저 포커스 중 앱이 가져갈 단축키 조합(#1034) — 렌더러가 설정 반영해 보냄.
ipcMain.on("browser:set-chords", (_e, list) => setAppChords(list));
// 탭 쪽 모드 점유/해제/조회(#789) — 메인 창 렌더러가 모드 탭 추가·닫기·복원 시 호출.
ipcMain.handle("mode:claim", (_e, kind) => ({ ok: claimMode(kind, "tab") }));
ipcMain.handle("mode:release", (_e, kind) => { releaseMode(kind); return { ok: true }; });
ipcMain.handle("mode:isOpen", (_e, kind) => openModes.has(kind));
ipcMain.handle("mode:list", () => [...openModes.keys()]);
ipcMain.handle("runtime-paths:get", () => loadSavedRuntimePaths());
ipcMain.handle("runtime-paths:set", (_e, paths) => ({ ok: true, saved: saveRuntimePaths(paths) }));
// GitHub 패널(#810) — gh 경로는 설정값 우선, 없으면 PATH의 gh. IPC로 인증 상태 진단(서브3~5가 데이터 IPC 추가).
const ghExe = () => loadSavedRuntimePaths().gh || "gh";

// 토큰(PAT) 폴백(#826, 서브6) — gh auth login 없이 PAT를 GH_TOKEN으로 주입.
// safeStorage(OS 키체인)로 암호화 저장. 값은 렌더러 비노출(존재 여부만).
function ghTokenFile() { return join(app.getPath("userData"), "gh-token.json"); }
function loadGhToken() {
  try {
    const { enc } = JSON.parse(readFileSync(ghTokenFile(), "utf8"));
    if (!enc || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(enc, "base64")) || null;
  } catch { return null; } // 파일 없음/복호화 실패 → 토큰 없음
}
function saveGhToken(token) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, detail: "이 환경은 안전한 토큰 저장을 지원하지 않음(safeStorage 불가)" };
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    const enc = safeStorage.encryptString(String(token)).toString("base64");
    writeFileSync(ghTokenFile(), JSON.stringify({ enc }));
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e?.message || e).slice(0, 300) }; // 디스크 풀·권한 등 → reject 대신 에러 객체
  }
}
function clearGhToken() { try { rmSync(ghTokenFile()); } catch { /* 없으면 무시 */ } }
// gh 실행 env — 저장된 토큰 있으면 GH_TOKEN 주입, 없으면 기본 env(undefined → 브릿지가 process.env).
function ghEnv() { const tok = loadGhToken(); return tok ? { ...process.env, GH_TOKEN: tok } : undefined; }

// 연동 확장(#960) — 호스트별 토큰(safeStorage). gh(github)는 위 전용 함수, 여기선 bitbucket/azure.
const TOKEN_HOSTS = ["bitbucket", "azure", "vercel", "supabase"];
const glabExe = () => loadSavedRuntimePaths().glab || "glab";
function hostTokenFile(host) { return join(app.getPath("userData"), `token-${host}.json`); }
function loadHostToken(host) {
  try {
    const { enc } = JSON.parse(readFileSync(hostTokenFile(host), "utf8"));
    if (!enc || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(enc, "base64")) || null;
  } catch { return null; }
}
function saveHostToken(host, token) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, detail: "이 환경은 안전한 토큰 저장을 지원하지 않음(safeStorage 불가)" };
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    const enc = safeStorage.encryptString(String(token)).toString("base64");
    writeFileSync(hostTokenFile(host), JSON.stringify({ enc }));
    return { ok: true };
  } catch (e) { return { ok: false, detail: String(e?.message || e).slice(0, 300) }; }
}
function clearHostToken(host) { try { rmSync(hostTokenFile(host)); } catch { /* 없으면 무시 */ } }

// 토큰 IPC(#826) — set(저장)/status(존재 여부만)/clear(삭제).
ipcMain.handle("github:set-token", (_e, { token }) => {
  if (typeof token !== "string" || !token.trim()) return { ok: false, detail: "빈 토큰" };
  return saveGhToken(token.trim());
});
ipcMain.handle("github:token-status", () => ({ hasToken: loadGhToken() != null }));
ipcMain.handle("github:clear-token", () => { clearGhToken(); return { ok: true }; });

// 연동 확장(#960) — GitLab glab 감지(authDiagnose 재사용) + bitbucket/azure 토큰.
ipcMain.handle("integrations:glab-status", (_e, { cwd } = {}) => githubBridge.authDiagnose({ gh: glabExe(), cwd: cwd || undefined, env: undefined }));

// GitLab 조회(#964) — glab JSON을 GitHub 형태(GhPr/GhIssue)로 정규화해 UI 재사용.
function glState(s) { const v = String(s || "").toLowerCase(); return v === "merged" ? "MERGED" : v === "closed" ? "CLOSED" : "OPEN"; } // opened/locked → OPEN
function glActor(a) { return { login: a?.username || a?.name || "", name: a?.name }; }
function glLabels(ls) { return (Array.isArray(ls) ? ls : []).map((l) => ({ name: typeof l === "string" ? l : (l?.name || ""), color: (l && l.color) || "" })); }
function mapGlMr(m) { return { number: m.iid, title: m.title || "", state: glState(m.state), isDraft: !!(m.draft || m.work_in_progress), author: glActor(m.author), createdAt: m.created_at || "", updatedAt: m.updated_at || "", statusCheckRollup: [] }; }
function mapGlIssue(i) { return { number: i.iid, title: i.title || "", state: glState(i.state), labels: glLabels(i.labels), author: glActor(i.author), createdAt: i.created_at || "", updatedAt: i.updated_at || "" }; }
async function glJsonList(cwd, args, mapper) {
  const r = await githubBridge.ghJson({ gh: glabExe(), cwd: cwd || undefined, env: undefined, args });
  if (!r.ok) return r;
  return { ok: true, data: (Array.isArray(r.data) ? r.data : []).map(mapper) };
}
async function glJsonOne(cwd, args, mapper) {
  const r = await githubBridge.ghJson({ gh: glabExe(), cwd: cwd || undefined, env: undefined, args });
  if (!r.ok) return r;
  return { ok: true, data: mapper(r.data) };
}
// glab state 인자: opened/closed/merged/all(gh와 다름). gh 필터(open/closed/all) → glab 매핑.
function glStateArg(state) { return state === "closed" ? "closed" : state === "all" ? "all" : "opened"; }
ipcMain.handle("integrations:glab-mr-list", (_e, { cwd, state, limit }) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 1000);
  return glJsonList(cwd, ["mr", "list", "--output", "json", "--state", glStateArg(state), "--per-page", String(lim)], mapGlMr);
});
ipcMain.handle("integrations:glab-mr-view", (_e, { cwd, number }) => {
  const n = Number(number); if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid mr number" };
  return glJsonOne(cwd, ["mr", "view", String(n), "--output", "json"], (m) => ({ ...mapGlMr(m), assignees: (m.assignees || []).map(glActor), body: m.description || "", comments: [], mergeStateStatus: "", url: m.web_url || "", reactionGroups: [] }));
});
ipcMain.handle("integrations:glab-issue-list", (_e, { cwd, state, limit }) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 1000);
  return glJsonList(cwd, ["issue", "list", "--output", "json", "--state", glStateArg(state), "--per-page", String(lim)], mapGlIssue);
});
ipcMain.handle("integrations:glab-issue-view", (_e, { cwd, number }) => {
  const n = Number(number); if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid issue number" };
  return glJsonOne(cwd, ["issue", "view", String(n), "--output", "json"], (i) => ({ ...mapGlIssue(i), assignees: (i.assignees || []).map(glActor), milestone: i.milestone ? { title: i.milestone.title } : null, body: i.description || "", comments: [], url: i.web_url || "", reactionGroups: [] }));
});
ipcMain.handle("integrations:set-token", (_e, { host, token }) => {
  if (!TOKEN_HOSTS.includes(host)) return { ok: false, detail: "invalid host" };
  if (typeof token !== "string" || !token.trim()) return { ok: false, detail: "빈 토큰" };
  return saveHostToken(host, token.trim());
});
ipcMain.handle("integrations:token-status", (_e, { host }) => ({ hasToken: TOKEN_HOSTS.includes(host) && loadHostToken(host) != null }));
ipcMain.handle("integrations:clear-token", (_e, { host }) => { if (TOKEN_HOSTS.includes(host)) clearHostToken(host); return { ok: true }; });

ipcMain.handle("github:auth", (_e, { cwd }) => githubBridge.authDiagnose({ gh: ghExe(), cwd, env: ghEnv() }));
// 이슈 목록·상세(#813) — gh issue list/view --json. state=open|closed|all(기본 open).
ipcMain.handle("github:issue-list", (_e, { cwd, state, limit }) => {
  const st = state === "closed" ? "closed" : state === "all" ? "all" : "open";
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 1000); // 1..1000 클램프(더 보기 페이지네이션)
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["issue", "list", "--json", "number,title,state,labels,author,createdAt,updatedAt", "--state", st, "--limit", String(lim)] });
});
ipcMain.handle("github:issue-view", (_e, { cwd, number }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid issue number" }; // 숫자만(플래그 오인 방지)
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["issue", "view", String(n), "--json", "number,title,state,labels,author,assignees,milestone,body,comments,createdAt,url,reactionGroups"] });
});
// 이슈 생성(#945) — 성공 시 stdout=생성된 이슈 URL. labels=쉼표 구분 → 각 --label.
ipcMain.handle("github:issue-create", (_e, { cwd, title, body, labels }) => {
  if (!title || typeof title !== "string" || !title.trim()) return { ok: false, kind: "error", detail: "title required" };
  const args = ["issue", "create", "--title", title.trim(), "--body", typeof body === "string" ? body : ""];
  if (typeof labels === "string" && labels.trim()) {
    for (const l of labels.split(",").map((x) => x.trim()).filter(Boolean)) args.push("--label", l);
  }
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args });
});
// PR 목록·상세(#814) — gh pr list/view --json. statusCheckRollup=CI 체크(서브3 재사용).
ipcMain.handle("github:pr-list", (_e, { cwd, state, limit }) => {
  const st = state === "closed" ? "closed" : state === "all" ? "all" : "open";
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 1000);
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "list", "--json", "number,title,state,isDraft,author,createdAt,updatedAt,statusCheckRollup", "--state", st, "--limit", String(lim)] });
});
ipcMain.handle("github:pr-view", (_e, { cwd, number }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid pr number" };
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "view", String(n), "--json", "number,title,state,isDraft,author,createdAt,assignees,body,comments,statusCheckRollup,mergeStateStatus,url,reactionGroups"] });
});
// 현재 브랜치 CI(#812) — gh pr view(번호 없이 = 현재 브랜치 PR)로 statusCheckRollup. PR 없으면 {noPr:true}.
ipcMain.handle("github:checks", async (_e, { cwd }) => {
  const r = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "view", "--json", "number,title,state,statusCheckRollup,url,headRefName"] });
  if (!r.ok && /no pull requests found|no default remote|not found/i.test(r.detail || "")) return { ok: true, data: { noPr: true } };
  return r;
});
// 체크 주석(#812) — gh api로 check-run annotations(경고/에러). id는 detailsUrl서 파싱한 job id.
ipcMain.handle("github:check-annotations", (_e, { cwd, checkRunId }) => {
  const id = Number(checkRunId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid check id" };
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/check-runs/${id}/annotations`] });
});
// 작업(job) 스텝 흐름(#812) — Actions job의 steps(Set up job…Complete job). job id=detailsUrl의 job id.
ipcMain.handle("github:job-steps", (_e, { cwd, jobId }) => {
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid job id" };
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/actions/jobs/${id}`, "--jq", "{steps: .steps}"] });
});
// 이슈·PR 코멘트 작성(#820, 첫 write) — gh issue/pr comment. number 정수·body 비어있지 않음 검증.
ipcMain.handle("github:add-comment", (_e, { cwd, kind, number, body }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  if (typeof body !== "string" || !body.trim()) return { ok: false, kind: "error", detail: "empty body" };
  const sub = kind === "pr" ? "pr" : "issue";
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: [sub, "comment", String(n), "--body", body] }); // no-shell, body는 인자(개행·특수문자 안전)
});
// 코멘트 수정/삭제(#820) — issue·PR 대화 코멘트는 공통 issues/comments 엔드포인트. commentId=url의 issuecomment id.
ipcMain.handle("github:edit-comment", (_e, { cwd, commentId, body }) => {
  const id = Number(commentId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid comment id" };
  if (typeof body !== "string" || !body.trim()) return { ok: false, kind: "error", detail: "empty body" };
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${id}`, "-f", `body=${body}`] });
});
ipcMain.handle("github:delete-comment", (_e, { cwd, commentId }) => {
  const id = Number(commentId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid comment id" };
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/comments/${id}`] });
});
// 코멘트 리액션 토글(#820) — 이미 내가 단 리액션이면 삭제, 아니면 추가. content=REST명(+1,-1,laugh…).
const REACTION_CONTENT = new Set(["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"]);
// 캐시 안 함 — gh 계정 전환 시 옛 로그인으로 남의 리액션을 지우는 사고 방지(리뷰 🔴). 토글마다 조회(클릭 액션, 지연 무해).
async function viewerLogin(cwd) {
  const r = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "user", "--jq", "{login: .login}"] });
  return r.ok ? (r.data?.login || null) : null;
}
ipcMain.handle("github:react", async (_e, { cwd, commentId, content }) => {
  const id = Number(commentId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid comment id" };
  if (!REACTION_CONTENT.has(content)) return { ok: false, kind: "error", detail: "invalid reaction" };
  const login = await viewerLogin(cwd);
  const list = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/issues/comments/${id}/reactions`] });
  const mine = list.ok && Array.isArray(list.data) ? list.data.find((r) => r.content === content && r.user?.login === login) : null;
  if (mine) return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/comments/${id}/reactions/${mine.id}`] });
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "POST", `repos/{owner}/{repo}/issues/comments/${id}/reactions`, "-f", `content=${content}`] });
});
// 이슈·PR 본문 리액션 토글(#822) — issues/{n}/reactions(PR도 공통). 코멘트 토글과 동일 로직.
ipcMain.handle("github:body-react", async (_e, { cwd, number, content }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  if (!REACTION_CONTENT.has(content)) return { ok: false, kind: "error", detail: "invalid reaction" };
  const login = await viewerLogin(cwd);
  const list = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/issues/${n}/reactions`] });
  const mine = list.ok && Array.isArray(list.data) ? list.data.find((r) => r.content === content && r.user?.login === login) : null;
  if (mine) return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/${n}/reactions/${mine.id}`] });
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "POST", `repos/{owner}/{repo}/issues/${n}/reactions`, "-f", `content=${content}`] });
});
// 이슈·PR 제목·본문 편집(#822) — gh issue/pr edit <n> --title/--body. 준 것만 반영.
ipcMain.handle("github:edit-item", (_e, { cwd, kind, number, title, body }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  const sub = kind === "pr" ? "pr" : "issue";
  const args = [sub, "edit", String(n)];
  if (typeof title === "string" && title.trim()) args.push("--title", title);
  if (typeof body === "string" && body.trim()) args.push("--body", body);
  if (args.length === 3) return Promise.resolve({ ok: false, kind: "error", detail: "nothing to edit" });
  return githubBridge.ghRun({ gh: ghExe(), cwd, args });
});
// 이슈·PR 상태 전환(#822) — close/reopen, PR draft↔ready. 화이트리스트로 안전.
ipcMain.handle("github:set-state", (_e, { cwd, kind, number, action }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  const sub = kind === "pr" ? "pr" : "issue";
  if (action === "close") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: [sub, "close", String(n)] });
  if (action === "reopen") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: [sub, "reopen", String(n)] });
  if (sub === "pr" && action === "ready") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "ready", String(n)] });
  if (sub === "pr" && action === "draft") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "ready", String(n), "--undo"] });
  return Promise.resolve({ ok: false, kind: "error", detail: "invalid action" });
});
// PR 머지(#822 추가) — method별 플래그 + 병합 후 브랜치 삭제. 되돌릴 수 없음(렌더러서 확인).
ipcMain.handle("github:merge", (_e, { cwd, number, method }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  const flag = { merge: "--merge", squash: "--squash", rebase: "--rebase" }[method] || "--merge";
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "merge", String(n), flag, "--delete-branch"] });
});
// PR 생성(#944) — 성공 시 stdout=생성된 PR URL. base/head 빈값이면 플래그 생략(gh 기본: 현재 브랜치/origin default).
ipcMain.handle("github:pr-create", (_e, { cwd, base, head, title, body, draft }) => {
  if (!title || typeof title !== "string" || !title.trim()) return { ok: false, kind: "error", detail: "title required" };
  const args = ["pr", "create", "--title", title.trim(), "--body", typeof body === "string" ? body : ""];
  if (base && typeof base === "string" && base.trim()) args.push("--base", base.trim());
  if (head && typeof head === "string" && head.trim()) args.push("--head", head.trim());
  if (draft) args.push("--draft");
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args });
});
ipcMain.handle("app:relaunch", () => { app.relaunch(); app.quit(); });
// Claude·Codex 구독 사용 한도 조회(#735) — 로컬 크레덴셜로 각 provider usage 엔드포인트 호출.
ipcMain.handle("provider-usage:get", () => getProviderUsage());
// 레포 파일 워처(#739) — 변경 시 렌더러에 repo:changed push. 활성 레포당 하나(렌더러가 전환 관리).
ipcMain.handle("repo:watch", (e, { id, root }) => startWatch(id, root, () => { try { e.sender.send("repo:changed", { id }); } catch { /* ignore */ } }));
ipcMain.handle("repo:unwatch", (_e, { id }) => { stopWatch(id); });

// 알림 아이콘 경로 — dev=public, 패키지=standalone/public(존재하는 첫 후보).
function notifyIconPath() {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, "standalone", "public", "brand", "nunopi-appicon-512.png"),
        join(process.resourcesPath, "public", "brand", "nunopi-appicon-512.png"),
      ]
    : [join(__dirname, "..", "public", "brand", "nunopi-appicon-512.png")];
  for (const c of candidates) { try { if (existsSync(c)) return c; } catch { /* ignore */ } }
  return undefined;
}

// 데스크톱 네이티브 알림(분석 완료 등). 창을 보고 있으면(포커스) 스킵 — 안 보고 있을 때만 알림.
ipcMain.handle("notify", (_e, payload) => {
  const { title, body, suppressWhileFocused, silent, target } = payload ?? {};
  if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
  // #928 설정: suppressWhileFocused=false면 포커스여도 알림(기본 true=기존 동작).
  if (suppressWhileFocused !== false && win && win.isFocused()) return { ok: false, reason: "focused" };
  // #939 silent=true면 무음 알림.
  const n = new Notification({ title: title || "nunopi", body: body || "", icon: notifyIconPath(), silent: !!silent });
  n.on("click", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (process.platform === "darwin") app.focus({ steal: true }); // orca: 다른 앱 위에 있을 때도 앞으로
    win.show(); win.focus();
    // #989 그 레포·터미널로 이동 — 렌더러(WorkspaceTabs·LearningHome)가 받아 탭 전환.
    if (target && typeof target.repoPath === "string") win.webContents.send("notify:activate", { repoPath: target.repoPath, sessionId: typeof target.sessionId === "string" ? target.sessionId : undefined });
  });
  n.show();
  return { ok: true };
});

// 레포 폴더 선택 — OS 네이티브 폴더 창. { canceled, path }.
ipcMain.handle("repo:pickFolder", async (_e, opts) => {
  // #939 defaultPath — 설정된 워크스페이스 기본 폴더서 열기.
  const defaultPath = opts && typeof opts.defaultPath === "string" && opts.defaultPath ? opts.defaultPath : undefined;
  const res = await dialog.showOpenDialog(win ?? undefined, { properties: ["openDirectory"], defaultPath });
  if (res.canceled || res.filePaths.length === 0) return { canceled: true };
  return { canceled: false, path: res.filePaths[0] };
});

// ── 터미널 — pty를 detached 데몬(terminal-daemon.cjs)이 소유(#682). 앱 종료에도 세션(프로세스) 생존.
// 메인은 데몬에 소켓 프록시만. terminal:* IPC 계약(ensure/input/resize/kill/data/exit)은 그대로.
const PTY_BUFFER_MAX = 200_000; // 재생용 스크롤백 상한(문자)
const broadcast = (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(channel, payload); } catch { /* ignore */ } } };

// 데몬 스크립트 경로 — 패키지는 extraResources(커밋 4), dev는 electron 폴더.
function daemonScriptPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "electron", "terminal-daemon.cjs")
    : join(__dirname, "terminal-daemon.cjs");
}

// 스크롤백 디스크 영속(#680) — 데몬이 유휴 reap된 뒤(콜드 스타트) 이전 내용 재생용. { id: buffer }.
// 데몬이 살아있는 재접속(warm)이면 데몬 buffer가 진실이라 시드 안 함(중복 재생 방지).
const bufFile = () => join(app.getPath("userData"), "terminal-buffers.json");
let savedBuffers = {};
try { savedBuffers = JSON.parse(readFileSync(bufFile(), "utf8")) || {}; } catch { savedBuffers = {}; }
const liveBuffers = new Map(); // id → buffer  — 데몬 data 미러(디스크 영속용)

// #765 버퍼 스크레이핑 상태 드라이버 — liveBuffers를 파싱해 에이전트 상태를 상태 스토어로 POST(훅 대체).
// 데몬 data 미러라 낡은 데몬·서버 재시작·훅 로드 타이밍과 무관하게 동작.
const { parseAgentScreen, agentFromProcess, stripAnsi, recentTitle, lastTitle } = require("./agent-screen.cjs");
let appBase = null;              // Next 서버 베이스 URL(boot서 설정)
const cwdById = new Map();       // id → cwd(레포 매핑)
const procById = new Map();      // id → foreground 프로세스명(데몬 list) — 에이전트 종료(셸 복귀) 게이트
const lastScreen = new Map();    // id → { state, agent, at, task }(변화·keep-alive 판단)
const screenTimers = new Map();  // id → 디바운스 타이머
const lastTitleRawById = new Map(); // #989 id → 마지막 OSC 타이틀 원문(스트림 전체 추적 — 16KB tail서 밀려도 상태 판정 유지)
const lastTaskById = new Map();  // #970 id → 현재 세션 제목(onData 라이브 추적, 셸 복귀/종료 시 리셋 — 이전 세션 제목 누출 방지)
const mapScreenState = (s) => (s === "idle" ? "done" : s); // 파서 idle → 스토어 done(present/ready)
// 포그라운드가 셸이면 에이전트 종료로 간주(버퍼에 옛 화면이 남아도 무시). herdr도 포그라운드 프로세스로 게이트.
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "pwsh", "powershell", "cmd", "login", "screen", "tmux"]);
const isShellProc = (p) => SHELLS.has(String(p || "").trim().toLowerCase().replace(/^-+/, ""));

// #864 orca식 신원 확정 — 우리가 탭에서 직접 실행한 에이전트를 기록(tabId→agent). 스크레이프 추측 대신
// 이 기록이 신원의 진실(오판 원천 소멸). 셸 복귀(종료) 시 해제. 유저가 손으로 실행하면 기록 없음 → 스크레이프 fallback.
const launchRegistry = new Map(); // id → agent id
// 에이전트 id → 실행 셸 커맨드. runtime 경로 설정 있으면 그걸, 없으면 기본 커맨드명.
const AGENT_DEFAULT_CMD = { claude: "claude", codex: "codex", gemini: "gemini", antigravity: "agy", opencode: "opencode", aider: "aider", cursor: "cursor-agent", copilot: "copilot", amp: "amp", grok: "grok", hermes: "hermes", omp: "omp" };
function agentCommand(agent) {
  const rp = loadSavedRuntimePaths();
  if (agent === "claude") return rp.claudeCode || "claude";
  if (agent === "codex") return rp.codex || "codex";
  if (agent === "opencode") return rp.opencode || "opencode";
  return AGENT_DEFAULT_CMD[agent] || null;
}
// launchRegistry 디스크 영속(#864) — pty는 앱 재시작에도 생존(#682)하는데 registry는 메모리라 재시작 시 날아가
// 살아남은 세션이 스크레이프 fallback으로 오판된다(codex→claude). {id:agent}를 파일에 저장하고 부팅 시 복원.
const registryFile = () => join(app.getPath("userData"), "agent-registry.json");
function saveRegistry() {
  try { const out = {}; for (const [id, reg] of launchRegistry) out[id] = reg.agent; writeFileSync(registryFile(), JSON.stringify(out)); }
  catch { /* 영속 실패 무시 */ }
}
function loadRegistry() {
  try {
    const o = JSON.parse(readFileSync(registryFile(), "utf8"));
    for (const [id, agent] of Object.entries(o)) if (typeof agent === "string" && agent) launchRegistry.set(id, { agent, confirmed: true, at: Date.now() }); // 재시작 전 실행 중이었으니 confirmed
  } catch { /* 파일 없음 등 무시 */ }
}

// 실행 기록 신원 해석 + confirm/clear 관리. reg={agent,confirmed,at}.
// 핵심: 실행 직후엔 foreground가 아직 셸(에이전트 부팅 전)이라, 그때 셸이라고 registry를 지우면 codex가
// 막 떠서 스크레이프 fallback→claude로 오판됨. 그래서 "에이전트가 실제 foreground 점유(non-shell)"를
// 본 뒤에만 confirmed=true, 확정 후 셸 복귀만 종료로 간주(삭제). 미확정+셸=부팅 중이라 신원 유지.
function registryAgent(id, proc) {
  const reg = launchRegistry.get(id);
  if (!reg) return null;
  const shell = proc !== undefined && isShellProc(proc);
  if (!shell) { reg.confirmed = true; return reg.agent; }        // 에이전트 실행 중(확정)
  if (reg.confirmed) { launchRegistry.delete(id); return null; } // 확정 후 셸 = 종료
  if (Date.now() - reg.at > 20000) { launchRegistry.delete(id); return null; } // 20s 내 안 뜨면 포기(오실행)
  return reg.agent;                                              // 부팅 중(미확정 셸) — 신원 유지
}
// 커맨드 basename → agent id. 유저가 셸에 직접 친 실행 커맨드도 잡아 신원 확정(피커 안 써도 정확).
// gemini 제외 — 구글 에이전트는 antigravity(agy)로 통일(#864). agy 커맨드가 antigravity로 매핑.
const CMD_TO_AGENT = { claude: "claude", codex: "codex", agy: "antigravity", antigravity: "antigravity", opencode: "opencode", grok: "grok", omp: "omp", aider: "aider", amp: "amp", copilot: "copilot", hermes: "hermes", "cursor-agent": "cursor", cursor: "cursor" };
const inputBuf = new Map(); // id → 현재 타이핑 중인 라인(개행 전까지 누적)
// pty 입력 스트림을 감시해 "에이전트 실행 커맨드 + Enter"를 감지 → launchRegistry 갱신. 수동 실행도 신원 확정(#864).
// (셸 복귀 시 registry는 이미 해제되므로, 이전 stale 신원이 남아도 새 커맨드가 덮어씀 → codex→claude 오판 소멸.)
function detectLaunchFromInput(id, data) {
  let s = inputBuf.get(id) || "";
  for (const ch of data) {
    const code = ch.charCodeAt(0);
    if (ch === "\r" || ch === "\n") {
      const line = s.trim(); s = "";
      const tok = line.split(/\s+/).filter((tk) => !/^\w+=/.test(tk))[0] || ""; // FOO=bar 같은 env 할당 스킵
      const base = tok.split("/").pop().toLowerCase();
      const agent = CMD_TO_AGENT[base];
      if (agent) launchRegistry.set(id, { agent, confirmed: false, at: Date.now() });
    } else if (code === 0x7f || code === 0x08) { s = s.slice(0, -1); } // backspace
    else if (code === 0x03 || code === 0x15) { s = ""; }               // Ctrl-C / Ctrl-U → 라인 취소
    else if (code >= 0x20) { s += ch; }
  }
  inputBuf.set(id, s.slice(-500)); // 상한(장문 붙여넣기 대비)
}

async function postStatus(body) {
  if (!appBase) return;
  try { await fetch(`${appBase}/api/agent/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { /* 서버 미준비 등 — 다음 틱에 재시도 */ }
}

// #870 터미널 활동 실시간 내레이션 — 에이전트 세션의 버퍼 델타(새 활동)를 관찰해 observe로 보내면
// SNA가 "지금 뭘 하는지 + 개념/용어"를 학습 스트림에 뿜는다. 레포별(cwd 귀속) + 스로틀 + 유의미 델타만.
const narrPending = new Map(); // id → 마지막 내레이션 이후 누적된 새 출력(onData가 append, 관찰기가 소비)
const lastNarr = new Map();   // id → 마지막 내레이션 시각
const lastDiffHash = new Map(); // id → 직전 내레이션에 쓴 git diff 해시(같은 코드 재설명 방지)
// 실제 코드 변경(git diff HEAD) 확보 — 터미널 산문 대신 진짜 코드로 학습(#870). 캡 6KB, 실패 시 "".
// 비동기 execFile — main 이벤트루프 안 막음(동기 execFileSync는 타임아웃까지 최대 3s 블록, UI 프리즈)(cavecrew).
const execFileP = require("node:util").promisify(require("node:child_process").execFile);
async function getGitDiff(cwd) {
  try {
    // *.md 제외 — 문서화(학습정리·작업일지·개념정리 등)는 학습 대상 아님(#870). 코드 변경만.
    const { stdout } = await execFileP("git", ["-C", cwd, "diff", "HEAD", "--unified=1", "--", ".", ":(exclude)*.md"], { encoding: "utf8", timeout: 3000, maxBuffer: 4_000_000 });
    return stdout.length > 6000 ? stdout.slice(0, 6000) + "\n…(diff 생략)" : stdout;
  } catch { return ""; } // 깃 아님·HEAD 없음·타임아웃 등
}
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }
// 스피너/상태줄 노이즈 제거 — 라이브 타이머·상태줄·글리프만인 줄 버림. 알맹이(툴콜·코드·diff·추론)만 남겨
// 내레이션이 "이건 스피너일 뿐" 같은 무의미 카드(토큰 낭비)를 안 만들게(#870).
function stripNoise(text) {
  return String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter((line) => {
    const l = line.trim();
    if (!l) return false;
    if (/\(\d+m?\d*s\b[^)]*tokens?\)/i.test(l)) return false;                 // "(9s · ↓ 9.4k tokens)" 라이브 타이머
    if (/…\s*\(\d/.test(l)) return false;                                     // "Actualizing… (9s"
    if (/esc to interrupt|\? *for shortcuts|auto mode on|shift\+tab|for agents/i.test(l)) return false; // 상태줄
    if (/^[\s✳✱✻✽●○◍◌⏺⠀-⣿]+$/.test(l)) return false;                // 스피너 글리프만(브라유+claude). +/-/*/--- 등 diff·기호는 내용이라 안 버림
    return true;
  }).join("\n").trim();
}
const narrInFlight = new Set(); // 관찰 요청 진행 중인 id(느린 analyze 중복 호출 방지)
// #1019·#1031 "이미 본 텍스트" — 레포(cwd)별 공유 + 디스크 저장. 탭 클릭·재시작 resize 재그리기, 그리고 탭을 닫고 새 탭에서
// `claude --resume`이 예전 대화를 다시 찍는 것(#1031: 세션별·메모리였을 땐 새 탭이 빈 기억이라 전부 재해설)을 새 활동으로 안 봄.
const narrSeenByRepo = new Map(); // cwd → 상태(첫 사용 시 파일에서 로드)
const narrSeenDirty = new Set();  // 저장 대기 레포
const narrSeeded = new Set();     // 기존 화면을 이미 시딩한 세션 id(목록 루프 1회)
const narrOverflow = new Map();   // id → 대기 칸(14000자)에서 밀려난 출력(해설 안 함 → 본 것으로만 흡수)
// #1031 해설 게이트 — 에이전트가 "작업 중"이거나 끝난 지 NARR_WORK_GRACE 이내일 때만 해설. 그 밖의 출력(`--resume`이 다시 찍는
// 예전 대화, 탭 전환 재그리기 등)은 에이전트가 입력 대기 중이라 해설하지 않고 "본 것"으로만 흡수(기억 유무와 무관하게 막힘).
const narrWorkingAt = new Map();  // id → 마지막 "작업 중" 시각(화면 판정)
const NARR_WORK_GRACE = 15000;
function absorbOverflow(id) {
  const raw = narrOverflow.get(id);
  if (!raw) return;
  narrOverflow.delete(id);
  const cwd = cwdById.get(id);
  if (cwd) setRepoSeen(cwd, seenText(repoSeen(cwd), stripNoise(stripAnsi(raw))));
}
const narrSeenDir = () => join(app.getPath("userData"), "narration-seen");
const repoKey = (cwd) => String(cwd || "").replace(/\/+$/, "");
function repoSeen(cwd) {
  const k = repoKey(cwd);
  if (!narrSeenByRepo.has(k)) narrSeenByRepo.set(k, loadSeen(narrSeenDir(), k));
  return narrSeenByRepo.get(k);
}
function setRepoSeen(cwd, state) {
  const k = repoKey(cwd);
  if (narrSeenByRepo.get(k) === state) return;
  narrSeenByRepo.set(k, state); narrSeenDirty.add(k);
}
function flushSeen() { for (const k of narrSeenDirty) saveSeen(narrSeenDir(), k, narrSeenByRepo.get(k)); narrSeenDirty.clear(); }
setInterval(flushSeen, 10000);  // 10초마다 바뀐 레포만
app.on("before-quit", flushSeen); // 종료 시 마지막 저장
// 시딩: 앱이 세션의 기존 화면을 처음 볼 때 "본 것"으로. 아직 내레이션 안 한 꼬리(narrPending)는 빼서 진짜 새 활동은 살림.
function seedSeen(id, buffer) {
  const cwd = cwdById.get(id);
  if (!cwd) return;
  narrSeeded.add(id);
  const raw = String(buffer || "");
  const p = narrPending.get(id) || "";
  const base = p && raw.endsWith(p) ? raw.slice(0, raw.length - p.length) : raw;
  setRepoSeen(cwd, seenText(repoSeen(cwd), stripNoise(stripAnsi(base))));
}
const NARR_INTERVAL = 8000;   // 세션당 최소 간격(더 촘촘히 — 노이즈 필터+SKIP가 무의미 호출 걸러 낭비 안 늘어남)
const NARR_MIN_DELTA = 150;   // 노이즈 제거 후 이만큼 알맹이 있어야 내레이션(스피너-only 스킵)
async function observeActivity(id) {
  const cwd = cwdById.get(id);
  if (!cwd || !appBase) return;
  const proc = procById.get(id);
  if (proc !== undefined && isShellProc(proc)) { narrPending.delete(id); return; } // 셸 = 에이전트 없음
  // 신원: 실행기록(#864) 우선, 없으면 스크레이프. 둘 다 없으면(랜덤 프로세스 로그) 스킵.
  const agent = registryAgent(id, proc) || (parseAgentScreen(liveBuffers.get(id) || "", lastTitleRawById.get(id)) || {}).agent;
  if (!agent) { narrPending.delete(id); return; }
  if (narrInFlight.has(id)) return;                                                 // 이전 관찰 진행 중 — 중복 호출 방지
  const now = Date.now();
  if (now - (lastNarr.get(id) || 0) < NARR_INTERVAL) return;                        // 스로틀
  const raw = narrPending.get(id) || "";
  if (!raw) return;                                                                 // 지난 내레이션 이후 새 출력 없음
  const cleaned = stripNoise(stripAnsi(raw));                                       // 스피너·상태줄 노이즈 제거 → 알맹이만
  narrPending.set(id, "");                                                          // 소비(비움)
  if (now - (narrWorkingAt.get(id) || 0) > NARR_WORK_GRACE) { setRepoSeen(cwd, seenText(repoSeen(cwd), cleaned)); return; } // 작업 중 아님 → 기억만
  const { fresh: delta, state: seenNext } = freshLines(repoSeen(cwd), cleaned);   // #1019·#1031 이미 본 줄(재그리기·resume 재출력) 제거 → 진짜 새 줄만
  setRepoSeen(cwd, seenNext);
  if (delta.length < NARR_MIN_DELTA || !/[a-zA-Z가-힣]/.test(delta)) return;         // 알맹이 없으면 스킵(토큰 낭비 방지)
  // 실제 코드 변경(diff)을 재료로 — 코드가 바뀌었으면 그 diff로 코드 학습. 안 바뀌었으면 diff 없이 탐색/개념 학습.
  const diffFull = await getGitDiff(cwd);
  const dh = diffFull ? djb2(diffFull) : 0;
  const diffChanged = !!diffFull && dh !== lastDiffHash.get(id);
  if (diffChanged) lastDiffHash.set(id, dh);
  const diff = diffChanged ? diffFull : "";                                         // 코드 그대로면 재전송 안 함(같은 코드 재설명 방지)
  lastNarr.set(id, now);
  narrInFlight.add(id);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000); // analyze 행 방지 — 초과 시 중단(다음 델타서 재시도)
  try {
    await fetch(`${appBase}/api/repo/learn/observe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, agent, delta: delta.slice(-5000), diff }), signal: ctrl.signal });
  } catch { /* 서버 미준비·타임아웃 등 — 다음 델타서 재시도 */ }
  finally { clearTimeout(to); narrInFlight.delete(id); }
}
async function pushScreenState(id, screen) {
  const cwd = cwdById.get(id);
  if (!cwd || !appBase) return;
  const proc = procById.get(id);
  const ra = registryAgent(id, proc);                           // #864 실행 기록 신원(부팅 중 셸 유지, 확정 후 종료 해제)
  const shell = proc !== undefined && isShellProc(proc);
  // 활성=liveBuffers(full/fresh), 비활성=데몬 screen 힌트(#840). liveBuffers는 안 건드림(영속 안전).
  const parsed = shell ? null : parseAgentScreen(liveBuffers.get(id) ?? screen, lastTitleRawById.get(id)); // {agent,state}|null
  const procAgent = shell ? null : agentFromProcess(proc);      // 프로세스명으로 "존재" 판정(버퍼 미판정 대비)
  // #989 판정 불가 ≠ 완료(orca staleWorkingTitleClear와 같은 원칙) — 상태를 모르면 직전 상태 유지. 예전엔 "done"으로 떨어져
  // working→done 가짜 전이 → 알림. 첫 보고(직전 없음)만 done.
  const unknownState = lastScreen.get(id)?.state ?? "done";
  let agent, state;
  if (ra) { agent = ra; agentSticky.set(id, ra); state = parsed ? mapScreenState(parsed.state) : unknownState; } // #864 신원=실행기록(sticky도 동기화 — agentForId와 일관), 상태만 스크레이프
  else if (parsed) { agent = parsed.agent; state = mapScreenState(parsed.state); agentSticky.set(id, agent); } // 버퍼가 상태 잡음(working/waiting/유휴→done)
  else if (procAgent) { agent = procAgent; state = unknownState; agentSticky.set(id, agent); }    // 프로세스는 에이전트인데 버퍼 미판정 → 존재
  // 배너 스크롤아웃 등으로 버퍼 미판정이어도, 셸이 아니고 이미 신원이 있으면 유지(#805) — 탭(agentForId)과 동일 sticky.
  // hermes처럼 프로세스명이 python(래퍼 exec)이라 폴백도 안 되는 에이전트가 카드서 사라지던 문제.
  else if (!shell && agentSticky.has(id)) { agent = agentSticky.get(id); state = unknownState; }
  else {
    // 에이전트 없음(종료/셸/미인식) — 이전에 보고했으면 스토어에서 제거해 카드서 사라지게.
    agentSticky.delete(id);
    lastTaskById.delete(id); // #970 셸 복귀(claude 종료) → 이전 세션 제목 폐기(재시작 시 옛 제목 누출 방지)
    lastTitleRawById.delete(id); // #989 같은 이유 — 옛 세션 스피너 타이틀로 새 세션을 working 오판 방지
    if (lastScreen.has(id)) { lastScreen.delete(id); await postStatus({ cwd, sessionId: id, clear: true }); }
    return;
  }
  // #968/#970 세션 작업 제목 — 탭 라벨(terminal.list)과 동일하게 sessionTitleFor 재사용(16KB parse + onData 라이브 추적 lastTaskById).
  const task = sessionTitleFor(id, proc, screen) || undefined;
  const prev = lastScreen.get(id);
  const now = Date.now();
  // #970 fix: task가 빈값↔제목으로 "생기거나 사라질 때"도 재POST(호버 즉시 반영). 작업 중 제목 텍스트만 바뀌는 건
  // 제외(!!로 존재 여부만 비교) → 과POST 방지. 유휴 세션은 상태 변화가 없어 예전엔 30s 뒤에야 제목이 떴음.
  const changed = !prev || prev.state !== state || prev.agent !== agent || (!!prev.task !== !!task);
  if (!changed && prev && now - prev.at < 30000) return; // 같은 상태·제목유무면 30s마다만 재POST(TTL 유지, 과POST 억제)
  lastScreen.set(id, { state, agent, at: now, task });
  if (state === "working") narrWorkingAt.set(id, now); // #1031 해설 게이트용 — 마지막으로 "작업 중"이던 시각
  await postStatus({ cwd, agent, state, sessionId: id, source: "screen", task });
}
function scheduleScreenParse(id) {
  if (screenTimers.has(id)) return; // 코얼레스(버스트 억제)
  screenTimers.set(id, setTimeout(() => { screenTimers.delete(id); void pushScreenState(id); }, 150));
}
// 중앙 검출(#840) — 데몬 전 세션(비활성 포함)을 순회해 스크레이핑. 렌더러 마운트/클릭 무관하게 탭바·호버카드·도트 반영.
// 매 틱 list 한 번(기존 refreshProcs가 하던 것) → procById·cwdById 보강 + screen을 pushScreenState 힌트로.
setInterval(async () => {
  let ss;
  try { ss = await termClient.list(); } catch { return; } // 데몬 미응답 — 다음 틱
  procById.clear();
  for (const s of ss) {
    procById.set(s.id, s.process);
    if (s.cwd && !cwdById.has(s.id)) cwdById.set(s.id, s.cwd); // 비활성(ensure 안 됨) 세션 레포 매핑 보강 — 상태 POST용
  }
  for (const s of ss) void pushScreenState(s.id, s.screen); // liveBuffers.keys()가 아니라 전 세션
  for (const s of ss) absorbOverflow(s.id); // #1031 밀려난 출력 = 본 것(관찰 스로틀·에이전트 판정과 무관하게 매 틱)
  for (const s of ss) if (!narrSeeded.has(s.id)) seedSeen(s.id, liveBuffers.get(s.id) || s.screen); // #1019 앱 시작 시 기존 화면 = 본 것
  for (const s of ss) void observeActivity(s.id);            // #870 활동 델타 → 실시간 내레이션(내부 스로틀)
}, 1200);

// 데몬 소켓 클라이언트 — 죽어있으면 fork(detached,unref)로 스폰. data/exit는 렌더러로 브로드캐스트.
// 소켓 주소 — Windows는 파일 경로 리슨 불가라 네임드 파이프(net이 자동 인식).
// ponytail: 파이프명 고정(단일 유저 가정). 멀티유저 격리 필요 시 userData 해시 접미.
const termSock = process.platform === "win32"
  ? "\\\\.\\pipe\\nunopi-terminal-daemon"
  : join(app.getPath("userData"), "terminal-daemon.sock");
const termClient = createDaemonClient({
  sock: termSock,
  metaFile: join(app.getPath("userData"), "terminal-daemon.json"),
  daemonScript: daemonScriptPath(),
  // fork는 process.execPath(=electron)로 실행 → ELECTRON_RUN_AS_NODE로 순수 node처럼 데몬 구동.
  spawnEnvExtra: { ELECTRON_RUN_AS_NODE: "1", NUNOPI_TERM_SHELL: process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/bash") },
  onData: (id, data) => {
    let b = (liveBuffers.get(id) || "") + data;
    if (b.length > PTY_BUFFER_MAX) b = b.slice(-PTY_BUFFER_MAX);
    liveBuffers.set(id, b);
    // #970 세션 제목 라이브 추적 — 데이터에 OSC 타이틀(ESC]0;/]2;) 있을 때만 최근 tail 스캔(핫패스 보호).
    // 제목이 emit되는 순간 잡아 lastTaskById에 저장 → 유휴에도 유지, 셸 복귀 시 리셋(이전 세션 누출 방지).
    if (data.indexOf("\x1b]0;") >= 0 || data.indexOf("\x1b]2;") >= 0) {
      try { const tt = recentTitle(b); if (tt) lastTaskById.set(id, tt); } catch { /* ignore */ }
      try { const raw = lastTitle(data); if (raw) lastTitleRawById.set(id, raw); } catch { /* ignore */ } // #989 청크 경계에 걸린 OSC는 다음 프레임서 갱신
    }
    let np = (narrPending.get(id) || "") + data; // #870 미내레이션 새 출력 누적(상한 버퍼와 별개 — 델타 유실 방지)
    if (np.length > 14000) {
      // #1031 꼬리 14000자 밖으로 밀려나는 출력은 해설 안 하고 버려짐 — 그래도 "본 것"으로 기억해야 함. 안 그러면 `--resume`이
      // 예전 대화를 쏟아낼 때마다 매번 다른 조각이 꼬리에 걸려 재해설됨(유저 재현: resume마다 다른 해설). 목록 루프에서 흡수.
      // 자르는 위치는 줄바꿈 바로 뒤로(#1032 리뷰) — 14000 지점이 ANSI 제어 코드 한가운데면 양쪽 줄이 깨져 같은 줄로 못 알아봄.
      const nl = np.indexOf("\n", np.length - 14000);
      const cut = nl >= 0 ? nl + 1 : np.length - 14000;
      const ov = (narrOverflow.get(id) || "") + np.slice(0, cut);
      narrOverflow.set(id, ov.length > 1_000_000 ? ov.slice(ov.indexOf("\n", ov.length - 1_000_000) + 1 || ov.length - 1_000_000) : ov);
      np = np.slice(cut);
    }
    narrPending.set(id, np);
    broadcast("terminal:data", { id, data });
    scheduleScreenParse(id); // #765 버퍼 변화 → 상태 파싱(디바운스)
  },
  onExit: (id) => {
    liveBuffers.delete(id); delete savedBuffers[id];
    cwdById.delete(id); lastScreen.delete(id); agentSticky.delete(id); launchRegistry.delete(id); inputBuf.delete(id); ensuredIds.delete(id); narrPending.delete(id); lastNarr.delete(id); narrInFlight.delete(id); narrSeeded.delete(id); narrOverflow.delete(id); narrWorkingAt.delete(id); lastDiffHash.delete(id); lastTaskById.delete(id); // #765·#803·#864·#870·#970 정리
    const tm = screenTimers.get(id); if (tm) { clearTimeout(tm); screenTimers.delete(id); }
    broadcast("terminal:exit", { id });
  },
});

function persistBuffers() {
  const out = { ...savedBuffers }; // 아직 재접속 안 한 id의 저장분 보존
  for (const [id, b] of liveBuffers) out[id] = b.slice(-PTY_BUFFER_MAX);
  try { mkdirSync(app.getPath("userData"), { recursive: true }); writeFileSync(bufFile(), JSON.stringify(out)); } catch { /* ignore */ }
}
setInterval(persistBuffers, 5000); // 크래시 대비 주기 저장(before-quit은 아래 quit 훅서)
setInterval(saveRegistry, 3000);   // #864 실행 기록 영속(재시작 생존 세션 신원 복원용)

ipcMain.handle("terminal:ensure", async (_e, { id, cwd, cols, rows, dark }) => {
  cwdById.set(id, cwd); // #765 버퍼 파서 상태를 이 레포에 매핑
  try { removeRepoHooks(cwd, app.getPath("userData")); } catch { /* 무시 */ } // #765 예전 #764 훅 주입분 정리(버퍼 스크레이핑이 대체)
  const r = await termClient.ensure({ id, cwd, cols, rows, dark }); // #914 배경 밝기 힌트(COLORFGBG) 전달
  if (!r.ok) return { ok: false, reason: r.reason || "daemon unavailable" };
  let buffer = r.buffer || "";
  // 콜드 스타트(데몬 buffer 빔)인데 디스크 저장분 있으면 이전 내용 재생 시드(#680). warm 재접속이면 skip.
  if (!buffer && savedBuffers[id]) buffer = savedBuffers[id] + "\r\n\x1b[2m── 이전 세션 내용(재시작 전) ──\x1b[0m\r\n";
  delete savedBuffers[id]; // 재생 1회 소비(중복 방지)
  liveBuffers.set(id, buffer);
  seedSeen(id, buffer); // #1019 붙는 순간의 기존 화면 = 본 것(곧 이어질 resize 재그리기를 새 활동으로 안 봄)
  ensuredIds.add(id); // #864 pty 준비 완료 — launchAgent가 새 탭에 커맨드 주입 전 이걸 대기
  return { ok: true, buffer };
});
// #989 중단 추정(orca inferInterrupt) — Claude는 Ctrl+C 중단에 훅을 안 보냄 → 그대로 두면 영원히 working.
// Ctrl+C 입력 후 0.5s(orca AGENT_INTERRUPT_SETTLE_MS) 지나 서버에 "그 시각 이후 훅 없으면 중단(알림 없는 done)" 요청.
// Esc는 증거로 안 씀 — Claude TUI에서 오버레이 닫기 등 이동에도 쓰여 구분 불가(orca isNavigationEscapeIntent).
function inferInterrupt(id, data) {
  if (data !== "\x03" || !cwdById.has(id)) return;
  const at = Date.now();
  setTimeout(() => { void postStatus({ cwd: cwdById.get(id), sessionId: id, interruptAt: at }); }, 500);
}
ipcMain.on("terminal:input", (_e, { id, data }) => { termClient.input({ id, data }); try { detectLaunchFromInput(id, data); inferInterrupt(id, data); } catch { /* 감지 실패가 입력 막지 않게 */ } });
// #864 에이전트 직접 실행 — 신원을 실행 기록에 확정하고 pty 셸에 실행 커맨드 주입. 반환 후 탭 아이콘/이름=이 에이전트.
// 새 탭은 렌더러가 Terminal 마운트→ensure까지 시간차가 있어, pty 준비(ensuredIds)를 최대 3s 대기 후 주입.
const ensuredIds = new Set(); // ensure 완료된 세션 id
ipcMain.handle("terminal:launchAgent", async (_e, { id, agent, dark, extraArgs }) => {
  if (!id || typeof agent !== "string") return { ok: false, reason: "bad args" };
  let cmd = agentCommand(agent);
  if (!cmd) return { ok: false, reason: "unknown agent" };
  // claude는 자기 theme(settings.json)으로 diff·프롬프트·링크 색을 truecolor로 찍어 터미널 팔레트가 못 이긴다(#922).
  // 터미널 테마에 맞춰 --settings로 세션 theme만 덮어씀(유저 전역 ~/.claude/settings.json은 안 건드림, auth 유지·병합).
  if (agent === "claude" && typeof dark === "boolean") cmd += ` --settings '{"theme":"${dark ? "dark" : "light"}"}'`;
  // 유저 지정 per-agent 추가 인자(#927) — 설정서 렌더러가 전달. 로컬 유저 인자라 그대로 append.
  if (typeof extraArgs === "string" && extraArgs.trim()) cmd += ` ${extraArgs.trim()}`;
  launchRegistry.set(id, { agent, confirmed: false, at: Date.now() }); // 즉시 신원(아이콘). 부팅 중 셸이어도 유지.
  let ready = false;
  for (let i = 0; i < 60; i++) { if (ensuredIds.has(id)) { ready = true; break; } await new Promise((r) => setTimeout(r, 50)); } // 최대 3s pty 대기
  if (!ready) { launchRegistry.delete(id); return { ok: false, reason: "pty not ready" }; } // 준비 실패 → 신원 취소(오아이콘 방지)
  try { termClient.input({ id, data: cmd + "\r" }); }
  catch (e) { launchRegistry.delete(id); return { ok: false, reason: String((e && e.message) || e) }; }
  return { ok: true };
});
ipcMain.on("terminal:resize", (_e, { id, cols, rows }) => termClient.resize({ id, cols, rows }));
ipcMain.on("terminal:kill", (_e, { id }) => { termClient.kill({ id }); liveBuffers.delete(id); delete savedBuffers[id]; cwdById.delete(id); lastScreen.delete(id); agentSticky.delete(id); launchRegistry.delete(id); inputBuf.delete(id); ensuredIds.delete(id); narrPending.delete(id); lastNarr.delete(id); narrInFlight.delete(id); narrSeeded.delete(id); narrOverflow.delete(id); narrWorkingAt.delete(id); lastDiffHash.delete(id); lastTaskById.delete(id); lastTitleRawById.delete(id); }); // 탭 닫기 시 데몬 pty·저장분·상태·실행기록 정리
// 세션의 실행 중 에이전트 id | null(#803) — 터미널 탭 자동 이름·아이콘용.
// 프로세스명만으론 node 래퍼 CLI(codex 등: 네이티브 자식을 spawn해 foreground pgrp 리더가 "node")를 못 잡아,
// 버퍼 스크레이핑(parseAgentScreen)을 1순위로. 셸이면 종료로 간주(null). 버퍼 미판정이면 프로세스명 폴백.
// 세션 신원 고정(#803) — 한번 에이전트로 잡히면 셸 복귀(종료)까지 그 신원 유지.
// codex는 작업 중 배너가 스크롤아웃되면 버퍼 판정이 흔들려(claude 공유 스피너로 오판정) 탭이 깜빡일 수 있어,
// 최초 판정을 셸 복귀까지 붙들어 안정화. 셸이면 해제해 다음 에이전트를 새로 잡음.
// 탭(agentForId)과 카드(pushScreenState) 두 표면이 공유(#805) — 신원이 표면마다 갈리지 않게.
const agentSticky = new Map(); // id → agent id
// screen(#840): 데몬 list가 실어 준 buffer tail을 "파싱 힌트"로 받음. 활성 세션은 liveBuffers(full/fresh) 우선,
// 비활성(ensure 안 됨)은 screen 힌트로 검출. liveBuffers는 절대 안 건드림 — 16KB tail로 덮으면 스크롤백 영속(#680) 손실.
// 신원 판정은 pushScreenState(카드)와 동일 우선순위(#841): 현재 화면 파싱 > 프로세스명 > sticky(폴백).
// 예전엔 sticky를 파싱보다 먼저 return해서, 이전 세션(예: claude) 신원이 고정되면 새 에이전트(codex)를 켜도
// 탭이 claude로 남았다(카드는 파싱 우선이라 codex로 바뀌어 표면 불일치). 현재 파싱을 우선해 신선한 배너가 stale sticky를 덮게.
function agentForId(id, proc, screen) {
  const ra = registryAgent(id, proc);                          // #864 실행 기록 신원(부팅 중 셸도 유지, 확정 후 종료 시 해제)
  if (ra) { agentSticky.set(id, ra); return ra; }
  if (proc !== undefined && isShellProc(proc)) { agentSticky.delete(id); return null; }
  const parsed = parseAgentScreen(liveBuffers.get(id) ?? screen, lastTitleRawById.get(id));
  if (parsed && parsed.agent) { agentSticky.set(id, parsed.agent); return parsed.agent; } // 현재 화면이 잡은 에이전트 우선
  const procAgent = agentFromProcess(proc);
  if (procAgent) { agentSticky.set(id, procAgent); return procAgent; }
  if (agentSticky.has(id)) return agentSticky.get(id); // 배너 스크롤아웃 등 transient null → 마지막 신원 유지
  return null;
}
// 세션 작업 제목(#970) — OSC 타이틀 요약. 탭 라벨·호버 이름용. 셸이면 "".
// ① parseAgentScreen(16KB tail) task 우선(활성 세션). ② 없으면 lastTaskById(onData 라이브 추적으로 저장된
// 현재 세션 제목 — 유휴에도 유지). 전체버퍼 스캔(extractTask)은 안 씀 — ctrl+c 후 재시작 시 이전 세션 scrollback의
// 옛 타이틀을 주워 오는 세션경계 오염 때문(#970 fix). 셸 복귀/종료 시 lastTaskById를 지워 이전 세션 제목이 안 샘.
function sessionTitleFor(id, proc, screen) {
  if (proc !== undefined && isShellProc(proc)) return "";
  // 라이브 추적값(onData가 잡아 셸 복귀 시 리셋 — 현재 세션 것만) 우선. ctrl+c 재시작 직후 옛 타이틀이 16KB 내
  // 남아 parseAgentScreen이 그걸 주워오는 창(리뷰 🟡)을 막음 — 새 세션 제목이 onData로 잡히면 그게 권위.
  const live = lastTaskById.get(id);
  if (live) return live;
  // 폴백(주로 main 재시작 직후, onData가 이번 실행서 타이틀을 못 본 경우) — parseAgentScreen은 내부적으로 16KB tail만 봄.
  const parsed = parseAgentScreen(liveBuffers.get(id) ?? screen ?? "", lastTitleRawById.get(id));
  return (parsed && parsed.task) ? parsed.task : "";
}
ipcMain.handle("terminal:list", async () => {
  const ss = await termClient.list(); // 세션 목록(#764) — 레포탭 호버 카드 + 탭 이름(#803) + 세션 제목(#970)
  // 비활성 탭도 검출: 데몬 screen(buffer tail)을 힌트로 agentForId에 전달(#836/#840). screen은 검출용, 렌더러 미전송(누출 방지).
  return ss.map(({ screen, ...s }) => ({ ...s, agent: agentForId(s.id, s.process, screen), sessionTitle: sessionTitleFor(s.id, s.process, screen) }));
});

// ── 포트 패널(#880) — 워크스페이스가 띄운 dev 서버 리스닝 포트 감지. lsof(포트+PID)+세션PID+ps(ppid) 귀속.
const LOCAL_ADDRS = /^(127\.0\.0\.1|::1|\*|0\.0\.0\.0|localhost)$/i;
// lsof로 리스닝(LISTEN) TCP 포트+PID 목록. localhost만. 실패 시 [](패널만 비어 안전).
async function listeningPorts() {
  try {
    const { stdout } = await execFileP("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8", timeout: 4000, maxBuffer: 4_000_000 });
    const out = [];
    for (const line of stdout.split("\n").slice(1)) { // 첫 줄 헤더
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const cmd = parts[0], pid = Number(parts[1]);
      if (!Number.isInteger(pid)) continue;
      const nameTok = line.replace(/\s+\(LISTEN\)\s*$/, "").trim().split(/\s+/).pop() || ""; // NAME 열(예: 127.0.0.1:3000)
      const ci = nameTok.lastIndexOf(":");
      if (ci < 0) continue;
      const addr = nameTok.slice(0, ci).replace(/^\[|\]$/g, ""), port = Number(nameTok.slice(ci + 1));
      if (!Number.isInteger(port) || !LOCAL_ADDRS.test(addr)) continue;
      out.push({ cmd, pid, port });
    }
    return out;
  } catch { return []; } // lsof 없음(win)·타임아웃 등
}
// pid→ppid 맵(ps 한 번).
async function ppidMap() {
  try {
    const { stdout } = await execFileP("ps", ["-eo", "pid=,ppid="], { encoding: "utf8", timeout: 4000, maxBuffer: 4_000_000 });
    const m = new Map();
    for (const line of stdout.split("\n")) {
      const t = line.trim().split(/\s+/);
      if (t.length >= 2) { const p = Number(t[0]), pp = Number(t[1]); if (Number.isInteger(p) && Number.isInteger(pp)) m.set(p, pp); }
    }
    return m;
  } catch { return new Map(); }
}
// pid의 부모 체인에 sessionPids 중 하나가 있으면 true(방문 set·최대 뎁스로 루프 방지).
function descendsFrom(pid, sessionPids, pmap) {
  let cur = pid, depth = 0; const seen = new Set();
  while (Number.isInteger(cur) && cur > 1 && depth < 40 && !seen.has(cur)) {
    if (sessionPids.has(cur)) return true;
    seen.add(cur); cur = pmap.get(cur); depth++;
  }
  return false;
}
async function listPorts(cwd) {
  if (!cwd) return [];
  const nc = String(cwd).replace(/\/+$/, "");
  let sessions;
  try { sessions = await termClient.list(); } catch { return []; }
  // 이 워크스페이스 cwd(또는 하위)서 뜬 세션들의 pty pid — dev 서버는 이 pid의 자손.
  const sessionPids = new Set(
    sessions
      .filter((s) => { const c = String(s.cwd || "").replace(/\/+$/, ""); return c === nc || c.startsWith(nc + "/"); })
      .map((s) => Number(s.pid)).filter(Number.isInteger),
  );
  if (sessionPids.size === 0) return [];
  const [ports, pmap] = await Promise.all([listeningPorts(), ppidMap()]);
  const seen = new Set(); const out = [];
  for (const p of ports) {
    if (seen.has(p.port)) continue;
    if (descendsFrom(p.pid, sessionPids, pmap)) { seen.add(p.port); out.push(p); }
  }
  return out.sort((a, b) => a.port - b.port);
}
ipcMain.handle("ports:list", (_e, cwd) => listPorts(cwd));
ipcMain.handle("ports:open", (_e, port) => {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false };
  void shell.openExternal(`http://localhost:${n}`); // 앱 내부 창 아니라 기본 브라우저로(devtools·확장 위해)
  return { ok: true };
});

// 단일 인스턴스.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  // #1027 앱 메뉴 직접 구성 — Electron 기본 메뉴엔 ⌘W(창 닫기=앱 꺼짐)·⌘R(새로고침)·⌘+/−(설정과 따로 노는 확대)가 숨어 있어
// 렌더러 단축키(⌘W 터미널 탭 닫기·⌘=/− 터미널 글자 크기)와 충돌. 입력창에 꼭 필요한 편집(⌘C/V/Z/A)·앱(숨기기·종료)·창(최소화)만 남김.
function installAppMenu() {
  const mac = process.platform === "darwin";
  const template = [
    ...(mac ? [{ role: "appMenu" }] : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "toggleDevTools" }] }, // ⌥⌘I — 단축키 충돌 없음, 디버깅용
    { label: "Window", submenu: [{ role: "minimize" }, ...(mac ? [{ role: "zoom" }, { type: "separator" }, { role: "front" }] : [])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(installAppMenu).catch(() => {});
installBrowserGuestPolicy(app); // #1034 모든 창의 <webview> 보안·정책
app.whenReady().then(boot).catch((e) => { console.error("[electron] boot failed", e); app.quit(); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => {
    try { stopAllWatchers(); } catch { /* ignore */ } // 레포 워처 정리(#739)
    try { persistBuffers(); } catch { /* ignore */ } // 터미널 스크롤백 저장(#680)
    try { serverProc?.kill(); } catch { /* ignore */ }
    try { snaHandle?.stop(); } catch { /* ignore */ }
    // 터미널 데몬은 안 죽임 — 세션(프로세스) 생존(#682). 유휴 reap로만 종료.
  });
}

// preload — renderer에 최소 데스크톱 API 노출(contextIsolation 유지).
// 런타임 CLI 경로 설정(재시작 후 적용)과 재시작만.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

const zoomRect = (r) => { const z = webFrame.getZoomFactor() || 1; return { x: r.x * z, y: r.y * z, w: r.w * z, h: r.h * z }; };

contextBridge.exposeInMainWorld("nunopiDesktop", {
  isDesktop: true,
  // UI 줌(#937) — 전체 인터페이스 배율. webFrame은 렌더러 프로세스 API(즉시 적용).
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  getRuntimePaths: () => ipcRenderer.invoke("runtime-paths:get"),
  setRuntimePaths: (paths) => ipcRenderer.invoke("runtime-paths:set", paths),
  relaunch: () => ipcRenderer.invoke("app:relaunch"),
  notify: (payload) => ipcRenderer.invoke("notify", payload),
  // #989 알림 클릭 → {repoPath, sessionId}. 해제 함수 반환.
  onNotifyActivate: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("notify:activate", h); return () => ipcRenderer.removeListener("notify:activate", h); },
  pickRepoFolder: (opts) => ipcRenderer.invoke("repo:pickFolder", opts),
  // 클립보드 이미지를 임시 PNG로 저장하고 경로 반환(#799) — 터미널 Cmd+V 이미지 붙여넣기용. 이미지 없으면 ok:false.
  saveClipboardImage: () => ipcRenderer.invoke("clipboard:save-image"),
  // 학습 모드를 별도 창으로 열기(#789) — 멀티모니터. {ok} 반환(exists면 ok:false).
  openModeWindow: (kind) => ipcRenderer.invoke("mode-window:open", kind),
  // 탭·창 통합 모드 중복 레지스트리(#789). claim 성공 시에만 탭 추가, 닫을 때 release.
  modeClaim: (kind) => ipcRenderer.invoke("mode:claim", kind),
  modeRelease: (kind) => ipcRenderer.invoke("mode:release", kind),
  modeIsOpen: (kind) => ipcRenderer.invoke("mode:isOpen", kind),
  listOpenModes: () => ipcRenderer.invoke("mode:list"),
  onModesChanged: (cb) => { const h = (_e, kinds) => cb(kinds); ipcRenderer.on("modes:changed", h); return () => ipcRenderer.removeListener("modes:changed", h); },
  // 창 전체화면 상태(#779) — 신호등 자리 좌측 패딩 토글용. 초기 상태 조회 + 변경 구독(해제 함수 반환).
  window: {
    isFullscreen: () => ipcRenderer.invoke("window:isFullscreen"),
    onFullscreen: (cb) => { const h = (_e, v) => cb(v); ipcRenderer.on("window:fullscreen", h); return () => ipcRenderer.removeListener("window:fullscreen", h); },
  },
  // Claude·Codex 구독 사용 한도(세션/주간/Fable) 조회(#735).
  getProviderUsage: () => ipcRenderer.invoke("provider-usage:get"),
  // 레포 파일 워처(#739) — 변경 시 onChanged 콜백. 활성 레포만 watch.
  repo: {
    watch: (opts) => ipcRenderer.invoke("repo:watch", opts),
    unwatch: (opts) => ipcRenderer.invoke("repo:unwatch", opts),
    onChanged: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("repo:changed", h); return () => ipcRenderer.removeListener("repo:changed", h); },
  },
  // GitHub 패널(#809/#810) — gh CLI 브릿지. auth=인증 상태 진단(서브3~5서 데이터 메서드 추가).
  github: {
    auth: (cwd) => ipcRenderer.invoke("github:auth", { cwd }),
    issueList: (cwd, state, limit) => ipcRenderer.invoke("github:issue-list", { cwd, state, limit }),  // #813
    issueView: (cwd, number) => ipcRenderer.invoke("github:issue-view", { cwd, number }),
    issueCreate: (cwd, opts) => ipcRenderer.invoke("github:issue-create", { cwd, ...opts }),  // #945 이슈 생성(opts: title/body?/labels?)
    prList: (cwd, state, limit) => ipcRenderer.invoke("github:pr-list", { cwd, state, limit }),  // #814
    prView: (cwd, number) => ipcRenderer.invoke("github:pr-view", { cwd, number }),
    metaCandidates: (cwd, field) => ipcRenderer.invoke("github:meta-candidates", { cwd, field }), // #1131 리뷰어·담당자·라벨·마일스톤
    editMeta: (cwd, kind, number, field, add, remove) => ipcRenderer.invoke("github:edit-meta", { cwd, kind, number, field, add, remove }),
    prReviewEvent: (cwd, number, event, body) => ipcRenderer.invoke("github:pr-review-event", { cwd, number, event, body }), // #1131 승인·변경 요청·코멘트
    prFiles: (cwd, number) => ipcRenderer.invoke("github:pr-files", { cwd, number }),  // #1123 변경 파일 + 봤음
    prFileDiff: (cwd, number, path) => ipcRenderer.invoke("github:pr-file-diff", { cwd, number, path }),
    prFileFullDiff: (cwd, number, path) => ipcRenderer.invoke("github:pr-file-full-diff", { cwd, number, path }), // #1133 파일 전체
    prFileViewed: (cwd, prId, path, viewed) => ipcRenderer.invoke("github:pr-file-viewed", { cwd, prId, path, viewed }),
    prLineComment: (cwd, number, path, line, body, commitId) => ipcRenderer.invoke("github:pr-line-comment", { cwd, number, path, line, body, commitId }), // #1127
    prLineComments: (cwd, number) => ipcRenderer.invoke("github:pr-line-comments", { cwd, number }),
    prReviewReply: (cwd, number, commentId, body) => ipcRenderer.invoke("github:pr-review-reply", { cwd, number, commentId, body }), // #1129
    prThreadResolve: (cwd, threadId, resolve) => ipcRenderer.invoke("github:pr-thread-resolve", { cwd, threadId, resolve }),
    prReviewSubmit: (cwd, number, commitId, comments) => ipcRenderer.invoke("github:pr-review-submit", { cwd, number, commitId, comments }), // #1127 여러 지적 한 번에
    checks: (cwd) => ipcRenderer.invoke("github:checks", { cwd }),  // #812 현재 브랜치 CI
    checkAnnotations: (cwd, checkRunId) => ipcRenderer.invoke("github:check-annotations", { cwd, checkRunId }),  // #812
    jobSteps: (cwd, jobId) => ipcRenderer.invoke("github:job-steps", { cwd, jobId }),  // #812
    addComment: (cwd, kind, number, body) => ipcRenderer.invoke("github:add-comment", { cwd, kind, number, body }),  // #820
    editComment: (cwd, commentId, body, kind) => ipcRenderer.invoke("github:edit-comment", { cwd, commentId, body, kind }),  // #820
    deleteComment: (cwd, commentId, kind) => ipcRenderer.invoke("github:delete-comment", { cwd, commentId, kind }),
    react: (cwd, commentId, content, kind) => ipcRenderer.invoke("github:react", { cwd, commentId, content, kind }),  // #820 리액션 토글
    bodyReact: (cwd, number, content) => ipcRenderer.invoke("github:body-react", { cwd, number, content }),  // #822 본문 리액션
    editItem: (cwd, kind, number, title, body) => ipcRenderer.invoke("github:edit-item", { cwd, kind, number, title, body }),  // #822 제목·본문
    setState: (cwd, kind, number, action) => ipcRenderer.invoke("github:set-state", { cwd, kind, number, action }),
    merge: (cwd, number, method) => ipcRenderer.invoke("github:merge", { cwd, number, method }),  // #822 PR 머지(method=merge|squash|rebase, --delete-branch)
    prCreate: (cwd, opts) => ipcRenderer.invoke("github:pr-create", { cwd, ...opts }),  // #944 PR 생성(opts: base?/head?/title/body?/draft?)
    setToken: (token) => ipcRenderer.invoke("github:set-token", { token }),  // #826 PAT 폴백 저장(safeStorage)
    tokenStatus: () => ipcRenderer.invoke("github:token-status"),  // #826 토큰 존재 여부(값 비노출)
    clearToken: () => ipcRenderer.invoke("github:clear-token"),  // #826 토큰 삭제
  },
  // 연동 확장(#960) — GitLab glab 감지 + bitbucket/azure 토큰.
  integrations: {
    glabStatus: (cwd) => ipcRenderer.invoke("integrations:glab-status", { cwd }),
    glabMrList: (cwd, state, limit) => ipcRenderer.invoke("integrations:glab-mr-list", { cwd, state, limit }),  // #964 GhPr[] 정규화
    glabMrView: (cwd, number) => ipcRenderer.invoke("integrations:glab-mr-view", { cwd, number }),
    glabIssueList: (cwd, state, limit) => ipcRenderer.invoke("integrations:glab-issue-list", { cwd, state, limit }),
    glabIssueView: (cwd, number) => ipcRenderer.invoke("integrations:glab-issue-view", { cwd, number }),
    setToken: (host, token) => ipcRenderer.invoke("integrations:set-token", { host, token }),
    tokenStatus: (host) => ipcRenderer.invoke("integrations:token-status", { host }),
    clearToken: (host) => ipcRenderer.invoke("integrations:clear-token", { host }),
  },
  // 터미널(pty) 브릿지 — 레포별 세션(#647).
  terminal: {
    ensure: (opts) => ipcRenderer.invoke("terminal:ensure", opts),
    input: (payload) => ipcRenderer.send("terminal:input", payload),
    resize: (payload) => ipcRenderer.send("terminal:resize", payload),
    kill: (payload) => ipcRenderer.send("terminal:kill", payload),
    list: () => ipcRenderer.invoke("terminal:list"),
    launchAgent: (payload) => ipcRenderer.invoke("terminal:launchAgent", payload), // #864 에이전트 직접 실행(신원 확정)
    onData: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("terminal:data", h); return () => ipcRenderer.removeListener("terminal:data", h); },
    onExit: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("terminal:exit", h); return () => ipcRenderer.removeListener("terminal:exit", h); },
  },
  browser: { // #1034 인앱 브라우저 — 분리 창 열기 + 포커스된 guest가 넘겨준 단축키 구독(해제 함수 반환)
    openWindow: (payload) => ipcRenderer.invoke("browser-window:open", payload),
    setAppChords: (list) => ipcRenderer.send("browser:set-chords", list),
    // devtools 자리(CSS px) → 창 DIP — UI 줌(webFrame)을 여기서 곱함(main 쪽 줌 값은 늦을 수 있음).
    openDevTools: (guestId, rect) => ipcRenderer.invoke("browser:devtools-open", { guestId, rect: zoomRect(rect) }),
    devtoolsBounds: (guestId, rect) => ipcRenderer.send("browser:devtools-bounds", { guestId, rect: zoomRect(rect) }),
    closeDevTools: (guestId) => ipcRenderer.invoke("browser:devtools-close", { guestId }),
    sendToAgent: (payload) => ipcRenderer.invoke("browser:send-to-agent", payload), // #1037 셸이면 안 보냄(main 판정)
    register: (guestId, repo, visible) => ipcRenderer.send("browser:register", { guestId, repo, visible }), // #1041 에이전트가 이 탭을 찾게
    unregister: (guestId) => ipcRenderer.send("browser:unregister", { guestId }),
    // 열기 요청(#1041): 각 레포 화면이 "내가 그 cwd 레포"라고 손들고(claimOpen), main이 가장 깊은 레포 하나에만 grant.
    onOpenRequest: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("browser:open-request", h); return () => ipcRenderer.removeListener("browser:open-request", h); },
    onTabCommand: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("browser:tab-command", h); return () => ipcRenderer.removeListener("browser:tab-command", h); }, // #1041 에이전트가 탭 고르기/닫기
    claimOpen: (reqId, repo, cwd) => ipcRenderer.send("browser:claim-open", { reqId, repo, cwd }),
    onOpenGrant: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("browser:open-grant", h); return () => ipcRenderer.removeListener("browser:open-grant", h); },
    capture: (guestId, rect) => ipcRenderer.invoke("browser:capture", { guestId, rect }), // #1037 요소 스크린샷 → 임시 PNG 경로
    onKey: (cb) => { const h = (_e, k) => cb(k); ipcRenderer.on("browser:key", h); return () => ipcRenderer.removeListener("browser:key", h); },
  },
  daemon: { // #1036 옛 터미널 데몬 감지·재시작
    status: () => ipcRenderer.invoke("daemon:status"),
    restart: () => ipcRenderer.invoke("daemon:restart"),
  },
  ports: { // #880 워크스페이스 dev 서버 포트 감지·열기
    list: (cwd) => ipcRenderer.invoke("ports:list", cwd),
    open: (port) => ipcRenderer.invoke("ports:open", port),
  },
});

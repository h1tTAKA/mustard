// GitHub gh CLI 브릿지 결과·엔티티(#813~). ghJson 반환 형태.
type GhResult<T> = { ok: true; data: T } | { ok: false; kind: string; detail?: string };
interface GhLabel { name: string; color: string }
interface GhActor { login: string; name?: string }
interface GhIssue { number: number; title: string; state: string; labels: GhLabel[]; author: GhActor; createdAt: string; updatedAt: string }
interface GhReactionGroup { content: string; users: { totalCount: number } } // content=ENUM(THUMBS_UP…)
interface GhComment { author: GhActor; body: string; createdAt: string; url?: string; viewerDidAuthor?: boolean; reactionGroups?: GhReactionGroup[] }
interface GhMilestone { title: string }
interface GhIssueDetail extends GhIssue { assignees: GhActor[]; milestone: GhMilestone | null; body: string; comments: GhComment[]; url: string; reactionGroups?: GhReactionGroup[] }
// PR(#814). statusCheckRollup 항목은 CheckRun|StatusContext 혼재 — 필드 옵셔널로 흡수(정규화는 렌더러 checks.ts).
interface GhCheckRaw { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string; workflowName?: string; startedAt?: string; completedAt?: string; description?: string }
interface GhPr { number: number; title: string; state: string; isDraft: boolean; author: GhActor; createdAt: string; updatedAt: string; statusCheckRollup: GhCheckRaw[] }
interface GhPrDetail extends GhPr { assignees: GhActor[]; body: string; comments: GhComment[]; mergeStateStatus: string; url: string; reactionGroups?: GhReactionGroup[] }
// 현재 브랜치 CI(#812) — PR 있으면 checks, 없으면 { noPr:true }.
interface GhChecks { number?: number; title?: string; state?: string; statusCheckRollup?: GhCheckRaw[]; url?: string; headRefName?: string; noPr?: boolean }
interface GhAnnotation { path?: string; start_line?: number; annotation_level?: string; message?: string; title?: string }
interface GhJobStep { name?: string; status?: string; conclusion?: string; number?: number }

// 일렉트론 preload가 노출하는 데스크톱 API(웹에선 undefined).
interface NunopiDesktopApi {
  isDesktop: true;
  // UI 줌(#937) — 전체 인터페이스 배율(electron webFrame). 즉시 적용, 반환 없음.
  setZoomFactor(factor: number): void;
  getRuntimePaths(): Promise<{ claudeCode?: string; codex?: string; opencode?: string }>;
  setRuntimePaths(paths: { claudeCode?: string; codex?: string; opencode?: string }): Promise<{ ok: boolean; saved: Record<string, string> }>;
  relaunch(): Promise<void>;
  // 데스크톱 네이티브 알림. 창 포커스 중이면 스킵(reason:"focused").
  notify(payload: { title: string; body?: string; suppressWhileFocused?: boolean; silent?: boolean; target?: { repoPath: string; sessionId?: string } }): Promise<{ ok: boolean; reason?: string }>;
  // #989 알림 클릭 시 이동 대상. 해제 함수 반환.
  onNotifyActivate?(cb: (p: { repoPath: string; sessionId?: string }) => void): () => void;
  // 레포 폴더 선택(OS 네이티브 창). 취소 시 { canceled: true }. defaultPath=시작 경로(#939).
  pickRepoFolder(opts?: { defaultPath?: string }): Promise<{ canceled: boolean; path?: string }>;
  // 클립보드 이미지를 임시 PNG로 저장하고 경로 반환(#799) — 터미널 Cmd+V 이미지 붙여넣기. 이미지 없으면 ok:false.
  saveClipboardImage?(): Promise<{ ok: boolean; path?: string; error?: string }>;
  // 학습 모드를 별도 창으로 열기(#789) — 멀티모니터. ok:false(reason:"exists")면 이미 떠 있음.
  openModeWindow?(kind: "ask" | "code" | "text" | "memorize"): Promise<{ ok: boolean; reason?: string }>;
  // 탭·창 통합 모드 중복 레지스트리(#789). 탭 점유/해제/조회 + 변경 구독(해제 함수 반환).
  modeClaim?(kind: "ask" | "code" | "text" | "memorize"): Promise<{ ok: boolean }>;
  modeRelease?(kind: "ask" | "code" | "text" | "memorize"): Promise<{ ok: boolean }>;
  modeIsOpen?(kind: "ask" | "code" | "text" | "memorize"): Promise<boolean>;
  listOpenModes?(): Promise<Array<"ask" | "code" | "text" | "memorize">>;
  onModesChanged?(cb: (kinds: Array<"ask" | "code" | "text" | "memorize">) => void): () => void;
  // 창 전체화면 상태(#779) — 신호등 자리 좌측 패딩 토글용. onFullscreen은 해제 함수 반환.
  window?: {
    isFullscreen(): Promise<boolean>;
    onFullscreen(cb: (v: boolean) => void): () => void;
  };
  // Claude·Codex 구독 사용 한도(세션/주간/Fable) 조회(#735). 상세 타입은 @/lib/usage/types.
  getProviderUsage?(): Promise<import("@/lib/usage/types").ProviderUsageResult>;
  // 레포 파일 워처(#739) — 활성 레포 변경 감지. recursive 미지원 플랫폼은 supported:false → 폴백.
  repo?: {
    watch(opts: { id: string; root: string }): Promise<{ ok: boolean; supported: boolean; error?: string }>;
    unwatch(opts: { id: string }): Promise<void>;
    onChanged(cb: (p: { id: string }) => void): () => void;
  };
  // GitHub 패널(#809/#810) — gh CLI 브릿지. auth=인증 상태 진단(cwd=레포). 서브3~5서 checks/이슈/PR 메서드 추가.
  github?: {
    auth(cwd: string): Promise<{ state: "ok" | "not-installed" | "not-authed" | "rate-limited" | "error"; detail?: string }>;
    // 이슈 목록·상세(#813). 성공 { ok:true, data } | 실패 { ok:false, kind, detail }.
    issueList(cwd: string, state?: "open" | "closed" | "all", limit?: number): Promise<GhResult<GhIssue[]>>;
    issueView(cwd: string, number: number): Promise<GhResult<GhIssueDetail>>;
    issueCreate(cwd: string, opts: { title: string; body?: string; labels?: string }): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;  // #945 성공 시 stdout=이슈 URL
    prList(cwd: string, state?: "open" | "closed" | "all", limit?: number): Promise<GhResult<GhPr[]>>;  // #814
    prView(cwd: string, number: number): Promise<GhResult<GhPrDetail>>;
    checks(cwd: string): Promise<GhResult<GhChecks>>;  // #812
    checkAnnotations(cwd: string, checkRunId: string): Promise<GhResult<GhAnnotation[]>>;  // #812
    jobSteps(cwd: string, jobId: string): Promise<GhResult<{ steps?: GhJobStep[] }>>;  // #812
    addComment(cwd: string, kind: "issue" | "pr", number: number, body: string): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;  // #820
    editComment(cwd: string, commentId: string, body: string, kind?: "issue" | "review"): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;
    deleteComment(cwd: string, commentId: string, kind?: "issue" | "review"): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;
    react(cwd: string, commentId: string, content: string): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;  // content=+1|-1|laugh|hooray|confused|heart|rocket|eyes
    bodyReact(cwd: string, number: number, content: string): Promise<{ ok: boolean; kind?: string; detail?: string }>;  // #822 이슈/PR 본문 리액션
    editItem(cwd: string, kind: "issue" | "pr", number: number, title: string, body: string): Promise<{ ok: boolean; kind?: string; detail?: string }>;  // #822 제목·본문(빈 값은 미반영)
    setState(cwd: string, kind: "issue" | "pr", number: number, action: "close" | "reopen" | "ready" | "draft"): Promise<{ ok: boolean; kind?: string; detail?: string }>;
    // #1123 PR 리뷰 — 변경 파일(봤음 포함)·파일별 diff·봤음 표시(GitHub에 저장)
    prFiles?(cwd: string, number: number): Promise<{ ok: boolean; data?: { prId: string; head?: string; files: { path: string; additions: number; deletions: number; changeType: string; viewed: boolean }[]; truncated?: boolean }; kind?: string; detail?: string }>;
    prFileDiff?(cwd: string, number: number, path: string): Promise<{ ok: boolean; data?: { diff: string; missing?: boolean }; kind?: string; detail?: string }>;
    prFileViewed?(cwd: string, prId: string, path: string, viewed: boolean): Promise<{ ok: boolean; kind?: string; detail?: string }>;
    prLineComment?(cwd: string, number: number, path: string, line: number, body: string, commitId?: string): Promise<{ ok: boolean; data?: { id?: number; url?: string }; kind?: string; detail?: string }>;
    prReviewReply?(cwd: string, number: number, commentId: number, body: string): Promise<{ ok: boolean; kind?: string; detail?: string }>;
    prThreadResolve?(cwd: string, threadId: string, resolve: boolean): Promise<{ ok: boolean; kind?: string; detail?: string }>;
    prReviewSubmit?(cwd: string, number: number, commitId: string, comments: { path: string; line: number; body: string }[]): Promise<{ ok: boolean; data?: { id?: number; url?: string }; kind?: string; detail?: string }>;
    prLineComments?(cwd: string, number: number): Promise<{ ok: boolean; data?: { id: number; mine: boolean; threadId?: string; resolved?: boolean; path: string; line: number | null; outdated: boolean; body: string; author: string; createdAt: string; url: string; inReplyTo: number | null }[]; kind?: string; detail?: string }>;
    merge(cwd: string, number: number, method: "merge" | "squash" | "rebase"): Promise<{ ok: boolean; kind?: string; detail?: string }>;  // #822 PR 머지(--delete-branch)
    prCreate(cwd: string, opts: { base?: string; head?: string; title: string; body?: string; draft?: boolean }): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;  // #944 성공 시 stdout=PR URL
    setToken(token: string): Promise<{ ok: boolean; detail?: string }>;  // #826 PAT 폴백 저장(safeStorage 암호화)
    tokenStatus(): Promise<{ hasToken: boolean }>;  // #826 토큰 존재 여부(값 비노출)
    clearToken(): Promise<{ ok: boolean }>;  // #826 토큰 삭제
  };
  // 연동 확장(#960) — GitLab glab 감지 + bitbucket/azure 토큰(safeStorage).
  integrations?: {
    glabStatus(cwd?: string): Promise<{ state: "ok" | "not-installed" | "not-authed" | "rate-limited" | "error"; detail?: string }>;
    // GitLab 조회(#964) — glab JSON을 GhPr/GhIssue로 정규화 반환(UI 재사용). cwd=레포 경로.
    glabMrList(cwd: string, state?: "open" | "closed" | "all", limit?: number): Promise<GhResult<GhPr[]>>;
    glabMrView(cwd: string, number: number): Promise<GhResult<GhPrDetail>>;
    glabIssueList(cwd: string, state?: "open" | "closed" | "all", limit?: number): Promise<GhResult<GhIssue[]>>;
    glabIssueView(cwd: string, number: number): Promise<GhResult<GhIssueDetail>>;
    setToken(host: "bitbucket" | "azure" | "vercel" | "supabase", token: string): Promise<{ ok: boolean; detail?: string }>;
    tokenStatus(host: "bitbucket" | "azure" | "vercel" | "supabase"): Promise<{ hasToken: boolean }>;
    clearToken(host: "bitbucket" | "azure" | "vercel" | "supabase"): Promise<{ ok: boolean }>;
  };
  // 터미널(pty) — id별 세션(#647·#678 멀티탭). cwd는 spawn 작업 디렉터리. ensure는 세션 확보 + 재생용 scrollback 반환.
  terminal: {
    ensure(opts: { id: string; cwd: string; cols: number; rows: number; dark?: boolean }): Promise<{ ok: boolean; buffer?: string; reason?: string }>;
    input(payload: { id: string; data: string }): void;
    resize(payload: { id: string; cols: number; rows: number }): void;
    kill(payload: { id: string }): void;
    // 세션 목록(#764) — 레포탭 호버 카드용. process=foreground 프로세스명(claude/codex/zsh…), cwd=spawn 디렉터리.
    // agent(#803)=실행 중 에이전트 id | null(버퍼 파싱 우선 → node 래퍼 CLI도 감지). 탭 자동 이름·아이콘용.
    // sessionTitle(#970)=세션 작업 제목(OSC 타이틀 요약) | ""(셸·미판정). 탭 라벨·호버 이름용.
    list(): Promise<{ id: string; cwd: string; process: string; pid: number; agent: string | null; sessionTitle: string }[]>;
    // 에이전트 직접 실행(#864) — 신원을 실행 기록에 확정 + pty에 실행 커맨드 주입. 이후 탭 아이콘/이름=이 에이전트.
    launchAgent(payload: { id: string; agent: string; dark?: boolean; extraArgs?: string; cwd?: string }): Promise<{ ok: boolean; reason?: string }>; // cwd = #1110 Crew 넘겨받기
    onData(cb: (p: { id: string; data: string }) => void): () => void;
    onExit(cb: (p: { id: string }) => void): () => void;
  };
  // 포트 패널(#880) — 워크스페이스(cwd)가 띄운 dev 서버 리스닝 포트. open은 기본 브라우저로.
  // #1034 인앱 브라우저 — 분리 창(멀티 모니터) + guest 포커스 중 앱 단축키 전달.
  browser?: {
    openWindow(payload: { url?: string; repo?: string; devtools?: boolean }): Promise<{ ok: boolean; reason?: string }>;
    setAppChords(list: string[]): void;
    openDevTools(guestId: number, rect: { x: number; y: number; w: number; h: number }): Promise<{ ok: boolean }>;
    devtoolsBounds(guestId: number, rect: { x: number; y: number; w: number; h: number }): void;
    closeDevTools(guestId: number): Promise<{ ok: boolean }>;
    sendToAgent(payload: { cwd: string; preferId?: string; text: string }): Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
    register(guestId: number, repo: string, visible: boolean): void;
    unregister(guestId: number): void;
    onOpenRequest(cb: (p: { cwd: string; url: string; reqId: string }) => void): () => void;
    claimOpen(reqId: string, repo: string, cwd: string): void;
    onTabCommand(cb: (p: { guestId: number; action: "select" | "close" }) => void): () => void;
    onOpenGrant(cb: (p: { reqId: string; repo: string; url: string }) => void): () => void;
    capture(guestId: number, rect: { x: number; y: number; w: number; h: number }): Promise<{ ok: boolean; path?: string }>;
    onKey(cb: (k: { code: string; key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }) => void): () => void;
  };
  daemon?: {
    status(): Promise<{ outdated: boolean; sessions: number }>;
    restart(): Promise<{ ok: boolean; reason?: string }>;
  };
  ports: {
    list(cwd: string): Promise<{ port: number; pid: number; cmd: string }[]>;
    open(port: number): Promise<{ ok: boolean }>;
  };
}

interface Window {
  nunopiDesktop?: NunopiDesktopApi;
}

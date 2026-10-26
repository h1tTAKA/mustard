// 일렉트론 preload가 노출하는 데스크톱 API(웹에선 undefined).
// nunopi 스탠드얼론 학습앱(#894 서브5) — preload.cjs가 실제 노출하는 학습 표면만 선언.
// 워크스페이스 전용(terminal·ports·repo watch·provider-usage)은 없음. 공유 설정 창이 ?.로 확인하는 github·integrations·pickRepoFolder는
// 타입만 선택(optional)으로 둠 — 스탠드얼론 런타임엔 없어서 그 설정 칸은 동작 안 함.
interface AgentDetect { id: string; label: string; status: "ok" | "broken" | "missing"; path?: string; version?: string | null; auth: "authenticated" | "unauthenticated" | "unknown"; install: string | null; tried: { path: string; error: string }[]; url?: string; cmd?: string; choices?: string[] }
interface NunopiDesktopApi {
  isDesktop: true;
  getRuntimePaths(): Promise<{ claudeCode?: string; codex?: string; opencode?: string }>;
  setRuntimePaths(paths: { claudeCode?: string; codex?: string; opencode?: string }): Promise<{ ok: boolean; saved: Record<string, string> }>;
  // #1171 에이전트 CLI 상태(Mustard main — nunopi 단독 앱엔 없을 수 있음)
  detectAgents?(force?: boolean): Promise<{ ok: true; list: AgentDetect[] } | { ok: false; error: string }>;
  liftAgentArgs?(agent: string, args: string): Promise<{ choice: string; rest: string } | null>; // #1184
  relaunch(): Promise<void>;
  // 데스크톱 네이티브 알림. 창 포커스 중이면 스킵(reason:"focused").
  notify(payload: { title: string; body?: string; suppressWhileFocused?: boolean }): Promise<{ ok: boolean; reason?: string }>;
  // 클립보드 이미지를 임시 PNG로 저장하고 경로 반환(#799). 이미지 없으면 ok:false.
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
  pickRepoFolder?(opts?: { defaultPath?: string }): Promise<{ canceled: boolean; path?: string }>;
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
    editComment(cwd: string, commentId: string, body: string): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;
    deleteComment(cwd: string, commentId: string): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;
    react(cwd: string, commentId: string, content: string): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;  // content=+1|-1|laugh|hooray|confused|heart|rocket|eyes
    bodyReact(cwd: string, number: number, content: string): Promise<{ ok: boolean; kind?: string; detail?: string }>;  // #822 이슈/PR 본문 리액션
    editItem(cwd: string, kind: "issue" | "pr", number: number, title: string, body: string): Promise<{ ok: boolean; kind?: string; detail?: string }>;  // #822 제목·본문(빈 값은 미반영)
    setState(cwd: string, kind: "issue" | "pr", number: number, action: "close" | "reopen" | "ready" | "draft"): Promise<{ ok: boolean; kind?: string; detail?: string }>;
    merge(cwd: string, number: number, method: "merge" | "squash" | "rebase"): Promise<{ ok: boolean; kind?: string; detail?: string }>;  // #822 PR 머지(--delete-branch)
    prCreate(cwd: string, opts: { base?: string; head?: string; title: string; body?: string; draft?: boolean }): Promise<{ ok: boolean; stdout?: string; kind?: string; detail?: string }>;  // #944 성공 시 stdout=PR URL
    setToken(token: string): Promise<{ ok: boolean; detail?: string }>;  // #826 PAT 폴백 저장(safeStorage 암호화)
    tokenStatus(): Promise<{ hasToken: boolean }>;  // #826 토큰 존재 여부(값 비노출)
    clearToken(): Promise<{ ok: boolean }>;  // #826 토큰 삭제
  };
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
}

interface Window {
  nunopiDesktop?: NunopiDesktopApi;
}

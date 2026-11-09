// 작업공간(#1170) 화면 사이 신호 — 어디서든(+ 메뉴·PR·이슈·호버 카드) "새 작업공간" 창을 열고, 만든 폴더를 레포 탭으로 엶. WorkspaceTabs가 받음.
export const NEW_WORKSPACE_EVENT = "mustard:new-workspace";
export const OPEN_REPO_TAB_EVENT = "mustard:open-repo-tab";
export type NewWorkspaceInitial = { kind: "issue" | "pr"; number: number } | { kind: "tracker"; name: string }; // tracker = Linear·Jira 이슈(#1172) — 이름(키 포함)만 정해 줌
export const openNewWorkspace = (root: string, initial?: NewWorkspaceInitial) =>
  window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT, { detail: { root, initial } }));
// root = 그 worktree의 레포 탭 경로 — 있으면 새 탭 대신 그 레포 탭 안에서 작업 폴더를 바꿈(유저 결정: 레포 탭 안에서 전환)
export const openRepoTab = (path: string, root?: string) => window.dispatchEvent(new CustomEvent(OPEN_REPO_TAB_EVENT, { detail: { path, root } }));
// 지우기 창 열기 / 지우기 직전 그 작업공간 탭 닫고 터미널 끄기(PTY를 먼저 정리)
export const REMOVE_WORKSPACE_EVENT = "mustard:remove-workspace";
export const CLOSE_WORKSPACE_EVENT = "mustard:close-workspace";
export const openRemoveWorkspace = (root: string, dir: string) => window.dispatchEvent(new CustomEvent(REMOVE_WORKSPACE_EVENT, { detail: { root, dir } }));
export const closeWorkspace = (dir: string) => window.dispatchEvent(new CustomEvent(CLOSE_WORKSPACE_EVENT, { detail: dir }));
// #1216 작업공간 설정 창(이 레포의 setup·archive·공유 폴더) 열기
export const WORKSPACE_SETTINGS_EVENT = "mustard:workspace-settings";
export const openWorkspaceSettings = (root: string) => window.dispatchEvent(new CustomEvent(WORKSPACE_SETTINGS_EVENT, { detail: root }));
// #1174 겨루기 — 후보마다 이 레포 터미널에 새 탭을 열고 그 작업 폴더에서 에이전트를 띄워 같은 프롬프트를 보냄. TerminalPane이 받음(taken).
// 터미널 패널이 접혀 있어 아직 없으면 맡겨 두고(WorkspaceView가 터미널을 펼침), TerminalPane이 붙을 때 가져감(리뷰).
export const FANOUT_LAUNCH_EVENT = "mustard:fanout-launch";
export type FanoutLaunch = { root: string; id: string; prompt: string; candidates: { agent: string; dir: string }[]; taken?: boolean };
const pendingLaunch = new Map<string, FanoutLaunch>(); // 레포 탭 경로 → 아직 못 띄운 겨루기
export const launchFanout = (d: FanoutLaunch) => { const detail: FanoutLaunch = { ...d, taken: false }; window.dispatchEvent(new CustomEvent(FANOUT_LAUNCH_EVENT, { detail })); if (!detail.taken) pendingLaunch.set(d.root, detail); };
export const takePendingFanout = (root: string) => { const d = pendingLaunch.get(root); pendingLaunch.delete(root); return d; };
// #1174 채택·버리기 — 지울 후보들의 터미널 탭을 확인 없이 닫음(사람이 이미 확인 창에서 고름). TerminalPane이 받음.
export const FANOUT_CLOSE_TABS_EVENT = "mustard:fanout-close-tabs";
export const closeFanoutTabs = (root: string, ids: string[]) => window.dispatchEvent(new CustomEvent(FANOUT_CLOSE_TABS_EVENT, { detail: { root, ids } }));

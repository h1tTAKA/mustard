// 작업공간(#1170) 화면 사이 신호 — 어디서든(+ 메뉴·PR·이슈·호버 카드) "새 작업공간" 창을 열고, 만든 폴더를 레포 탭으로 엶. WorkspaceTabs가 받음.
export const NEW_WORKSPACE_EVENT = "mustard:new-workspace";
export const OPEN_REPO_TAB_EVENT = "mustard:open-repo-tab";
export type NewWorkspaceInitial = { kind: "issue" | "pr"; number: number };
export const openNewWorkspace = (root: string, initial?: NewWorkspaceInitial) =>
  window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT, { detail: { root, initial } }));
export const openRepoTab = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_REPO_TAB_EVENT, { detail: path }));
// 지우기 창 열기 / 지우기 직전 그 작업공간 탭 닫고 터미널 끄기(Orca도 PTY를 먼저 정리)
export const REMOVE_WORKSPACE_EVENT = "mustard:remove-workspace";
export const CLOSE_WORKSPACE_EVENT = "mustard:close-workspace";
export const openRemoveWorkspace = (root: string, dir: string) => window.dispatchEvent(new CustomEvent(REMOVE_WORKSPACE_EVENT, { detail: { root, dir } }));
export const closeWorkspace = (dir: string) => window.dispatchEvent(new CustomEvent(CLOSE_WORKSPACE_EVENT, { detail: dir }));

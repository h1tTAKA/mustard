// 작업공간(#1170) 화면 사이 신호 — 어디서든(+ 메뉴·PR·이슈·호버 카드) "새 작업공간" 창을 열고, 만든 폴더를 레포 탭으로 엶. WorkspaceTabs가 받음.
export const NEW_WORKSPACE_EVENT = "mustard:new-workspace";
export const OPEN_REPO_TAB_EVENT = "mustard:open-repo-tab";
export type NewWorkspaceInitial = { kind: "issue" | "pr"; number: number };
export const openNewWorkspace = (root: string, initial?: NewWorkspaceInitial) =>
  window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT, { detail: { root, initial } }));
export const openRepoTab = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_REPO_TAB_EVENT, { detail: path }));

// Crew 보드 타입·칸 목록(#1098) — 서버(crewStore)·화면(CrewBoard) 공용. node 모듈 없음(클라 import 가능).
export const CREW_STATUSES = ["backlog", "ready", "running", "needs-you", "review", "done", "blocked"] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];
// 기본 역할 8(유저 제공 구성) — 이름·설명은 i18n crew.role.<id> / crew.roleDesc.<id>. 커스텀 역할은 에픽 2번.
export const CREW_ROLES = ["scope-planner", "screen-designer", "data-architect", "app-builder", "test-engineer", "bug-fixer", "release-checker", "doc-writer"] as const;
// role 없음 = 자동 배정(범위 기획자가 나눔)
// 사람 대기 이유(#1102) — spec/schema/merge 관문, question(되묻기). stage = 반려·답 때 다시 돌릴 단계.
export interface CrewGate { kind: "spec" | "schema" | "merge" | "question" | "blocked" | "setup"; text?: string; stage: number } // setup = 레포 setup 스크립트 첫 실행 승인(#1176)
// #1114 범위 기획자가 제안한 하위 작업 — after = 같은 목록 안 앞 번호(그것들이 끝나야 시작)
export interface CrewSubtask { title: string; body?: string; roles: string[]; after?: number[] }
export interface CrewTask {
  id: string; title: string; body: string; status: CrewStatus; order: number; createdAt: number; updatedAt: number; role?: string;
  // 오케스트레이터(#1102) — 파이프라인(역할 순서)·지금 단계·테스트↔수정 횟수·같은 단계 연속 실패·사람 대기·다음 실행에 붙일 사람 말
  pipeline?: string[]; stage?: number; loops?: number; fails?: number; gate?: CrewGate; note?: string;
  // 에이전트 토론(#1108) — 지금 단계가 동료 질문에 답하기면 consult, 묻기 횟수·리뷰 왕복 횟수
  consult?: { stage: number; from: string; question: string }; consults?: number; reviews?: number;
  pr?: { url: string }; // #1110 사람이 만든 draft PR
  issue?: { provider: "linear" | "jira"; key: string; url: string }; // #1172 트래커 이슈에서 만든 카드 — 칩·상태 동기화
  // #1114 쪼개기 — split = spec 관문에 올라온 제안, children = 승인 후 만든 하위 카드, parentId·dependsOn = 하위 카드 쪽
  split?: CrewSubtask[]; children?: string[]; parentId?: string; dependsOn?: string[];
}
export interface CrewBoard { version: 1; tasks: CrewTask[]; }
export type CrewOp =
  | { op: "create"; title: string; body?: string; status?: CrewStatus; role?: string; pipeline?: string[]; issue?: CrewTask["issue"] }
  | { op: "update"; id: string; title?: string; body?: string; role?: string; pipeline?: string[] } // pipeline [] = 지움(담당 하나·자동)
  | { op: "move"; id: string; status: CrewStatus; index: number }
  | { op: "delete"; id: string };
// #1279 Crew 권한 항목 — 유저가 설정에서 항목마다 '알아서 허용(true) / 물어보기'를 고름. 고정 항목(비밀·밖 쓰기·파괴 git·검사 회피)은 여기 없음.
export const CREW_PERM_CATS = ["unknownCmd", "git", "code", "network", "system", "publish", "mcp"] as const;
export type CrewPermCat = (typeof CREW_PERM_CATS)[number];
export type CrewPerms = Partial<Record<CrewPermCat, boolean>>;
export const CREW_PERM_DEFAULTS: Record<CrewPermCat, boolean> = { unknownCmd: true, git: true, code: true, network: false, system: false, publish: false, mcp: false };

// Crew 보드 타입·칸 목록(#1098) — 서버(crewStore)·화면(CrewBoard) 공용. node 모듈 없음(클라 import 가능).
export const CREW_STATUSES = ["backlog", "ready", "running", "needs-you", "review", "done", "blocked"] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];
// 기본 역할 8(유저 제공 구성) — 이름·설명은 i18n crew.role.<id> / crew.roleDesc.<id>. 커스텀 역할은 에픽 2번.
export const CREW_ROLES = ["scope-planner", "screen-designer", "data-architect", "app-builder", "test-engineer", "bug-fixer", "release-checker", "doc-writer"] as const;
// role 없음 = 자동 배정(범위 기획자가 나눔)
export interface CrewTask { id: string; title: string; body: string; status: CrewStatus; order: number; createdAt: number; updatedAt: number; role?: string }
export interface CrewBoard { version: 1; tasks: CrewTask[] }
export type CrewOp =
  | { op: "create"; title: string; body?: string; status?: CrewStatus; role?: string }
  | { op: "update"; id: string; title?: string; body?: string; role?: string }
  | { op: "move"; id: string; status: CrewStatus; index: number }
  | { op: "delete"; id: string };

// Crew 보드 타입·칸 목록(#1098) — 서버(crewStore)·화면(CrewBoard) 공용. node 모듈 없음(클라 import 가능).
export const CREW_STATUSES = ["backlog", "ready", "running", "needs-you", "review", "done", "blocked"] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];
export interface CrewTask { id: string; title: string; body: string; status: CrewStatus; order: number; createdAt: number; updatedAt: number }
export interface CrewBoard { version: 1; tasks: CrewTask[] }
export type CrewOp =
  | { op: "create"; title: string; body?: string; status?: CrewStatus }
  | { op: "update"; id: string; title?: string; body?: string }
  | { op: "move"; id: string; status: CrewStatus; index: number }
  | { op: "delete"; id: string };

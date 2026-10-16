// Crew 화면 공용 조각(#1098) — 칸 색 점, 역할 아이콘.
import { IconBug, IconCode, IconDatabase, IconLayoutDashboard, IconNotes, IconRocket, IconSparkles, IconTarget, IconTestPipe } from "@tabler/icons-react";
import type { CrewStatus } from "@/lib/crew/crewTypes";

// 칸 색 점 — 나 필요=주의, 막힘=빨강, 완료=초록, 실행 중=겨자.
export const STATUS_DOT: Record<CrewStatus, string> = {
  backlog: "bg-zinc-400", ready: "bg-sky-500", running: "bg-mustard-500", "needs-you": "bg-amber-500",
  review: "bg-violet-500", done: "bg-emerald-500", blocked: "bg-rose-500",
};

const ROLE_ICON: Record<string, typeof IconCode> = {
  "scope-planner": IconTarget, "screen-designer": IconLayoutDashboard, "data-architect": IconDatabase, "app-builder": IconCode,
  "test-engineer": IconTestPipe, "bug-fixer": IconBug, "release-checker": IconRocket, "doc-writer": IconNotes,
};

// 역할 없음(자동 배정)·모르는 역할 = 반짝이(범위 기획자가 나눔)
export function RoleIcon({ role, size = 12, className = "" }: { role?: string; size?: number; className?: string }) {
  const Icon = (role && ROLE_ICON[role]) || IconSparkles;
  return <Icon size={size} stroke={1.9} className={`shrink-0 ${className}`} aria-hidden />;
}

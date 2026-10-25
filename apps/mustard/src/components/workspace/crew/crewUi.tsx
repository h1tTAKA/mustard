// Crew 화면 공용 조각(#1098·#1100) — 칸 색 점, 역할 아이콘·이름, 실행 AI 이름, 역할·실행 기록 불러오기 훅.
import { useCallback, useEffect, useState } from "react";
import { IconBug, IconCode, IconDatabase, IconLayoutDashboard, IconNotes, IconRocket, IconSparkles, IconTarget, IconTestPipe, IconUserCog } from "@tabler/icons-react";
import type { CrewStatus } from "@/lib/crew/crewTypes";
import type { CrewRole } from "@/lib/crew/crewRoleDefaults";
import type { CrewRun } from "@/lib/crew/crewRunner";

// 칸 색 점 — 나 필요=주의, 막힘=빨강, 완료=초록, 실행 중=겨자.
export const STATUS_DOT: Record<CrewStatus, string> = {
  backlog: "bg-zinc-400", ready: "bg-sky-500", running: "bg-mustard-500", "needs-you": "bg-amber-500",
  review: "bg-violet-500", done: "bg-emerald-500", blocked: "bg-rose-500",
};

export const PROVIDER_LABEL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", grok: "Grok Build", cursor: "Cursor", opencode: "OpenCode" };

const ROLE_ICON: Record<string, typeof IconCode> = {
  "scope-planner": IconTarget, "screen-designer": IconLayoutDashboard, "data-architect": IconDatabase, "app-builder": IconCode,
  "test-engineer": IconTestPipe, "bug-fixer": IconBug, "release-checker": IconRocket, "doc-writer": IconNotes,
};

// 역할 없음(자동 배정) = 반짝이, 커스텀 = 사람+톱니
export function RoleIcon({ role, size = 12, className = "" }: { role?: string; size?: number; className?: string }) {
  const Icon = !role ? IconSparkles : ROLE_ICON[role] ?? IconUserCog;
  return <Icon size={size} stroke={1.9} className={`shrink-0 ${className}`} aria-hidden />;
}

type T = (k: string, v?: Record<string, string | number>) => string;
// 기본 역할은 i18n, 커스텀은 저장된 이름. 목록에 없는 id(지워진 커스텀)는 자동 배정으로 보임.
export const roleName = (t: T, roles: CrewRole[], id?: string) => {
  const r = id ? roles.find((x) => x.id === id) : undefined;
  if (!r) return t("crew.role.none");
  return r.builtin ? t(`crew.role.${r.id}`) : r.name;
};
export const roleDesc = (t: T, roles: CrewRole[], id?: string) => {
  const r = id ? roles.find((x) => x.id === id) : undefined;
  if (!r) return t("crew.roleDesc.none");
  return r.builtin ? t(`crew.roleDesc.${r.id}`) : r.description;
};

export function useCrewRoles(): [CrewRole[], (roles: CrewRole[]) => void, () => void] {
  const [roles, setRoles] = useState<CrewRole[]>([]);
  const load = useCallback(() => { fetch("/api/crew/roles").then((r) => r.json()).then((j) => { if (j?.ok) setRoles(j.roles); }).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  return [roles, setRoles, load];
}

const ACTIVE = new Set(["starting", "running", "needs-permission"]);
export const isActiveRun = (r?: CrewRun) => !!r && ACTIVE.has(r.state);

// 실행 기록 — 진행 중이면 2초, 아니면 15초마다(+창 포커스). 상태가 바뀌면 onChange(보드 다시 읽기 — 엔진이 카드를 옮김).
export function useCrewRuns(root: string, onChange: () => void): [Map<string, CrewRun>, () => void] {
  const [latest, setLatest] = useState<Map<string, CrewRun>>(new Map());
  const [sig, setSig] = useState("");
  const load = useCallback(() => {
    fetch(`/api/crew/run?root=${encodeURIComponent(root)}`).then((r) => r.json()).then((j) => {
      if (!j?.ok) return;
      const m = new Map<string, CrewRun>();
      for (const r of j.runs as CrewRun[]) m.set(r.taskId, r); // 시작 시각 순 → 마지막 것이 남음
      setLatest(m);
      setSig([...m.values()].map((r) => `${r.id}:${r.state}`).join(","));
    }).catch(() => {});
  }, [root]);
  useEffect(() => { load(); }, [load]);
  const anyActive = [...latest.values()].some(isActiveRun);
  useEffect(() => { const id = setInterval(load, anyActive ? 2000 : 15000); return () => clearInterval(id); }, [load, anyActive]);
  useEffect(() => { window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);
  useEffect(() => { if (sig) onChange(); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- 상태 서명 바뀔 때만
  return [latest, load];
}

// 경과 "3m 12s"/"1h 4m"
export function elapsed(from: number, to = Date.now()): string {
  const s = Math.max(0, Math.floor((to - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// #1167 지금 화면에 열린 Crew 대화방(레포 root) — 열려 있는 방의 Crew 알림은 생략(WorkspaceTabs). 창이 여럿이어도 같은 렌더러 안에서만.
export const crewRoomOpen = new Set<string>();

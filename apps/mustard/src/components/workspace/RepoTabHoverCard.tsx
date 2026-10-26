"use client";

import { useEffect, useState } from "react";
import { IconGitBranch, IconPlus, IconTrash, IconArrowUp, IconArrowDown, IconPencil, IconLoader2, IconCircleCheck, IconQuestionMark, IconAlertTriangle, IconPlugConnected, IconExternalLink } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import RepoAvatar from "@/components/workspace/RepoAvatar";
import { openNewWorkspace, openRemoveWorkspace, openRepoTab } from "@/lib/repo/workspaceEvents";

// 레포 탭 호버 카드(#764/#765) — 그 레포에서 도는 에이전트 상태 + git 워크트리를 실시간으로.
// 에이전트 상태는 pty 버퍼 스크레이핑(#765)으로 판정된 것을 /api/agent/status(스토어)에서 읽는다(SSE 푸시 + 폴백 폴링).
// (프로세스명 휴리스틱은 유휴/작업 구분을 못 해 유휴에도 스피너를 띄우던 문제로 제거 — 버퍼 스크레이핑이 정확한 소스.)

interface Worktree { path: string; branch: string | null; head: string; detached: boolean; bare: boolean; locked: boolean; dirty: number; ahead: number; behind: number; subject: string; committedAt: string; }
type AgentState = "working" | "waiting" | "blocked" | "done";
interface AgentStatus { sessionId: string; agent: string; state: AgentState; tool?: string; toolInput?: string; prompt?: string; task?: string; since?: number; }
interface Port { port: number; pid: number; cmd: string } // #880 이 레포가 띄운 dev 서버 포트
interface SubInfo { id: string; agentType: string; description: string; depth: number; running: boolean; updatedAt: number } // #977 /api/agent/subagents

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const norm = (p: string) => p.replace(/\/+$/, "");
// 상대시각(간결) — "3s"/"5m"/"2h"/"4d". committedAt ISO 기준.
function rel(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const asAgentId = (s: string): AgentId => (Object.prototype.hasOwnProperty.call(AGENT_META, s) ? (s as AgentId) : "other");
// 그 레포에서 현재 열린 터미널 탭 세션 id 집합(#968) — TerminalPane이 localStorage `nunopi:ws-terms:{cwd}`에
// {tabs:[{id}]} 로 영속. 이 id가 곧 세션 id(= 상태 스토어 sessionId). 데몬 생존 유령(닫힌 탭 pty)을 호버서 제외하려고
// "열린 탭에 있는 세션"만 남긴다. 키 없으면 null(폴백 = 필터 안 함).
function openTermIds(repoPath: string): Set<string> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`nunopi:ws-terms:${repoPath}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as { tabs?: Array<{ id?: unknown }> };
    if (!Array.isArray(p.tabs)) return null;
    return new Set(p.tabs.map((tb) => tb?.id).filter((x): x is string => typeof x === "string"));
  } catch { return null; }
}
// 상대시각(ms 타임스탬프판) — since(stateStartedAt)용. "3s"/"5m"/"2h"/"4d".
function relMs(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const STATE_TEXT: Record<AgentState, string> = { working: "text-amber-500", waiting: "text-amber-500", blocked: "text-rose-500", done: "text-emerald-500" };
// 상태 아이콘 — 작업중=앰버 스피너, 대기(yes/no)=물음표, 막힘=경고, 완료=초록 체크. 색은 부모 텍스트색 상속.
function stateIcon(st: AgentState) {
  const p = { size: 12, stroke: 2.5, "aria-hidden": true } as const;
  if (st === "working") return <IconLoader2 {...p} className="animate-spin" />;
  if (st === "waiting") return <IconQuestionMark {...p} />;
  if (st === "blocked") return <IconAlertTriangle {...p} />;
  return <IconCircleCheck {...p} />;
}

// path별 마지막 스냅샷 캐시 — 재호버 시 즉시 표시(빈 상태 깜빡임·지연 방지, #764).
interface Snap { statuses: AgentStatus[]; worktrees: Worktree[] | null; ports?: Port[]; }
const snapCache = new Map<string, Snap>();
// path 스냅샷 부분 갱신 — 새 path 추가 시 100개 LRU 상한(모든 effect가 이걸 써서 무한 증가 방지, cavecrew).
function cacheMerge(path: string, patch: Partial<Snap>) {
  if (!snapCache.has(path) && snapCache.size >= 100) { const oldest = snapCache.keys().next().value; if (oldest !== undefined) snapCache.delete(oldest); }
  const prev = snapCache.get(path) ?? { statuses: [], worktrees: null };
  snapCache.set(path, { ...prev, ...patch });
}

export default function RepoTabHoverCard({ path, left, top, onMouseEnter, onMouseLeave }: {
  path: string;
  left: number;
  top: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const t = useT();
  const seed = snapCache.get(path);
  const [statuses, setStatuses] = useState<AgentStatus[]>(seed?.statuses ?? []); // 버퍼 스크레이핑 상태
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(seed?.worktrees ?? null); // null=로딩
  const [ports, setPorts] = useState<Port[]>(seed?.ports ?? []); // #880 dev 서버
  // #977 서브에이전트 트리 — claude 세션(sessionId)별 서브 목록. 카드 열린 동안 3s 폴링.
  const [subs, setSubs] = useState<Record<string, SubInfo[]>>({});
  const claudeKey = statuses.filter((s) => s.agent === "claude").map((s) => `${s.sessionId}\u0001${s.task ?? ""}`).join("\u0002");
  useEffect(() => {
    const rows = claudeKey ? claudeKey.split("\u0002").map((r) => r.split("\u0001")) : [];
    if (!rows.length) return;
    let alive = true;
    let seq = 0; // 응답 순서 가드 — 늦게 온 옛 폴링이 최신 결과 덮지 않게(리뷰 🟡)
    const load = () => {
      const my = ++seq;
      Promise.all(rows.map(async ([sid, task]) => {
        try {
          const r = await fetch(`/api/agent/subagents?cwd=${encodeURIComponent(path)}&title=${encodeURIComponent(task)}`);
          const j = await r.json();
          return [sid, j?.ok ? (j.subagents as SubInfo[]) : []] as const;
        } catch { return [sid, [] as SubInfo[]] as const; }
      })).then((es) => { if (alive && my === seq) setSubs(Object.fromEntries(es)); });
    };
    load();
    const iv = setInterval(load, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [path, claudeKey]);

  // 에이전트 상태 — /api/agent/status. SSE 푸시(즉시) + 폴백 폴링(1.5s).
  useEffect(() => {
    let alive = true;
    const inRepo = (cwd: string) => { const a = norm(cwd), b = norm(path); return a === b || a.startsWith(b + "/"); };
    const load = () => {
      fetch(`/api/agent/status?root=${encodeURIComponent(path)}`).then((r) => r.json()).then((j) => {
        if (!alive) return;
        const ss: AgentStatus[] = j?.ok ? (j.statuses ?? []) : [];
        // #968 유령 제외 — 그 레포서 현재 열린 터미널 탭 세션만. 키 없으면(폴백) 전부.
        const openIds = openTermIds(path);
        const shown = openIds ? ss.filter((s) => openIds.has(s.sessionId)) : ss;
        setStatuses(shown); cacheMerge(path, { statuses: shown });
      }).catch(() => { /* ignore */ });
    };
    void load();
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/agent/status/stream");
      es.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (typeof d?.cwd === "string" && inRepo(d.cwd)) void load(); } catch { /* ignore */ } };
    } catch { /* EventSource 미지원 → 폴링만 */ }
    const iv = setInterval(load, 1500);
    return () => { alive = false; clearInterval(iv); es?.close(); };
  }, [path]);

  // 워크트리 — 열 때 + 레포 파일 변경(#739) 시 재조회.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/repo/git-worktree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const d = await r.json();
        const list: Worktree[] = r.ok && d.ok ? (d.worktrees ?? []) : [];
        if (!alive) return;
        setWorktrees(list);
        cacheMerge(path, { worktrees: list });
      } catch { if (alive) setWorktrees([]); }
    };
    void load();
    const off = (typeof window !== "undefined" ? window.nunopiDesktop : undefined)?.repo?.onChanged?.((p) => { if (p.id === path) void load(); });
    return () => { alive = false; off?.(); };
  }, [path]);

  // 포트(#880) — 이 레포가 띄운 dev 서버. 열 때 + 3s 폴링(main이 세션 없으면 lsof 전에 [] 반환·저비용).
  useEffect(() => {
    const fn = (typeof window !== "undefined" ? window.nunopiDesktop : undefined)?.ports?.list;
    if (!fn) return;
    let alive = true;
    const load = () => { fn(path).then((ps) => {
      if (!alive) return; setPorts(ps); cacheMerge(path, { ports: ps });
    }).catch(() => { /* ignore */ }); };
    void load();
    const iv = setInterval(load, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [path]);

  return (
    <div style={{ left, top }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      className="fixed z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-[var(--s-raise)]">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
        <RepoAvatar path={path} size={14} iconClassName="shrink-0 text-mustard-600 dark:text-mustard-400" />
        <span className="truncate">{basename(path)}</span>
      </div>

      {/* 에이전트(#968) — orca式: 그 레포 세션 전부를 [상태 아이콘 + 로고 + 작업 제목 + 시각]으로 나열 */}
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {t("workspace.agents")}{statuses.length > 0 ? ` · ${statuses.length}` : ""}
      </div>
      {statuses.length === 0 ? (
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.noAgents")}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {statuses.map((h, i) => {
            const id = asAgentId(h.agent);
            // 주 텍스트 = 작업 제목(OSC 타이틀 요약). 없으면 에이전트 라벨. 서브 = working 중 툴.
            const title = h.task && h.task.trim() ? h.task.trim() : AGENT_META[id].label;
            const sub = h.state === "working" && h.tool ? (h.toolInput ? `${h.tool}: ${h.toolInput}` : h.tool) : "";
            const age = relMs(h.since);
            return (
              <div key={h.sessionId || `s${i}`}>
                <div className="flex items-center gap-2 text-[12px] text-zinc-700 dark:text-zinc-200">
                  <span className={`flex shrink-0 items-center ${STATE_TEXT[h.state]}`}>{stateIcon(h.state)}</span>
                  <AgentLogo agent={id} size={14} />
                  <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
                  {age && <span className="shrink-0 tabular-nums text-[10px] text-zinc-300 dark:text-zinc-600">{age}</span>}
                </div>
                {sub && <div className="ml-[38px] truncate text-[10px] text-zinc-400 dark:text-zinc-500" title={sub}>{sub}</div>}
                {/* #977 서브에이전트 트리 — spawnDepth만큼 들여쓰기. 실행중=스피너, 완료=체크 */}
                {(subs[h.sessionId] ?? []).map((sa) => (
                  <div key={sa.id} style={{ paddingLeft: 22 + sa.depth * 12 }} className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className={`flex shrink-0 items-center ${sa.running ? "text-amber-500" : "text-emerald-500"}`}>{stateIcon(sa.running ? "working" : "done")}</span>
                    <span className="min-w-0 flex-1 truncate" title={`${sa.description} (${sa.agentType})`}>{sa.description || sa.agentType}</span>
                    {sa.agentType && <span className="shrink-0 truncate text-[9px] text-zinc-300 dark:text-zinc-600" style={{ maxWidth: 80 }}>{sa.agentType.split(":").pop()}</span>}
                    <span className="shrink-0 tabular-nums text-[10px] text-zinc-300 dark:text-zinc-600">{relMs(sa.updatedAt)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* 워크트리 */}
      <div className="mb-1 mt-2.5 flex items-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        <span className="flex-1">{t("workspace.worktrees")}</span>
        {/* #1170 새 작업공간 */}
        <button type="button" onClick={() => openNewWorkspace(path)} title={t("newWs.title")} aria-label={t("newWs.title")} className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconPlus size={12} stroke={2} aria-hidden /></button>
      </div>
      {worktrees === null ? (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden /></div>
      ) : worktrees.length === 0 ? (
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.noWorktrees")}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {worktrees.map((w, i) => {
            const age = rel(w.committedAt);
            const main = i === 0, crew = w.path.includes("/.nunopi/worktrees/"); // #1170 메인·Crew worktree는 여기서 안 지움(Crew가 관리)
            return (
              <div key={w.path} className="group">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                  <IconGitBranch size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
                  {/* #1170 줄 누르면 이 레포 탭에서 그 작업 폴더로 전환 */}
                  {main ? <span className="min-w-0 flex-1 truncate" title={w.path}>{w.detached ? `${w.head} (detached)` : (w.branch ?? basename(w.path))}</span>
                    : <button type="button" onClick={() => openRepoTab(w.path, path)} title={t("rmWs.openTab", { path: w.path })} className="min-w-0 flex-1 truncate text-left hover:underline">{w.detached ? `${w.head} (detached)` : (w.branch ?? basename(w.path))}</button>}
                  {w.ahead > 0 && <span className="flex shrink-0 items-center text-emerald-500"><IconArrowUp size={11} stroke={2.5} aria-hidden />{w.ahead}</span>}
                  {w.behind > 0 && <span className="flex shrink-0 items-center text-amber-500"><IconArrowDown size={11} stroke={2.5} aria-hidden />{w.behind}</span>}
                  {w.dirty > 0 && <span className="flex shrink-0 items-center gap-0.5 text-zinc-400" title={t("workspace.dirtyFiles", { n: w.dirty })}><IconPencil size={10} stroke={2} aria-hidden />{w.dirty}</span>}
                  {!main && !crew && <button type="button" onClick={() => openRemoveWorkspace(path, w.path)} title={t("rmWs.title")} aria-label={t("rmWs.title")} className="shrink-0 rounded p-0.5 text-zinc-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-rose-500/10"><IconTrash size={11} stroke={2} aria-hidden /></button>}
                </div>
                {w.subject && (
                  <div className="ml-[18px] flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <span className="min-w-0 truncate" title={w.subject}>{w.subject}</span>
                    {age && <span className="shrink-0 tabular-nums text-zinc-300 dark:text-zinc-600">· {age}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 포트(#880) — 감지된 dev 서버 있을 때만. 클릭 → 기본 브라우저. */}
      {ports.length > 0 && (
        <>
          <div className="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("ports.title")}</div>
          <div className="flex flex-col gap-1">
            {ports.map((p) => (
              <button key={p.port} type="button" onClick={() => void window.nunopiDesktop?.ports?.open(p.port)} title={t("ports.open")}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <IconPlugConnected size={12} stroke={2} className="shrink-0 text-emerald-500" aria-hidden />
                <span className="font-mono text-[11px] font-medium text-zinc-700 dark:text-zinc-200">:{p.port}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-400 dark:text-zinc-500">{p.cmd}</span>
                <IconExternalLink size={11} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

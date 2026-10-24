"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { IconFiles, IconFolderOpen, IconPlus, IconX, IconMessages, IconFileCode, IconFileText, IconCards, IconBell, IconBellOff } from "@tabler/icons-react";
import { useT, useShortcut } from "@mustard/core";
import { getSetting, setSetting, subscribeSettings, NKEYS, NOTIF_DEFAULTS, CKEYS, desktopNotify, WKEYS, WORKSPACE_DEFAULTS } from "@mustard/core";
import { useToast } from "@mustard/core";
import { useConfirm } from "@mustard/core";
import WorkspaceView from "@/components/workspace/WorkspaceView";
import WorkspaceModePane from "@/components/workspace/WorkspaceModePane";
import RepoAvatar from "@/components/workspace/RepoAvatar";
import WorkspaceAddMenu, { type AddKind } from "@/components/workspace/WorkspaceAddMenu";
import RepoTabHoverCard from "@/components/workspace/RepoTabHoverCard";
import DaemonOutdatedNotice from "@/components/workspace/DaemonOutdatedNotice";
import { AgentStateIcon } from "@/components/workspace/AgentStateIcon";
import { publishRepoSessions } from "@/lib/agentSessionStates";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";
import MustardMark from "@/components/brand/MustardMark";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
const TABS_KEY = "nunopi:ws-tabs";       // 열린 탭 배열(#731, #769에서 태그드 유니온으로 확장)
const ACTIVE_KEY = "nunopi:ws-active";   // 활성 탭 키(tabKey)
const OLD_PATH_KEY = "nunopi:workspace-path"; // 구 단일 워크스페이스 경로 — 최초 1회 마이그레이션

// 탭 모델(#769) — 레포 탭은 폴더 경로가 정체성, 모드 탭(질문/코드/글)은 폴더 없이 유니크 id가 정체성.
type ModeKind = "ask" | "code" | "text" | "memorize";
export type Tab =
  | { type: "repo"; path: string }
  | { type: ModeKind; id: string };
// keep-alive·활성 판별 공통 키 — 레포=경로, 모드=id. localStorage active 키로도 씀.
const tabKey = (t: Tab): string => (t.type === "repo" ? `repo:${t.path}` : `${t.type}:${t.id}`);
// #968 그 레포서 현재 열린 터미널 탭 세션 id 집합(TerminalPane이 localStorage에 영속) — 데몬 생존 유령(닫힌 탭 pty)
// 제외용. 호버 카드(RepoTabHoverCard)와 동일 필터라 탭 도트도 실제 열린 세션만 집계. 키 없으면 null(폴백=필터 안 함).
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
const isMode = (k: unknown): k is ModeKind => k === "ask" || k === "code" || k === "text" || k === "memorize";
// 저장된 원소 하나를 Tab으로 — 구 문자열(순수 경로)이면 레포 탭으로 이관, 신규 객체는 검증 후 통과, 그 외 버림.
function migrateTab(x: unknown): Tab | null {
  if (typeof x === "string") return { type: "repo", path: x };
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (o.type === "repo" && typeof o.path === "string") return { type: "repo", path: o.path };
    if (isMode(o.type) && typeof o.id === "string") return { type: o.type, id: o.id };
  }
  return null;
}

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const norm = (p: string) => p.replace(/\/+$/, "");

// 모드 탭 표시(#771) — 레포 탭(IconFiles·인디고)과 구분되게 모드별 아이콘·색·이름.
const MODE_TAB: Record<ModeKind, { Icon: typeof IconFiles; labelKey: string; color: string }> = {
  // 색은 누노피 그라데이션의 파란 톤으로 통일 — 레포 아이콘(인디고)·상태 도트(emerald/amber/rose)와 구분.
  ask: { Icon: IconMessages, labelKey: "mode.ask", color: "text-sky-500 dark:text-sky-400" },
  code: { Icon: IconFileCode, labelKey: "mode.code", color: "text-sky-500 dark:text-sky-400" },
  text: { Icon: IconFileText, labelKey: "mode.text", color: "text-sky-500 dark:text-sky-400" },
  memorize: { Icon: IconCards, labelKey: "mode.memorize", color: "text-sky-500 dark:text-sky-400" },
};

// 탭 상태 도트(#764/#765) — 그 레포 에이전트의 종합 상태(버퍼 스크레이핑). 우선순위: 막힘>대기>작업중>완료.
type TabState = "working" | "waiting" | "blocked" | "done";
function aggregate(states: string[]): TabState | null {
  if (states.includes("blocked")) return "blocked";
  if (states.includes("waiting")) return "waiting";
  if (states.includes("working")) return "working";
  if (states.includes("done")) return "done";
  return null;
}
// 탭 상태 아이콘 — 공용 AgentStateIcon(터미널 탭과 같은 모양, #1036).
const tabDot = (st: TabState | null) => <AgentStateIcon state={st} />;

// 멀티 워크스페이스 탭(#731) — 여러 레포를 탭으로 열고 전환. 각 탭 = WorkspaceView 인스턴스(key=tabKey).
// 방문한 탭은 숨긴 채 계속 마운트(lazy keep-alive) — 전환해도 도킹/에디터/터미널 상태 보존.
// 명령 팔레트(#878)가 워크스페이스 탭을 조작하는 명령형 핸들 — 전환/생성/목록.
export type WorkspaceTabsHandle = {
  listTabs: () => { key: string; kind: "repo" | ModeKind; label: string }[];
  activate: (key: string) => void;
  addTab: (kind: AddKind) => void;
};
type WorkspaceTabsProps = { active?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings; onExitWorkspace?: () => void; onOpenMemorize?: () => void; onOpenSettings?: () => void };
const WorkspaceTabs = forwardRef<WorkspaceTabsHandle, WorkspaceTabsProps>(function WorkspaceTabs({ active = true, providerId, providerSettings, onExitWorkspace, onOpenMemorize, onOpenSettings }, ref) {
  const t = useT();
  // #1120 오래 사는 폴링 effect·타이머는 첫 렌더의 t(언어 불러오기 전 ko)를 붙잡음 → 알림은 이 ref로 최신 언어를 읽음.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]); // tabsRef·activeKeyRef와 같은 방식(렌더 중 ref 쓰기 회피). 알림은 1.5s 뒤라 타이밍 안전
  const toast = useToast();
  const confirm = useConfirm();
  const [mounted, setMounted] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeKeyRef = useRef<string | null>(null); // #973 poll 클로저서 최신 활성 탭 읽기(알림 게이트용)
  useEffect(() => { activeKeyRef.current = activeKey; }, [activeKey]);
  // 한 번이라도 활성화된 탭 키 — 이 집합만 실제 마운트(keep-alive). 안 연 탭은 마운트 안 함.
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const modeSeq = useRef(0); // 모드 탭 id 세션 카운터(같은 ms 충돌 방지, #769)
  const [addMenu, setAddMenu] = useState<{ left: number; top: number } | null>(null); // "+" 드롭다운 픽커(#769)
  const closeAddMenu = useCallback(() => setAddMenu(null), []); // 안정 참조 — 메뉴 effect 재부착 최소화
  // "+" 버튼 아래로 드롭다운 앵커링. 화면 오른쪽 넘침 방지.
  const openAddMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const W = 256, M = 8; // 메뉴 폭(w-64=256px) · 화면 여백
    setAddMenu({ left: Math.max(M, Math.min(r.left, window.innerWidth - W - M)), top: r.bottom + 6 });
  };
  // 레포 탭 호버 카드(#764) — 에이전트·워크트리 실시간. 탭↔카드 사이 이동 허용 위해 지연 닫기.
  const [hover, setHover] = useState<{ path: string; left: number; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 150); };
  const openHover = (p: string, el: HTMLElement) => {
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = 288, M = 8; // 카드 폭(w-72) · 화면 여백
    const left = Math.max(M, Math.min(r.left, window.innerWidth - W - M));
    setHover({ path: p, left, top: r.bottom + 6 }); // 탭 아래로
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  // 탭별 종합 상태(#764) — 호버 없이도 돌아가는중/완료/대기를 도트로. 레포 탭만 대상. 워크스페이스 활성 동안 폴링.
  const [repoStatus, setRepoStatus] = useState<Record<string, TabState | null>>({});
  const prevRepoStatus = useRef<Record<string, TabState | null>>({}); // 탭 도트(레포 종합)
  // #989 알림은 세션 단위 전이(orca 방식). key = repo\0sessionId. latest는 대기 타이머가 재확인할 최신값.
  const prevSession = useRef<Record<string, string>>({});
  const latestSession = useRef<Record<string, string>>({});
  const pendingNotify = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastNotifyAt = useRef<Record<string, number>>({}); // 레포별 마지막 알림 시각(5s 쿨다운)
  // 대기 타이머는 effect 재실행(탭 변경)을 넘어 살아야 함 — 재실행 때 취소하면 이미 소비된 전이 알림이 사라짐.
  // 그래서 탭은 ref로 읽고, 타이머는 언마운트 때만 정리.
  const tabsRef = useRef<Tab[]>([]);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => () => { for (const h of Object.values(pendingNotify.current)) clearTimeout(h); }, []);
  const notifyWarmupUntil = useRef(0); // #973 실행 후 워밍업 종료 시각 — 복원 버퍼 정착 전 flicker 전이 알림 억제
  const [notifyOn, setNotifyOn] = useState(true);                     // #876 알림 on/off(벨 토글, localStorage 영속)
  const notifyOnRef = useRef(true);                                   // poll .then 클로저서 최신값 읽기(effect 재실행 회피)
  const toggleNotify = () => {
    const next = !notifyOnRef.current;
    notifyOnRef.current = next; setNotifyOn(next);
    setSetting(NKEYS.agentDone, next); // #928 설정 스토어로 이관(설정 페이지와 동기)
  };
  // 설정 페이지서 알림 토글 변경 시 인탭 벨 동기(#928).
  useEffect(() => subscribeSettings(() => {
    const v = getSetting<boolean>(NKEYS.agentDone, NOTIF_DEFAULTS.agentDone);
    notifyOnRef.current = v; setNotifyOn(v);
  }), []);
  useEffect(() => {
    if (!mounted || !active) return;
    // #973 실행/재활성 직후 4s는 알림 워밍업 — 복원된 터미널 버퍼(옛 에이전트 출력)가 정착하며 생기는
    // 가짜 working→done 전이로 알림이 뜨던 문제 억제. baseline(prevRepoStatus)은 그대로 잡되 알림만 스킵.
    if (!notifyWarmupUntil.current) notifyWarmupUntil.current = Date.now() + 4000;
    const repoPaths = tabs.filter((x): x is { type: "repo"; path: string } => x.type === "repo").map((x) => x.path);
    if (repoPaths.length === 0) return;
    let alive = true;
    // 각 레포의 에이전트 상태(버퍼 스크레이핑, /api/agent/status)로 종합 도트. 프로세스명 휴리스틱은 제거(#765).
    const poll = () => {
      Promise.all(repoPaths.map(async (p) => {
        try {
          const r = await fetch(`/api/agent/status?root=${encodeURIComponent(p)}`); const j = await r.json();
          const raw: { sessionId: string; state: string; silent?: boolean }[] = j?.ok ? (j.statuses ?? []) : [];
          const openIds = openTermIds(p); // #968 유령 제외 — 열린 터미널 탭 세션만 집계(호버와 일관)
          const shown = openIds ? raw.filter((s) => openIds.has(s.sessionId)) : raw;
          publishRepoSessions(p, shown); // #1036 터미널 탭 아이콘용(같은 폴링 결과 공유)
          return [p, aggregate(shown.map((s) => s.state)), shown] as const;
        }
        catch { publishRepoSessions(p, null); return [p, null, null] as const; } // 조회 실패면 터미널 탭 아이콘도 비움(낡은 스피너 고정 방지)
      })).then((results) => {
        if (!alive) return;
        const entries = results.map(([p, st]) => [p, st] as const);
        // #876 전이 감지 — 레포가 working → 完了/대기/blocked로 바뀐 순간에만 데스크톱 알림(자리비움 게이트는 notify IPC가 처리).
        // 이 콜백은 read(prev[p])~write(prev=…) 사이 await가 없어 원자적 — 동시 폴 2개여도 직렬 실행돼 한 전이가 두 번 안 울림.
        // #973 "보고 있는 레포"면 알림 스킵 — 창 포커스 AND 그 레포가 활성 탭일 때(작업 지켜보는 중).
        // 배경 레포(다른 탭) 또는 창 비포커스(다른 앱/화면)면 알림 O. 예전엔 창 포커스만 봐서 배경 레포 완료를 놓쳤음.
        const warming = Date.now() < notifyWarmupUntil.current; // #973 실행 직후 유예(복원 버퍼 정착 중)
        // #989 세션 단위 전이 → 1.5s 조용히 기다렸다 재확인(그 사이 다시 working이면 취소) → 게이트·쿨다운 후 알림.
        // orca: hook done 1.5s quiet window + 워크트리별 5s 쿨다운. 깜빡임(working→done→working)이 알림까지 못 가게.
        const seen = new Set<string>();
        for (const [p, , shown] of results) {
          for (const s of shown ?? []) {
            const k = `${p}\0${s.sessionId}`;
            seen.add(k);
            latestSession.current[k] = s.silent ? `${s.state}:silent` : s.state; // #989 수동 compact 종료 = 알림 없는 done
            const prev = prevSession.current[k];
            prevSession.current[k] = s.state;
            if (s.state === "working") { clearTimeout(pendingNotify.current[k]); delete pendingNotify.current[k]; continue; }
            if (prev !== "working" || warming || !notifyOnRef.current || pendingNotify.current[k] || s.silent) continue;
            const fired = latestSession.current[k];
            pendingNotify.current[k] = setTimeout(() => {
              delete pendingNotify.current[k];
              if (latestSession.current[k] !== fired || !notifyOnRef.current) return; // 그새 바뀜 → 취소
              const focused = typeof document !== "undefined" && document.hasFocus();
              const at = tabsRef.current.find((x) => tabKey(x) === activeKeyRef.current);
              const watching = focused && !!at && at.type === "repo" && at.path === p; // 지금 이 레포를 보고 있음
              if (getSetting<boolean>(NKEYS.suppressWhileWatching, NOTIF_DEFAULTS.suppressWhileWatching) && watching) return;
              const now = Date.now();
              if (now - (lastNotifyAt.current[p] ?? 0) < 5000) return; // 레포별 5s 쿨다운(세션 여러 개 동시 완료 등)
              lastNotifyAt.current[p] = now;
              const name = p.split(/[\\/]/).filter(Boolean).pop() || p; // 레포 폴더명(win 백슬래시·posix 슬래시 둘 다)
              const title = s.state === "done" ? `✅ ${tRef.current("notify.done")}` : `⏸ ${tRef.current("notify.waiting")}`;
              // 게이트는 여기서(watching) 처리 — IPC 포커스 억제 끔(배경 레포는 포커스여도 알림). target = 클릭 시 이동(#989).
              void desktopNotify({ title, body: name, suppressWhileFocused: false, target: { repoPath: p, sessionId: s.sessionId } });
            }, 1500);
          }
        }
        for (const k of Object.keys(prevSession.current)) if (!seen.has(k)) { delete prevSession.current[k]; delete latestSession.current[k]; } // 닫힌 세션 정리
        prevRepoStatus.current = Object.fromEntries(entries);
        setRepoStatus(prevRepoStatus.current);
      });
    };
    void poll();
    // SSE 푸시(#764) — 훅이 열린 레포 중 하나의 cwd 상태를 바꾸면 즉시 재조회. 이게 "실제 변화 시" 갱신의 주 경로.
    const within = (cwd: string) => { const a = norm(cwd); return repoPaths.some((p) => { const b = norm(p); return a === b || a.startsWith(b + "/"); }); };
    let es: EventSource | null = null;
    let sseOk = false;
    try {
      es = new EventSource("/api/agent/status/stream");
      es.onopen = () => { sseOk = true; };
      es.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (typeof d?.cwd === "string" && within(d.cwd)) void poll(); } catch { /* ignore */ } };
      es.onerror = () => { sseOk = false; };
    } catch { /* EventSource 미지원 → 폴링만 */ }
    // 성능(#838): 변경은 SSE가 push하므로 폴링은 느린 안전망만. 예전 1.5s×N레포 폴링이 로그 스팸·churn의 원인이었음.
    // SSE가 살아있으면 20s 하트비트(놓친 push 대비), 죽었/미지원이면 3s로 촘촘히(폴링이 유일 수단).
    const iv = setInterval(() => { void poll(); }, 20000);
    const ivFast = setInterval(() => { if (!sseOk) void poll(); }, 3000); // SSE 다운 시에만 촘촘히
    return () => { alive = false; clearInterval(iv); clearInterval(ivFast); es?.close(); };
  }, [mounted, active, tabs]);

  // #1167 Crew가 나를 부르면(@you — 질문·권한 요청·관문·막힘) 데스크톱 알림. 대화방을 안 열어 둬도 레포 탭마다 5초 확인.
  // 처음 본 레포는 기준점만(지금 시각) — 앱 켤 때 옛 글로 알림이 쏟아지지 않게. 같은 ms 글은 id로 한 번만.
  const crewSince = useRef<Record<string, number>>({});
  const crewSeen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!mounted || !active) return;
    const repoPaths = tabs.filter((x): x is { type: "repo"; path: string } => x.type === "repo").map((x) => x.path);
    if (repoPaths.length === 0) return;
    for (const p of repoPaths) crewSince.current[p] ??= Date.now();
    let alive = true;
    const TITLE: Record<string, [string, string]> = { question: ["❓", "crewchat.notify.question"], permission: ["🔐", "crewchat.notify.permission"], gate: ["🚦", "crewchat.notify.gate"], blocked: ["⛔", "crewchat.notify.blocked"] };
    const check = () => {
      if (!getSetting<boolean>(NKEYS.crew, NOTIF_DEFAULTS.crew)) { for (const p of repoPaths) crewSince.current[p] = Date.now(); return; } // 꺼 둔 동안 글은 켜도 안 울림
      for (const p of repoPaths) {
        void fetch(`/api/crew/chat?root=${encodeURIComponent(p)}&since=${crewSince.current[p]}&peek=1`).then((r) => r.json()).then((j: { ok?: boolean; msgs?: { id: string; ts: number; from: string; kind: string; text: string; taskTitle?: string; mentions?: string[]; i18n?: { key: string; vars?: Record<string, string | number> } }[] }) => {
          if (!alive || !j?.ok) return;
          for (const m of j.msgs ?? []) {
            crewSince.current[p] = Math.max(crewSince.current[p] ?? 0, m.ts);
            if (crewSeen.current.has(m.id)) continue;
            crewSeen.current.add(m.id);
            const head = TITLE[m.kind];
            if (!head || !m.mentions?.includes("you")) continue;
            const focused = typeof document !== "undefined" && document.hasFocus();
            const at = tabsRef.current.find((x) => tabKey(x) === activeKeyRef.current);
            if (getSetting<boolean>(NKEYS.suppressWhileWatching, NOTIF_DEFAULTS.suppressWhileWatching) && focused && at?.type === "repo" && at.path === p) continue; // 지금 이 레포를 보고 있음
            const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
            const said = (m.i18n ? tRef.current(m.i18n.key, m.i18n.vars) : m.text).replace(/\s+/g, " ").trim();
            void desktopNotify({ title: `${head[0]} ${tRef.current(head[1])}`, body: `${name}${m.taskTitle ? ` · ${m.taskTitle}` : ""}\n${said.slice(0, 140)}`, suppressWhileFocused: false, target: { repoPath: p } });
          }
          if (crewSeen.current.size > 500) crewSeen.current = new Set([...crewSeen.current].slice(-200)); // 오래된 id 정리
        }).catch(() => { /* 다음 확인에서 */ });
      }
    };
    const iv = setInterval(check, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [mounted, active, tabs]);

  useEffect(() => {
    let ts: Tab[] = [];
    let a: string | null = null;
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) ts = arr.map(migrateTab).filter((x): x is Tab => x !== null); }
      else { const old = localStorage.getItem(OLD_PATH_KEY); if (old) ts = [{ type: "repo", path: old }]; } // 구 단일 → 탭 1개로 이관
      const keys = ts.map(tabKey);
      const act = localStorage.getItem(ACTIVE_KEY);
      // 구 active(순수 경로)면 repo: 접두 붙여 매칭 시도. 못 맞추면 첫 탭.
      const want = act && keys.includes(act) ? act : act && keys.includes(`repo:${act}`) ? `repo:${act}` : null;
      a = want ?? keys[0] ?? null;
    } catch { /* ignore */ }
    // #928 설정 스토어서 복원. 옛 키(nunopi:notifyAgentDone) 있으면 1회 이관.
    try { const old = localStorage.getItem("nunopi:notifyAgentDone"); if (old !== null && getSetting(NKEYS.agentDone, null) === null) { setSetting(NKEYS.agentDone, old !== "0"); localStorage.removeItem("nunopi:notifyAgentDone"); } } catch { /* ignore */ }
    const notif = getSetting<boolean>(NKEYS.agentDone, NOTIF_DEFAULTS.agentDone);
    notifyOnRef.current = notif;
    /* eslint-disable react-hooks/set-state-in-effect -- 마운트 1회 복원 */
    setMounted(true);
    setNotifyOn(notif);
    setTabs(ts);
    setActiveKey(a);
    if (a) setVisited(new Set([a]));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const desktop = mounted ? window.nunopiDesktop : undefined;

  // 영속.
  useEffect(() => { if (!mounted) return; try { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)); } catch { /* ignore */ } }, [tabs, mounted]);
  useEffect(() => { if (!mounted) return; try { if (activeKey) localStorage.setItem(ACTIVE_KEY, activeKey); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ } }, [activeKey, mounted]);

  // 복원 시 모드 탭을 main 레지스트리에 재등록(#789) — 재시작하면 레지스트리가 비므로. 이미 다른
  // 창이 점유해 claim 실패한 kind는 그 탭을 조용히 제거(탭·창 통합 1개 유지).
  useEffect(() => {
    if (!mounted || !desktop?.modeClaim) return;
    let cancelled = false;
    (async () => {
      const kinds = [...new Set(tabs.filter((x): x is Extract<Tab, { type: ModeKind }> => x.type !== "repo").map((x) => x.type))];
      const failed: ModeKind[] = [];
      for (const k of kinds) { const r = await desktop.modeClaim!(k); if (!r.ok) failed.push(k); }
      if (!cancelled && failed.length) setTabs((prev) => prev.filter((x) => x.type === "repo" || !failed.includes(x.type)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // #989 알림 클릭 → 그 레포 탭 활성(닫혀 있으면 다시 열기) + 그 터미널 탭 포커스.
  useEffect(() => {
    if (!mounted || !desktop?.onNotifyActivate) return;
    return desktop.onNotifyActivate(({ repoPath, sessionId }) => {
      const key = tabKey({ type: "repo", path: repoPath });
      setTabs((prev) => (prev.some((x) => tabKey(x) === key) ? prev : [...prev, { type: "repo", path: repoPath }]));
      activate(key);
      if (sessionId) requestTerminalFocus(repoPath, sessionId);
    });
  }, [mounted, desktop]);

  // #1027 레포 탭 단축키 — ⌘⌥] / ⌘⌥[ / ⌘⌥1~9(9=마지막). 탭 줄 순서 그대로.
  useShortcut(["repo.next", "repo.prev", ...Array.from({ length: 9 }, (_, i) => `repo.goto${i + 1}`)], (d) => {
    if (!active || !tabs.length) return false;
    const keys = tabs.map(tabKey);
    const i = Math.max(0, keys.indexOf(activeKey ?? ""));
    const k = d.id === "repo.next" ? keys[(i + 1) % keys.length] : d.id === "repo.prev" ? keys[(i - 1 + keys.length) % keys.length]
      : d.arg === 9 ? keys[keys.length - 1] : keys[(d.arg ?? 1) - 1] ?? keys[keys.length - 1];
    activate(k);
  });

  function activate(key: string) {
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key))); // keep-alive 대상 등록
    setActiveKey(key);
  }

  // 탭 드래그 재정렬(#775) — pointer 기반(HTML5 DnD 아님). native 드래그는 브라우저가 "복사" 커서
  // 배지를 강제로 띄워 못 없애므로, pointerdown/move/up으로 직접 구현해 커서를 완전 제어한다.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [overAfter, setOverAfter] = useState(false); // 드롭 위치가 over 탭의 뒤(오른쪽)인가 — 맨 뒤 이동 표시용
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 }); // 떠다니는 고스트 위치(마우스 추적)
  const dragState = useRef<{ key: string; startX: number; moved: boolean } | null>(null);
  // 배열 순서 = 화면 순서. from을 to(앞/뒤) 위치로 splice → setTabs → 기존 effect가 localStorage 영속.
  function reorder(fromKey: string, toKey: string, after: boolean) {
    if (fromKey === toKey) return;
    setTabs((prev) => {
      const from = prev.findIndex((x) => tabKey(x) === fromKey);
      const to = prev.findIndex((x) => tabKey(x) === toKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      let insertAt = after ? to + 1 : to;
      if (from < insertAt) insertAt--; // from 제거로 뒤쪽 인덱스가 하나 당겨짐
      next.splice(insertAt, 0, moved);
      return next;
    });
  }
  function tabPointerDown(e: React.PointerEvent<HTMLDivElement>, key: string) {
    if ((e.target as HTMLElement).closest("button")) return; // 닫기 버튼은 자체 클릭 — 드래그 시작 안 함.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { key, startX: e.clientX, moved: false };
  }
  function tabPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const st = dragState.current;
    if (!st) return;
    if (!st.moved) {
      if (Math.abs(e.clientX - st.startX) < 5) return; // 임계 미만 = 클릭(드래그 시작 안 함)
      st.moved = true;
      setDraggingKey(st.key);
      setHover(null);
      cancelClose();
    }
    setDragPos({ x: e.clientX, y: e.clientY }); // 고스트가 마우스 따라오게
    // 마우스 아래의 탭 키(pointerCapture라 좌표로 직접 탐색). 탭 중앙 오른쪽이면 "뒤에 삽입".
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-tab-key]") as HTMLElement | null;
    const overK = el?.getAttribute("data-tab-key") ?? null;
    if (overK && overK !== st.key && el) {
      const r = el.getBoundingClientRect();
      setOverKey(overK);
      setOverAfter(e.clientX > r.left + r.width / 2);
    } else {
      setOverKey(null);
    }
  }
  function tabPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const st = dragState.current;
    dragState.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (st?.moved) {
      if (overKey && overKey !== st.key) reorder(st.key, overKey, overAfter);
    } else if (st) {
      activate(st.key); // 안 움직였으면 클릭 = 탭 활성화.
    }
    setDraggingKey(null);
    setOverKey(null);
  }

  async function addRepoTab() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder({ defaultPath: getSetting<string>(WKEYS.defaultFolder, WORKSPACE_DEFAULTS.defaultFolder) || undefined });
      if (!r.canceled && r.path) {
        const path = r.path;
        const key = `repo:${path}`;
        if (tabs.some((x) => tabKey(x) === key)) { // 이미 열린 레포면 새 탭 없이 안내(자동이동 X, 버튼으로 이동, #787)
          toast(t("workspace.repoAlreadyOpen"), "error", { label: t("workspace.goToTab"), onClick: () => activate(key) });
          return;
        }
        // 추가는 updater 내에서 재확인 — 폴더 피커 동시 resolve 등 레이스 시 이중 추가 방지.
        setTabs((prev) => (prev.some((x) => tabKey(x) === key) ? prev : [...prev, { type: "repo", path }]));
        activate(key);
      }
    } catch { /* 무시 */ } finally { setPicking(false); }
  }

  // 모드 탭(질문/코드/글) 추가(#769) — 폴더 없이 유니크 id로 새 빈 탭. id는 생성 후 불변(keep-alive·영속 키).
  // Date.now(세션 간 구분) + 세션 카운터(같은 ms 연속 생성 시 충돌 방지).
  async function addModeTab(kind: ModeKind) {
    const existing = tabs.find((x) => x.type === kind); // 로컬 탭에 이미 있으면 그 탭으로 안내(#787)
    if (existing) {
      toast(t("workspace.modeAlreadyOpen"), "error", { label: t("workspace.goToTab"), onClick: () => activate(tabKey(existing)) });
      return;
    }
    // 다른 창(#789)에 이미 열렸는지 main 레지스트리로 확인+점유. 성공해야 탭 추가(탭·창 통합 1개).
    if (desktop?.modeClaim) {
      const r = await desktop.modeClaim(kind);
      if (!r.ok) { toast(t("workspace.modeOpenElsewhere"), "error"); return; }
    }
    const id = `${Date.now().toString(36)}-${modeSeq.current++}`;
    const key = `${kind}:${id}`;
    // updater 내 재확인 — 같은 배치에서 이중 발화해도 kind당 1개 유지(레이스 백스톱).
    setTabs((prev) => (prev.some((x) => x.type === kind) ? prev : [...prev, { type: kind, id }]));
    activate(key);
  }

  // 모드를 새 창으로 열기(#789) — main 레지스트리가 이미 떠 있으면 exists로 거부.
  // exists일 때만 "이미 열림" 안내. 그 외 실패(invalid=구 main/미지원, not-ready)는 오표시 방지 위해 조용히.
  async function openModeInWindow(kind: ModeKind) {
    if (!desktop?.openModeWindow) return;
    const r = await desktop.openModeWindow(kind);
    if (r?.reason === "exists") toast(t("workspace.modeOpenElsewhere"), "error");
  }

  // 메뉴 선택 → 레포는 폴더 다이얼로그, 모드는 탭 추가 또는 새 창(#789).
  const onPick = (kind: AddKind, target: "tab" | "window" = "tab") => {
    if (kind === "repo") { void addRepoTab(); return; }
    if (target === "window") void openModeInWindow(kind);
    else void addModeTab(kind);
  };

  // 명령 팔레트(#878)용 명령형 핸들 — 매 렌더 최신 tabs/activate/onPick 반영(activate는 setter-only라 stale 무해).
  useImperativeHandle(ref, () => ({
    listTabs: () => tabs.map((tb) => ({ key: tabKey(tb), kind: tb.type, label: tb.type === "repo" ? basename(tb.path) : t(MODE_TAB[tb.type].labelKey) })),
    activate: (key) => activate(key),
    addTab: (kind) => onPick(kind),
  }), [tabs, t, activate, onPick]);

  // #968 레포 탭 닫을 때 그 repo(하위 포함)에서 도는 터미널 pty를 데몬서 kill — 유령 세션(닫힌 탭 생존) 방지.
  // orca 기본 동작(닫기=kill)과 동일. 명시적 닫기에서만 호출(언마운트/앱종료엔 미호출 → #682 재시작 생존 보존).
  function killRepoTerminals(repoPath: string) {
    const nd = desktop;
    if (!nd?.terminal?.list || !nd.terminal.kill) return;
    const norm = (p: string) => p.replace(/\/+$/, "");
    const root = norm(repoPath);
    const inRepo = (root2: string, cwd: string) => cwd === root2 || cwd.startsWith(root2 + "/");
    // 다른 열린 레포 탭 경로들(nested repo 대비) — 세션의 "가장 구체적(긴) 매칭 repo"가 닫는 repo일 때만 kill.
    // 예: repoB가 repoA 하위인데 둘 다 열림 → repoA 닫아도 repoB 세션은 repoB가 더 긴 매칭이라 보존.
    const openRepoPaths = tabs.filter((x): x is { type: "repo"; path: string } => x.type === "repo").map((x) => norm(x.path));
    nd.terminal.list().then((sessions) => {
      for (const s of sessions) {
        const c = s.cwd ? norm(s.cwd) : "";
        if (!c || !inRepo(root, c)) continue;
        const best = openRepoPaths.filter((p) => inRepo(p, c)).sort((a, b) => b.length - a.length)[0]; // 최장 매칭
        if (best === root) nd.terminal.kill({ id: s.id }); // 이 세션의 주인이 닫는 repo일 때만
      }
    }).catch(() => { /* 데몬 미응답 — 무시(다음 idle reap이 정리) */ });
  }

  function closeTab(key: string) {
    const idx = tabs.findIndex((x) => tabKey(x) === key);
    if (idx < 0) return;
    const closing = tabs[idx];
    if (closing.type !== "repo") desktop?.modeRelease?.(closing.type); // 모드 탭 닫으면 레지스트리 해제(#789)
    else killRepoTerminals(closing.path); // #968 레포 탭 명시적 닫기 → 그 repo 터미널 pty kill(유령 세션 방지). 앱 재시작 생존(#682)은 별개.
    const next = tabs.filter((x) => tabKey(x) !== key);
    if (activeKey === key) {
      // 활성 탭을 닫으면 이웃으로 활성 이동.
      const neighbor = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
      const nk = neighbor ? tabKey(neighbor) : null;
      setActiveKey(nk);
      if (nk) setVisited((prev) => (prev.has(nk) ? prev : new Set(prev).add(nk)));
    }
    setTabs(next);
    // 닫힌 탭은 keep-alive에서 제거(언마운트). localStorage per-path는 남아 재오픈 시 복원.
    setVisited((prev) => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });
  }

  if (mounted && !desktop) {
    return <div className="flex h-full flex-1 items-center justify-center p-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">{t("workspace.desktopOnly")}</div>;
  }

  // 탭 스트립 — WorkspaceView 헤더 한 줄의 좌측에 pill 형태로(#731). 헤더가 border-b 제공, 자체 bar 없음.
  const tabStrip = (
    <div className="nunopi-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5">
      {tabs.map((tab) => {
        const key = tabKey(tab);
        const on = key === activeKey;
        const p = tab.type === "repo" ? tab.path : null;
        const mode = tab.type === "repo" ? null : MODE_TAB[tab.type];
        const Icon = mode ? mode.Icon : IconFiles;
        // 아이콘 색 — 활성 레포=인디고, 활성 모드=모드색(레포와 구분), 비활성=회색.
        const iconColor = !on ? "text-zinc-400" : mode ? mode.color : "text-mustard-600 dark:text-mustard-400";
        const label = p ? basename(p) : t(mode!.labelKey);
        const showDrop = overKey === key && draggingKey !== null && draggingKey !== key;
        const isDragging = draggingKey === key;
        // 드롭 바 — 앞(왼쪽)/뒤(오른쪽). 뒤=맨 끝 이동을 명확히 보여준다.
        const dropBar = !showDrop ? "" : overAfter
          ? "after:absolute after:-right-0.5 after:top-1/2 after:h-4/5 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-mustard-500 dark:after:bg-mustard-400"
          : "before:absolute before:-left-0.5 before:top-1/2 before:h-4/5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-mustard-500 dark:before:bg-mustard-400";
        return (
          <div key={key} data-tab-key={key} title={p ?? label}
            onPointerDown={(e) => tabPointerDown(e, key)}
            onPointerMove={tabPointerMove}
            onPointerUp={tabPointerUp}
            onMouseEnter={p ? (e) => openHover(p, e.currentTarget) : undefined} onMouseLeave={p ? scheduleClose : undefined}
            className={`group relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition ${draggingKey ? "cursor-grabbing" : "cursor-grab"} ${isDragging ? "opacity-50" : ""} ${on ? "bg-brown-500/12 text-zinc-900 shadow-sm ring-1 ring-inset ring-brown-500/45 dark:bg-brown-400/12 dark:text-zinc-50 dark:ring-brown-400/45" : "text-zinc-500 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"} ${dropBar}`}>
            {p ? tabDot(repoStatus[p] ?? null) : null}
            {p ? <RepoAvatar path={p} size={13} iconClassName={`shrink-0 ${iconColor}`} /> : <Icon size={13} stroke={2} className={`shrink-0 ${iconColor}`} aria-hidden />}
            <span className="max-w-[12rem] truncate whitespace-nowrap font-medium">{label}</span>
            <button type="button" onClick={async (e) => { e.stopPropagation(); if (await confirm({ skipKey: CKEYS.skipCloseTab, title: label, message: t("workspace.closeTabConfirm"), detail: t("workspace.closeTabConfirmDetail"), confirmText: t("workspace.closeTab"), tone: "warn" })) closeTab(key); }} title={t("workspace.closeTab")} aria-label={t("workspace.closeTab")}
              className={`ml-0.5 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`}>
              <IconX size={12} stroke={2.5} aria-hidden />
            </button>
          </div>
        );
      })}
      {/* 새 탭 추가 — 마지막 탭 바로 옆(#731). "+" 항상 드롭다운 먼저(#769). */}
      <button type="button" onClick={(e) => openAddMenu(e.currentTarget)} disabled={picking || !mounted} title={t("workspace.newTab")} aria-label={t("workspace.newTab")}
        className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200">
        <IconPlus size={16} stroke={2} aria-hidden />
      </button>
      {/* #876 에이전트 완료 알림 on/off */}
      <button type="button" onClick={toggleNotify} title={t("notify.toggle")} aria-label={t("notify.toggle")} aria-pressed={notifyOn}
        className="ml-auto flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200">
        {notifyOn ? <IconBell size={15} stroke={2} aria-hidden /> : <IconBellOff size={15} stroke={2} aria-hidden />}
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <DaemonOutdatedNotice />
      {/* 본문 — 방문한 탭들 keep-alive(활성만 보임). 탭 스트립은 각 WorkspaceView 헤더 아래에. 탭 없으면 빈 상태. */}
      <div className="relative flex min-h-0 flex-1">
        {tabs.length === 0 ? (
          <div className="flex h-full flex-1 items-center justify-center p-8">
            <div className="flex max-w-sm flex-col items-center gap-4 text-center">
              {/* 브랜드 심볼(#906 겨자 꽃가지) + 워드마크. 브랜드명이라 무번역. */}
              <MustardMark size={60} />
              <div className="text-2xl font-bold tracking-tight text-mustard-600 dark:text-mustard-400">Mustard</div>
              <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("workspace.intro")}</p>
              <button type="button" onClick={(e) => openAddMenu(e.currentTarget)} disabled={picking || !mounted}
                className="inline-flex items-center gap-2 rounded-xl bg-mustard-500 px-4 py-2 text-[13px] font-semibold text-brown-900 transition hover:bg-mustard-400 disabled:opacity-50">
                <IconFolderOpen size={16} stroke={2} aria-hidden /> {t("workspace.pickFolder")}
              </button>
              {/* 키보드 힌트 — ⌘K 명령 팔레트(orca식 컴팩트 치트시트). */}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-zinc-700 dark:bg-zinc-800">⌘K</kbd>
                <span>{t("workspace.hintPalette")}</span>
              </div>
            </div>
          </div>
        ) : (
          tabs.filter((tab) => visited.has(tabKey(tab))).map((tab) => {
            const key = tabKey(tab);
            const on = key === activeKey;
            return (
              <div key={key} className={on ? "flex min-h-0 w-full flex-1" : "hidden"}>
                {tab.type === "repo" ? (
                  <WorkspaceView
                    path={tab.path}
                    active={active && on}
                    agentWorking={repoStatus[tab.path] === "working"} // #1043 숨은 레포라도 에이전트 작업 중이면 캐치업 연결 유지
                    providerId={providerId}
                    providerSettings={providerSettings}
                    onOpenMemorize={onOpenMemorize}
                    onOpenSettings={onOpenSettings}
                    tabStrip={on ? tabStrip : undefined}
                  />
                ) : (
                  <WorkspaceModePane
                    kind={tab.type}
                    active={active && on}
                    providerId={providerId}
                    providerSettings={providerSettings}
                    tabStrip={on ? tabStrip : undefined}
                    onExitWorkspace={onExitWorkspace}
                    onOpenMemorize={onOpenMemorize}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
      {hover && (
        <RepoTabHoverCard key={hover.path} path={hover.path} left={hover.left} top={hover.top}
          onMouseEnter={cancelClose} onMouseLeave={scheduleClose} />
      )}
      {/* 드래그 고스트(#775) — 마우스 따라오는 탭 미리보기. pointer 방식이라 native 잔영이 없어 직접 그린다. */}
      {draggingKey && (() => {
        const gt = tabs.find((x) => tabKey(x) === draggingKey);
        if (!gt) return null;
        const gp = gt.type === "repo" ? gt.path : null;
        const gm = gt.type === "repo" ? null : MODE_TAB[gt.type];
        const GIcon = gm ? gm.Icon : IconFiles;
        const glabel = gp ? basename(gp) : t(gm!.labelKey);
        return (
          <div className="pointer-events-none fixed z-[60] flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-zinc-800 opacity-90 shadow-lg ring-1 ring-black/10 dark:bg-[var(--s-pane)] dark:text-zinc-100 dark:ring-white/10"
            style={{ left: dragPos.x + 10, top: dragPos.y + 10 }}>
            <GIcon size={13} stroke={2} className={`shrink-0 ${gm ? gm.color : "text-mustard-600 dark:text-mustard-400"}`} aria-hidden />
            <span className="max-w-[12rem] truncate">{glabel}</span>
          </div>
        );
      })()}
      <WorkspaceAddMenu anchor={addMenu} onClose={closeAddMenu} onPick={onPick} />
    </div>
  );
});
export default WorkspaceTabs;

"use client";
// 워크스페이스 터미널 멀티탭(#678) — 탭 바 + 활성 터미널. pty는 메인서 id별로 생존(#647 A안).
// 활성 탭만 렌더(전환 시 remount → scrollback 재생). 탭 목록은 레포별 localStorage 영속.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconX, IconTerminal2 } from "@tabler/icons-react";
import { useShortcut, useT, getTerminalThemePref, isTerminalDark, getSetting, AKEYS, AGENT_DEFAULTS, CKEYS, useConfirm } from "@mustard/core";
import Terminal from "@/components/workspace/Terminal";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import { AgentStateIcon } from "@/components/workspace/AgentStateIcon";
import { sessionState, useAgentSessionStates } from "@/lib/agentSessionStates";

interface Tab { id: string; title: string; customTitle?: string } // customTitle=유저 더블클릭 리네임(최우선, 영속)
const genId = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
// 새 탭 번호 = 현재 안 쓰는 가장 낮은 양수(#756). 닫은 자리를 다시 채워 "터미널 4처럼 계속 증가" 방지.
// 제목 끝 숫자로 판별(모든 로케일 포맷이 "… {n}"이라 안전).
// #1125 저장된 기본 탭 이름("터미널 N" — 만들 때 언어로 굳음)은 번호만 살려 보여 줄 때 번역. 번호 없는 이름은 그대로.
const tabNum = (title: string) => title.match(/(\d+)\s*$/)?.[1];
function nextNum(tabs: Tab[]): number {
  const used = new Set<number>();
  for (const tb of tabs) { const m = tb.title.match(/(\d+)\s*$/); if (m) used.add(parseInt(m[1], 10)); }
  let n = 1; while (used.has(n)) n += 1;
  return n;
}

function loadTabs(store: string, firstTitle: string): { tabs: Tab[]; activeId: string } {
  const fresh = () => { const id = genId(); return { tabs: [{ id, title: firstTitle }], activeId: id }; };
  if (typeof localStorage === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(store);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as { tabs?: Tab[]; activeId?: string };
    if (!Array.isArray(p.tabs) || !p.tabs.length) return fresh();
    const tabs = p.tabs.filter((t) => t && typeof t.id === "string");
    if (!tabs.length) return fresh();
    const activeId = p.activeId && tabs.some((t) => t.id === p.activeId) ? p.activeId : tabs[0].id;
    return { tabs, activeId };
  } catch { return fresh(); }
}

// #989 알림 클릭 → 그 레포의 그 터미널 탭으로. 패널이 이미 떠 있으면 이벤트로, 아직 안 떴으면(첫 방문) 마운트 때 소비.
const FOCUS_EVENT = "mustard:focus-term";
const pendingFocus = new Map<string, string>(); // cwd → 터미널 id
export function requestTerminalFocus(cwd: string, termId: string) {
  pendingFocus.set(cwd, termId);
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { cwd } }));
}

export default function TerminalPane({ cwd, active: paneActive = true }: { cwd: string; active?: boolean }) {
  const t = useT();
  const termLabel = (title: string) => { const n = tabNum(title); return n ? t("workspace.terminalTab", { n }) : title; };
  const store = `nunopi:ws-terms:${cwd}`;
  const initial = useMemo(() => loadTabs(store, t("workspace.terminalTab", { n: 1 })), []); // eslint-disable-line react-hooks/exhaustive-deps -- 마운트 1회 복원(cwd 변경은 아래 이펙트)
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [activeId, setActiveId] = useState<string>(initial.activeId);
  const curStore = useRef(store);
  const confirm = useConfirm();

  // 폴더(cwd) 바뀌면 그 레포 탭셋 재로드(첫 마운트는 lazy init).
  useEffect(() => {
    if (curStore.current === store) return;
    curStore.current = store;
    const d = loadTabs(store, t("workspace.terminalTab", { n: 1 }));
    setTabs(d.tabs); setActiveId(d.activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store 변경만
  }, [store]);

  // #989 알림 클릭 포커스 — 마운트 시 + 이벤트 시 대기 요청 소비(그 cwd에 그 탭이 있을 때만).
  useEffect(() => {
    const take = () => {
      const id = pendingFocus.get(cwd);
      if (!id) return;
      pendingFocus.delete(cwd);
      if (tabs.some((x) => x.id === id)) setActiveId(id);
    };
    take();
    const h = (e: Event) => { if ((e as CustomEvent<{ cwd: string }>).detail?.cwd === cwd) take(); };
    window.addEventListener(FOCUS_EVENT, h);
    return () => window.removeEventListener(FOCUS_EVENT, h);
  }, [cwd, tabs]);

  // 탭 목록 영속.
  useEffect(() => {
    try { localStorage.setItem(store, JSON.stringify({ tabs, activeId })); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 데이터 변경 시 저장(store는 클로저 현재값)
  }, [tabs, activeId]);

  function addTab() {
    const id = genId();
    // 번호는 functional update 안에서 최신 prev로 계산 — 연타 시 중복 번호 방지.
    setTabs((prev) => [...prev, { id, title: t("workspace.terminalTab", { n: nextNum(prev) }) }]);
    setActiveId(id);
  }
  async function closeTab(id: string) {
    // #929 실행 중(에이전트 돌아가는) 터미널은 설정이 켜져 있으면 닫기 전 확인.
    if (agentById[id] && getSetting<boolean>(CKEYS.confirmCloseTerminal, false)) {
      if (!(await confirm({ title: t("workspace.closeTermRunningTitle"), message: t("workspace.closeTermRunningMsg"), confirmText: t("workspace.closeTab"), tone: "warn" }))) return;
    }
    try { window.nunopiDesktop?.terminal?.kill({ id }); } catch { /* ignore */ } // pty 정리(좀비 방지)
    const next = tabs.filter((x) => x.id !== id);
    if (!next.length) { // 마지막 탭 → 새 빈 탭으로 대체 + 그 탭 활성(번호 1로 리셋)
      const nt = { id: genId(), title: t("workspace.terminalTab", { n: 1 }) };
      setTabs([nt]); setActiveId(nt.id);
      return;
    }
    setTabs(next);
    if (activeId === id) setActiveId(next[next.length - 1].id); // 활성 닫으면 마지막으로
  }

  const active = tabs.find((x) => x.id === activeId) ?? tabs[0];
  // 활성 터미널 탭이 오버플로로 스크롤 밖이면 안 보임(#801) — 활성 탭에 콜백 ref로 스크롤 인투 뷰.
  // (터미널 자동 펴기는 N/A: 접히면 pane·+버튼이 dock에서 제거돼 외부 "열기" 트리거가 없고, 재표시는 헤더 토글=이미 펴짐.)
  const scrollTabIntoView = useCallback((el: HTMLElement | null) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, []);

  // 탭별 실행 중 에이전트(#803) — main이 버퍼 파싱으로 판정한 agent id(node 래퍼 CLI도 잡음). 탭 이름·아이콘용.
  // pty는 push 이벤트가 없어(에이전트 실행/종료=프로세스 교체) 2s 폴링. list()는 전 세션 반환 → tab.id로 조회.
  useAgentSessionStates(); // #1036 탭별 에이전트 상태가 바뀌면 다시 그림(WorkspaceTabs 폴링 결과 공유)
  const [agentById, setAgentById] = useState<Record<string, AgentId>>({});
  const [sessionTitleById, setSessionTitleById] = useState<Record<string, string>>({}); // #970 세션 제목(OSC 타이틀)
  useEffect(() => {
    const api = window.nunopiDesktop?.terminal;
    if (!api?.list) return;
    let alive = true;
    const tick = async () => {
      try {
        const ls = await api.list();
        // s.agent는 string|null(.cjs 경계라 타입 강제 불가) — AGENT_META 키로 검증한 값만 수용(미지 문자열→라벨/로고 조회 크래시 방지).
        if (!alive) return;
        setAgentById(Object.fromEntries(ls.filter((s) => s.agent && s.agent in AGENT_META).map((s) => [s.id, s.agent as AgentId])));
        // #970 세션 제목 — 빈 문자열은 제외(폴백=에이전트명 유지). 미판정 틱에 제목이 사라지지 않게 이전 것 보존.
        setSessionTitleById((prev) => { const next = { ...prev }; for (const s of ls) if (s.sessionTitle) next[s.id] = s.sessionTitle; return next; });
      } catch { /* ignore */ }
    };
    void tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 탭 드래그 재정렬(#864) — 레포 탭처럼 순서 변경. 배열 순서=화면 순서, setTabs가 localStorage 영속.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const reorderTabs = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((x) => x.id === fromId);
      if (from < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const insertAt = next.findIndex((x) => x.id === toId); // 제거 후 재계산
      next.splice(insertAt < 0 ? next.length : insertAt, 0, moved); // 대상 앞에 삽입
      return next;
    });
  };

  // 더블클릭 리네임(#864) — 편집 중 탭 id + 입력값. 빈 값 확정 시 customTitle 해제(자동 이름 복귀).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const commitRename = (id: string) => {
    const v = editValue.trim();
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, customTitle: v || undefined } : tb)));
    setEditingId(null);
  };

  // ＋ 메뉴(#864) — orca식. 새 터미널 또는 에이전트 선택. 에이전트는 새 탭 생성 후 그 탭에 직접 실행(신원 확정).
  // ＋는 탭 옆(스크롤 안)에 두되, 드롭다운은 position:fixed로 띄워 overflow-x-auto 클리핑을 피한다(버튼 rect 기준 좌표).
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const plusRef = useRef<HTMLButtonElement>(null);
  const MENU_W = 190, MENU_H = 340; // 드롭다운 대략 크기(양축 화면밖 방지용 추정)
  const toggleMenu = () => {
    if (menuOpen) { setMenuOpen(false); return; }
    const r = plusRef.current?.getBoundingClientRect();
    if (r) {
      const x = Math.max(4, Math.min(r.left, window.innerWidth - MENU_W - 4));
      const y = r.bottom + 4 + MENU_H > window.innerHeight ? Math.max(4, r.top - MENU_H - 4) : r.bottom + 4; // 아래 넘치면 위로
      setMenuPos({ x, y });
    }
    setMenuOpen(true);
  };
  const LAUNCHABLE: AgentId[] = ["claude", "codex", "grok", "opencode", "omp", "antigravity", "cursor", "hermes"]; // gemini 제외(구글=antigravity)
  const newTerminal = () => { setMenuOpen(false); addTab(); };
  // #1110 Crew 카드 넘겨받기 — 이 레포 카드면 새 탭에서 카드 작업 폴더로 이동해 그 에이전트 대화를 이어받음
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ root: string; worktree: string; provider: string }>).detail;
      if (!d || d.root !== cwd) return;
      const map: Record<string, [AgentId, string]> = { "claude-code": ["claude", "--continue"], codex: ["codex", "resume --last"], grok: ["grok", ""], cursor: ["cursor", ""], opencode: ["opencode", ""] };
      const [agent, args] = map[d.provider] ?? ["claude", "--continue"];
      const id = genId();
      setTabs((prev) => [...prev, { id, title: t("workspace.terminalTab", { n: nextNum(prev) }) }]);
      setActiveId(id);
      void window.nunopiDesktop?.terminal?.launchAgent?.({ id, agent, dark: isTerminalDark(getTerminalThemePref()), extraArgs: [getSetting<string>(AKEYS.args(agent), ""), args].filter(Boolean).join(" "), cwd: d.worktree });
    };
    window.addEventListener("mustard:crew-takeover", on);
    return () => window.removeEventListener("mustard:crew-takeover", on);
  }, [cwd, t]);
  const launchInNewTab = (agent: AgentId) => {
    setMenuOpen(false);
    const id = genId();
    setTabs((prev) => [...prev, { id, title: t("workspace.terminalTab", { n: nextNum(prev) }) }]);
    setActiveId(id);
    // 터미널 테마(#922) + 에이전트 추가 인자(#927) 전달. main이 cmd에 반영.
    const extraArgs = getSetting<string>(AKEYS.args(agent), "");
    void window.nunopiDesktop?.terminal?.launchAgent?.({ id, agent, dark: isTerminalDark(getTerminalThemePref()), extraArgs }); // main이 pty ensure 대기 후 커맨드 주입
  };
  // 기본 에이전트(#927) 빠른 실행 — 설정의 agent.default.
  const launchDefaultAgent = () => launchInNewTab(getSetting<string>(AKEYS.default, AGENT_DEFAULTS.default) as AgentId);

  // #1027 터미널 탭 단축키 — 보이는(활성) 레포의 터미널 패널만 처리, 아니면 false로 다른 레포에 넘김.
  useShortcut(["term.new", "term.newAgent", "term.close", "term.next", "term.prev", ...Array.from({ length: 9 }, (_, i) => `term.goto${i + 1}`)], (d) => {
    if (!paneActive || !tabs.length) return false;
    const i = Math.max(0, tabs.findIndex((x) => x.id === activeId));
    if (d.id === "term.new") addTab();
    else if (d.id === "term.newAgent") launchDefaultAgent();
    else if (d.id === "term.close") void closeTab(activeId);
    else if (d.id === "term.next") setActiveId(tabs[(i + 1) % tabs.length].id);
    else if (d.id === "term.prev") setActiveId(tabs[(i - 1 + tabs.length) % tabs.length].id);
    else if (d.arg) setActiveId((d.arg === 9 ? tabs[tabs.length - 1] : tabs[d.arg - 1] ?? tabs[tabs.length - 1]).id); // ⌘9 = 마지막(Ghostty 관례)
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 터미널 탭 바 — 에디터 탭 느낌(활성 상단 강조선·구분선·닫기). pr-6 외곽: 우상단 이동 그립 자리 예약(#716). */}
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[var(--s-bar)]">
      <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          // 아이콘=에이전트 로고(실행 중)/터미널. 제목 우선순위(#970): 유저 리네임 > 세션 제목(OSC 타이틀) > 에이전트 라벨 > "터미널 N".
          const agent = agentById[tab.id] ?? null;
          const sessionTitle = sessionTitleById[tab.id];
          const label = tab.customTitle || sessionTitle || (agent ? AGENT_META[agent].label : termLabel(tab.title));
          const editing = editingId === tab.id;
          return (
            <div key={tab.id} ref={on ? scrollTabIntoView : undefined}
              draggable={!editing}
              onDragStart={(e) => { setDragId(tab.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (dragId && dragId !== tab.id) { e.preventDefault(); setOverId(tab.id); } }}
              onDragLeave={() => setOverId((o) => (o === tab.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (dragId) reorderTabs(dragId, tab.id); setDragId(null); setOverId(null); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[var(--s-pane)] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"} ${dragId === tab.id ? "opacity-40" : ""}`}
              onClick={() => setActiveId(tab.id)}>
              {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-mustard-500" aria-hidden />}
              {overId === tab.id && <span className="absolute inset-y-0 left-0 w-0.5 bg-mustard-500" aria-hidden />}
              {agent && <AgentStateIcon state={sessionState(tab.id)} />}{/* #1036 orca처럼 에이전트 아이콘 왼쪽에 상태 */}
              {agent
                ? <span className="shrink-0"><AgentLogo agent={agent} size={13} /></span>
                : <IconTerminal2 size={13} stroke={2} className={`shrink-0 ${on ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`} aria-hidden />}
              {editing ? (
                <input autoFocus value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(tab.id); else if (e.key === "Escape") setEditingId(null); }}
                  onBlur={() => commitRename(tab.id)}
                  className="w-[130px] rounded border border-mustard-400 bg-white px-1 py-0 text-[12px] text-zinc-800 outline-none dark:bg-zinc-900 dark:text-zinc-100" />
              ) : (
                <span className="max-w-[200px] truncate whitespace-nowrap" title={label}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditValue(tab.customTitle || sessionTitle || (agent ? AGENT_META[agent].label : "")); setEditingId(tab.id); }}>{label}</span>
              )}
              {tabs.length > 1 && (
                <button type="button" onClick={(e) => { e.stopPropagation(); void closeTab(tab.id); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("workspace.terminalClose")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
        {/* ＋ 버튼 — 탭 옆(스크롤 안). 드롭다운은 아래 fixed로(클리핑 회피). */}
        <button ref={plusRef} type="button" onClick={toggleMenu} aria-label={t("workspace.terminalNew")}
          className="flex shrink-0 items-center px-2.5 text-zinc-400 transition hover:bg-white hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
          <IconPlus size={15} stroke={2.5} aria-hidden />
        </button>
      </div>
      </div>
      {/* ＋ 드롭다운(#864) — position:fixed라 overflow-x-auto에 안 잘림. 버튼 rect 기준 좌표. */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
          <div style={{ position: "fixed", left: menuPos.x, top: menuPos.y }}
            className="z-50 min-w-[180px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-[var(--s-pane)]">
            <button type="button" onClick={newTerminal}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
              <IconTerminal2 size={14} stroke={2} aria-hidden /><span className="whitespace-nowrap">{t("workspace.terminalNew")}</span>
            </button>
            {/* 기본 에이전트 빠른 실행(#927) — 설정 agent.default */}
            <button type="button" onClick={launchDefaultAgent}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium text-zinc-800 transition hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800">
              <AgentLogo agent={getSetting<string>(AKEYS.default, AGENT_DEFAULTS.default) as AgentId} size={14} />
              <span className="whitespace-nowrap">{t("workspace.launchDefaultAgent")}</span>
            </button>
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
            {LAUNCHABLE.map((a) => (
              <button key={a} type="button" onClick={() => launchInNewTab(a)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                <AgentLogo agent={a} size={14} />
                <span className="whitespace-nowrap">{AGENT_META[a].label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {/* 활성 터미널(id로 remount → 그 pty 재생) */}
      <div className="min-h-0 flex-1">
        {active && <Terminal key={active.id} id={active.id} cwd={cwd} />}
      </div>
    </div>
  );
}

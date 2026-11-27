"use client";
// 봇 홈(#1397, 에픽 #1391 재정의 2) — 레포 없이 봇들만 보는 화면. 왼쪽 목록 · 가운데 · 오른쪽 봇 정보 3단.
// 좁은 폭: 본문 폭을 재서 오른쪽 칸(900px 미만) → 왼쪽 칸(560px 미만) 순으로 붙박이에서 빠짐.
// 빠진 칸은 헤더 토글로 가운데 위에 덮어 열고, 가운데를 누르면 닫힘. 붙박이 칸의 토글은 그냥 접기/펴기.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconPlus, IconLayoutSidebarLeftExpand, IconLayoutSidebarLeftCollapse, IconLayoutSidebarRightExpand, IconLayoutSidebarRightCollapse } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { useFullscreen } from "@mustard/nunopi";
import BotSidebar, { type BotProject } from "./BotSidebar";
import BotInfo from "./BotInfo";
import BotAvatar from "./BotAvatar";
import NewBotDialog, { type CreateResult } from "./NewBotDialog";
import type { CrewProvider } from "@/lib/crew/crewRoleDefaults";
import { botDesc, botName, useBots } from "./useBots";

const SEL_KEY = "nunopi:bots-selected";

const TOGGLE = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
const LEFT_MIN = 560, RIGHT_MIN = 900;

export default function BotHome({ modeSwitch, active, projects, onOpenProject }: { modeSwitch: ReactNode; active: boolean; projects: BotProject[]; onOpenProject: (key: string) => void }) {
  const t = useT();
  const { bots, error, reload, op } = useBots(active);
  // 고른 봇 — 기억해 두고, 없어졌으면(빼기·다른 창) 맨 위 봇.
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem(SEL_KEY); } catch { return null; } });
  const [creating, setCreating] = useState(false); // 새 봇 창 열림
  const pick = (id: string | null) => { setPicked(id); try { if (id) localStorage.setItem(SEL_KEY, id); else localStorage.removeItem(SEL_KEY); } catch { /* ignore */ } };
  const bot = bots?.find((b) => b.id === picked) ?? bots?.[0] ?? null;
  const uninstall = async (id: string): Promise<"ok" | "rejected" | "unknown"> => { const r = await op({ op: "uninstall", id }); return typeof r === "object" ? "ok" : r; };
  // 맡길 일로 바로 만들기 → 서버가 알려 준 새 봇 id를 고름
  // 새 봇 창에서 만들기 → 서버가 알려 준 새 봇 id를 고름
  const create = async (b: { name: string; mission: string; provider: CrewProvider; color: string }): Promise<CreateResult> => {
    const r = await op({ op: "create", ...b });
    if (typeof r !== "object") return r;
    if (r.created) pick(r.created);
    return "ok";
  };
  const openNew = () => setCreating(true);
  const left = <BotSidebar bots={bots} error={error} selected={bot?.id ?? null} onSelect={pick} onNew={openNew} onRetry={reload} projects={projects} onOpenProject={onOpenProject} />;
  const center = bot ? (
    // 한계: Home Chat(H4) 전까지 가운데는 봇 소개만.
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <BotAvatar name={botName(t, bot)} color={bot.color} size={56} />
      <div className="text-[18px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{botName(t, bot)}</div>
      <p className="max-w-md text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{botDesc(t, bot)}</p>
      <p className="mt-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-[12px] text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400">{t("bots.chatSoon")}</p>
    </div>
  ) : bots && bots.length === 0 ? (
    // 봇 없음 — 가운데는 조용히 한 줄 + [새 봇](만들기는 창으로)
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-[13px] text-zinc-400 dark:text-zinc-500">{t("bots.noBots")}</p>
      <button type="button" onClick={openNew}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-mustard-500 px-3.5 text-[12.5px] font-semibold text-brown-900 transition hover:bg-mustard-400">
        <IconPlus size={14} stroke={2.2} aria-hidden /> {t("bots.new.title")}
      </button>
    </div>
  ) : null; // 읽는 중·못 읽음
  const right = bot ? <BotInfo bot={bot} onUninstall={uninstall} /> : error ? <BotInfo bot={null} onUninstall={uninstall} /> : null; // 읽는 중·봇 없음엔 비움
  const fullscreen = useFullscreen(); // 신호등 자리 좌측 패딩(레포 헤더와 같은 규칙)
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1440);
  const [leftOver, setLeftOver] = useState(false), [rightOver, setRightOver] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      if (w <= 0) return;
      setWidth(w);
      // 붙박이로 돌아가면 덮개 상태는 버림 — 다시 좁혔을 때 안 눌렀는데 덮개가 열리지 않게(리뷰)
      if (w >= LEFT_MIN) setLeftOver(false);
      if (w >= RIGHT_MIN) setRightOver(false);
    }); // 레포 모드(display:none)의 0은 무시 — 돌아올 때 양옆 칸이 한 번 빠졌다 붙지 않게(리뷰)
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const leftDocked = width >= LEFT_MIN, rightDocked = width >= RIGHT_MIN;
  // 붙박이일 땐 접기 상태, 빠졌을 땐 덮어 열기 상태 — 서로 따로(넓혔을 때 덮개가 남지 않게).
  const [leftShut, setLeftShut] = useState(false), [rightShut, setRightShut] = useState(false);
  const leftOn = leftDocked ? !leftShut : leftOver, rightOn = rightDocked ? !rightShut : rightOver;
  const toggleLeft = () => (leftDocked ? setLeftShut((v) => !v) : setLeftOver((v) => !v));
  const toggleRight = () => (rightDocked ? setRightShut((v) => !v) : setRightOver((v) => !v));
  const over = "absolute inset-y-0 z-20 shadow-lg";
  // 덮어 연 칸은 Esc로 닫힘(리뷰)
  useEffect(() => {
    if ((!leftOver && !rightOver) || creating) return; // 새 봇 창이 열려 있으면 Esc는 창 몫(같이 닫히지 않게, 리뷰)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setLeftOver(false); setRightOver(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftOver, rightOver, creating]);
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className={`titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pr-2 dark:border-zinc-800 ${fullscreen ? "pl-2" : "pl-[78px]"}`}>
        {modeSwitch}
        <button type="button" onClick={toggleLeft} aria-pressed={leftOn} title={t("bots.leftPanel")} aria-label={t("bots.leftPanel")} className={TOGGLE}>
          {leftOn ? <IconLayoutSidebarLeftCollapse size={18} stroke={2} aria-hidden /> : <IconLayoutSidebarLeftExpand size={18} stroke={2} aria-hidden />}
        </button>
        <div className="flex-1" />
        <button type="button" onClick={toggleRight} aria-pressed={rightOn} title={t("bots.rightPanel")} aria-label={t("bots.rightPanel")} className={TOGGLE}>
          {rightOn ? <IconLayoutSidebarRightCollapse size={18} stroke={2} aria-hidden /> : <IconLayoutSidebarRightExpand size={18} stroke={2} aria-hidden />}
        </button>
      </header>
      <div ref={bodyRef} className="relative flex min-h-0 flex-1">
        {leftOn && (
          <aside className={`flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-[var(--s-pane)] ${leftDocked ? "" : `${over} left-0`}`}>
            {left}
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col" onPointerDown={() => { setLeftOver(false); setRightOver(false); }}>{center}</main>
        {rightOn && (
          <aside className={`flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[var(--s-pane)] ${rightDocked ? "" : `${over} right-0`}`}>
            {right}
          </aside>
        )}
      </div>
      {creating && <NewBotDialog onClose={() => setCreating(false)} create={create} />}
    </div>
  );
}

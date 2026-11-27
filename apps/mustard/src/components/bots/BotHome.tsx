"use client";
// 봇 홈(#1397, 에픽 #1391 재정의 2) — 레포 없이 봇들만 보는 화면. 왼쪽 목록 · 가운데 · 오른쪽 봇 정보 3단.
// 좁은 폭: 본문 폭을 재서 오른쪽 칸(900px 미만) → 왼쪽 칸(560px 미만) 순으로 붙박이에서 빠짐.
// 빠진 칸은 헤더 토글로 가운데 위에 덮어 열고, 가운데를 누르면 닫힘. 붙박이 칸의 토글은 그냥 접기/펴기.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconLayoutSidebarLeftExpand, IconLayoutSidebarLeftCollapse, IconLayoutSidebarRightExpand, IconLayoutSidebarRightCollapse } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { useFullscreen } from "@mustard/nunopi";

const TOGGLE = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
const LEFT_MIN = 560, RIGHT_MIN = 900;

export default function BotHome({ modeSwitch, left, center, right }: { modeSwitch: ReactNode; left?: ReactNode; center?: ReactNode; right?: ReactNode }) {
  const t = useT();
  const fullscreen = useFullscreen(); // 신호등 자리 좌측 패딩(레포 헤더와 같은 규칙)
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1440);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const leftDocked = width >= LEFT_MIN, rightDocked = width >= RIGHT_MIN;
  // 붙박이일 땐 접기 상태, 빠졌을 땐 덮어 열기 상태 — 서로 따로(넓혔을 때 덮개가 남지 않게).
  const [leftShut, setLeftShut] = useState(false), [rightShut, setRightShut] = useState(false);
  const [leftOver, setLeftOver] = useState(false), [rightOver, setRightOver] = useState(false);
  const leftOn = leftDocked ? !leftShut : leftOver, rightOn = rightDocked ? !rightShut : rightOver;
  const toggleLeft = () => (leftDocked ? setLeftShut((v) => !v) : setLeftOver((v) => !v));
  const toggleRight = () => (rightDocked ? setRightShut((v) => !v) : setRightOver((v) => !v));
  const over = "absolute inset-y-0 z-20 shadow-lg";
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className={`titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pr-2 dark:border-zinc-800 ${fullscreen ? "pl-2" : "pl-[78px]"}`}>
        {modeSwitch}
        <button type="button" onClick={toggleLeft} aria-pressed={leftOn} title={t(leftOn ? "workspace.leftCollapse" : "workspace.leftExpand")} aria-label={t(leftOn ? "workspace.leftCollapse" : "workspace.leftExpand")} className={TOGGLE}>
          {leftOn ? <IconLayoutSidebarLeftCollapse size={18} stroke={2} aria-hidden /> : <IconLayoutSidebarLeftExpand size={18} stroke={2} aria-hidden />}
        </button>
        <div className="flex-1" />
        <button type="button" onClick={toggleRight} aria-pressed={rightOn} title={t(rightOn ? "bots.rightCollapse" : "bots.rightExpand")} aria-label={t(rightOn ? "bots.rightCollapse" : "bots.rightExpand")} className={TOGGLE}>
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
    </div>
  );
}

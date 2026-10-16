"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@mustard/core";

interface ResizableBodyProps {
  // localStorage 키 식별자 — 섹션마다 고유(lines/tokens/it-terms).
  id: string;
  defaultHeight?: number;
  minHeight?: number;
  children: React.ReactNode;
}

const storageKey = (id: string) => `nunopi:section-h:${id}`;

// 학습패널 섹션 컨텐츠를 감싸 유저가 하단 핸들을 드래그해 높이를 조절하게 한다.
// 높이는 localStorage에 저장 → 새로고침/재진입해도 유지. 섹션 헤더는 호출부에 그대로 둔다.
export default function ResizableBody({
  id,
  defaultHeight = 360,
  minHeight = 140,
  children,
}: ResizableBodyProps) {
  const t = useT();
  const [height, setHeight] = useState(defaultHeight);
  // 드래그 중 최신 높이를 항상 보유 — pointerup 영속화 시 클로저 stale 방지(AppShell 패턴).
  const heightRef = useRef(defaultHeight);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(0);

  // 저장된 높이 복원.
  useEffect(() => {
    const stored = Number(localStorage.getItem(storageKey(id)));
    if (Number.isFinite(stored) && stored >= minHeight) {
      heightRef.current = stored;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHeight(stored);
    }
  }, [id, minHeight]);

  function handlePointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHRef.current = heightRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const next = Math.max(minHeight, startHRef.current + (e.clientY - startYRef.current));
    heightRef.current = next;
    setHeight(next);
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      localStorage.setItem(storageKey(id), String(Math.round(heightRef.current)));
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <div
        style={{ height }}
        className="nunopi-scroll overflow-y-auto pr-1"
      >
        {children}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("layout.resizeSection")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title={t("layout.dragResize")}
        className="mx-auto mt-1.5 h-1.5 w-16 cursor-row-resize rounded-full bg-zinc-300 transition-colors hover:bg-blue-400/60 dark:bg-zinc-700 dark:hover:bg-blue-400/50"
      />
    </div>
  );
}

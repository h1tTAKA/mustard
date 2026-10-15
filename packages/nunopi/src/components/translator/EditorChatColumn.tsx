"use client";

import { useRef, useState } from "react";
import { useT } from "@mustard/core";

interface EditorChatColumnProps {
  editor: React.ReactNode;
  chat: React.ReactNode;
  chatOpen: boolean;
  // 입력 패널 접힘(#350) — 챗이 열려 있으면 에디터 없이 챗만 풀높이로.
  editorCollapsed?: boolean;
}

const SPLIT_KEY = "nunopi:editor-chat-top-pct";
const MIN = 25;
const MAX = 80;

// 왼쪽 컬럼을 세로 분할 — 위 에디터 / 아래 학습 챗. 챗이 닫히면 에디터 풀높이.
// 상하 드래그로 비율 조절(localStorage 보존). 우측 학습패널은 안 건드린다.
export default function EditorChatColumn({ editor, chat, chatOpen, editorCollapsed = false }: EditorChatColumnProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [topPct, setTopPct] = useState(() => {
    if (typeof window === "undefined") return 55;
    const stored = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(stored) && stored >= MIN && stored <= MAX ? stored : 55;
  });
  const [dragging, setDragging] = useState(false);

  // 접힘 — 챗 열림이면 챗만(학습패널 보며 질문). 챗 닫힘이면 AppShell이 영역째 숨김(방어적 null).
  if (editorCollapsed) {
    return chatOpen ? <div className="h-full min-h-0 overflow-hidden px-4 py-4">{chat}</div> : null;
  }

  if (!chatOpen) {
    return <div className="h-full">{editor}</div>;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const pct = Math.min(MAX, Math.max(MIN, ((e.clientY - rect.top) / rect.height) * 100));
    setTopPct(pct);
  }

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col">
      <div style={{ height: `${topPct}%` }} className="min-h-0 overflow-hidden">
        {editor}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("layout.resizeEditorChat")}
        onPointerDown={(e) => {
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => {
          setDragging(false);
          e.currentTarget.releasePointerCapture(e.pointerId);
          try { localStorage.setItem(SPLIT_KEY, String(Math.round(topPct))); } catch { /* ignore */ }
        }}
        className={`mx-4 h-1.5 shrink-0 cursor-row-resize rounded-full transition-colors ${
          dragging ? "bg-blue-400/60" : "bg-zinc-200 hover:bg-blue-400/40 dark:bg-zinc-800"
        }`}
      />
      <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-2">{chat}</div>
    </div>
  );
}

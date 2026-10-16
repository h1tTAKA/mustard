"use client";

import { useEffect, useRef } from "react";
import { IconBookmark, IconBookmarkFilled } from "@tabler/icons-react";
import type { AgentLineExplanation } from "../../lib/agent";
import type { ConceptOccurrence } from "@mustard/core";
import CodeBlock from "./CodeBlock";
import { Markdown } from "@mustard/core";
import { useT } from "@mustard/core";

interface LineExplanationListProps {
  lineExplanations: AgentLineExplanation[];
  concepts?: ConceptOccurrence[];
  onConceptClick?: (conceptId: string) => void;
  language?: string;
  // 에디터와 링크된 활성 줄 — 해당 카드를 강조.
  activeLine?: number | null;
  // 패널 스크롤 중 화면 상단에 보이는 줄을 알린다(우→좌 링크).
  onLineFocus?: (line: number) => void;
  // 분석 진행 중 — 줄별 설명이 아직 스트리밍으로 채워지는 중임을 알린다.
  isStreaming?: boolean;
  // 청크 진행률(완료/전체) — "남은 줄 분석 중" 안내용.
  chunkProgress?: { done: number; total: number } | null;
  // 책갈피(#639) — "여기까지 봤음" 핀 줄 + 토글 콜백.
  pinnedLine?: number | null;
  onPinLine?: (line: number) => void;
}

export default function LineExplanationList({
  lineExplanations,
  language,
  concepts = [],
  onConceptClick,
  activeLine = null,
  onLineFocus,
  isStreaming = false,
  chunkProgress = null,
  pinnedLine = null,
  onPinLine,
}: LineExplanationListProps) {
  const t = useT();
  // bounded 스크롤 박스 안에서 전체를 렌더(더보기 없이 스크롤).
  const visibleItems = lineExplanations;

  const containerRef = useRef<HTMLDivElement>(null);
  const onLineFocusRef = useRef(onLineFocus);
  const lastFocusedRef = useRef<number | null>(null);
  useEffect(() => {
    onLineFocusRef.current = onLineFocus;
  }, [onLineFocus]);

  // 패널 스크롤 시 화면 상단에 가장 가까운 가시 카드의 줄을 onLineFocus로 알린다.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>("[data-nunopi-line]"),
    );
    if (cards.length === 0) return;
    const visible = new Set<HTMLElement>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) visible.add(el);
          else visible.delete(el);
        }
        // 뷰포트 세로 중앙에 가장 가까운 카드를 "지금 보는 줄"로 선택.
        // (줄별설명 자체 스크롤을 없애고 ResizableBody가 스크롤하므로 root=뷰포트.)
        const boxCenter = window.innerHeight / 2;
        let best: HTMLElement | null = null;
        let bestDist = Infinity;
        for (const el of visible) {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top + rect.height / 2 - boxCenter);
          if (dist < bestDist) {
            bestDist = dist;
            best = el;
          }
        }
        if (!best) return;
        const line = Number(best.dataset.nunopiLine);
        if (Number.isFinite(line) && line !== lastFocusedRef.current) {
          lastFocusedRef.current = line;
          onLineFocusRef.current?.(line);
        }
      },
      // root=뷰포트. 중앙 띠(-45%/-45%)를 지나는 카드를 활성으로.
      { root: null, rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [visibleItems.length]);

  // 청크 진행 안내 문구(있을 때만).
  const progressLabel =
    chunkProgress && chunkProgress.total > 0
      ? t("panel.chunk", { done: chunkProgress.done, total: chunkProgress.total })
      : "";

  if (lineExplanations.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {isStreaming
          ? t("line.analyzing", { label: progressLabel })
          : t("line.empty")}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-3">
      {visibleItems.map((item, i) => {
        // 줄별 토큰 칩(클릭 후 설명)은 제거됨(#505) — 줄 설명 자체가 각 조각을 풀어 설명하고,
        // 범용 토큰은 분석 시 토큰 사전에 자동으로 채워진다. 여기선 개념 칩만 유지한다.
        // conceptIds 중복은 유일화(동일 key 중복 렌더 방지).
        const lineConcepts = Array.from(new Set(item.conceptIds))
          .map((id) => concepts.find((c) => c.conceptId === id))
          .filter((c): c is ConceptOccurrence => c !== undefined);

        const isActive = item.line === activeLine;
        const isPinned = item.line === pinnedLine;
        return (
          <div
            key={`${i}-${item.line}`}
            id={`nunopi-line-${item.line}`}
            data-nunopi-line={item.line}
            className={`scroll-mt-4 rounded-2xl border p-4 transition-colors ${
              isActive
                ? "border-blue-500 bg-blue-100 dark:border-blue-500 dark:bg-blue-950/30"
                : isPinned
                  ? "border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-950/20"
                  : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center rounded-lg bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                {t("panel.lineN", { n: item.line })}
              </span>
              <div className="flex items-center gap-2">
                {item.confidence != null && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {Math.round(item.confidence * 100)}%
                  </span>
                )}
                {onPinLine && (
                  <button
                    type="button"
                    onClick={() => onPinLine(item.line)}
                    aria-label={isPinned ? t("line.unpin") : t("line.pin")}
                    title={isPinned ? t("line.unpin") : t("line.pin")}
                    className={`rounded p-1 transition ${isPinned ? "text-amber-500" : "text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"}`}
                  >
                    {isPinned ? <IconBookmarkFilled size={15} stroke={2} aria-hidden /> : <IconBookmark size={15} stroke={2} aria-hidden />}
                  </button>
                )}
              </div>
            </div>
            <CodeBlock code={item.code} language={language} />
            <Markdown className="mt-3 text-sm text-zinc-700 dark:text-zinc-200">
              {item.explanation}
            </Markdown>
            {lineConcepts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {lineConcepts.map((concept) => (
                  <button
                    key={concept.conceptId}
                    type="button"
                    onClick={() => onConceptClick?.(concept.conceptId)}
                    className="inline-flex items-center rounded-lg bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 transition hover:bg-violet-200 hover:text-violet-900 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-800/40 dark:hover:text-violet-200"
                    aria-label={t("concept.gotoFor", { name: concept.title })}
                  >
                    {concept.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {isStreaming && (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-200" />
          {t("line.remaining", { label: progressLabel })}
        </div>
      )}
    </div>
  );
}

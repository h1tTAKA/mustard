"use client";

import { useEffect } from "react";
import type { ItConcept } from "@mustard/core";
import { StarIcon } from "./icons";
import { useT } from "@mustard/core";

interface ItConceptSectionProps {
  concepts: ItConcept[];
  // 클릭한 용어의 관련 개념들(복수) — 전부 하이라이트, 첫 개로 스크롤.
  activeConceptIds?: string[];
  // 북마크 — 누르면 IT 용어 사전에 저장(용어와 한 사전). title 기준.
  onBookmarkToggle?: (concept: ItConcept) => void;
  bookmarkedTitles?: string[];
  // 스트리밍 중이면 빈 목록은 "아직 안 옴"이지 "없음"이 아니다(용어 다음에 채워짐).
  isStreaming?: boolean;
}

// 글 모드 관련 개념 — 코드 모드 ConceptSection에 대응. 용어 설명에 더 필요한
// 배경 개념을 항상 설명과 함께 카드로 보여준다(코드 모드와 달리 설명이 동적).
export default function ItConceptSection({
  concepts,
  activeConceptIds = [],
  onBookmarkToggle,
  bookmarkedTitles = [],
  isStreaming = false,
}: ItConceptSectionProps) {
  const t = useT();
  // 첫 관련 개념으로 스크롤(강조는 전부, 스크롤은 하나만 가능). 배열 참조 매번 새로 생겨도
  // 첫 id(string) dep라 과발화 안 함.
  const scrollTarget = activeConceptIds[0];
  useEffect(() => {
    if (!scrollTarget) return;
    const el = document.getElementById(`it-concept-${scrollTarget}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [scrollTarget]);

  if (concepts.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {isStreaming ? (
          <span className="italic text-zinc-400 dark:text-zinc-500">
            {t("itconcept.pending")}
          </span>
        ) : (
          t("itconcept.empty")
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {concepts.map((concept) => {
        const isActive = activeConceptIds.includes(concept.conceptId);
        return (
          <div
            key={concept.conceptId}
            id={`it-concept-${concept.conceptId}`}
            className={`scroll-mt-4 rounded-2xl border p-4 transition ${
              isActive
                ? "border-blue-500 bg-blue-100 dark:border-blue-500 dark:bg-blue-950/30"
                : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-medium text-zinc-800 dark:text-zinc-100">{concept.title}</p>
              {onBookmarkToggle && (
                <button
                  type="button"
                  onClick={() => onBookmarkToggle(concept)}
                  className={`shrink-0 transition ${
                    bookmarkedTitles.includes(concept.title)
                      ? "text-lime-600 dark:text-lime-400"
                      : "text-zinc-400 hover:text-lime-600 dark:text-zinc-500 dark:hover:text-lime-400"
                  }`}
                  title={bookmarkedTitles.includes(concept.title) ? t("bookmark.remove") : t("bookmark.addToItDict")}
                  aria-label={
                    bookmarkedTitles.includes(concept.title)
                      ? t("bookmark.removeFor", { name: concept.title })
                      : t("bookmark.addFor", { name: concept.title })
                  }
                >
                  <StarIcon filled={bookmarkedTitles.includes(concept.title)} />
                </button>
              )}
            </div>
            {concept.explanation.trim() ? (
              <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">{concept.explanation}</p>
            ) : (
              <p className="mt-1.5 text-xs italic text-zinc-400 dark:text-zinc-500">{t("common.analyzing")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

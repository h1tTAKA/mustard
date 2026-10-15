"use client";

import { useEffect } from "react";
import type { ConceptOccurrence } from "@mustard/core";
import { CONCEPT_DESCRIPTIONS, conceptShort } from "./conceptDescriptions";
import { StarIcon, XIcon } from "./icons";
import { useT, useLocale } from "@mustard/core";

interface ConceptSectionProps {
  concepts: ConceptOccurrence[];
  activeConceptId?: string | null;
  onConceptClick?: (conceptId: string) => void;
  // on-demand 설명을 불러오는 중인 conceptId들(lazy 개념 설명).
  explainingConcepts?: string[];
  bookmarkedConceptTitles?: string[];
  onBookmarkToggle?: (concept: ConceptOccurrence) => void;
  onDelete?: (conceptId: string) => void;
}

export default function ConceptSection({ concepts, activeConceptId, onConceptClick, explainingConcepts, bookmarkedConceptTitles, onBookmarkToggle, onDelete }: ConceptSectionProps) {
  const t = useT();
  const { locale } = useLocale();
  useEffect(() => {
    if (!activeConceptId) return;
    const el = document.getElementById(`concept-${activeConceptId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeConceptId]);

  if (concepts.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {t("concept.empty")}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {concepts.map((concept) => {
        const isActive = activeConceptId === concept.conceptId;
        const isBookmarked = bookmarkedConceptTitles?.includes(concept.title) ?? false;
        const hasActions = Boolean(onBookmarkToggle || onDelete);
        return (
          <div
            key={concept.conceptId}
            id={`concept-${concept.conceptId}`}
            className={`relative scroll-mt-4 rounded-2xl border transition ${
              isBookmarked
                ? "border-lime-600 bg-lime-50 dark:border-lime-700 dark:bg-lime-950/20"
                : isActive
                  ? "border-blue-500 bg-blue-100 dark:border-blue-500 dark:bg-blue-950/30"
                  : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            }`}
          >
            {hasActions && (
              <div className="absolute right-2 top-2.5 flex items-center gap-2">
                {onBookmarkToggle && (
                  <button
                    type="button"
                    onClick={() => onBookmarkToggle(concept)}
                    className={`transition ${
                      isBookmarked
                        ? "text-lime-600 dark:text-lime-400"
                        : "text-zinc-400 hover:text-lime-600 dark:text-zinc-500 dark:hover:text-lime-400"
                    }`}
                    title={isBookmarked ? t("bookmark.remove") : t("bookmark.add")}
                    aria-label={isBookmarked ? t("bookmark.removeFor", { name: concept.title }) : t("bookmark.addFor", { name: concept.title })}
                  >
                    <StarIcon filled={isBookmarked} />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(concept.conceptId)}
                    className="text-zinc-400 transition hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                    title={t("concept.deleteHint")}
                    aria-label={t("concept.deleteFor", { name: concept.title })}
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            )}
            {/* 헤더만 클릭 영역. 설명은 버튼 밖 select-text → 드래그 복사 가능. */}
            <button
              type="button"
              onClick={() => onConceptClick?.(concept.conceptId)}
              aria-label={t("concept.selectFor", { name: concept.title })}
              className={`w-full px-4 pt-4 text-left ${hasActions ? "pr-12" : ""}`}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {concept.title}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(() => {
                    const desc = CONCEPT_DESCRIPTIONS[concept.conceptId];
                    if (!desc) return null;
                    const isIntermediate = desc.level === "intermediate";
                    return (
                      <span className={`inline-flex items-center rounded-lg px-1.5 py-0.5 text-xs font-medium ${
                        isIntermediate
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      }`}>
                        {t("level." + desc.level)}
                      </span>
                    );
                  })()}
                  {concept.count != null && concept.count > 0 && (
                    <span className="inline-flex items-center rounded-lg bg-zinc-200 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      ×{concept.count}
                    </span>
                  )}
                </div>
              </div>
              {(concept.lines ?? []).length > 0 && (
                <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                  {t("panel.linesN", { lines: (concept.lines ?? []).join(", ") })}
                </p>
              )}
            </button>
            <div className="px-4 pb-4 pt-2">
              {/* 설명은 토큰처럼 상시 노출(#535). 있으면 설명, 로딩중이면 스피너 문구, 없으면 클릭 유도. */}
              {(() => {
                const desc = concept.description ?? conceptShort(concept.conceptId, locale);
                if (desc) {
                  return (
                    <p className="select-text border-t border-zinc-200 pt-2 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                      {desc}
                    </p>
                  );
                }
                if (explainingConcepts?.includes(concept.conceptId)) {
                  return (
                    <p className="border-t border-zinc-200 pt-2 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                      {t("concept.loading")}
                    </p>
                  );
                }
                return (
                  <p className="border-t border-zinc-200 pt-2 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                    {(() => {
                      const [a, b] = t("panel.tokenClickToExplain").split("{star}");
                      return <>{a}<StarIcon className="inline-block h-3.5 w-3.5 align-text-bottom" />{b}</>;
                    })()}
                  </p>
                );
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

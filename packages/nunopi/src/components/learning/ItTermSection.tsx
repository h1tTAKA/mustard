"use client";

import { useEffect } from "react";
import type { ItTerm } from "@mustard/core";
import { BanIcon, StarIcon } from "./icons";
import { useConfirm, CKEYS } from "@mustard/core";
import { useT } from "@mustard/core";

interface ItTermSectionProps {
  terms: ItTerm[];
  activeTermId?: string | null;
  // 용어 클릭 시 관련 개념으로 이동(관련 개념 id들을 전달).
  onTermClick?: (conceptIds: string[]) => void;
  bookmarkedTermTexts?: string[];
  onBookmarkToggle?: (term: ItTerm) => void;
  // 이 용어를 제외(차단) — 다음 분석부터 표시에서 숨긴다.
  onExclude?: (term: ItTerm) => void;
}

// 글 모드 IT 용어 사전 — 코드 모드 TokenSection에 대응. 글에서 뽑은 IT 용어를
// 초보자용 설명과 함께 카드로 보여준다.
export default function ItTermSection({
  terms,
  activeTermId,
  onTermClick,
  bookmarkedTermTexts,
  onBookmarkToggle,
  onExclude,
}: ItTermSectionProps) {
  const confirm = useConfirm();
  const t = useT();
  // 글 원문에서 용어를 클릭하면 그 카드로 스크롤(ItConceptSection과 동일 패턴).
  useEffect(() => {
    if (!activeTermId) return;
    const el = document.getElementById(`it-term-${activeTermId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeTermId]);

  if (terms.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {t("term.empty")}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {terms.map((term) => {
        const isActive = activeTermId === term.id;
        const hasConcepts = term.conceptIds.length > 0;
        const isBookmarked = bookmarkedTermTexts?.includes(term.term) ?? false;
        return (
          <div
            key={term.id}
            id={`it-term-${term.id}`}
            className={`relative scroll-mt-4 rounded-2xl border transition ${
              isBookmarked
                ? "border-lime-600 bg-lime-50 dark:border-lime-700 dark:bg-lime-950/20"
                : isActive
                  ? "border-blue-500 bg-blue-100 dark:border-blue-500 dark:bg-blue-950/30"
                  : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="absolute right-2 top-2.5 flex items-center gap-2">
              {term.bookmarkable && onBookmarkToggle && (
                <button
                  type="button"
                  onClick={() => onBookmarkToggle(term)}
                  className={`transition ${
                    isBookmarked
                      ? "text-lime-600 dark:text-lime-400"
                      : "text-zinc-400 hover:text-lime-600 dark:text-zinc-500 dark:hover:text-lime-400"
                  }`}
                  title={isBookmarked ? t("bookmark.remove") : t("bookmark.add")}
                  aria-label={isBookmarked ? t("bookmark.removeFor", { name: term.term }) : t("bookmark.addFor", { name: term.term })}
                >
                  <StarIcon filled={isBookmarked} />
                </button>
              )}
              {onExclude && (
                <button
                  type="button"
                  onClick={async () => {
                    if (await confirm({ skipKey: CKEYS.skipDelete, title: t("confirm.excludeTermTitle", { term: term.term }), message: t("confirm.excludeTerm"), confirmText: t("common.exclude"), danger: true })) onExclude(term);
                  }}
                  className="text-zinc-400 transition hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                  title={t("term.excludeHint")}
                  aria-label={t("term.excludeFor", { name: term.term })}
                >
                  <BanIcon />
                </button>
              )}
            </div>
            {/* 카드 본문 — 텍스트 드래그 복사를 위해 button 대신 div(role=button).
                드래그로 텍스트를 선택 중이면 클릭 네비게이션은 건너뛴다. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => { if (window.getSelection()?.toString()) return; onTermClick?.(term.conceptIds); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!window.getSelection()?.toString()) onTermClick?.(term.conceptIds);
                }
              }}
              aria-label={t("term.ariaFor", { name: term.term })}
              className={`w-full cursor-pointer select-text p-4 text-left ${(term.bookmarkable && onBookmarkToggle) || onExclude ? "pr-12" : ""}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <code className="max-w-full break-all rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-mono font-semibold text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">
                  {term.term}
                </code>
                {term.reading && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{term.reading}</span>
                )}
              </div>
              {term.explanation.trim() ? (
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{term.explanation}</p>
              ) : (
                <p className="mt-2 text-xs italic text-zinc-400 dark:text-zinc-500">{t("common.analyzing")}</p>
              )}
              {hasConcepts && (
                <p className="mt-2 text-xs text-blue-500 dark:text-blue-400">
                  {t("concept.relatedN", { n: term.conceptIds.length })}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useLocale } from "@mustard/core";
import { useT, relocalizeCardSource } from "@mustard/core";
import type { Card } from "@mustard/core";

const SOURCE_LABEL: Record<Card["source"], string> = {
  token: "mem.srcToken",
  concept: "mem.srcConcept",
  term: "mem.srcTerm",
};

const LOCALE_TAG: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };

// 현재 카드 메타 — 출처 · 습득일 · 총 복습 · 다시/애매/완벽 누적.
export default function CardInfoPanel({ card }: { card: Card }) {
  const t = useT();
  const { locale } = useLocale();
  const g = card.state.grades ?? { again: 0, hard: 0, good: 0 };
  const reviews = card.state.reviews ?? 0;
  const acquired = card.bookmarkedAt
    ? new Date(card.bookmarkedAt).toLocaleDateString(LOCALE_TAG[locale] ?? "en-US")
    : "—";

  return (
    <div className="flex w-56 flex-col gap-2 rounded-xl border border-zinc-200 bg-white/60 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
      {/* 출처 = 담은 분석의 제목 */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("mem.source")}</span>
        <span className="line-clamp-2 font-semibold text-zinc-700 dark:text-zinc-200">
          {card.sourceTitle?.trim() ? relocalizeCardSource(card.sourceTitle.trim(), t) : t("mem.sourceUnknown")}
        </span>
      </div>
      {/* 분류 · 습득일 */}
      <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
        <span>{t("mem.category")}: {t(SOURCE_LABEL[card.source])}</span>
        <span className="text-zinc-400 dark:text-zinc-500">{acquired}</span>
      </div>
      <div className="text-zinc-500 dark:text-zinc-400">
        {t("mem.reviewsN").replace("{n}", String(reviews))}
      </div>
      <div className="flex gap-3">
        <span className="text-rose-500 dark:text-rose-400">{t("mem.again")} {g.again}</span>
        <span className="text-amber-500 dark:text-amber-400">{t("mem.hard")} {g.hard}</span>
        <span className="text-emerald-500 dark:text-emerald-400">{t("mem.good")} {g.good}</span>
      </div>
    </div>
  );
}

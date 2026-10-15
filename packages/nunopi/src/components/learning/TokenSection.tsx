"use client";

import { useEffect } from "react";
import type { CodeToken } from "@mustard/core";
import CodeBlock from "./CodeBlock";
import { StarIcon, XIcon } from "./icons";
import { useT } from "@mustard/core";

interface TokenSectionProps {
  tokens: CodeToken[];
  activeTokenIds?: string[];
  onTokenClick?: (tokenId: string, conceptId: string | undefined) => void;
  // 카드 클릭 시 그 토큰의 뜻을 on-demand로 요청(#505). 이미 설명이 있으면 무시된다.
  onTokenExplain?: (token: CodeToken) => void;
  // 설명을 불러오는 중인 토큰 텍스트들 — 스피너 표시용.
  explainingTokenTexts?: string[];
  bookmarkedTokenTexts?: string[];
  onBookmarkToggle?: (token: CodeToken) => void;
  // 토큰 호버 시 강조할 코드 줄들(떼면 null). 에디터 하이라이트 연동.
  onTokenHover?: (lines: number[] | null) => void;
  // 이 토큰 카드를 사전에서 삭제(X) — 다시 태그를 누르면 재호출된다.
  onDelete?: (token: CodeToken) => void;
  // 토큰이 없을 때 보여줄 안내 문구(lazy 사전: 클릭 유도).
  emptyHint?: string;
}

export default function TokenSection({ tokens, activeTokenIds, onTokenClick, onTokenExplain, explainingTokenTexts, bookmarkedTokenTexts, onBookmarkToggle, onTokenHover, onDelete, emptyHint }: TokenSectionProps) {
  const t = useT();
  // bounded 스크롤 박스 안에서 전체를 렌더(더보기 없이 스크롤).
  const visibleTokens = tokens;

  // 줄별 설명에서 토큰 태그를 클릭하면 activeTokenIds가 바뀜 → 그 토큰 카드로 스크롤.
  const activeKey = (activeTokenIds ?? []).join(",");
  useEffect(() => {
    const first = activeTokenIds?.[0];
    if (!first) return;
    const el = document.getElementById(`nunopi-token-${first}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  if (tokens.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {emptyHint ?? t("panel.tokenEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
      {visibleTokens.map((token) => {
        const isActive = activeTokenIds?.includes(token.id) ?? false;
        const isBookmarked = bookmarkedTokenTexts?.includes(token.token) ?? false;
        const isExplaining = explainingTokenTexts?.includes(token.token) ?? false;
        return (
          <div
            key={token.id}
            id={`nunopi-token-${token.id}`}
            onMouseEnter={() => onTokenHover?.(token.lines)}
            onMouseLeave={() => onTokenHover?.(null)}
            className={`relative scroll-mt-2 rounded-2xl border transition ${
              isBookmarked
                ? "border-lime-600 bg-lime-50 dark:border-lime-700 dark:bg-lime-950/20"
                : isActive
                  ? "border-blue-500 bg-blue-100 dark:border-blue-500 dark:bg-blue-950/30"
                  : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="absolute right-2 top-2.5 flex items-center gap-2">
              {token.bookmarkable && (
                <button
                  type="button"
                  onClick={() => onBookmarkToggle?.(token)}
                  className={`transition ${
                    isBookmarked
                      ? "text-lime-600 dark:text-lime-400"
                      : "text-zinc-400 hover:text-lime-600 dark:text-zinc-500 dark:hover:text-lime-400"
                  }`}
                  title={isBookmarked ? t("bookmark.remove") : t("bookmark.add")}
                  aria-label={isBookmarked ? t("bookmark.removeFor", { name: token.token }) : t("bookmark.addFor", { name: token.token })}
                >
                  <StarIcon filled={isBookmarked} />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(token)}
                  className="text-zinc-400 transition hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                  title={t("token.deleteHint")}
                  aria-label={t("token.deleteFor", { name: token.token })}
                >
                  <XIcon />
                </button>
              )}
            </div>
            {/* 헤더(토큰칩+카테고리)만 클릭 영역 — 클릭 시 뜻을 on-demand로 채운다(#505).
                설명/예시는 버튼 밖 → 드래그 복사 가능. */}
            <button
              type="button"
              onClick={() => {
                onTokenExplain?.(token);
                onTokenClick?.(token.id, token.conceptId);
              }}
              className={`w-full px-4 pt-4 text-left ${token.bookmarkable || onDelete ? "pr-12" : ""}`}
              aria-label={token.description ? t("token.selectFor", { name: token.token }) : t("token.viewDescFor", { name: token.token })}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <code className="max-w-full break-all rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-mono font-semibold text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">
                  {token.token}
                </code>
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {t("cat." + token.category)}
                </span>
              </div>
              {token.label && (
                <p className="mt-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  {token.label}
                </p>
              )}
            </button>
            <div className="px-4 pb-4">
              {isExplaining ? (
                <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-200" />
                  {t("panel.tokenExplaining")}
                </p>
              ) : token.description ? (
                <p className="mt-1 select-text text-xs text-zinc-600 dark:text-zinc-300">
                  {token.description}
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  {(() => {
                    const [a, b] = t("panel.tokenClickToExplain").split("{star}");
                    return <>{a}<StarIcon className="inline-block h-3.5 w-3.5 align-text-bottom" />{b}</>;
                  })()}
                </p>
              )}
              {!isExplaining && token.example && (
                <div className="mt-2 select-text">
                  <CodeBlock code={token.example} />
                </div>
              )}
              {token.lines.length > 0 && (
                <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                  {t("panel.linesAppear", { lines: token.lines.join(", ") })}
                </p>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

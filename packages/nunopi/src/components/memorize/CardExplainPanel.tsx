"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconRefresh, IconZoomScan, IconX } from "@tabler/icons-react";
import { useT, useLocale } from "@mustard/core";
import { Markdown } from "@mustard/core";
import MemorizeChat from "./MemorizeChat";
import type { AgentProviderKind, ProviderSettings } from "../../lib/agent";
import type { Card } from "@mustard/core";
import { loadCardExplain, saveCardExplain, clearCardExplain, streamCardExplain } from "../../lib/cardExplain";
import { CardTitle } from "./CardTitle";

interface CardExplainPanelProps {
  card: Card;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings; // 크게 보기 모달 내 챗용
  flipped: boolean; // 카드를 뒤집었을 때만 설명 생성.
}

// 왼쪽 반투명 패널 — 현재 카드(용어)의 디폴트(맥락 독립) 설명을 에이전트가 실시간 타이핑.
// 카드별 캐시(재방문 즉시), 리셋 재생성. 뒤 부채꼴이 비치도록 반투명.
export default function CardExplainPanel({ card, providerId, providerSettings, flipped }: CardExplainPanelProps) {
  const t = useT();
  const { locale } = useLocale();
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(false);
  const [zoomed, setZoomed] = useState(false); // 크게 보기(확대 모달)
  const [chatOpen, setChatOpen] = useState(false); // 확대 모달 내 챗 열림 → 모달을 왼쪽으로 비킴
  // 확대 닫히면(언플립/내용 소실 포함) 챗 열림 상태도 초기화(재오픈 시 레이아웃 stale 방지).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!zoomed && chatOpen) setChatOpen(false);
  }, [zoomed, chatOpen]);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setText("");
    setError(false);
    setStreaming(true);
    streamCardExplain(
      { term: card.front, kind: card.source, providerId, locale },
      (full) => setText(full),
      ac.signal,
    )
      .then((md) => {
        if (ac.signal.aborted) return;
        saveCardExplain(card.key, md);
        setStreaming(false);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setError(true);
        setStreaming(false);
      });
  }, [card.front, card.source, card.key, providerId, locale]);

  // 이전에 생성한 설명이 있으면 항상 로드(뒤집기 전엔 블러). 없으면 뒤집을 때 생성.
  useEffect(() => {
    const cached = loadCardExplain(card.key);
    if (cached) {
      abortRef.current?.abort();
      /* eslint-disable react-hooks/set-state-in-effect */
      setText(cached);
      setStreaming(false);
      setError(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    if (flipped) {
      generate();
      return () => abortRef.current?.abort();
    }
    // 캐시 없고 아직 안 뒤집음 — 비움.
    abortRef.current?.abort();
     
    setText("");
    setStreaming(false);
    setError(false);
     
  }, [card.key, flipped, generate]);

  function handleReset() {
    clearCardExplain(card.key);
    generate();
  }

  return (
    <div className="flex w-96 flex-col gap-2 rounded-xl border border-zinc-200/40 bg-white/80 p-3 text-xs backdrop-blur-md dark:border-zinc-700/40 dark:bg-zinc-900/80">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          {t("mem.explainTitle")}
          {/* 크게 보기 — 라벨 옆(리셋과 떨어뜨려 오조작 방지). 읽을 수 있을 때만 활성 */}
          <button
            type="button"
            onClick={() => setZoomed(true)}
            disabled={!flipped || !text || error}
            aria-label={t("mem.explainZoom")}
            title={t("mem.explainZoom")}
            className="rounded p-0.5 text-zinc-400 transition hover:text-blue-500 disabled:opacity-40 dark:text-zinc-500 dark:hover:text-blue-400"
          >
            <IconZoomScan size={14} stroke={2} aria-hidden />
          </button>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleReset}
            disabled={streaming}
            aria-label={t("mem.explainReset")}
            title={t("mem.explainReset")}
            className="rounded p-0.5 text-zinc-400 transition hover:text-blue-500 disabled:opacity-40 dark:text-zinc-500 dark:hover:text-blue-400"
          >
            <IconRefresh size={13} stroke={2} className={streaming ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
      </div>
      <div className="nunopi-scroll max-h-[80vh] overflow-y-auto pr-1 text-zinc-600 dark:text-zinc-300">
        {error ? (
          <span className="text-rose-500 dark:text-rose-400">{t("mem.explainError")}</span>
        ) : text ? (
          // 뒤집기 전엔 블러 처리(내용은 있지만 못 읽게) → 뒤집으면 선명.
          <div className={!flipped ? "pointer-events-none select-none blur-[3.5px]" : "transition-[filter] duration-200"}>
            <Markdown>{text}</Markdown>
          </div>
        ) : streaming ? (
          <span className="text-zinc-400 dark:text-zinc-500">{t("mem.explainLoading")}</span>
        ) : null}
      </div>

      {/* 크게 보기 모달 — 큰 글씨로 읽기 편하게. 배경/X 클릭으로 닫힘. */}
      {zoomed && flipped && text && typeof document !== "undefined" && createPortal(
        <div
          className={`fixed inset-0 z-[95] flex items-center bg-black/60 p-6 backdrop-blur-sm transition-all ${chatOpen ? "justify-end pr-[38rem] md:pr-[39rem]" : "justify-center"}`}
          onClick={() => { setZoomed(false); setChatOpen(false); }}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl transition-all dark:border-zinc-700 dark:bg-[var(--s-bar)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <CardTitle text={card.front} className="text-sm font-semibold text-zinc-800 dark:text-zinc-100" />
              <button
                type="button"
                onClick={() => { setZoomed(false); setChatOpen(false); }}
                aria-label={t("mem.exit")}
                className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
              >
                <IconX size={18} stroke={2} aria-hidden />
              </button>
            </div>
            <div className="nunopi-scroll overflow-y-auto px-7 py-6 text-zinc-700 dark:text-zinc-200">
              <Markdown className="nunopi-md-lg">{text}</Markdown>
            </div>
          </div>
          {/* 확대 중에도 질문 가능 — 챗은 모달 위(우하단 고정). 클릭이 배경 닫힘으로 안 번지게 격리. */}
          <div role="presentation" onClick={(e) => e.stopPropagation()}>
            <MemorizeChat card={card} providerId={providerId} providerSettings={providerSettings} onOpenChange={setChatOpen} expanded />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

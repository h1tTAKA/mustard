"use client";

import { useEffect, useRef, useState } from "react";
import { IconMessageCircle, IconX } from "@tabler/icons-react";
import { IconPlus, IconCheck } from "@tabler/icons-react";
import type { ChatMessage } from "../../lib/agent";
import { Markdown } from "@mustard/core";
import { useT } from "@mustard/core";
import { useConfirm } from "@mustard/core";
import { useToast } from "@mustard/core";
import { parseCardSuggestions, stripStreamingCardBlock, type SuggestedCard } from "@mustard/core";
import { bookmarkedTermExists } from "@mustard/core";

interface ChatRoomProps {
  messages: ChatMessage[];
  // 스트리밍 중인 어시스턴트 답변(타이핑). 없으면 대기.
  streaming?: string | null;
  isLoading: boolean;
  disabled?: boolean; // 분석 전 등 비활성 사유.
  mode?: "code" | "text"; // 비활성 안내 문구를 모드별로(코드/글) 다국어로 보여주기 위함.
  onSend: (text: string) => void;
  onClear?: () => void;
  // 세션 탭바(#312) — 분석 항목당 다중 세션. 이름은 인덱스 기반 "세션 N".
  sessionIds?: string[];
  activeSessionId?: string | null;
  onSwitchSession?: (id: string) => void;
  onNewSession?: () => void;
  onDeleteSession?: (id: string) => void;
  // 카드 제안 칩 액션 — 어시스턴트 답변의 nunopi-cards 블록에서 파생. 없으면 칩 미노출.
  // messageIndex는 messages 배열 인덱스. add=그 카드 생성, dismiss=블록 거절.
  // 반환: add 시 새로 만들었으면 true, 중복 스킵이면 false(칩 토스트 분기 #511). dismiss/미지정은 무관.
  onCardAction?: (messageIndex: number, action: { add?: SuggestedCard; dismiss?: boolean }) => void | boolean;
  large?: boolean; // 확대 컨텍스트(카드 설명 크게 보기) — 메시지 글씨 확대.
}

// 학습 챗 — 코드에 대해 튜터에게 질문. 에디터 하단 분할 영역에 들어간다.
// 대화를 마크다운 문자열로(어시스턴트 답은 이미 마크다운이라 그대로 → 표/코드 보존).
type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function formatChatAsMarkdown(messages: ChatMessage[], t: TFn): string {
  return messages
    .map((m) => `${m.role === "user" ? `**🙋 ${t("chat.you")}**` : `**🤖 ${t("chat.tutor")}**`}\n\n${m.content}`)
    .join("\n\n---\n\n");
}

export default function ChatRoom({ messages, streaming, isLoading, disabled, mode = "code", onSend, onClear, sessionIds = [], activeSessionId = null, onSwitchSession, onNewSession, onDeleteSession, onCardAction, large = false }: ChatRoomProps) {
  const mdLg = large ? "nunopi-md-lg" : undefined; // 어시스턴트 마크다운 확대
  const userTxt = large ? "text-[15px]" : "text-xs"; // 유저 말풍선·안내 글씨
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const disabledHint = t(mode === "text" ? "chat.disabledText" : "chat.disabledCode");

  // 세션 삭제는 실수 방지로 확인 모달 — 대화가 사라진다는 안내.
  async function confirmDeleteSession(id: string) {
    if (!onDeleteSession) return;
    if (await confirm({ title: t("confirm.deleteSessionTitle"), message: t("confirm.deleteSession"), confirmText: t("common.delete"), danger: true })) {
      onDeleteSession(id);
    }
  }
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // 대화가 (다른 경로로) 비워지면 초기화 확인 상태도 해제 — 다음 대화에서 잔류 방지.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (messages.length === 0) setConfirmingClear(false);
  }, [messages.length]);

  async function handleCopy() {
    if (messages.length === 0) return;
    try {
      await navigator.clipboard.writeText(formatChatAsMarkdown(messages, t));
      setCopied(true);
    } catch { /* ignore — clipboard may be unavailable */ }
  }

  // 새 메시지/스트리밍마다 맨 아래로.
  const tick = `${messages.length}:${streaming?.length ?? 0}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tick]);

  function submit() {
    const text = input.trim();
    if (!text || isLoading || disabled) return;
    setInput("");
    onSend(text);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[var(--ink)]">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300"><IconMessageCircle size={15} stroke={2} aria-hidden /> {t("chat.title")}</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{t("chat.subtitle")}</span>
        {messages.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => { void handleCopy(); }}
              className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              title={t("chat.copyAllMd")}
            >
              {copied ? t("panel.copied") : t("chat.copyMd")}
            </button>
            {confirmingClear ? (
              <>
                <button
                  type="button"
                  onClick={() => { setConfirmingClear(false); onClear?.(); }}
                  className="rounded-lg bg-red-500 px-2 py-1 text-xs font-medium text-white transition hover:bg-red-600"
                >
                  {t("chat.clear")}?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(false)}
                  className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  {t("confirm.cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                disabled={isLoading}
                className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                title={t("chat.resetConversation")}
              >
                {t("chat.clear")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 세션 탭바(#312) — 분석 항목당 다중 세션. 코드 미입력(disabled) 시 숨김. */}
      {!disabled && sessionIds.length > 0 && onSwitchSession && (
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">
          {sessionIds.map((id, i) => {
            const isActive = id === activeSessionId;
            return (
              <span
                key={id}
                className={`group inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0 text-xs font-medium transition ${
                  isActive
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                <button type="button" onClick={() => onSwitchSession(id)} className="whitespace-nowrap">
                  {t("chat.session", { n: i + 1 })}
                </button>
                {sessionIds.length > 1 && onDeleteSession && (
                  <button
                    type="button"
                    onClick={() => { void confirmDeleteSession(id); }}
                    title={t("chat.deleteSession")}
                    aria-label={t("chat.deleteSession")}
                    className={`rounded transition hover:text-red-500 ${isActive ? "inline-flex text-zinc-400 dark:text-zinc-500" : "hidden text-zinc-400 group-hover:inline-flex dark:text-zinc-500"}`}
                  >
                    <IconX size={12} stroke={2.5} aria-hidden />
                  </button>
                )}
              </span>
            );
          })}
          {onNewSession && (
            <button
              type="button"
              onClick={onNewSession}
              disabled={isLoading}
              className="shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              {t("chat.newSession")}
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="nunopi-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && !streaming && (
          <p className="py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
            {disabled ? disabledHint : t("chat.exampleHint")}
          </p>
        )}
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className={`max-w-[85%] select-text whitespace-pre-wrap rounded-2xl bg-blue-500 px-3 py-2 text-white ${userTxt}`}>
                  {m.content}
                </div>
              </div>
            );
          }
          // 어시스턴트 — nunopi-cards 블록은 본문에서 떼고, 칩으로 노출.
          // 이미 카드로 있는 용어도 칩은 띄우되 "이미 담김" 상태(회색+체크)로 표시(#511) —
          // 안 띄우면 유저가 잊고 다시 물었을 때 칩이 왜 없는지 헷갈린다. 클릭 시 안내만.
          const { text, cards } = parseCardSuggestions(m.content);
          return (
            <div key={i} className="flex flex-col items-start gap-1.5">
              <div className="max-w-[85%] select-text rounded-2xl bg-zinc-100 px-3 py-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <Markdown className={mdLg}>{text}</Markdown>
              </div>
              {onCardAction && cards.length > 0 && (
                <div className="flex max-w-[85%] flex-wrap items-center gap-1.5">
                  {cards.map((c) =>
                    bookmarkedTermExists(c.term) ? (
                      <button
                        key={c.term}
                        type="button"
                        onClick={() => toast(t("card.exists"))}
                        className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-600"
                      >
                        <IconCheck size={12} stroke={2.5} aria-hidden />
                        {c.term} {t("chat.cardExists")}
                      </button>
                    ) : (
                      <button
                        key={c.term}
                        type="button"
                        onClick={() => { const ok = onCardAction(i, { add: c }); toast(ok === false ? t("card.exists") : t("card.added", { term: c.term })); }}
                        className="inline-flex items-center gap-1 rounded-full bg-[#3B34E2] px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-[#322bc9]"
                      >
                        <IconPlus size={12} stroke={2.5} aria-hidden />
                        {c.term} {t("chat.saveAsCard")}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => onCardAction(i, { dismiss: true })}
                    className="rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
                  >
                    {t("chat.noThanks")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {streaming != null && (
          <div className="flex justify-start">
            <div className="max-w-[85%] select-text rounded-2xl bg-zinc-100 px-3 py-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {streaming ? <Markdown className={mdLg}>{stripStreamingCardBlock(streaming)}</Markdown> : <span className={userTxt}>{t("chat.replying")}</span>}
            </div>
          </div>
        )}
        {isLoading && streaming == null && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("chat.replying")}</p>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={isLoading || disabled}
          rows={1}
          placeholder={disabled ? disabledHint : t("chat.placeholder")}
          className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
        />
        <button
          type="button"
          onClick={submit}
          disabled={isLoading || disabled || !input.trim()}
          className="shrink-0 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-50 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {t("chat.send")}
        </button>
      </div>
    </div>
  );
}

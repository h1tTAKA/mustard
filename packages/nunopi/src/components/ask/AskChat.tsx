"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowUp, IconPlus, IconCheck, IconSparkles, IconLayoutColumns, IconX, IconCommand, IconCards, IconFileText, IconListCheck, IconEye, IconEyeOff } from "@tabler/icons-react";
import { Markdown } from "@mustard/core";
import { formatChatAsMarkdown } from "../learning/ChatRoom";
import { useT, relocalizeFailure } from "@mustard/core";
import { useToast } from "@mustard/core";
import { parseCardSuggestions, stripStreamingCardBlock, type SuggestedCard } from "@mustard/core";
import { bookmarkedTermExists } from "@mustard/core";
import type { ChatMessage } from "../../lib/agent";

interface AskChatProps {
  folderPath?: string[]; // 세션이 속한 폴더 경로(상위→하위) — 브레드크럼 맨 앞.
  title: string; // 활성 세션 제목(포괄적) — 좌상단 헤더.
  subLabel?: string; // 활성 질문(서브세션) 라벨 — "폴더 / 세션 / 질문" 브레드크럼.
  messages: ChatMessage[];
  streaming?: string | null;
  isLoading: boolean;
  onSend: (text: string) => void;
  // 반환: add 시 새로 만들었으면 true, 중복 스킵이면 false(칩 토스트 분기 #511).
  onCardAction?: (messageIndex: number, action: { add?: SuggestedCard; dismiss?: boolean }) => void | boolean;
  // 분할 타일 모드(이슈4) — 여러 질문을 나란히 표시.
  tiled?: boolean; // 타일 테두리 표시.
  focused?: boolean; // 포커스 타일 강조.
  onFocus?: () => void; // 타일 클릭/포커스 시 활성 전환.
  onClose?: () => void; // 타일 닫기(×) — 있으면 버튼 노출.
  // 분할 컨트롤 — 안 열린 기존 질문 목록에서 고르거나 새 질문 생성.
  canSplit?: boolean; // 상한 미만이면 분할 가능.
  splitOptions?: { id: string; label: string }[];
  onOpenQuestion?: (id: string) => void;
  onSplitNew?: () => void;
  // 타일 헤더 드래그 재배치(HTML5 DnD).
  draggable?: boolean;
  onHeaderDragStart?: () => void;
  onHeaderDragEnd?: () => void;
  // 우측 카드 목록 패널 토글.
  cardsOpen?: boolean;
  onToggleCards?: () => void;
  // 우측 퀴즈 패널 토글(카드와 자리 공유·배타).
  quizOpen?: boolean;
  onToggleQuiz?: () => void;
  // 퀴즈 푸는 중 질문 가리기(블러) — 커닝 방지. blurActive=풀이중(토글 노출), blurred=현재 가려짐.
  blurActive?: boolean;
  blurred?: boolean;
  onToggleBlur?: () => void;
}

// Ask 모드 전용 챗 — 질문이 메인인 모드라 ChatGPT식 중앙 정렬·프레임리스 레이아웃.
// 답변은 버블 없이 폭 전체, 유저 말풍선만 우측. 로직(Markdown·카드칩·스트리밍)은 공용 재사용.
export default function AskChat({
  folderPath, title, subLabel, messages, streaming, isLoading, onSend, onCardAction,
  tiled = false, focused = false, onFocus, onClose,
  canSplit = false, splitOptions = [], onOpenQuestion, onSplitNew,
  draggable = false, onHeaderDragStart, onHeaderDragEnd,
  cardsOpen = false, onToggleCards,
  quizOpen = false, onToggleQuiz,
  blurActive = false, blurred = false, onToggleBlur,
}: AskChatProps) {
  const t = useT();
  const toast = useToast();
  const [input, setInput] = useState("");
  const [splitMenu, setSplitMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isEmpty = messages.length === 0 && streaming == null;

  // 새 메시지/스트리밍마다 맨 아래로.
  const tick = `${messages.length}:${streaming?.length ?? 0}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tick]);

  function submit() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    onSend(text);
  }

  // 대화를 마크다운으로 클립보드 복사(다른 챗룸과 동일).
  async function handleCopyMd() {
    try {
      await navigator.clipboard.writeText(formatChatAsMarkdown(messages, t));
      toast(t("chat.mdCopied"));
    } catch { /* clipboard 불가 — 무시 */ }
  }

  return (
    <div
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
      className={`flex h-full flex-col overflow-hidden ${
        tiled ? `rounded-xl border ${focused ? "border-[#3B34E2] dark:border-[#8b86f5]" : "border-zinc-200 dark:border-zinc-800"}` : ""
      }`}
    >
      {/* 헤더 — 세션 제목(좌) + 분할/지우기/닫기(우). 타일 모드면 드래그로 재배치. */}
      <div
        draggable={draggable}
        onDragStart={onHeaderDragStart}
        onDragEnd={onHeaderDragEnd}
        className={`flex shrink-0 items-center gap-1.5 px-5 py-3 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {folderPath?.map((name, i) => (
          <span key={i} className="flex min-w-0 shrink items-center gap-1.5">
            <span className="max-w-[8rem] truncate text-sm font-medium text-zinc-500 dark:text-zinc-400">{name}</span>
            <span className="shrink-0 text-zinc-300 dark:text-zinc-600">/</span>
          </span>
        ))}
        <span className="min-w-0 shrink truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</span>
        {subLabel && (
          <>
            <span className="shrink-0 text-zinc-300 dark:text-zinc-600">/</span>
            <span className="truncate text-sm font-medium text-zinc-500 dark:text-zinc-400">{subLabel}</span>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => { void handleCopyMd(); }}
              title={t("chat.copyMd")}
              aria-label={t("chat.copyMd")}
              className="inline-flex items-center rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <IconFileText size={15} stroke={2} aria-hidden />
            </button>
          )}
          {onToggleCards && (
            <button
              type="button"
              onClick={onToggleCards}
              title={t("ask.toggleCards")}
              aria-label={t("ask.toggleCards")}
              aria-pressed={cardsOpen}
              className={`inline-flex items-center rounded-full p-1.5 transition ${
                cardsOpen
                  ? "bg-[#3B34E2]/10 text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]"
                  : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <IconCards size={15} stroke={2} aria-hidden />
            </button>
          )}
          {onToggleQuiz && (
            <button
              type="button"
              onClick={onToggleQuiz}
              title={t("quiz.toggle")}
              aria-label={t("quiz.toggle")}
              aria-pressed={quizOpen}
              className={`inline-flex items-center rounded-full p-1.5 transition ${
                quizOpen
                  ? "bg-[#3B34E2]/10 text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]"
                  : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <IconListCheck size={15} stroke={2} aria-hidden />
            </button>
          )}
          {canSplit && onSplitNew && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  // 열 수 있는 기존 질문이 없으면 바로 새 질문. 있으면 선택 메뉴.
                  if (splitOptions.length === 0) onSplitNew();
                  else setSplitMenu((v) => !v);
                }}
                title={`${t("ask.split")} (⌘D)`}
                aria-label={t("ask.split")}
                className="inline-flex items-center rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <IconLayoutColumns size={15} stroke={2} aria-hidden />
              </button>
              {splitMenu && splitOptions.length > 0 && (
                <>
                  {/* 바깥 클릭 닫기 */}
                  <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setSplitMenu(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("ask.split")}</p>
                    {splitOptions.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => { setSplitMenu(false); onOpenQuestion?.(o.id); }}
                        className="block w-full truncate px-3 py-1.5 text-left text-[13px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        {o.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setSplitMenu(false); onSplitNew(); }}
                      className="flex w-full items-center gap-1.5 border-t border-zinc-100 px-3 py-1.5 text-left text-[13px] font-medium text-[#3B34E2] transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-[#8b86f5] dark:hover:bg-zinc-800"
                    >
                      <IconPlus size={13} stroke={2.5} aria-hidden />
                      {t("ask.newThread")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={t("ask.closeTile")}
              aria-label={t("ask.closeTile")}
              className="inline-flex items-center rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <IconX size={15} stroke={2} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* 메시지 영역 — 퀴즈 푸는 중이면 블러(커닝 방지) + 보기/가리기 토글. */}
      <div className="relative min-h-0 flex-1">
      {blurActive && (
        <button
          type="button"
          onClick={onToggleBlur}
          className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 text-[12px] font-medium text-zinc-600 shadow-sm backdrop-blur transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {blurred ? <IconEye size={14} stroke={2} aria-hidden /> : <IconEyeOff size={14} stroke={2} aria-hidden />}
          {blurred ? t("quiz.reveal") : t("quiz.hide")}
        </button>
      )}
      <div ref={scrollRef} className={`nunopi-scroll h-full overflow-y-auto transition ${blurred ? "pointer-events-none select-none blur-[5px]" : ""}`}>
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <IconSparkles size={34} stroke={1.5} className="text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
            <p className="text-xl font-semibold text-zinc-700 dark:text-zinc-200">{t("ask.empty")}</p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{t("chat.exampleHint")}</p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
            {messages.map((m, i) => {
              if (m.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] select-text whitespace-pre-wrap rounded-3xl bg-zinc-100 px-4 py-2.5 text-base text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">
                      {m.content}
                    </div>
                  </div>
                );
              }
              // 어시스턴트 — 버블 없이 폭 전체. nunopi-cards 블록은 칩으로.
              // 이미 카드인 용어도 칩은 띄우되 "이미 담김" 상태로 표시(#511).
              const { text, cards } = parseCardSuggestions(relocalizeFailure(m.content, t));
              return (
                <div key={i} className="flex flex-col items-start gap-2">
                  <div className="w-full select-text text-zinc-800 dark:text-zinc-100">
                    <Markdown className="nunopi-md-lg">{text}</Markdown>
                  </div>
                  {onCardAction && cards.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
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
              <div className="w-full select-text text-zinc-800 dark:text-zinc-100">
                {streaming ? <Markdown className="nunopi-md-lg">{stripStreamingCardBlock(streaming)}</Markdown> : <span className="text-zinc-400 dark:text-zinc-500">{t("chat.replying")}</span>}
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* 입력창 — 하단 중앙 pill. */}
      <div className="shrink-0 pb-4 pt-1">
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className={`flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-[#3B34E2] dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-[#8b86f5] ${blurred ? "pointer-events-none opacity-50" : ""}`}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={isLoading || blurred}
              rows={1}
              placeholder={blurred ? t("quiz.inputBlocked") : t("ask.placeholder")}
              className="max-h-32 min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-50 dark:placeholder:text-zinc-500"
            />
            <button
              type="button"
              onClick={submit}
              disabled={isLoading || !input.trim() || blurred}
              aria-label={t("chat.send")}
              className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full bg-[#3B34E2] text-white transition hover:bg-[#322bc9] disabled:cursor-not-allowed disabled:opacity-30"
            >
              <IconArrowUp size={18} stroke={2.5} aria-hidden />
            </button>
          </div>
          {canSplit && onSplitNew && (
            <div className="mt-1 flex items-center justify-end gap-0.5 text-[9px] text-zinc-400 dark:text-zinc-500">
              <kbd className="inline-flex items-center gap-0.5 rounded border border-zinc-200 bg-zinc-50 px-1 py-px font-sans dark:border-zinc-700 dark:bg-zinc-800">
                <IconCommand size={9} stroke={2} aria-hidden />Cmd
              </kbd>
              <span className="text-zinc-300 dark:text-zinc-600">+</span>
              <kbd className="inline-flex items-center rounded border border-zinc-200 bg-zinc-50 px-1 py-px font-sans dark:border-zinc-700 dark:bg-zinc-800">
                d
              </kbd>
              <span className="ml-0.5">{t("ask.newSubHint")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

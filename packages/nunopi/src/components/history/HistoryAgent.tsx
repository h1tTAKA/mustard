"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowUp, IconRefresh } from "@tabler/icons-react";
import { useLocale, useT } from "@mustard/core";
import { Markdown } from "@mustard/core";
import { collectHistory } from "../../lib/history/collect";
import { buildHistoryContext } from "../../lib/history/context";
import { parseCardSuggestions, stripStreamingCardBlock } from "@mustard/core";
import { dayKey } from "../../lib/srs/activityLog";
import { summary } from "../../lib/srs/stats";
import { categoryCounts, dueCards } from "../../lib/srs/due";
import { collectCards } from "../../lib/srs/collect";
import { DECK_SOURCES } from "@mustard/core";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@mustard/core";
interface HistoryAgentProps {
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
}

type StreamEvent =
  | { type: "progress"; line: string }
  | { type: "thinking"; line: string }
  | { type: "result"; response: { summary: string } }
  | { type: "error"; message: string };

// 대화 시작 전 예시 프롬프트(i18n 키).
const EXAMPLES = ["home.exYesterday", "home.exWeek", "home.exReview", "home.exHowto"] as const;

// 홈 우측 통합 학습 에이전트 — 유저의 전 분석·학습 이력을 컨텍스트로 참조해 답한다("어제 뭐 배웠지?").
// 전용 챗 UI(코드튜터용 ChatRoom 재사용 X — 헤더·힌트가 문맥과 안 맞음). 단일 in-memory 스레드(미저장).
// 컨텍스트는 전송 시점에 최신 collectHistory()로 빌드(항상 최신, 리스너 불필요).
export default function HistoryAgent({ providerId, providerSettings }: HistoryAgentProps) {
  const t = useT();
  const { locale } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 언마운트 시 진행 중 스트림 취소 — setState-after-unmount 방지(MemorizeChat 패턴).
  useEffect(() => () => abortRef.current?.abort(), []);

  // 새 메시지/스트리밍마다 맨 아래로 자동 스크롤.
  const tick = `${messages.length}:${streaming?.length ?? 0}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tick]);

  function handleClear() {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(null);
    setLoading(false);
  }

  function submit() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    handleSend(text);
  }

  function handleSend(text: string) {
    if (loading) return;
    const thread: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(thread);
    setStreaming("");
    setLoading(true);
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      let answer = "";
      try {
        // 전송 시점 최신 이력 + 복습(SRS) 현황 → 컨텍스트.
        const now = new Date();
        const events = await collectHistory();
        const s = summary("all", now);
        const cats = categoryCounts("all", now, undefined, "all");
        // due 카드 제목 목록(캡 40) — 어떤 카드가 복습 대기인지 콕 집어 답하도록.
        const dueTitles = dueCards(collectCards(DECK_SOURCES.all, now), now).slice(0, 40).map((c) => c.front);
        const context = buildHistoryContext(events, dayKey(now), {
          total: s.total,
          due: s.due,
          neverReviewed: cats.none,
          reviews: s.reviews,
          dueTitles,
        });
        const res = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            request: { code: context, locale, providerId, mode: "chat", messages: thread, providerSettings },
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          if (!ac.signal.aborted) setMessages([...thread, { role: "assistant", content: t("chat.replyFailed") }]);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            let ev: StreamEvent;
            try {
              ev = JSON.parse(l) as StreamEvent;
            } catch {
              continue;
            }
            if (ev.type === "progress" && providerId !== "codex-agent" && !ac.signal.aborted) setStreaming(ev.line);
            else if (ev.type === "result") answer = ev.response.summary;
          }
        }
        if (!ac.signal.aborted) setMessages([...thread, { role: "assistant", content: answer || t("fallback.emptyResponse") }]);
      } catch {
        if (!ac.signal.aborted) setMessages([...thread, { role: "assistant", content: t("chat.replyError") }]);
      } finally {
        if (!ac.signal.aborted) {
          setStreaming(null);
          setLoading(false);
        }
      }
    })();
  }

  const empty = messages.length === 0 && streaming == null;

  return (
    <div className="flex h-full flex-col">
      {/* 메시지 영역 */}
      <div ref={scrollRef} className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          // 빈 상태 — 중앙 인트로 + 예시 프롬프트 칩(행동 유도).
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            {/* 누노피 브랜드 심볼 — 라이트=darkeye, 다크=컬러 눈알 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/nunopi-symbol-darkeye-transparent.png" alt="" aria-hidden className="block h-16 w-16 object-contain opacity-90 dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/nunopi-symbol-transparent.png" alt="" aria-hidden className="hidden h-16 w-16 object-contain opacity-90 dark:block" />
            <p className="max-w-xs text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("home.agentIntro")}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {EXAMPLES.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleSend(t(k))}
                  disabled={loading}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-[12px] text-zinc-600 transition hover:border-[#3B34E2] hover:text-[#3B34E2] disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-[#8b86f5] dark:hover:text-[#8b86f5]"
                >
                  {t(k)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3 px-1 py-1">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-100 px-3.5 py-2 text-[13px] text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[90%] select-text rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-200">
                    {/* nunopi-cards 블록은 이 에이전트선 안 씀 — 본문만(파싱해서 카드 JSON 제거). */}
                    <Markdown>{parseCardSuggestions(m.content).text}</Markdown>
                  </div>
                </div>
              ),
            )}
            {streaming != null && (
              <div className="flex justify-start">
                <div className="max-w-[90%] select-text rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-200">
                  {streaming ? <Markdown>{stripStreamingCardBlock(streaming)}</Markdown> : <span className="text-[13px] text-zinc-400 dark:text-zinc-500">{t("chat.replying")}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 새 대화(대화 있을 때만) */}
      {messages.length > 0 && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            <IconRefresh size={13} stroke={2} aria-hidden />
            {t("home.agentNew")}
          </button>
        </div>
      )}

      {/* 입력바 */}
      <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 pl-3.5 transition focus-within:border-[#3B34E2] dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-[#8b86f5]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={loading}
          rows={1}
          placeholder={t("chat.placeholder")}
          className="max-h-28 min-h-[1.75rem] flex-1 resize-none bg-transparent py-1 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading || !input.trim()}
          aria-label={t("chat.send")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#3B34E2] text-white transition hover:bg-[#322bc9] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]"
        >
          <IconArrowUp size={18} stroke={2.5} aria-hidden />
        </button>
      </div>
    </div>
  );
}

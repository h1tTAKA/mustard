"use client";

import { useEffect, useRef, useState } from "react";
import { IconMessageCircle, IconX } from "@tabler/icons-react";
import { useLocale, useT } from "@mustard/core";
import ChatRoom from "../learning/ChatRoom";
import { loadCardExplain } from "../../lib/cardExplain";
import { loadCardSessions, saveCardSessions, newSessionId, CARD_CHAT_CHANGED_EVENT, type CardChatSession } from "../../lib/cardChat";
import { createChatCard } from "@mustard/core";
import { removeSuggestedCard, stripCardBlock, type SuggestedCard } from "@mustard/core";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "../../lib/agent";
import type { Card } from "@mustard/core";

interface MemorizeChatProps {
  card: Card;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  onOpenChange?: (open: boolean) => void; // 열림 상태 알림(확대 모달 레이아웃 조정용)
  expanded?: boolean; // 확대 모달 내 — 패널 크게 + 세로 중앙 정렬(모달과 나란히)
  autoOpen?: boolean; // 마운트 시 챗룸 바로 열기(전역 히스토리 카드챗 이동용, #565)
}

type StreamEvent =
  | { type: "progress"; line: string }
  | { type: "thinking"; line: string }
  | { type: "result"; response: { summary: string } }
  | { type: "error"; message: string };

// 암기 카드 우하단 챗 — 현재 카드(용어) 스코프 로컬 단일 스레드(히스토리 미저장).
// 코드/글 모드 챗은 좌하단, 암기는 우하단(대칭). ChatRoom UI 재사용.
export default function MemorizeChat({ card, providerId, providerSettings, onOpenChange, expanded = false, autoOpen = false }: MemorizeChatProps) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(autoOpen);
  // 열림 변화 알림(확대 모달 레이아웃용) — updater가 아닌 effect에서(렌더 중 부모 setState 금지).
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const [sessions, setSessions] = useState<CardChatSession[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const messages = sessions.find((s) => s.id === activeId)?.messages ?? [];

  // 활성 세션 messages만 갱신 + 저장.
  function commitActive(nextMsgs: ChatMessage[]) {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === activeId ? { ...s, messages: nextMsgs } : s));
      saveCardSessions(card.key, next);
      return next;
    });
  }

  // 카드가 바뀌면 그 카드의 세션 목록 로드(없으면 새 세션 1개) + 진행 중 요청 취소.
  useEffect(() => {
    abortRef.current?.abort();
    /* eslint-disable react-hooks/set-state-in-effect */
    const loaded = loadCardSessions(card.key);
    const list = loaded.length > 0 ? loaded : [{ id: newSessionId(), createdAt: new Date().toISOString(), messages: [] }];
    setSessions(list);
    setActiveId(list[list.length - 1].id);
    setStreaming(null);
    setLoading(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => abortRef.current?.abort();
  }, [card.key]);

  // 다른 인스턴스(확대 모달 챗↔뒤 peek 챗)가 저장하면 세션 목록 재로드로 동기화(유실 방지).
  // 스트리밍/로딩 중엔 진행 중 대화를 덮지 않도록 스킵.
  useEffect(() => {
    const sync = () => {
      if (loading || streaming != null) return;
      const loaded = loadCardSessions(card.key);
      if (loaded.length > 0) {
        setSessions(loaded);
        setActiveId((cur) => (loaded.some((s) => s.id === cur) ? cur : loaded[loaded.length - 1].id));
      }
    };
    window.addEventListener(CARD_CHAT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CARD_CHAT_CHANGED_EVENT, sync);
  }, [card.key, loading, streaming]);

  function handleClear() {
    abortRef.current?.abort();
    commitActive([]);
    setStreaming(null);
    setLoading(false);
  }

  // 세션 추가 — 새 빈 세션으로 전환.
  function handleNewSession() {
    if (loading) return;
    abortRef.current?.abort();
    const s: CardChatSession = { id: newSessionId(), createdAt: new Date().toISOString(), messages: [] };
    setSessions((prev) => { const next = [...prev, s]; saveCardSessions(card.key, next); return next; });
    setActiveId(s.id);
    setStreaming(null);
  }
  function handleSwitchSession(id: string) {
    abortRef.current?.abort();
    setActiveId(id);
    setStreaming(null);
    setLoading(false);
  }
  // 세션 삭제 — 최소 1개 유지. 활성 삭제 시 남은 마지막으로.
  function handleDeleteSession(id: string) {
    if (loading) return;
    if (sessions.length <= 1) return;
    abortRef.current?.abort();
    const next = sessions.filter((s) => s.id !== id);
    if (id === activeId) setActiveId(next[next.length - 1].id);
    setSessions(next);
    saveCardSessions(card.key, next);
    setStreaming(null);
  }

  // 카드 제안 칩 — 이 플래시카드의 source(token/concept/term) 사전에 저장. 출처=이 카드 챗룸(갤러리로 이동).
  function handleCardAction(messageIndex: number, action: { add?: SuggestedCard; dismiss?: boolean }): boolean {
    let created = false;
    if (action.add) {
      // 분류는 에이전트 kind 우선(예: @Override→token) — 없으면 이 카드 source 물려받음.
      created = createChatCard(action.add.kind ?? card.source, action.add.term, action.add.definition, t("mem.chatSource").replace("{front}", card.front), undefined, {
        kind: "card", originCardKey: card.key,
      });
    }
    const addedTerm = action.add?.term;
    const next = messages.map((m, i) =>
      i === messageIndex && m.role === "assistant"
        ? { ...m, content: addedTerm ? removeSuggestedCard(m.content, addedTerm) : stripCardBlock(m.content) }
        : m,
    );
    commitActive(next);
    return created;
  }

  function handleSend(text: string) {
    if (loading) return;
    const thread: ChatMessage[] = [...messages, { role: "user", content: text }];
    commitActive(thread);
    setStreaming("");
    setLoading(true);
    const ac = new AbortController();
    abortRef.current = ac;
    // 맥락 — 용어 + 추가설명(있으면)으로 이 카드 기준 답변 유도.
    const explain = loadCardExplain(card.key) ?? "";
    const context = `용어: ${card.front}\n\n${card.back}${explain ? `\n\n추가설명:\n${explain}` : ""}`;
    (async () => {
      let answer = "";
      try {
        const res = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            request: {
              code: context,
              locale,
              providerId,
              mode: "chat",
              messages: thread,
              providerSettings,
            },
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          if (!ac.signal.aborted) commitActive([...thread, { role: "assistant", content: t("chat.replyFailed") }]);
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
            // codex는 진행 라벨만 흘리므로 타이핑에 안 씀.
            if (ev.type === "progress" && providerId !== "codex-agent") setStreaming(ev.line);
            else if (ev.type === "result") answer = ev.response.summary;
          }
        }
        if (!ac.signal.aborted) commitActive([...thread, { role: "assistant", content: answer || t("fallback.emptyResponse") }]);
      } catch {
        if (!ac.signal.aborted) commitActive([...thread, { role: "assistant", content: t("chat.replyError") }]);
      } finally {
        if (!ac.signal.aborted) {
          setStreaming(null);
          setLoading(false);
        }
      }
    })();
  }

  return (
    <>
      {/* 우하단 토글 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("input.ask")}
        title={t("input.ask")}
        className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-lime-600 text-white shadow-lg transition hover:bg-lime-700"
      >
        {open ? <IconX size={20} stroke={2} aria-hidden /> : <IconMessageCircle size={20} stroke={2} aria-hidden />}
      </button>

      {/* 우하단 챗 패널 — expanded면 크게 + 세로 중앙(확대 모달과 나란히) */}
      {open && (
        <div className={`fixed z-30 flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[var(--s-bar)] ${expanded ? "right-8 top-1/2 h-[85vh] w-[34rem] -translate-y-1/2 md:right-12" : "bottom-24 right-6 h-[61vh] w-[30rem]"}`}>
          <ChatRoom
            messages={messages}
            streaming={streaming}
            isLoading={loading}
            mode="code"
            onSend={handleSend}
            onClear={handleClear}
            onCardAction={handleCardAction}
            sessionIds={sessions.map((s) => s.id)}
            activeSessionId={activeId}
            onSwitchSession={handleSwitchSession}
            onNewSession={handleNewSession}
            onDeleteSession={handleDeleteSession}
            large={expanded}
          />
        </div>
      )}
    </>
  );
}

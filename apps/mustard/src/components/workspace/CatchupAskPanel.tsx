"use client";
// 캐치업 항목 질문 패널(#998, 에픽 #991-D) — 💬로 고른 항목에 대해 질문. 대화는 항목별 서버 저장(ask/<key>.json)·복원.
// 컨텍스트 = 항목 → 캐치업 이력 → 레포(지도 + 읽기 전용 도구, 서버가 workspaceRoot 검증). 카드칩은 nunopi 켜짐일 때만.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconMessageCircle, IconX, IconArrowUp, IconLoader2, IconPlus, IconCheck } from "@tabler/icons-react";
import { useT, useLocale, useToast, useSetting, CUKEYS, CATCHUP_DEFAULTS, Markdown, parseCardSuggestions, relocalizeFailure, stripStreamingCardBlock, stripCardBlock, removeSuggestedCard, createChatCard, bookmarkedTermExists, type SuggestedCard } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { isNunopiEnabled } from "@/lib/product";
import { isCardWorthy } from "@/lib/cardWorthy";
import { gatherCatchupContext } from "@/lib/catchupAskGather";
import type { AskItem } from "@/lib/catchupAskContext";

type Msg = { role: "user" | "assistant"; content: string };
type StreamEvent = { type: string; line?: string; message?: string; response?: { summary?: string } };

export default function CatchupAskPanel({ root, item, providerId, providerSettings, onClose, onCount }: {
  root: string;
  item: AskItem;
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
  onClose: () => void;
  onCount: (key: string, n: number) => void; // 카드 배지 갱신(유저 질문 수)
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null); // 응답 대기 중인 항목(항목 바꿔도 그 항목에 저장)
  const [streaming, setStreaming] = useState<string | null>(null);
  const curKey = useRef(item.key);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatCards = useSetting<boolean>(CUKEYS.chatCards, CATCHUP_DEFAULTS.chatCards); // #1081 설정 > 캐치업 > 질문 > 카드 칩(질문 화면과 같은 스위치)
  const cardsOn = isNunopiEnabled() && chatCards; // 카드(암기) = nunopi 학습모듈 기능 → 꺼지면 칩·카드 지시 없음

  // 항목 바뀌면 그 항목 대화 복원.
  useEffect(() => {
    curKey.current = item.key;
    let alive = true;
    fetch(`/api/repo/stream/ask?root=${encodeURIComponent(root)}&key=${encodeURIComponent(item.key)}`).then((r) => r.json())
      .then((j) => { if (alive) setMsgs(j?.ok && j.thread?.messages ? (j.thread.messages as Msg[]) : []); })
      .catch(() => { if (alive) setMsgs([]); });
    return () => { alive = false; };
  }, [root, item.key]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length, streaming]);

  // 저장 — 그 항목 대화 통째로. 화면은 지금 보는 항목일 때만 갱신.
  const save = useCallback(async (key: string, target: string, messages: Msg[]) => {
    if (curKey.current === key) setMsgs(messages);
    onCount(key, messages.filter((m) => m.role === "user").length);
    try { await fetch("/api/repo/stream/ask", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, thread: { key, target, messages } }) }); } catch { /* 다음 저장 때 통째로 다시 씀 */ }
  }, [root, onCount]);

  async function send() {
    const text = input.trim();
    if (!text || busyKey || !providerId) return;
    setInput("");
    const key = item.key, target = item.target, focus = item;
    const thread: Msg[] = [...msgs, { role: "user", content: text }];
    void save(key, target, thread);
    setBusyKey(key); setStreaming("");
    let answer = "";
    try {
      const ctx = await gatherCatchupContext(root, focus);
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: thread, providerSettings, workspaceRoot: root, noCards: !cardsOn } }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "", err = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) {
          if (!l.trim()) continue;
          let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
          if (ev.type === "progress" && providerId !== "codex-agent" && curKey.current === key) setStreaming(ev.line ?? "");
          else if (ev.type === "result") answer = ev.response?.summary ?? "";
          else if (ev.type === "error") err = ev.message ?? "error";
        }
      }
      if (!answer && err) throw new Error(err);
      await save(key, target, [...thread, { role: "assistant", content: answer || t("fallback.emptyResponse") }]);
    } catch {
      await save(key, target, [...thread, { role: "assistant", content: t("fallback.error") }]);
    } finally { setBusyKey(null); setStreaming(null); }
  }

  // 카드칩 — 추가(북마크 카드) 또는 거절. 처리 후 그 메시지의 카드 블록 정리 + 저장.
  function cardAction(i: number, a: { add?: SuggestedCard; dismiss?: boolean }) {
    const repoName = root.split("/").filter(Boolean).pop() ?? root;
    let next = msgs;
    if (a.add) {
      const c = a.add;
      const ok = createChatCard(c.kind ?? "term", c.term, c.definition, t("card.workspaceSource", { repo: repoName }), undefined, { kind: "workspace", sessionId: `catchup:${item.key}`, root });
      toast(ok ? t("card.added", { term: c.term }) : t("card.exists"));
      next = msgs.map((m, j) => (j === i ? { ...m, content: removeSuggestedCard(m.content, c.term) } : m));
    } else if (a.dismiss) next = msgs.map((m, j) => (j === i ? { ...m, content: stripCardBlock(m.content) } : m));
    void save(item.key, item.target, next);
  }

  const busyHere = busyKey === item.key;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconMessageCircle size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-300" title={item.target}>{t("learn.askTitle", { target: item.target })}</span>
        <button type="button" onClick={onClose} aria-label={t("learn.askClose")} className="rounded-md p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"><IconX size={13} stroke={2} aria-hidden /></button>
      </div>
      <div className="nunopi-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {!msgs.length && streaming == null && <p className="py-3 text-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("learn.askEmpty")}</p>}
        {msgs.map((m, i) => {
          if (m.role === "user") return <div key={i} className="self-end max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-3 py-1.5 text-[12px] leading-relaxed text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">{m.content}</div>;
          const parsed = parseCardSuggestions(relocalizeFailure(m.content, t));
          const cards = cardsOn ? parsed.cards.filter((c) => isCardWorthy(c.term)) : [];
          return (
            <div key={i} className="flex max-w-full flex-col items-start gap-1.5 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
              <div className="max-w-full"><Markdown>{parsed.text}</Markdown></div>
              {cards.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {cards.map((c) => bookmarkedTermExists(c.term) ? (
                    <button key={c.term} type="button" onClick={() => toast(t("card.exists"))} className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-600">
                      <IconCheck size={12} stroke={2.5} aria-hidden />{c.term} {t("chat.cardExists")}
                    </button>
                  ) : (
                    <button key={c.term} type="button" onClick={() => cardAction(i, { add: c })} className="inline-flex items-center gap-1 rounded-full bg-mustard-500/12 px-2.5 py-1 text-[11px] font-medium text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
                      <IconPlus size={12} stroke={2.5} aria-hidden />{c.term} {t("chat.saveAsCard")}
                    </button>
                  ))}
                  <button type="button" onClick={() => cardAction(i, { dismiss: true })} className="rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600">{t("chat.noThanks")}</button>
                </div>
              )}
            </div>
          );
        })}
        {busyHere && streaming != null && (
          <div className="max-w-full text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
            {streaming ? <Markdown>{stripStreamingCardBlock(streaming)}</Markdown> : <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden /> {t("chat.replying")}</span>}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex shrink-0 items-end gap-1.5 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={t("learn.askPlaceholder")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          className="max-h-28 min-h-[32px] flex-1 resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[12px] text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500" />
        <button type="submit" disabled={!input.trim() || !!busyKey || !providerId} aria-label={t("learn.askSend")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mustard-500 text-white transition hover:bg-mustard-600 disabled:opacity-40">
          {busyKey ? <IconLoader2 size={14} stroke={2} className="animate-spin" aria-hidden /> : <IconArrowUp size={14} stroke={2.5} aria-hidden />}
        </button>
      </form>
    </div>
  );
}

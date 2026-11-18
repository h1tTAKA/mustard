"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconX, IconSparkles, IconEye, IconTrash, IconCircleCheck, IconSearch, IconCheck } from "@tabler/icons-react";
import { useT, useLocale } from "@mustard/core";
import { useToast } from "@mustard/core";
import { collectCards } from "../../lib/srs/collect";
import { deleteCard } from "../../lib/srs/deleteCard";
import { type Card, type SrsSource } from "@mustard/core";
import { cardFrame } from "../../lib/srs/cardFrame";
import { buildDedupContext, parseDedupGroups } from "../../lib/cardDedup";
import { normalizeCardFront } from "@mustard/core";
import { useFlyCard } from "./FlyCard";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "../../lib/agent";
import { CardTitle } from "./CardTitle";

const SYMBOL = "/brand/nunopi-symbol-darkeye-transparent.png";
type StreamEvent =
  | { type: "progress"; line: string }
  | { type: "thinking"; line: string }
  | { type: "result"; response: { summary: string } }
  | { type: "error"; message: string };

// 에이전트가 찾은 중복 묶음(카드 해석 완료) — 카드 2장 이상.
interface ResolvedGroup {
  id: string;
  cards: Card[];
  reason: string;
}

let groupIdSeq = 0;
function newGroupId(): string {
  try { return crypto.randomUUID(); } catch { groupIdSeq += 1; return `dg-${groupIdSeq}`; }
}

// 이름(앞면) 정규화가 겹치는 카드가 있으면 '이름 중복' 묶음 — 표기만 다른 확실한 중복이라 최우선.
function isNameDup(g: ResolvedGroup): boolean {
  const seen = new Set<string>();
  for (const c of g.cards) {
    const n = normalizeCardFront(c.front);
    if (seen.has(n)) return true;
    seen.add(n);
  }
  return false;
}

const SOURCE_KEYS: { key: SrsSource; label: string }[] = [
  { key: "token", label: "mem.srcToken" },
  { key: "concept", label: "mem.srcConceptFull" },
  { key: "term", label: "mem.srcTerm" },
];

type Phase = "idle" | "scanning" | "done";

// 갤러리 카드 중복 정리 패널 — 좌: 탐색 결과(유지/삭제), 우: 탐색 범위(분류·기준) + 탐색 버튼.
// 탐색은 버튼을 눌러야 시작한다(자동 실행 안 함).
export default function CardDedupModal({
  now, providerId, providerSettings, onClose,
}: {
  now: Date;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const { throwCard } = useFlyCard();
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [phase, setPhase] = useState<Phase>("idle");
  const [groups, setGroups] = useState<ResolvedGroup[]>([]);
  // 지울 카드 key 집합(전 그룹 통합). 기본은 전부 유지(빈 집합).
  const [toDelete, setToDelete] = useState<Set<string>>(new Set());
  // 탐색 범위 — 분류(출처) + 기준(제목/내용). 기본 전부 포함.
  const [sources, setSources] = useState<Set<SrsSource>>(new Set<SrsSource>(["token", "concept", "term"]));
  const [matchTitle, setMatchTitle] = useState(true);
  const [matchContent, setMatchContent] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const canScan = sources.size > 0 && (matchTitle || matchContent) && phase !== "scanning";

  function toggleSource(s: SrsSource) {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  async function scan() {
    if (sources.size === 0 || (!matchTitle && !matchContent)) return;
    const all = collectCards([...sources], now);
    const byKey = new Map(all.map((c) => [c.key, c]));
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("scanning");
    setGroups([]);
    setToDelete(new Set());

    if (all.length < 2) { setPhase("done"); return; }
    const thread: ChatMessage[] = [{ role: "user", content: t("mem.dedup") }];
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          request: {
            code: buildDedupContext(all, { matchTitle, matchContent }),
            locale, providerId, mode: "dedup-cards", messages: thread, providerSettings,
          },
        }),
        signal: ac.signal,
      });
      let answer = "";
      if (res.ok && res.body) {
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
            try {
              const ev = JSON.parse(l) as StreamEvent;
              if (ev.type === "result") answer = ev.response.summary;
            } catch { /* skip */ }
          }
        }
        if (buffer.trim()) { try { const ev = JSON.parse(buffer) as StreamEvent; if (ev.type === "result") answer = ev.response.summary; } catch { /* skip */ } }
      }
      if (ac.signal.aborted) return;
      const built: ResolvedGroup[] = parseDedupGroups(answer)
        .map((g) => ({
          id: newGroupId(),
          reason: g.reason,
          cards: [...new Set(g.keys)].map((k) => byKey.get(k)).filter((c): c is Card => !!c),
        }))
        .filter((g) => g.cards.length >= 2);
      // 이름(표기) 중복을 최상단으로 — 정규화 앞면이 겹치는 확실한 중복 먼저(안정 정렬).
      built.sort((a, b) => Number(isNameDup(b)) - Number(isNameDup(a)));
      setGroups(built);
      setPhase("done");
    } catch {
      if (!ac.signal.aborted) setPhase("done"); // 실패 시 빈 결과(없음 메시지)
    }
  }

  // 삭제 토글 — 한 묶음에서 최소 한 장은 남겨야 하므로, 그 그룹의 모든 카드를
  // 삭제 선택하려 하면(마지막 한 장까지) 막고 안내한다. 해제는 항상 허용.
  // 부수효과(toast)는 setState 업데이터 밖에서 — 업데이터는 순수해야 함(StrictMode 중복 실행 방지).
  function toggleDelete(key: string, group: ResolvedGroup) {
    if (toDelete.has(key)) {
      setToDelete((prev) => { const next = new Set(prev); next.delete(key); return next; });
      return;
    }
    const selectedInGroup = group.cards.filter((c) => toDelete.has(c.key)).length;
    if (selectedInGroup >= group.cards.length - 1) {
      toast(t("mem.dedupKeepOne"), "error"); // 마지막 한 장은 남긴다.
      return;
    }
    setToDelete((prev) => { const next = new Set(prev); next.add(key); return next; });
  }

  function deleteSelected() {
    if (toDelete.size === 0) return;
    const n = toDelete.size;
    const victims = groups.flatMap((g) => g.cards).filter((c) => toDelete.has(c.key));
    for (const c of victims) deleteCard(c);
    const remaining = groups
      .map((g) => ({ ...g, cards: g.cards.filter((c) => !toDelete.has(c.key)) }))
      .filter((g) => g.cards.length >= 2);
    setGroups(remaining);
    setToDelete(new Set());
    toast(t("mem.dedupDone").replace("{n}", String(n)));
  }

  const totalDupCards = useMemo(() => groups.reduce((n, g) => n + g.cards.length, 0), [groups]);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm" onClick={onClose}>
      {/* 중앙 패널 — 좌(결과) + 우(탐색 범위). */}
      <div
        className="flex max-h-[86vh] w-[min(94vw,980px)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#0b0c10]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 좌 — 결과 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-5 dark:border-zinc-800">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              <IconSparkles size={15} stroke={2} className="text-amber-500" aria-hidden /> {t("mem.dedupTitle")}
            </span>
            {phase === "done" && groups.length > 0 && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">{groups.length} · {totalDupCards}</span>
            )}
          </div>

          {phase === "idle" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
              <IconSearch size={28} stroke={1.6} className="text-zinc-300 dark:text-zinc-600" aria-hidden />
              <p className="text-sm text-zinc-400 dark:text-zinc-500">{t("mem.dedupIdle")}</p>
            </div>
          ) : phase === "scanning" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
              <IconSparkles size={30} stroke={1.6} className={`text-amber-500 ${reduced ? "" : "animate-pulse"}`} aria-hidden />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{t("mem.dedupScanning")}</p>
              <div className="nunopi-indeterminate h-1.5 w-full max-w-xs rounded-full bg-zinc-200 dark:bg-zinc-800">
                <span className="bg-amber-500" />
              </div>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
              <IconCircleCheck size={30} stroke={1.6} className="text-emerald-500" aria-hidden />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("mem.dedupNone")}</p>
            </div>
          ) : (
            <>
              <div className="nunopi-scroll flex-1 overflow-y-auto p-5">
                <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">{t("mem.dedupHint")}</p>
                <div className="flex flex-col gap-6">
                  {groups.map((g) => (
                    <section key={g.id} className="flex flex-col gap-2.5">
                      {g.reason && (
                        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{g.reason}</p>
                      )}
                      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(8.5rem, 1fr))" }}>
                        {g.cards.map((c) => {
                          const del = toDelete.has(c.key);
                          return (
                            <div
                              key={c.key}
                              data-fly-card
                              className={`group relative aspect-[5/7] overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 ${
                                del ? "border-rose-400" : "border-[#3B34E2]/50"
                              }`}
                            >
                              <span className={`pointer-events-none absolute inset-[6%] rounded-[10%] border-2 ${cardFrame(c.source).outer}`} />
                              <span className={`pointer-events-none absolute inset-[9%] rounded-[8%] border ${cardFrame(c.source).inner}`} />
                              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2.5 text-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={SYMBOL} alt="" className="h-5 w-5 object-contain" />
                                <CardTitle text={c.front} className="line-clamp-3 text-[11px] font-bold leading-tight text-zinc-900" />
                              </div>
                              {/* 카드 아무데나 클릭 = 삭제 대상 토글 */}
                              <button
                                type="button"
                                aria-label={c.front}
                                aria-pressed={del}
                                onClick={() => toggleDelete(c.key, g)}
                                className="absolute inset-0 z-10 cursor-pointer rounded-2xl"
                              />
                              {del && <span className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-rose-900/40" />}
                              {/* 우상단 삭제 선택 동그라미(명시 어포던스) */}
                              <button
                                type="button"
                                aria-label={del ? t("mem.dedupDeleteBadge") : t("mem.dedupKeepBadge")}
                                aria-pressed={del}
                                onClick={() => toggleDelete(c.key, g)}
                                className={`absolute right-1.5 top-1.5 z-30 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm transition ${
                                  del ? "border-rose-500 bg-rose-500 text-white" : "border-zinc-300 bg-white/90 text-transparent hover:border-rose-400"
                                }`}
                              >
                                <IconTrash size={12} stroke={2.5} aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => throwCard(c, (e.currentTarget.closest("[data-fly-card]") as HTMLElement | null)?.getBoundingClientRect())}
                                className="absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-lg bg-zinc-700/90 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-md transition hover:bg-zinc-800 group-hover:opacity-100"
                              >
                                <IconEye size={13} stroke={2} aria-hidden />
                                {t("mem.cardDetail")}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={deleteSelected}
                  disabled={toDelete.size === 0}
                  className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <IconTrash size={15} stroke={2} aria-hidden />
                  {t("mem.dedupDeleteN").replace("{n}", String(toDelete.size))}
                </button>
              </div>
            </>
          )}
        </div>

        {/* 우 — 탐색 범위 */}
        <div className="flex w-64 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-[#0d0e13]">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t("mem.dedupScopeTitle")}</span>
            <button type="button" onClick={onClose} aria-label={t("mem.close")} className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-200 dark:hover:bg-zinc-800">
              <IconX size={16} stroke={2} aria-hidden />
            </button>
          </div>
          <div className="nunopi-scroll flex-1 overflow-y-auto p-4">
            {/* 분류 */}
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("mem.dedupScopeSource")}</p>
            <div className="mb-5 flex flex-col gap-1">
              {SOURCE_KEYS.map((s) => (
                <CheckRow key={s.key} on={sources.has(s.key)} onToggle={() => toggleSource(s.key)} label={t(s.label)} />
              ))}
            </div>
            {/* 기준 */}
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("mem.dedupScopeField")}</p>
            <div className="flex flex-col gap-1">
              <CheckRow on={matchTitle} onToggle={() => setMatchTitle((v) => !v)} label={t("mem.dedupFieldTitle")} />
              <CheckRow on={matchContent} onToggle={() => setMatchContent((v) => !v)} label={t("mem.dedupFieldContent")} />
            </div>
          </div>
          <div className="shrink-0 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => { void scan(); }}
              disabled={!canScan}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconSearch size={15} stroke={2} aria-hidden />
              {phase === "done" ? t("mem.dedupRescan") : t("mem.dedupScan")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onToggle}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${on ? "border-[#3B34E2] bg-[#3B34E2] text-white" : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"}`}>
        {on && <IconCheck size={12} stroke={3} aria-hidden />}
      </span>
      {label}
    </button>
  );
}

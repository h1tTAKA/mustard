"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconSparkles, IconX, IconCheck, IconEye } from "@tabler/icons-react";
import { useT, useLocale } from "@mustard/core";
import { useConfirm, CKEYS } from "@mustard/core";
import { collectCards } from "../../lib/srs/collect";
import { addCardsToDeck, loadCustomDecks, CUSTOM_DECKS_CHANGED_EVENT, type CustomDeck } from "../../lib/srs/customDeck";
import { buildDeckAssignContext, parseDeckAssign } from "../../lib/deckAssign";
import { DECK_SOURCES, type Card } from "@mustard/core";
import { cardFrame } from "../../lib/srs/cardFrame";
import { useFlyCard } from "./FlyCard";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "../../lib/agent";
import { CardTitle } from "./CardTitle";

const SYMBOL = "/brand/nunopi-symbol-darkeye-transparent.png";
type StreamEvent = { type: "progress"; line: string } | { type: "thinking"; line: string } | { type: "result"; response: { summary: string } } | { type: "error"; message: string };

// 에이전트가 제안한 배정 그룹 — 기존 덱(고정) + 그 덱에 넣을 카드.
interface AssignGroup {
  deckId: string;
  deckName: string;
  cards: Card[];
  checked: boolean;
  excluded: Set<string>;
}

// 미니 카드 타일(setup 후보 선택 / preview 배정 결과 공용). dimmed=흐리게, check=우상단 파란 체크.
function MiniTile({ card, dimmed, check, onToggle, throwCard, t }: {
  card: Card; dimmed: boolean; check: boolean; onToggle: () => void;
  throwCard: (c: Card, r?: DOMRect) => void; t: (k: string) => string;
}) {
  return (
    <div data-fly-card className={`group relative aspect-[5/7] overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 ${dimmed ? "border-zinc-300 dark:border-zinc-600" : "border-[#3B34E2]/50"}`}>
      <span className={`pointer-events-none absolute inset-[6%] rounded-[10%] border-2 ${cardFrame(card.source).outer}`} />
      <span className={`pointer-events-none absolute inset-[9%] rounded-[8%] border ${cardFrame(card.source).inner}`} />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2.5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={SYMBOL} alt="" className="h-5 w-5 object-contain" />
        <CardTitle text={card.front} className="line-clamp-3 text-[11px] font-bold leading-tight text-zinc-900" />
      </div>
      <button type="button" aria-label={card.front} aria-pressed={check} onClick={onToggle} className="absolute inset-0 z-10 cursor-pointer rounded-2xl" />
      {dimmed && <span className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-zinc-900/45" />}
      <span className={`pointer-events-none absolute right-1.5 top-1.5 z-30 flex h-5 w-5 items-center justify-center rounded-full border ${check ? "border-[#3B34E2] bg-[#3B34E2] text-white" : "border-zinc-300 bg-white/80"}`}>
        {check && <IconCheck size={12} stroke={3} aria-hidden />}
      </span>
      {!dimmed && (
        <button
          type="button"
          onClick={(e) => throwCard(card, (e.currentTarget.closest("[data-fly-card]") as HTMLElement | null)?.getBoundingClientRect())}
          className="absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-lg bg-zinc-700/90 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-md transition hover:bg-zinc-800 group-hover:opacity-100"
        >
          <IconEye size={13} stroke={2} aria-hidden /> {t("mem.cardDetail")}
        </button>
      )}
    </div>
  );
}

// 에이전트 기존 덱 자동 분류 — UI 주도 2단계.
// setup: 왼쪽에서 분류할 카드(미분류 기본)·대상 덱 고르기 → "맡기기". preview: 에이전트 배정 제안 → 제외/체크 → 추가.
export default function AgentAssignModal({
  now, providerId, providerSettings, onBack, onApplied, onSwitchToCreate, embedded = false, headerRight,
}: {
  now: Date;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  onBack: () => void;
  onApplied: () => void;
  // 배정 안 된 카드를 "새 덱으로" 만들려 할 때 — hub에게 덱 생성 모드 전환 + 씨앗 프롬프트를 실어 올림(자식→부모 콜백).
  onSwitchToCreate?: (seedPrompt?: string) => void;
  // embedded=허브 패널 안에 끼워질 때: 자체 백드롭/풀스크린 제거하고 부모 박스를 채운다.
  embedded?: boolean;
  // 우측 컬럼 헤더의 제목 자리에 끼울 요소(허브의 모드 토글).
  headerRight?: React.ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const confirm = useConfirm();
  const { throwCard } = useFlyCard();
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const all = useMemo(() => collectCards(DECK_SOURCES.all, now), [now]);
  const byKey = useMemo(() => new Map(all.map((c) => [c.key, c])), [all]);
  const [existingDecks, setExistingDecks] = useState<CustomDeck[]>([]);
  useEffect(() => {
    const load = () => setExistingDecks(loadCustomDecks());
    load();
    window.addEventListener(CUSTOM_DECKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CUSTOM_DECKS_CHANGED_EVENT, load);
  }, []);

  // 미분류 = 전체 − 모든 덱 cardKeys 합집합.
  const assignedKeys = useMemo(() => new Set(existingDecks.flatMap((d) => d.cardKeys)), [existingDecks]);
  const [scope, setScope] = useState<"unassigned" | "all">("unassigned");
  const candidates = useMemo(
    () => (scope === "unassigned" ? all.filter((c) => !assignedKeys.has(c.key)) : all),
    [all, assignedKeys, scope],
  );

  // 선택 상태 — 카드/덱(기본 전체 선택). 배정 결과 유무와 무관하게 옵션 패널은 항상 유지.
  const [pickedCards, setPickedCards] = useState<Set<string>>(new Set());
  const [pickedDecks, setPickedDecks] = useState<Set<string>>(new Set());
  // 후보/덱 목록 바뀌면 기본 전체 선택으로 초기화.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { setPickedCards(new Set(candidates.map((c) => c.key))); }, [candidates]);
  useEffect(() => { setPickedDecks(new Set(existingDecks.map((d) => d.id))); }, [existingDecks]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(""); // 모델 추론 스트림 — 작업 중임을 보이게
  const [groups, setGroups] = useState<AssignGroup[]>([]);
  const [sentCards, setSentCards] = useState<Card[]>([]); // 직전 위임에서 에이전트에 보낸 카드(leftover 계산용)
  const [reveal, setReveal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const totalCards = useMemo(() => groups.reduce((n, g) => n + g.cards.length, 0), [groups]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (totalCards === 0) { setReveal(0); return; }
    if (reduced) { setReveal(totalCards); return; }
    setReveal(0);
    let i = 0;
    const id = window.setInterval(() => { i += 1; setReveal(i); if (i >= totalCards) window.clearInterval(id); }, 110);
    return () => window.clearInterval(id);
  }, [totalCards, reduced]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 에이전트 호출 — context(요청 시 고정)와 스레드로. answer 반환.
  async function runAgent(thread: ChatMessage[], context: string): Promise<string> {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setThinking("");
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: context, locale, providerId, mode: "deck-agent", messages: thread, providerSettings } }),
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
              if (ev.type === "thinking") setThinking(ev.line);
              else if (ev.type === "result") answer = ev.response.summary;
            } catch { /* skip */ }
          }
        }
        if (buffer.trim()) { try { const ev = JSON.parse(buffer) as StreamEvent; if (ev.type === "result") answer = ev.response.summary; } catch { /* skip */ } }
      }
      return ac.signal.aborted ? "" : answer;
    } finally {
      if (!ac.signal.aborted) { setLoading(false); setThinking(""); }
    }
  }

  // 중단 — 진행 중인 요청 취소하고 세팅 화면으로 복귀(다시 고를 수 있게).
  function cancel() {
    abortRef.current?.abort();
    setLoading(false);
    setThinking("");
  }

  // 응답을 배정 그룹으로 반영.
  function applyReply(reply: string) {
    if (!reply) return;
    const assigns = parseDeckAssign(reply);
    const built: AssignGroup[] = [];
    for (const a of assigns) {
      const deck = existingDecks.find((d) => d.name === a.deck);
      if (!deck) continue;
      const has = new Set(deck.cardKeys);
      const cards = a.keys.map((k) => byKey.get(k)).filter((c): c is Card => !!c && !has.has(c.key));
      if (cards.length > 0) built.push({ deckId: deck.id, deckName: deck.name, cards, checked: true, excluded: new Set() });
    }
    if (built.length > 0) setGroups(built);
  }

  // "맡기기" — 선택 카드·덱으로 컨텍스트 구성 + 자동 요청 → preview.
  async function delegate() {
    if (loading) return;
    const cards = candidates.filter((c) => pickedCards.has(c.key));
    const decks = existingDecks.filter((d) => pickedDecks.has(d.id));
    if (cards.length === 0 || decks.length === 0) return;
    const context = buildDeckAssignContext(cards, decks.map((d) => ({ name: d.name, cardKeys: d.cardKeys })));
    const prompt = t("mem.assignAutoPrompt").replace("{n}", String(cards.length)).replace("{decks}", decks.map((d) => d.name).join(", "));
    const thread: ChatMessage[] = [{ role: "user", content: prompt }];
    try {
      const answer = await runAgent(thread, context);
      if (abortRef.current?.signal.aborted) return; // 중단됨 — 결과 반영 안 함
      setSentCards(cards); // 이번에 보낸 카드 기록(중단 안 됐을 때만) → leftover 계산 기준
      applyReply(answer || t("mem.agentDeckNone"));
    } catch { if (!abortRef.current?.signal.aborted) applyReply(t("mem.agentDeckNone")); }
  }

  // setup 조작
  function toggleCard(key: string) {
    setPickedCards((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function toggleDeck(id: string) {
    setPickedDecks((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const allCardsPicked = candidates.length > 0 && candidates.every((c) => pickedCards.has(c.key));
  function toggleAllCards() {
    setPickedCards(allCardsPicked ? new Set() : new Set(candidates.map((c) => c.key)));
  }
  const allDecksPicked = existingDecks.length > 0 && existingDecks.every((d) => pickedDecks.has(d.id));
  function toggleAllDecks() {
    setPickedDecks(allDecksPicked ? new Set() : new Set(existingDecks.map((d) => d.id)));
  }

  // preview 조작
  function toggleExclude(deckId: string, key: string) {
    setGroups((prev) => prev.map((g) => {
      if (g.deckId !== deckId) return g;
      const ex = new Set(g.excluded); if (ex.has(key)) ex.delete(key); else ex.add(key); return { ...g, excluded: ex };
    }));
  }
  function toggleGroup(deckId: string) {
    setGroups((prev) => prev.map((g) => (g.deckId === deckId ? { ...g, checked: !g.checked } : g)));
  }
  const includedCount = (g: AssignGroup) => g.cards.filter((c) => !g.excluded.has(c.key)).length;
  const canApply = groups.some((g) => g.checked && includedCount(g) > 0);
  // 추가 완료 결과(팝업) — 확인 후 세팅. 닫으면 onApplied.
  const [result, setResult] = useState<{ decks: number; added: number; skipped: number } | null>(null);
  async function applyChecked() {
    if (!canApply) return;
    const targets = groups.filter((g) => g.checked && includedCount(g) > 0);
    const cardTotal = targets.reduce((n, g) => n + includedCount(g), 0);
    const ok = await confirm({ skipKey: CKEYS.skipDelete,
      title: t("mem.assignApplyConfirmTitle"),
      message: t("mem.assignApplyConfirmMsg").replace("{decks}", String(targets.length)).replace("{n}", String(cardTotal)),
      confirmText: t("mem.assignApply"),
    });
    if (!ok) return;
    let added = 0, skipped = 0;
    for (const g of targets) {
      const keys = g.cards.filter((c) => !g.excluded.has(c.key)).map((c) => c.key);
      const r = addCardsToDeck(g.deckId, keys);
      added += r.added; skipped += r.skipped;
    }
    setResult({ decks: targets.length, added, skipped });
  }

  const pickedCount = candidates.filter((c) => pickedCards.has(c.key)).length;
  // leftover = 보낸 카드 − 어느 덱에도 배정된 카드(집합 차이). 에이전트가 어울리는 덱 없어 뺀 것들.
  const leftover = useMemo(() => {
    const assigned = new Set(groups.flatMap((g) => g.cards.map((c) => c.key)));
    return sentCards.filter((c) => !assigned.has(c.key));
  }, [sentCards, groups]);
  // leftover 카드 이름들로 "새 덱 만들어줘" 프롬프트 작성 → 덱 생성 모드에 씨앗(seed)으로 넘김.
  function buildNewDeckPrompt(cards: Card[]): string {
    const names = cards.map((c) => c.front).join(", ");
    return t("mem.assignLeftoverPrompt").replace("{cards}", names);
  }
  // 그룹별 전역 stagger 시작 인덱스(이전 그룹들 카드 수 누적) — 렌더 밖에서 미리 계산.
  const groupOffsets = useMemo(() => {
    const o: number[] = [];
    let acc = 0;
    for (const g of groups) { o.push(acc); acc += g.cards.length; }
    return o;
  }, [groups]);

  // 옵션 패널(범위·카드선택·대상 덱·실행) — 채팅 자리 없앤 만큼 세로 전체를 채운다(대상 덱 목록이 확장).
  const optionsPanel = (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-white/60 px-5 py-4 dark:bg-zinc-900/40">
      {/* 분류할 카드 — 범위 토글 + 전체선택 */}
      <div className="shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t("mem.assignPickCards")}</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{pickedCount}/{candidates.length}</span>
          <button type="button" onClick={toggleAllCards} disabled={loading} className="ml-auto rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
            {allCardsPicked ? t("mem.selectNone") : t("mem.selectAll")}
          </button>
        </div>
        <div className="flex w-full items-center gap-1 rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800">
          {(["unassigned", "all"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)} disabled={loading}
              className={`flex-1 rounded-md px-2 py-1 font-medium transition disabled:opacity-50 ${scope === s ? "bg-white text-zinc-800 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}`}>
              {t(s === "unassigned" ? "mem.assignScopeUnassigned" : "mem.assignScopeAll")}
            </button>
          ))}
        </div>
      </div>
      {/* 대상 덱 — 남은 세로 공간을 다 채우는 목록 */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{t("mem.assignPickDecks")}</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{pickedDecks.size}/{existingDecks.length}</span>
          <button type="button" onClick={toggleAllDecks} disabled={loading} className="ml-auto text-[11px] font-medium text-zinc-400 transition hover:text-zinc-600 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-zinc-300">
            {allDecksPicked ? t("mem.selectNone") : t("mem.selectAll")}
          </button>
        </div>
        <div className="nunopi-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5">
          {existingDecks.map((d) => {
            const on = pickedDecks.has(d.id);
            return (
              <button key={d.id} type="button" onClick={() => toggleDeck(d.id)} disabled={loading}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition disabled:opacity-50 ${on ? "bg-[#3B34E2] text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"}`}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${on ? "border-white/70 bg-white/20" : "border-zinc-300 dark:border-zinc-600"}`}>
                  {on && <IconCheck size={11} stroke={3} aria-hidden />}
                </span>
                <span className="truncate">{d.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 실행 버튼 — 상태별 전환. 하단 고정. */}
      <div className="flex shrink-0 justify-end gap-2">
        {loading ? (
          <button type="button" onClick={cancel} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-600">
            <IconX size={15} stroke={2.5} aria-hidden />
            {t("mem.assignStop")}
          </button>
        ) : groups.length > 0 ? (
          <>
            <button type="button" onClick={() => { void delegate(); }} disabled={pickedCount === 0 || pickedDecks.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-lime-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-lime-600 disabled:cursor-not-allowed disabled:opacity-40">
              <IconSparkles size={14} stroke={2} aria-hidden />
              {t("mem.assignReclassify")}
            </button>
            <button type="button" onClick={() => { void applyChecked(); }} disabled={!canApply}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40">
              <IconCheck size={15} stroke={2.5} aria-hidden />
              {t("mem.assignApply")}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => { void delegate(); }} disabled={pickedCount === 0 || pickedDecks.size === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-lime-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-lime-600 disabled:cursor-not-allowed disabled:opacity-40">
            <IconSparkles size={15} stroke={2} aria-hidden />
            {t("mem.assignDelegate")}
            <span className="font-normal text-white/70">{pickedCount}·{pickedDecks.size}</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={embedded
      ? "absolute inset-0 flex overflow-hidden bg-white dark:bg-[#0b0c10]"
      : "absolute inset-0 z-10 flex bg-black/50 backdrop-blur-sm"}>
      {/* 좌: 본문(후보 그리드 ↔ 배정 결과). 옵션은 우측 컬럼. */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-zinc-200 bg-zinc-50/95 dark:border-zinc-800 dark:bg-[#0b0c10]/95">
        {/* 본문 — 결과 있으면 덱별 배정, 생각 중(첫 제안)엔 안내, 아니면 후보 카드 그리드 */}
        <div className="nunopi-scroll flex-1 overflow-y-auto p-5">
          {/* 배정 안 된 카드 안내 — 어울리는 덱 없던 카드들은 새 덱으로 유도 */}
          {sentCards.length > 0 && leftover.length > 0 && !loading && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <IconSparkles size={16} stroke={2} className="shrink-0 text-amber-500" aria-hidden />
              <span className="min-w-0 flex-1 text-xs leading-snug text-amber-800 dark:text-amber-200">
                {t("mem.assignLeftoverMsg").replace("{n}", String(leftover.length))}
              </span>
              {onSwitchToCreate && (
                <button
                  type="button"
                  onClick={() => onSwitchToCreate(buildNewDeckPrompt(leftover))}
                  className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
                >
                  {t("mem.assignLeftoverToCreate")}
                </button>
              )}
            </div>
          )}
          {groups.length > 0 ? (
            <div className={`flex flex-col gap-5 ${loading ? "opacity-50" : ""}`}>
              {groups.map((g, gi) => {
                const offset = groupOffsets[gi];
                return (
                  <section key={g.deckId} className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2">
                      <button type="button" role="checkbox" aria-checked={g.checked} onClick={() => toggleGroup(g.deckId)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${g.checked ? "border-[#3B34E2] bg-[#3B34E2] text-white" : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"}`}>
                        {g.checked && <IconCheck size={13} stroke={3} aria-hidden />}
                      </button>
                      <span className="min-w-0 flex-1 truncate px-1.5 py-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{g.deckName}</span>
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">+{includedCount(g)}</span>
                    </div>
                    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(8.5rem, 1fr))" }}>
                      {g.cards.map((c, i) => {
                        if (offset + i >= reveal) return null;
                        const ex = g.excluded.has(c.key);
                        return <MiniTile key={c.key} card={c} dimmed={ex} check={!ex} onToggle={() => toggleExclude(g.deckId, c.key)} throwCard={throwCard} t={t} />;
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <IconSparkles size={28} stroke={1.6} className={`text-lime-500 ${reduced ? "" : "animate-pulse"}`} aria-hidden />
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{t("mem.assignSorting")}</p>
              <div className="nunopi-indeterminate h-1.5 w-full max-w-xs rounded-full bg-zinc-200 dark:bg-zinc-800">
                <span className="bg-lime-500" />
              </div>
              {thinking && (
                <p className="max-h-28 max-w-md overflow-hidden whitespace-pre-wrap text-[11px] italic leading-snug text-zinc-400 dark:text-zinc-500">
                  {thinking.length > 400 ? `…${thinking.slice(-400)}` : thinking}
                </p>
              )}
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400 dark:text-zinc-600">{t("mem.assignNoCards")}</div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(8.5rem, 1fr))" }}>
              {candidates.map((c) => (
                <MiniTile key={c.key} card={c} dimmed={!pickedCards.has(c.key)} check={pickedCards.has(c.key)} onToggle={() => toggleCard(c.key)} throwCard={throwCard} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 우: (임베드) 옵션 패널 + 대화(보조) */}
      <div className="flex w-80 shrink-0 flex-col bg-white dark:bg-[var(--s-bar)]">
        <div className="relative flex h-14 shrink-0 items-center justify-center border-b border-zinc-200 px-4 dark:border-zinc-800">
          {headerRight ?? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              <IconSparkles size={15} stroke={2} className="text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden /> {t("mem.assignTitle")}
            </span>
          )}
          <button type="button" onClick={onBack} aria-label={t("mem.agentDeckReject")} className="absolute right-3 rounded-lg p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800">
            <IconX size={16} stroke={2} aria-hidden />
          </button>
        </div>
        {optionsPanel}
      </div>

      {/* 추가 완료 팝업 — 덱별 합계. 닫으면 모달 종료. */}
      {result && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/50 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-xl dark:border-zinc-800 dark:bg-[var(--s-bar)]">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-lime-500/15 text-lime-600 dark:text-lime-400">
              <IconCheck size={22} stroke={2.5} aria-hidden />
            </span>
            <h3 className="mt-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t("mem.assignDoneTitle")}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {t("mem.assignDoneMsg").replace("{decks}", String(result.decks)).replace("{n}", String(result.added))}
              {result.skipped > 0 && <> {t("mem.addSkippedMsg").replace("{n}", String(result.skipped))}</>}
            </p>
            <button type="button" onClick={() => { setResult(null); onApplied(); }}
              className="mt-4 w-full rounded-lg bg-[#3B34E2] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#322bc9]">
              {t("confirm.ok")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { collectCards, collectCardsByKeys } from "../../lib/srs/collect";
import { dueCards, orderCards, filterByCategory, type CardCategory } from "../../lib/srs/due";
import { applyGrade } from "../../lib/srs/schedule";
import { canGoToSource } from "../../lib/srs/cardSource";
import { updateCardState } from "../../lib/srs/store";
import { logReview } from "../../lib/srs/activityLog";
import type { Card, CardOrder, Deck, Grade, SrsSource } from "@mustard/core";
import { loadMemSession, saveMemSession, clearMemSession } from "../../lib/memSession";
import SessionDone from "./SessionDone";
import FlashCard from "./FlashCard";
import CardFan from "./CardFan";
import CardStageBar from "./CardStageBar";
import GradePiles from "./GradePiles";
import CardInfoPanel from "./CardInfoPanel";
import CardExplainPanel from "./CardExplainPanel";
import MemorizeChat from "./MemorizeChat";
import type { AgentProviderKind, ProviderSettings } from "../../lib/agent";

interface CardSessionProps {
  sources: SrsSource[];
  // due: 오늘 복습 대상만(에빙하우스) · all: 덱 전체 상시 복습.
  mode?: "due" | "all";
  // 암기 탭이 화면에 활성인지 — 비활성(다른 모드 보는 중)이면 키보드 무시.
  active?: boolean;
  deck: Deck;
  resume?: boolean; // true면 저장된 세션 이어하기, false/없으면 새로.
  order?: CardOrder; // 새 세션 카드 제시 순서(resume은 저장 순서 유지).
  categories?: CardCategory[]; // 포함할 분류(빈 배열=전체). resume은 무시.
  cardKeys?: string[]; // 커스텀 덱 — 있으면 sources 대신 이 key들로 세션 구성.
  customDeckId?: string; // 커스텀 덱 id — 세션 영속(이어하기) 키(custom:<id>)용.
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  sourceIds: Set<string>; // 현존하는 분석 히스토리 id들 — 출처 이동 버튼 노출 판별용.
  onGoToSource: (card: Card) => void; // 카드 출처로 이동(종류별 분기는 상위에서).
  onExit: () => void;
}

// toss 애니 시간(ms) — 채점 카드가 더미로 날아가는 시간.
const TOSS_MS = 320;

// toss 방향 — 각 채점 카드가 하단 중앙 3더미(좌:다시 · 중:애매 · 우:완벽)로 날아가는 transform.
const TOSS_TRANSFORM: Record<Grade, string> = {
  again: "translate(-160px, 420px) rotate(-14deg) scale(0.35)",
  hard: "translate(0px, 440px) rotate(4deg) scale(0.35)",
  good: "translate(160px, 420px) rotate(14deg) scale(0.35)",
};

// 플립 카드 세션 — 앞(용어)→3D 뒤집기→3단계 채점. "다시"는 세션 내 재복습 라운드.
// 채점 시 카드가 해당 더미로 toss되어 쌓인다.
export default function CardSession({ sources, mode = "due", active = true, deck, resume = false, order = "newest", categories = [], cardKeys, customDeckId, providerId, providerSettings, sourceIds, onGoToSource, onExit }: CardSessionProps) {
  const t = useT();
  const now = useMemo(() => new Date(), []);
  // 세션 영속 키 — 고정 덱은 deck, 커스텀은 custom:<id>(이어하기 지원).
  const deckKey = customDeckId ? `custom:${customDeckId}` : deck;
  // 마운트 시 초기 세션 구성 — resume이면 저장된 세션 복원(고정·커스텀 공통), 아니면 fresh.
  const init = useMemo(() => {
    // 이어하기 — roundKeys 복원용 byKey는 전체 출처 superset으로(커스텀은 sources가 비어 있으므로).
    const saved = resume ? loadMemSession(deckKey, mode) : null;
    if (saved && saved.roundKeys.length > 0) {
      const byKey = new Map(collectCards(["token", "concept", "term"], now).map((c) => [c.key, c]));
      const round = saved.roundKeys.map((k) => byKey.get(k)).filter((c): c is Card => !!c);
      if (round.length > 0) {
        // 이어하기 전 채점한 다시/애매 카드 복원 — 완료 화면 재복습 목록이 이번 세션 전체를 반영하게.
        const reviewed = new Map<string, { card: Card; grade: Grade }>();
        for (const k of saved.reviewedHard ?? []) { const c = byKey.get(k); if (c) reviewed.set(k, { card: c, grade: "hard" }); }
        for (const k of saved.reviewedAgain ?? []) { const c = byKey.get(k); if (c) reviewed.set(k, { card: c, grade: "again" }); }
        return { round, idx: Math.min(saved.idx, round.length - 1), stats: saved.stats, reviewed };
      }
    }
    // 새 세션 — 커스텀은 cardKeys, 고정은 sources. mode/order/category(상태) 모두 적용.
    const base0 = cardKeys ? collectCardsByKeys(cardKeys, now) : collectCards(sources, now);
    const base = mode === "all" ? base0 : dueCards(base0, now);
    const filtered = filterByCategory(base, new Set(categories));
    const queue = orderCards(filtered, order);
    return { round: queue, idx: 0, stats: { again: 0, hard: 0, good: 0 }, reviewed: new Map<string, { card: Card; grade: Grade }>() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 모션 최소화 설정 — 플립/toss 애니 생략.
  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const [round, setRound] = useState<Card[]>(init.round);
  const [idx, setIdx] = useState(init.idx);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState(init.stats);
  const [done, setDone] = useState(init.round.length === 0);
  // 완료 시 재복습 후보(다시/애매 카드) — done 전환 시 reviewedRef에서 계산해 저장(render서 ref 읽지 않게).
  const [retry, setRetry] = useState<{ again: Card[]; hard: Card[] }>({ again: [], hard: [] });
  // 이번(현재) 세션 카드 수 — 완료 제목용. 재복습 시작 시 그 부분집합 크기로 갱신.
  const [sessionTotal, setSessionTotal] = useState(init.round.length);
  const [tossing, setTossing] = useState<Grade | null>(null); // 진행 중 toss(연타 가드)
  // 이번 세션에서 채점한 카드의 최악 등급(완료 화면 재복습용). 재채점 시 갱신.
  // init.reviewed로 초기화 — 이어하기면 저장된 다시/애매 카드가 이미 들어있다(useRef는 첫 렌더값만 사용).
  const reviewedRef = useRef<Map<string, { card: Card; grade: Grade }>>(init.reviewed);
  // toss 타이머 — 언마운트 시 정리(dead 컴포넌트 setState 방지).
  const tossTimer = useRef<number | null>(null);
  useEffect(() => () => { if (tossTimer.current) window.clearTimeout(tossTimer.current); }, []);

  // 진행 상태 영속 — 완료면 삭제, 아니면 현재 라운드/위치/통계 저장(채점마다 갱신). deckKey(고정/커스텀 공통).
  useEffect(() => {
    if (done) {
      clearMemSession(deckKey, mode);
      return;
    }
    // 채점된 카드의 최악 등급도 저장 — 이어하기 후 완료 화면 재복습 목록이 세션 전체를 반영.
    const reviewed = [...reviewedRef.current.values()];
    saveMemSession(deckKey, mode, {
      sources,
      roundKeys: round.map((c) => c.key),
      idx,
      stats,
      reviewedAgain: reviewed.filter((x) => x.grade === "again").map((x) => x.card.key),
      reviewedHard: reviewed.filter((x) => x.grade === "hard").map((x) => x.card.key),
      savedAt: now.toISOString(),
    });
  }, [done, round, idx, stats, deckKey, mode, sources, now]);

  const card = round[idx];

  // 실제 채점 — SRS 반영 + 라운드 전이(toss 애니 후 호출).
  const commitGrade = useCallback(
    (g: Grade) => {
      if (!card) return;
      updateCardState(card.key, applyGrade(card.state, g, now));
      logReview(now, g); // 날짜별 복습 카운트(등급별, 히트맵/스트릭용)
      // 세션 내 최악 등급 기록(재복습용) — 한 번이라도 '다시'면 다시로 유지(재복습 라운드에서 통과해도).
      // 순위 again>hard>good. "다시 4개 있는데 애매만 뜨는" 문제 방지(최신 등급이 덮어쓰지 않게).
      {
        const rank = { again: 2, hard: 1, good: 0 } as const;
        const prev = reviewedRef.current.get(card.key);
        const worst = !prev || rank[g] > rank[prev.grade] ? g : prev.grade;
        reviewedRef.current.set(card.key, { card, grade: worst });
      }
      setStats((s) => ({ ...s, [g]: s[g] + 1 }));
      const nextIdx = idx + 1;
      if (nextIdx < round.length) {
        // 자동 재복습 라운드 없음 — '다시'여도 그냥 다음 카드로. 재복습은 완료 화면에서 유저가 선택.
        setIdx(nextIdx);
      } else {
        // 한 바퀴 끝 → 완료 화면. 다시/애매 카드는 체크박스로 골라 재복습(applyGrade는 이미 재예약됨).
        const r = [...reviewedRef.current.values()];
        setRetry({
          again: r.filter((x) => x.grade === "again").map((x) => x.card),
          hard: r.filter((x) => x.grade === "hard").map((x) => x.card),
        });
        setDone(true);
      }
      setFlipped(false);
      setTossing(null);
    },
    [card, idx, round.length, now],
  );

  // 채점 트리거 — toss 애니 재생 후 commit. reduced면 즉시.
  const grade = useCallback(
    (g: Grade) => {
      if (!flipped || tossing) return; // 뒤집힌 뒤에만, 진행 중 연타 무시
      if (reduced) {
        commitGrade(g);
        return;
      }
      setTossing(g);
      tossTimer.current = window.setTimeout(() => commitGrade(g), TOSS_MS);
    },
    [flipped, tossing, reduced, commitGrade],
  );

  // 키보드 — 스페이스=뒤집기, 1/2/3=채점.
  useEffect(() => {
    if (done || !active) return; // 비활성 뷰(다른 모드 보는 중)면 키 무시
    function onKey(e: KeyboardEvent) {
      // 챗 입력 등 폼 요소에 포커스 중이면 단축키 무시(스페이스 띄어쓰기가 카드 뒤집기 안 되게).
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!tossing) setFlipped((v) => !v);
        return;
      }
      if (e.key === "1") grade("again");
      else if (e.key === "2") grade("hard");
      else if (e.key === "3") grade("good");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, active, flipped, tossing, grade]);

  // 선택한 카드로 세션 재시작(완료 화면 "다시 한번" — 헷갈린 카드 재복습).
  function restart(cards: Card[]) {
    if (cards.length === 0) return;
    reviewedRef.current = new Map();
    setRetry({ again: [], hard: [] });
    setSessionTotal(cards.length);
    setRound(cards);
    setIdx(0);
    setStats({ again: 0, hard: 0, good: 0 });
    setFlipped(false);
    setTossing(null);
    setDone(false);
  }

  if (done) {
    return (
      <SessionDone
        stats={stats}
        total={sessionTotal}
        againCards={retry.again}
        hardCards={retry.hard}
        onRetry={restart}
        onExit={onExit}
      />
    );
  }

  // 채점으로 카드가 소진된 만큼만 진행(뒤집기는 진행과 무관).
  const progress = round.length > 0 ? (idx / round.length) * 100 : 0;

  // 출처로 이동 가능 여부 — 종류별(analysis: 히스토리 존재 / card: originCardKey 존재).
  const showSource = canGoToSource(card, sourceIds);

  const gradeBar = flipped ? (
    <div className="grid grid-cols-3 gap-3">
      <GradeButton onClick={() => grade("again")} label={t("mem.again")} keyHint="1" tone="rose" disabled={!!tossing} />
      <GradeButton onClick={() => grade("hard")} label={t("mem.hard")} keyHint="2" tone="amber" disabled={!!tossing} />
      <GradeButton onClick={() => grade("good")} label={t("mem.good")} keyHint="3" tone="emerald" disabled={!!tossing} />
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setFlipped(true)}
      className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {t("mem.flip")}
    </button>
  );

  return (
    <>
    {active && <MemorizeChat card={card} providerId={providerId} providerSettings={providerSettings} />}
    <div className="flex h-full w-full flex-col gap-4 px-8 py-5">
      {/* 진행률 + 덱 선택으로 돌아가기 — 스테이지는 전폭이지만 이 바는 예전 비율(중앙 max-w). */}
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <button
          type="button"
          onClick={onExit}
          aria-label={t("mem.backToDecks")}
          title={t("mem.backToDecks")}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <IconArrowLeft size={15} stroke={2} aria-hidden />
          {t("mem.backToDecks")}
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundImage: "linear-gradient(90deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)" }} />
        </div>
        <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
          {idx + 1}/{round.length}
        </span>
      </div>

      {/* 스테이지 — 부채꼴(배경) 위에 카드(중앙) + 더미(우측) + 정보(우상단). */}
      <div className="relative flex flex-1 items-center justify-center">
        {/* 남은 카드 부채꼴 — 카드 뒤 배경 */}
        <CardFan remaining={round.length - idx - 1} />

        {/* 현재 카드 정보 + 암기 단계 — 우상단 세로 스택(넓은 화면만) */}
        <div className="absolute right-0 top-0 z-10 hidden w-56 flex-col gap-2 xl:flex">
          <CardInfoPanel card={card} />
          <CardStageBar card={card} />
        </div>

        {/* 카드 디폴트 설명 — 좌상단(넓은 화면만), 반투명으로 뒤 부채꼴 비침 */}
        <div className="absolute left-0 top-0 z-10 hidden xl:block">
          <CardExplainPanel card={card} providerId={providerId} providerSettings={providerSettings} flipped={flipped} />
        </div>

        {/* 중앙 카드 + 채점바(카드 폭 그대로). 더미만 넓게 벌린다. */}
        <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-5">
          <div
            className={`w-full ${reduced ? "" : "transition-all"}`}
            style={
              tossing && !reduced
                ? { transform: TOSS_TRANSFORM[tossing], opacity: 0, transitionDuration: `${TOSS_MS}ms` }
                : undefined
            }
          >
            <FlashCard front={card.front} back={card.back} source={card.source} eco={card.eco} flipped={flipped} onFlip={() => setFlipped((v) => !v)} reduced={reduced} />
          </div>
          {/* 출처로 이동 — 이 카드를 담은 분석 히스토리로 화면 전환(존재할 때만). */}
          {showSource && (
            <button
              type="button"
              onClick={() => onGoToSource(card)}
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {t("mem.goToSource")}
              <IconExternalLink size={13} stroke={2} aria-hidden />
            </button>
          )}
          {/* 채점(다시/애매/완벽)은 아래 더미와 같은 폭으로 정렬, 뒤집기 버튼은 카드 폭 유지. */}
          <div className={flipped ? "w-[32rem] max-w-[90vw]" : "w-full"}>{gradeBar}</div>
          {/* 3분류 더미 — 채점 버튼과 같은 폭·3열로 정렬(각 더미가 해당 버튼 아래). */}
          <div className="mt-4 w-[32rem] max-w-[90vw]">
            <GradePiles stats={stats} landing={tossing} row />
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

const TONES: Record<string, string> = {
  rose: "bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50",
  amber: "bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-950/50",
  emerald: "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50",
};

function GradeButton({ onClick, label, keyHint, tone, disabled }: { onClick: () => void; label: string; keyHint: string; tone: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`mx-auto flex w-36 flex-col items-center gap-0.5 rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-50 ${TONES[tone]}`}
    >
      {label}
      <span className="text-[10px] opacity-60">{keyHint}</span>
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { IconCode, IconMessage2, IconMessageQuestion, IconListCheck, IconCards, IconBrain, IconLoader2, IconChevronLeft, IconChevronRight, IconCalendar, IconFlame, type IconProps } from "@tabler/icons-react";
import { useLocale, useT } from "@mustard/core";
import { collectHistory } from "../../lib/history/collect";
import { dayKey } from "../../lib/srs/activityLog";
import { summary } from "../../lib/srs/stats";
import { CARDS_CHANGED_EVENT } from "@mustard/core";
import { CARD_CHAT_CHANGED_EVENT } from "../../lib/cardChat";
import type { HistoryEventType, HistoryNav, UnifiedHistoryEvent } from "../../lib/history/types";
const LOCALE_TAG: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };

// 유형별 아이콘 · 색(cls) · 밴드 틴트(tint, 카드 상단 그라데이션 시작색).
// 계열 겹침 방지 — 인디고/스카이/에메랄드/푸시아/앰버/로즈.
const TYPE_META: Record<HistoryEventType, { Icon: React.ComponentType<IconProps>; cls: string; tint: string }> = {
  analysis: { Icon: IconCode, cls: "text-[#3B34E2] dark:text-[#8b86f5]", tint: "from-[#3B34E2]/15" },
  chat: { Icon: IconMessage2, cls: "text-sky-500", tint: "from-sky-500/15" },
  ask: { Icon: IconMessageQuestion, cls: "text-emerald-500", tint: "from-emerald-500/15" },
  quiz: { Icon: IconListCheck, cls: "text-fuchsia-500", tint: "from-fuchsia-500/15" },
  bookmark: { Icon: IconCards, cls: "text-amber-500", tint: "from-amber-500/15" },
  review: { Icon: IconBrain, cls: "text-rose-500", tint: "from-rose-500/15" },
};

const ALL_TYPES: HistoryEventType[] = ["analysis", "chat", "ask", "quiz", "bookmark", "review"];

// 전역 히스토리 좌 패널 — 유튜브 재생목록式 2단계:
//  ① 그리드: 유형 = 재생목록 카드(컬러 밴드 + 워터마크 아이콘 + 개수 + 최근 항목). 클릭 → ②.
//  ② 리스트: 그 유형만 날짜별로. 뒤로가기로 그리드 복귀.
export default function HistoryTimeline({ onNavigate }: { onNavigate?: (nav: HistoryNav) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const tag = LOCALE_TAG[locale] ?? "en-US";
  const [events, setEvents] = useState<UnifiedHistoryEvent[] | null>(null);
  // 열린 재생목록(유형). null이면 그리드.
  const [openType, setOpenType] = useState<HistoryEventType | null>(null);
  // 현재 시각 — 요약의 날짜·시간 표시 + "이번 주" 기준. 지연 초기화(순수성) + 분 단위 갱신.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // 언마운트 후 setState 방지 가드(collectHistory 비동기 완료가 언마운트 뒤일 수 있음).
    let alive = true;
    const reload = () => { void collectHistory(locale).then((ev) => { if (alive) setEvents(ev); }); };
    reload();
    window.addEventListener(CARDS_CHANGED_EVENT, reload);
    window.addEventListener(CARD_CHAT_CHANGED_EVENT, reload);
    window.addEventListener("focus", reload);
    return () => {
      alive = false;
      window.removeEventListener(CARDS_CHANGED_EVENT, reload);
      window.removeEventListener(CARD_CHAT_CHANGED_EVENT, reload);
      window.removeEventListener("focus", reload);
    };
  }, [locale]);

  if (events === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-zinc-400 dark:text-zinc-500">
        <IconLoader2 size={20} stroke={2} className="animate-spin" aria-hidden />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <p className="text-[13px] text-zinc-400 dark:text-zinc-500">{t("home.empty")}</p>
      </div>
    );
  }

  const dayLabel = (k: string) => {
    if (k === "?") return "?";
    const d = new Date(k + "T00:00:00");
    return d.toLocaleDateString(tag, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  };
  const timeLabel = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  };
  // 이벤트들을 날짜별 그룹으로(이미 desc 정렬 → 최신 날짜부터).
  const groupByDay = (list: UnifiedHistoryEvent[]) => {
    const groups: { day: string; items: UnifiedHistoryEvent[] }[] = [];
    for (const e of list) {
      const d = new Date(e.createdAt);
      const k = Number.isNaN(d.getTime()) ? "?" : dayKey(d);
      const last = groups[groups.length - 1];
      if (last && last.day === k) last.items.push(e);
      else groups.push({ day: k, items: [e] });
    }
    return groups;
  };

  // ── ② 유형 리스트(재생목록 열림) ──────────────────────────────
  if (openType) {
    const { Icon, cls } = TYPE_META[openType];
    const items = events.filter((e) => e.type === openType);
    const groups = groupByDay(items);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* 재생목록 헤더 — 뒤로가기 + 유형 아이콘·이름·개수 */}
        <button
          type="button"
          onClick={() => setOpenType(null)}
          className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 text-left transition hover:bg-zinc-100/60 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
        >
          <IconChevronLeft size={16} stroke={2} className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
          <Icon size={16} stroke={2} className={`shrink-0 ${cls}`} aria-hidden />
          <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t(`home.evt.${openType}`)}</span>
          <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{items.length}</span>
        </button>
        <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
          {groups.map((g) => (
            <div key={g.day} className="mb-3">
              <div className="sticky -top-3 z-10 -mx-3 bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-500 dark:bg-[var(--ink2)] dark:text-zinc-400">
                {dayLabel(g.day)}
              </div>
              <div className="flex flex-col gap-1">
                {g.items.map((e) => (
                  <EventRow key={e.id} e={e} cls={cls} Icon={Icon} timeLabel={timeLabel} onNavigate={onNavigate} t={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── ① 재생목록 그리드 ────────────────────────────────────────
  const counts = events.reduce<Partial<Record<HistoryEventType, number>>>((m, e) => { m[e.type] = (m[e.type] ?? 0) + 1; return m; }, {});
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = events.filter((e) => { const ms = new Date(e.createdAt).getTime(); return !Number.isNaN(ms) && ms >= weekAgo; }).length;
  // 연속 학습일(streak) — 활동한 날짜 집합에서 오늘(또는 어제)부터 하루씩 뒤로 연속인 날 수.
  const daySet = new Set<string>();
  for (const e of events) { const d = new Date(e.createdAt); if (!Number.isNaN(d.getTime())) daySet.add(dayKey(d)); }
  let streak = 0;
  const cursor = new Date(now);
  if (!daySet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1); // 오늘 아직 활동 없어도 어제까지 연속 유지
  while (daySet.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  // 복습 대기(due) — SRS 전체 덱 기준.
  const due = summary("all", now).due;
  // 이력에 있는 유형만 재생목록으로. 각 유형 최근 항목(desc라 첫 매치).
  const present = ALL_TYPES.filter((ty) => (counts[ty] ?? 0) > 0);
  const latestByType = (ty: HistoryEventType) => events.find((e) => e.type === ty);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 요약 스트립 — 오늘 날짜·시간 + 총 기록/활동일/이번 주. */}
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-3 pb-2.5 pt-3 dark:border-zinc-800">
        {/* 오늘 날짜 · 현재 시각(분 단위 갱신) — 크게 강조 */}
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          <IconCalendar size={16} stroke={2} className="text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
          <span>{now.toLocaleDateString(tag, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</span>
          <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{now.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
        {/* 통계: 🔥연속 학습일 · 이번 주 활동 · 복습 대기(클릭 시 암기모드). */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <IconFlame size={20} stroke={2} className="text-orange-500" aria-hidden />
            <span className="text-2xl font-bold leading-none tabular-nums text-zinc-800 dark:text-zinc-100">{streak}</span>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("home.summaryStreak")}</span>
          </div>
          <span className="h-6 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">{thisWeek}</span>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("home.summaryWeek")}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.({ mode: "memorize" })}
            disabled={!onNavigate}
            className="flex items-baseline gap-1.5 rounded-md px-1 transition enabled:hover:bg-zinc-100 disabled:cursor-default dark:enabled:hover:bg-zinc-800"
          >
            <span className={`text-sm font-semibold tabular-nums ${due > 0 ? "text-rose-500" : "text-zinc-600 dark:text-zinc-300"}`}>{due}</span>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("home.summaryDue")}</span>
          </button>
        </div>
      </div>
      {/* 유형 재생목록 — 1열 로우, 갭 없이 딱 붙여 꽉 채움(얇은 구분선). 풀블리드 틴트 + 텍스트 오버레이. */}
      <div className="nunopi-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        {present.map((ty) => {
          const { Icon, cls, tint } = TYPE_META[ty];
          const latest = latestByType(ty);
          return (
            <button
              key={ty}
              type="button"
              onClick={() => setOpenType(ty)}
              className={`group relative flex min-h-[76px] flex-1 items-center gap-3 overflow-hidden border-b border-black/5 bg-gradient-to-r px-4 text-left transition last:border-b-0 hover:brightness-105 dark:border-white/5 ${tint} to-transparent`}
            >
              {/* 워터마크 — 큰 아이콘이 우측서 잘려 은은하게(로우 전체 틴트 위 장식). */}
              <Icon size={104} stroke={1.5} className={`pointer-events-none absolute -bottom-5 right-4 opacity-15 transition group-hover:scale-105 ${cls}`} aria-hidden />
              {/* 좌 아이콘 액센트 */}
              <Icon size={30} stroke={2} className={`relative shrink-0 ${cls}`} aria-hidden />
              {/* 텍스트 오버레이 — 유형명 + 개수 칩 / 최근 항목. */}
              <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t(`home.evt.${ty}`)}</span>
                  <span className="shrink-0 rounded-md bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-600 dark:bg-white/10 dark:text-zinc-300">{counts[ty] ?? 0}</span>
                </div>
                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{latest?.title ?? ""}</p>
              </div>
              <IconChevronRight size={16} stroke={2} className="relative shrink-0 text-zinc-400 transition group-hover:text-[#3B34E2] dark:text-zinc-500 dark:group-hover:text-[#8b86f5]" aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 이벤트 한 줄 — 유형 리스트(드릴다운)에서 사용. 클릭 시 그 지점으로 이동.
function EventRow({ e, cls, Icon, timeLabel, onNavigate, t }: {
  e: UnifiedHistoryEvent;
  cls: string;
  Icon: React.ComponentType<IconProps>;
  timeLabel: (iso: string) => string;
  onNavigate?: (nav: HistoryNav) => void;
  t: (key: string) => string;
}) {
  const clickable = !!(e.nav && onNavigate);
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => { if (e.nav) onNavigate?.(e.nav); }}
      className={`flex w-full items-start gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left transition dark:border-zinc-800 dark:bg-zinc-900 ${clickable ? "cursor-pointer hover:border-[#3B34E2] dark:hover:border-[#8b86f5]" : "cursor-default"}`}
    >
      <Icon size={15} stroke={2} className={`mt-0.5 shrink-0 ${cls}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`shrink-0 text-[10px] font-semibold uppercase ${cls}`}>{t(`home.evt.${e.type}`)}</span>
          {e.type !== "review" && <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">{timeLabel(e.createdAt)}</span>}
        </div>
        <p className="truncate text-[13px] text-zinc-700 dark:text-zinc-200">{e.title}</p>
        {e.description && <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{e.description}</p>}
      </div>
    </button>
  );
}

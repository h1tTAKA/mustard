"use client";
// 캐치업 달력 팝오버(#996, 에픽 #991-C) — 기록 있는 날(•)만 고를 수 있는 월 달력. 오늘은 링(◉).
// 날짜 키는 서버 catchupStore.dayKey와 같은 로컬 "YYYY-MM-DD". 주 시작 일요일, 월·요일 이름은 Intl(locale).
import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useT } from "@mustard/core";

const pad = (n: number) => String(n).padStart(2, "0");
export const localDayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 월 그리드 — 앞쪽 빈칸(그 달 1일의 요일 수) + 1..말일. 순수 계산(테스트 용이).
export function monthCells(year: number, month: number): (number | null)[] {
  const lead = new Date(year, month, 1).getDay();       // 0=일
  const last = new Date(year, month + 1, 0).getDate();  // 말일(윤년 자동)
  return [...Array<null>(lead).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)];
}

export default function CatchupCalendar({ days, selected, locale, onPick, onClose }: {
  days: Set<string>;            // 기록 있는 날 "YYYY-MM-DD"
  selected: string | null;      // 보고 있는 지난 날(null=오늘)
  locale: string;
  onPick: (day: string | null) => void; // null = 오늘로
  onClose: () => void;
}) {
  const t = useT();
  const today = localDayKey(new Date());
  const init = selected ? new Date(`${selected}T00:00:00`) : new Date();
  const [ym, setYm] = useState({ y: init.getFullYear(), m: init.getMonth() });
  const ref = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc로 닫기.
  useEffect(() => {
    // 토글 버튼(data-cal-toggle)은 바깥 클릭으로 안 침 — 안 그러면 닫힘 직후 버튼 클릭이 다시 열어버림.
    const down = (e: MouseEvent) => { const el = e.target as Element; if (ref.current && !ref.current.contains(el) && !el.closest?.("[data-cal-toggle]")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);

  const title = useMemo(() => { try { return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(new Date(ym.y, ym.m, 1)); } catch { return `${ym.y}-${pad(ym.m + 1)}`; } }, [ym, locale]);
  // 요일 머리글 — 2023-01-01(일)부터 7일을 locale narrow로.
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => { try { return new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2023, 0, 1 + i)); } catch { return "SMTWTFS"[i]; } }), [locale]);
  const cells = monthCells(ym.y, ym.m);
  const move = (dm: number) => setYm(({ y, m }) => { const d = new Date(y, m + dm, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  // #1078 캘린더 버튼이 제목 옆(왼쪽)으로 와서 팝업도 왼쪽 정렬
  return (
    <div ref={ref} role="dialog" aria-label={t("learn.calendar")}
      className="absolute left-2 top-full z-30 mt-1 w-60 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1.5 flex items-center gap-1">
        <button type="button" onClick={() => move(-1)} aria-label={t("learn.prevMonth")} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"><IconChevronLeft size={14} stroke={2} aria-hidden /></button>
        <span className="flex-1 text-center text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{title}</span>
        <button type="button" onClick={() => move(1)} aria-label={t("learn.nextMonth")} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"><IconChevronRight size={14} stroke={2} aria-hidden /></button>
        <button type="button" onClick={() => onPick(null)} className="ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-mustard-700 hover:bg-mustard-500/10 dark:text-mustard-400">{t("learn.today")}</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((w, i) => <span key={i} className="py-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">{w}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const key = `${ym.y}-${pad(ym.m + 1)}-${pad(d)}`;
          const has = days.has(key) || key === today;               // 오늘은 기록 없어도 선택 가능(=오늘로)
          const sel = selected ? key === selected : key === today;
          return (
            <button key={key} type="button" disabled={!has} onClick={() => onPick(key === today ? null : key)}
              className={`relative flex h-7 flex-col items-center justify-center rounded-md text-[11px] transition ${
                sel ? "bg-mustard-500 font-semibold text-white" : has ? "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800" : "cursor-default text-zinc-300 dark:text-zinc-600"
              } ${key === today && !sel ? "ring-1 ring-mustard-500" : ""}`}>
              {d}
              {days.has(key) && <span className={`absolute bottom-0.5 h-1 w-1 rounded-full ${sel ? "bg-white" : "bg-mustard-500"}`} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";
// 설정 공용 조작 — 한 단계씩 − 값 + (스크롤 속도 #1212와 같은 모양), 알약형 단일 선택(스크롤백 프리셋과 같은 모양).
import type { ReactNode } from "react";
import { IconMinus, IconPlus } from "@tabler/icons-react";

export function Stepper({ value, min, max, step, label, format, onChange }: { value: number; min: number; max: number; step: number; label: string; format: (v: number) => string; onChange: (v: number) => void }) {
  // 저장값을 먼저 단계에 맞춘 뒤 한 단계(#1212 리뷰), 소수 단계 오차는 반올림으로 정리
  const go = (d: number) => onChange(Number(Math.min(max, Math.max(min, Math.round(value / step) * step + d * step)).toFixed(4)));
  const btn = "grid size-7 place-items-center rounded-md text-zinc-600 transition hover:bg-white aria-disabled:opacity-30 aria-disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-700";
  return (
    <span className="flex shrink-0 items-center rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label={label}>
      <button type="button" onClick={() => go(-1)} aria-disabled={value <= min} aria-label={`${label} −`} className={btn}><IconMinus size={14} stroke={2} aria-hidden /></button>
      <span className="w-14 text-center font-mono text-xs tabular-nums text-zinc-800 dark:text-zinc-100" aria-live="polite">{format(value)}</span>
      <button type="button" onClick={() => go(1)} aria-disabled={value >= max} aria-label={`${label} +`} className={btn}><IconPlus size={14} stroke={2} aria-hidden /></button>
    </span>
  );
}

export function Segmented<T extends string>({ options, value, label, render, onChange }: { options: readonly T[]; value: T; label: string; render: (o: T) => ReactNode; onChange: (o: T) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === o ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>{render(o)}</button>
      ))}
    </div>
  );
}

// 이름·설명 왼쪽, 조작 오른쪽 한 줄
export function SettingRow({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="min-w-0"><span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</span>{desc && <span className="block text-xs text-zinc-400 dark:text-zinc-500">{desc}</span>}</span>
      {children}
    </div>
  );
}

"use client";
// 이슈·PR 사이드바 한 줄(#1131, GitHub처럼) — "제목:" + 칩(× 빼기) + [+](후보에서 고르기). 리뷰어·담당자·라벨·마일스톤 공용.
// 담당자 줄 원래 모양(칩·글자 크기) 그대로, 라벨 칩은 이슈 목록의 색 점 칩과 같은 모양.
// onChange가 실제 반영을 맡음 — 상세는 gh edit, 작성 폼은 화면 상태만(만들 때 한 번에).
import { useCallback, useEffect, useRef, useState } from "react";
import { IconPlus, IconX, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import GhAvatar from "@/components/workspace/github/GhAvatar";

export type MetaItem = { value: string; color?: string; readonly?: boolean };
type Result = { ok: boolean; detail?: string };

// 작성 폼용(#1131) — 고른 항목을 화면 상태로만 들고 있다가 만들 때 한 번에. 라벨 색은 후보에서 기억.
export function useMetaDraft() {
  const [items, setItems] = useState<MetaItem[]>([]);
  const colors = useRef(new Map<string, string>());
  const onChange = useCallback((add: string[], remove: string[]) => {
    setItems((xs) => [...xs.filter((x) => !remove.includes(x.value)), ...add.map((v) => ({ value: v, color: colors.current.get(v) }))]);
    return { ok: true };
  }, []);
  const onCandidates = useCallback((cs: { value: string; color?: string }[]) => { for (const c of cs) if (c.color) colors.current.set(c.value, c.color); }, []);
  return { items, onChange, onCandidates, values: items.map((x) => x.value) };
}

export default function MetaRow({ root, field, title, items, empty, exclude = [], single = false, onChange, onCandidates }: {
  root: string; field: GhMetaField; title: string; items: MetaItem[]; empty: string; exclude?: string[]; single?: boolean;
  onChange: (add: string[], remove: string[]) => Promise<Result> | Result;
  onCandidates?: (cands: { value: string; color?: string }[]) => void; // 작성 폼이 라벨 색을 기억하게
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<{ value: string; color?: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const onCandidatesRef = useRef(onCandidates);
  useEffect(() => { onCandidatesRef.current = onCandidates; }, [onCandidates]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // 열 때 후보 조회(실패는 오류로 — "고를 게 없음"과 구분), 밖 클릭·Esc로 닫기
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void window.nunopiDesktop?.github?.metaCandidates?.(root, field)
      .then((r) => { if (!alive) return; if (r.ok && r.data) { setCands(r.data); onCandidatesRef.current?.(r.data); } else { setCands([]); setErr(r.detail || t("github.error")); } })
      .catch((e) => { if (alive) { setCands([]); setErr(String((e as Error)?.message || e)); } });
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", down); window.addEventListener("keydown", key);
    return () => { alive = false; window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [open, root, field, t]);

  const change = async (add: string[], remove: string[], tag: string) => {
    if (busy) return;
    setBusy(tag); setErr(null);
    const r = await Promise.resolve(onChange(add, remove)).catch((e) => ({ ok: false, detail: String((e as Error)?.message || e) }));
    if (!mounted.current) return;
    setBusy(null);
    if (r.ok) setOpen(false); else setErr(r.detail || t("github.error"));
  };
  const have = new Set(items.map((i) => i.value));
  const pick = (cands ?? []).filter((c) => !have.has(c.value) && !exclude.includes(c.value));
  const chip = "inline-flex items-center gap-0.5 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  const dot = (color?: string) => color ? <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `#${color}` }} aria-hidden /> : null;

  return (
    // 줄 전체가 기준(relative) — 목록을 줄 폭에 맞춰 바로 아래에 펼쳐 좁은 패널에서 오른쪽이 안 잘리게(유저)
    <div ref={box} className="relative mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-zinc-400 dark:text-zinc-500">{title}:</span>
      {items.map((i) => (
        <span key={i.value} className={chip} style={i.color ? { backgroundColor: `#${i.color}22` } : undefined}>
          {dot(i.color)}{i.value}
          {!i.readonly && (
            <button type="button" onClick={() => void change([], [i.value], i.value)} disabled={!!busy} title={t("github.removeItem")} aria-label={`${t("github.removeItem")} ${i.value}`}
              className="text-zinc-400 transition hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-200">
              {busy === i.value ? <IconLoader2 size={10} className="animate-spin" aria-hidden /> : <IconX size={10} stroke={2} aria-hidden />}
            </button>
          )}
        </span>
      ))}
      {!items.length && <span className="text-zinc-400 dark:text-zinc-500">{empty}</span>}
      <div className="inline-flex">
        <button type="button" onClick={() => { setErr(null); setCands(null); setOpen((v) => !v); }} title={t("github.addTo", { name: title })} aria-label={t("github.addTo", { name: title })} aria-expanded={open}
          className="shrink-0 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200">
          <IconPlus size={12} stroke={2} aria-hidden />
        </button>
        {open && (
          <div className="absolute inset-x-0 top-full z-30 mt-1 max-w-72 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <p className="mb-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{t("github.addTo", { name: title })}</p>
            {cands === null ? (
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-zinc-400"><IconLoader2 size={12} className="animate-spin" aria-hidden />…</div>
            ) : err ? null : pick.length ? (
              <div className="max-h-56 overflow-y-auto">
                {pick.map((c) => (
                  <button key={c.value} type="button" onClick={() => void change([c.value], single ? items.map((i) => i.value) : [], c.value)} disabled={!!busy}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11.5px] text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    {busy === c.value ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : field === "reviewer" || field === "assignee" ? <GhAvatar login={c.value} size={14} /> : dot(c.color)}<span className="truncate">{c.value}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 py-1 text-[11px] text-zinc-400 dark:text-zinc-500">{field === "reviewer" ? t("github.noReviewerCandidates") : t("github.noCandidates")}</p>
            )}
          </div>
        )}
      </div>
      {err && <p className="w-full break-words text-[10px] text-rose-500">{err}</p>}
    </div>
  );
}

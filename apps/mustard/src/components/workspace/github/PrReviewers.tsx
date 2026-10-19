"use client";
// 리뷰어 지정(#1131) — 담당자 줄과 같은 모양: "Reviewers:" + 요청된 사람 칩(× 요청 취소) + [+](후보 목록에서 추가).
// 후보 = 이 레포에 배정 가능한 사람 − PR 작성자(GitHub가 막음) − 이미 요청된 사람. 팀 요청은 이름만 표시(제거는 GitHub에서).
import { useEffect, useRef, useState } from "react";
import { IconPlus, IconX, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";

export default function PrReviewers({ root, number, author, requested, onChanged }: { root: string; number: number; author?: string; requested: { login?: string; name?: string; slug?: string }[]; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // 열 때 후보 조회, 밖 클릭·Esc로 닫기
  useEffect(() => {
    if (!open) return;
    let alive = true;
    // 조회 실패는 "지정할 사람 없음"이 아니라 오류로(리뷰)
    void window.nunopiDesktop?.github?.prReviewerCandidates?.(root).then((r) => { if (!alive) return; if (r.ok && r.data) setCands(r.data); else { setCands([]); setErr(r.detail || t("github.error")); } }).catch((e) => { if (alive) { setCands([]); setErr(String((e as Error)?.message || e)); } });
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", down); window.addEventListener("keydown", key);
    return () => { alive = false; window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [open, root, t]);

  const users = requested.map((r) => r.login).filter((l): l is string => !!l);
  const teams = requested.filter((r) => !r.login).map((r) => r.name || r.slug || "").filter(Boolean);
  const change = async (add: string[], remove: string[], tag: string) => {
    if (busy) return;
    setBusy(tag); setErr(null);
    const r = await window.nunopiDesktop?.github?.prReviewers?.(root, number, add, remove).catch((e) => ({ ok: false, detail: String((e as Error)?.message || e) }));
    if (!mounted.current) return;
    setBusy(null);
    if (r?.ok) { setOpen(false); onChanged(); } else setErr(r?.detail || t("github.error"));
  };
  const pick = (cands ?? []).filter((l) => l !== author && !users.includes(l));
  const chip = "inline-flex items-center gap-0.5 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-zinc-400 dark:text-zinc-500">{t("github.reviewers")}:</span>
      {users.map((l) => (
        <span key={l} className={chip}>
          {l}
          <button type="button" onClick={() => void change([], [l], l)} disabled={!!busy} title={t("github.removeReviewer")} aria-label={`${t("github.removeReviewer")} ${l}`}
            className="text-zinc-400 transition hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-200">
            {busy === l ? <IconLoader2 size={10} className="animate-spin" aria-hidden /> : <IconX size={10} stroke={2} aria-hidden />}
          </button>
        </span>
      ))}
      {teams.map((n) => <span key={n} className={chip}>{n}</span>)}
      {!users.length && !teams.length && <span className="text-zinc-400 dark:text-zinc-500">{t("github.noReviewer")}</span>}
      <div ref={box} className="relative inline-flex">
        <button type="button" onClick={() => { setErr(null); setCands(null); setOpen((v) => !v); }} title={t("github.addReviewer")} aria-label={t("github.addReviewer")} aria-expanded={open}
          className="shrink-0 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200">
          <IconPlus size={12} stroke={2} aria-hidden />
        </button>
        {open && (
          <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {cands === null ? (
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-zinc-400"><IconLoader2 size={12} className="animate-spin" aria-hidden />…</div>
            ) : err ? null : pick.length ? (
              <div className="max-h-56 overflow-y-auto">
                {pick.map((l) => (
                  <button key={l} type="button" onClick={() => void change([l], [], l)} disabled={!!busy}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11.5px] text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    {busy === l && <IconLoader2 size={12} className="animate-spin" aria-hidden />}{l}
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 py-1 text-[11px] text-zinc-400 dark:text-zinc-500">{t("github.noReviewerCandidates")}</p>
            )}
          </div>
        )}
      </div>
      {err && <p className="w-full break-words text-[10px] text-rose-500">{err}</p>}
    </div>
  );
}

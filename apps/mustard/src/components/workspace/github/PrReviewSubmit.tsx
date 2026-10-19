"use client";
// PR 리뷰 판정(#1131) — 대화 탭: 리뷰 기록(작성자별 최신 판정) + 리뷰 제출(GitHub 웹처럼 Comment/Approve/Request changes 고르고 제출 하나).
// 입력 상자·버튼은 CommentComposer와 같은 모양. 내 PR이면 승인·변경 요청은 GitHub가 막아서 숨김.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconCircleCheck, IconCircleX, IconMessage } from "@tabler/icons-react";
import { useT, Markdown } from "@mustard/core";
import GhAvatar from "@/components/workspace/github/GhAvatar";
import MarkdownToolbar from "@/components/workspace/github/MarkdownToolbar";
import { relTime } from "@/lib/relTime";

type Ev = "comment" | "approve" | "request-changes";
const STATE: Record<string, { key: string; Icon: typeof IconMessage; cls: string }> = {
  APPROVED: { key: "github.reviewApproved", Icon: IconCircleCheck, cls: "text-emerald-600 dark:text-emerald-400" },
  CHANGES_REQUESTED: { key: "github.reviewChangesRequested", Icon: IconCircleX, cls: "text-rose-600 dark:text-rose-400" },
  COMMENTED: { key: "github.reviewCommented", Icon: IconMessage, cls: "text-zinc-500 dark:text-zinc-400" },
};

// 작성자별 최신 판정 — 본문 없는 COMMENTED(줄 댓글 묶음)는 판정이 아니라서 뺌
export function latestReviews(reviews: GhReview[]): GhReview[] {
  const by = new Map<string, GhReview>();
  for (const r of reviews) {
    if (!STATE[r.state] || (r.state === "COMMENTED" && !r.body?.trim())) continue;
    const k = r.author?.login ?? "";
    const prev = by.get(k);
    if (!prev || (r.submittedAt ?? "") >= (prev.submittedAt ?? "")) by.set(k, r);
  }
  return [...by.values()].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
}

export default function PrReviewSubmit({ root, number, reviews, mine, onSubmitted }: { root: string; number: number; reviews: GhReview[]; mine: boolean; onSubmitted: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [ev, setEv] = useState<Ev>("comment");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const options: Ev[] = mine ? ["comment"] : ["comment", "approve", "request-changes"];
  const canSend = !sending && (ev === "approve" || !!text.trim());
  const submit = async () => {
    if (!canSend) return;
    setSending(true); setError(null);
    const r = await window.nunopiDesktop?.github?.prReviewEvent?.(root, number, ev, text).catch((e) => ({ ok: false, detail: String((e as Error)?.message || e) }));
    if (!mounted.current) return;
    setSending(false);
    if (r?.ok) { setText(""); setEv("comment"); onSubmitted(); } else setError(r?.detail || t("github.error"));
  };
  const shown = latestReviews(reviews);

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
      {shown.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.reviews")} · {shown.length}</p>
          {shown.map((r, i) => {
            const s = STATE[r.state];
            return (
              <div key={`${r.author?.login}-${i}`} className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/40">
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <GhAvatar login={r.author?.login} size={16} />
                  <span>{r.author?.login}</span>
                  <span className={`inline-flex items-center gap-0.5 font-medium ${s.cls}`}><s.Icon size={12} stroke={2} aria-hidden />{t(s.key)}</span>
                  {r.submittedAt && <span>· {relTime(r.submittedAt)}</span>}
                </div>
                {r.body?.trim() && <Markdown className="mt-1 text-[12px] text-zinc-700 dark:text-zinc-200">{r.body}</Markdown>}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.submitReview")}</p>
      <div className="rounded-lg border border-zinc-200 bg-white transition focus-within:border-mustard-500/60 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          ref={taRef} value={text} onChange={(e) => setText(e.target.value)} disabled={sending}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
          placeholder={t("github.reviewPlaceholder")} rows={3}
          className="w-full resize-y bg-transparent px-2.5 py-2 text-[12px] text-zinc-700 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-200 dark:placeholder:text-zinc-500" />
        <div className="flex items-center gap-0.5 border-t border-zinc-100 px-1.5 py-1 dark:border-zinc-800/60">
          <MarkdownToolbar taRef={taRef} setValue={setText} />
        </div>
        {/* 판정 고르기(GitHub 웹처럼) + 제출 하나 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 px-2.5 py-1.5 dark:border-zinc-800/60">
          {options.map((o) => (
            <label key={o} className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-300">
              <input type="radio" name={`review-${number}`} checked={ev === o} onChange={() => setEv(o)} disabled={sending} className="accent-mustard-500" />
              {t(o === "comment" ? "github.reviewEvComment" : o === "approve" ? "github.reviewEvApprove" : "github.reviewEvRequestChanges")}
            </label>
          ))}
          <button type="button" onClick={() => void submit()} disabled={!canSend}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500">
            {sending && <IconLoader2 size={12} className="animate-spin" aria-hidden />}
            {sending ? t("github.sending") : t("github.submitReview")}
          </button>
        </div>
      </div>
      {mine && <p className="px-1 text-[10px] text-zinc-400 dark:text-zinc-500">{t("github.ownPrReviewNote")}</p>}
      {error && <p className="break-words px-1 text-[10px] text-rose-500">{error}</p>}
    </div>
  );
}

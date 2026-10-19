"use client";
// PR 리뷰 기록(#1131) — 작성자별 판정(승인·변경 요청·코멘트, GitHub 방식은 reviewVerdict.ts). 대화 탭 입력창 위.
// 판정 제출은 입력창(CommentComposer review)의 [Approve]·[Request changes] — 입력창은 하나(유저: 두 개면 헷갈림).
import { IconCircleCheck, IconCircleX, IconMessage } from "@tabler/icons-react";
import { useT, Markdown } from "@mustard/core";
import GhAvatar from "@/components/workspace/github/GhAvatar";
import { relTime } from "@/lib/relTime";
import { latestReviews } from "@/lib/reviewVerdict";

const STATE: Record<string, { key: string; Icon: typeof IconMessage; cls: string }> = {
  APPROVED: { key: "github.reviewApproved", Icon: IconCircleCheck, cls: "text-emerald-600 dark:text-emerald-400" },
  CHANGES_REQUESTED: { key: "github.reviewChangesRequested", Icon: IconCircleX, cls: "text-rose-600 dark:text-rose-400" },
  COMMENTED: { key: "github.reviewCommented", Icon: IconMessage, cls: "text-zinc-500 dark:text-zinc-400" },
};

export default function PrReviews({ reviews }: { reviews: GhReview[] }) {
  const t = useT();
  const shown = latestReviews(reviews);
  if (!shown.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.reviews")} · {shown.length}</p>
      {shown.map((r, i) => {
        const s = STATE[r.state];
        if (!s) return null;
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
  );
}

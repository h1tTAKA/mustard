"use client";
// PR 줄 리뷰 댓글(#1127) — 대화 탭에. 일반 댓글(gh pr view comments)엔 안 나오는 파일·줄 댓글(에이전트 리뷰로 올린 것 포함).
// 파일:줄 누르면 가운데 PR diff. 답글(inReplyTo)은 원댓글 밑에 들여서.
import { useEffect, useState } from "react";
import { IconFile } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import CommentItem from "@/components/workspace/github/CommentItem";
import { prReviewKey, PR_REVIEW_EVENT } from "@/lib/prReview";

type LineComment = { id: number; mine: boolean; path: string; line: number | null; outdated: boolean; body: string; author: string; createdAt: string; url: string; inReplyTo: number | null };

export default function PrReviewComments({ root, number, reloadKey, onOpenFile }: { root: string; number: number; reloadKey: number; onOpenFile?: (file: string) => void }) {
  const t = useT();
  const [list, setList] = useState<LineComment[]>([]);
  const [tick, setTick] = useState(0);
  // 에이전트 리뷰에서 올리면(저장 이벤트) 다시 불러옴
  useEffect(() => {
    const key = prReviewKey(root, number);
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setTick((n) => n + 1); };
    window.addEventListener(PR_REVIEW_EVENT, on);
    return () => window.removeEventListener(PR_REVIEW_EVENT, on);
  }, [root, number]);
  useEffect(() => {
    let alive = true;
    void window.nunopiDesktop?.github?.prLineComments?.(root, number).then((r) => { if (alive && r.ok && r.data) setList(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, [root, number, reloadKey, tick]);

  if (!list.length) return null;
  const tops = list.filter((c) => c.inReplyTo == null);
  const replies = (id: number) => list.filter((c) => c.inReplyTo === id);
  // 한 개 = 공용 CommentItem(내 댓글만 수정·삭제, 리뷰 댓글 경로). 옛 <sub> 꼬리표는 기울임으로 보이게.
  const item = (c: LineComment, reply = false) => (
    <div key={c.id} className={reply ? "ml-5 mt-1.5 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700" : ""}>
      <CommentItem root={root} reviewId={c.id} onChanged={() => setTick((n) => n + 1)}
        comment={{ author: { login: c.author }, body: c.body.replace(/<sub>([\s\S]*?)<\/sub>/g, "_$1_"), createdAt: c.createdAt, url: c.url, viewerDidAuthor: c.mine }} />
    </div>
  );
  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.reviewComments")} · {list.length}</p>
      {tops.map((c) => (
        <div key={c.id} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
          <button type="button" onClick={() => onOpenFile?.(c.path)} disabled={!onOpenFile}
            className="mb-1.5 flex max-w-full items-center gap-1 font-mono text-[10.5px] text-zinc-400 hover:text-zinc-600 disabled:cursor-default dark:text-zinc-500 dark:hover:text-zinc-300">
            <IconFile size={12} stroke={2} className="shrink-0" aria-hidden /><span className="truncate">{c.path}{c.line ? `:${c.line}` : ""}</span>
            {c.outdated && <span className="shrink-0 rounded bg-zinc-200 px-1 font-sans text-[9.5px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">{t("github.outdated")}</span>}
          </button>
          {item(c)}
          {replies(c.id).map((r) => item(r, true))}
        </div>
      ))}
    </div>
  );
}

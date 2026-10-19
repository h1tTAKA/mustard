"use client";
// PR 줄 리뷰 댓글(#1127) — 대화 탭에. 일반 댓글(gh pr view comments)엔 안 나오는 파일·줄 댓글(에이전트 리뷰로 올린 것 포함).
// 파일:줄 누르면 가운데 PR diff. 답글(inReplyTo)은 원댓글 밑에 들여서.
// #1129 스레드마다 답글 입력·Resolve/Unresolve(GitHub 화면처럼), 해결된 스레드는 접음.
import { useEffect, useRef, useState } from "react";
import { IconFile, IconLoader2, IconCircleCheck, IconCornerDownRight } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import CommentItem from "@/components/workspace/github/CommentItem";
import SendToAgent from "@/components/workspace/github/SendToAgent";
import { prReviewKey, PR_REVIEW_EVENT } from "@/lib/prReview";

// 옛 에이전트 꼬리표(<sub>🤖 Mustard agent review</sub>)만 기울임으로 보이게 — 다른 <sub>·원문은 그대로
const legacyFooter = (b: string) => b.replace("<sub>🤖 Mustard agent review</sub>", "_🤖 Mustard agent review_");

type LineComment = { id: number; mine: boolean; reactionGroups?: GhReactionGroup[]; threadId?: string; resolved?: boolean; path: string; line: number | null; outdated: boolean; body: string; author: string; createdAt: string; url: string; inReplyTo: number | null };

export default function PrReviewComments({ root, number, prTitle = "", reloadKey, onOpenFile }: { root: string; number: number; prTitle?: string; reloadKey: number; onOpenFile?: (file: string) => void }) {
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
  const reload = () => setTick((n) => n + 1);
  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.reviewComments")} · {list.length}</p>
      {tops.map((c) => <Thread key={c.id} root={root} number={number} prTitle={prTitle} top={c} replies={replies(c.id)} onOpenFile={onOpenFile} onChanged={reload} />)}
    </div>
  );
}

function Thread({ root, number, prTitle, top, replies, onOpenFile, onChanged }: { root: string; number: number; prTitle: string; top: LineComment; replies: LineComment[]; onOpenFile?: (file: string) => void; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(!top.resolved); // 해결된 스레드는 접어서 시작
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"reply" | "resolve" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const gh = () => window.nunopiDesktop?.github;
  const sendReply = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy("reply"); setErr(null);
    const r = await gh()?.prReviewReply?.(root, number, top.id, body).catch(() => null);
    if (!mounted.current) return;
    setBusy(null);
    if (r?.ok) { setDraft(""); setReplying(false); onChanged(); } else setErr(r?.detail || t("github.error"));
  };
  const toggleResolve = async () => {
    if (!top.threadId || busy) return;
    setBusy("resolve"); setErr(null);
    const r = await gh()?.prThreadResolve?.(root, top.threadId, !top.resolved).catch(() => null);
    if (!mounted.current) return;
    setBusy(null);
    if (r?.ok) { setOpen(top.resolved ? true : false); onChanged(); } else setErr(r?.detail || t("github.error"));
  };
  // 한 개 = 공용 CommentItem(내 댓글만 수정·삭제, 리뷰 댓글 경로). 옛 꼬리표는 표시에서만 기울임.
  const item = (c: LineComment, reply = false) => (
    <div key={c.id} className={reply ? "ml-5 mt-1.5 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700" : ""}>
      <CommentItem root={root} reviewId={c.id} onChanged={onChanged} display={legacyFooter}
        actions={<SendToAgent root={root} item={{ kind: "pr", number, title: prTitle, part: "review", url: c.url, author: c.author, file: c.path, line: c.line, body: c.body }} />}
        comment={{ author: { login: c.author }, body: c.body, createdAt: c.createdAt, url: c.url, viewerDidAuthor: c.mine, reactionGroups: c.reactionGroups }} />
    </div>
  );
  const btn = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50";
  return (
    <div className={`rounded-lg border p-2.5 ${top.resolved ? "border-zinc-200/70 bg-zinc-50/50 dark:border-zinc-800/70 dark:bg-zinc-900/30" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <button type="button" onClick={() => onOpenFile?.(top.path)} disabled={!onOpenFile}
          className="flex min-w-0 items-center gap-1 font-mono text-[10.5px] text-zinc-400 hover:text-zinc-600 disabled:cursor-default dark:text-zinc-500 dark:hover:text-zinc-300">
          <IconFile size={12} stroke={2} className="shrink-0" aria-hidden /><span className="truncate">{top.path}{top.line ? `:${top.line}` : ""}</span>
        </button>
        {top.outdated && <span className="shrink-0 rounded bg-zinc-200 px-1 text-[9.5px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">{t("github.outdated")}</span>}
        {top.resolved && <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/15 px-1 text-[9.5px] font-medium text-emerald-600 dark:text-emerald-400"><IconCircleCheck size={10} aria-hidden />{t("github.resolved")}</span>}
        {top.resolved && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="ml-auto shrink-0 text-[10.5px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            {open ? "▾" : "▸"} {open ? t("github.hide") : t("github.show")}
          </button>
        )}
      </div>
      {open && (<>
        {item(top)}
        {replies.map((r) => item(r, true))}
        {replying ? (
          <div className="mt-2 flex flex-col gap-1">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy === "reply"} rows={3} autoFocus placeholder={t("github.replyPlaceholder")}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void sendReply(); } }}
              className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-700 outline-none focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => { setReplying(false); setErr(null); }} className={`${btn} text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200`}>{t("github.cancel")}</button>
              <button type="button" onClick={() => void sendReply()} disabled={busy === "reply" || !draft.trim()} className={`${btn} bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white`}>
                {busy === "reply" && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("github.reply")}
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1">
          {!replying && <button type="button" onClick={() => setReplying(true)} className={`${btn} text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800`}><IconCornerDownRight size={12} aria-hidden />{t("github.reply")}</button>}
          {top.threadId && (
            <button type="button" onClick={() => void toggleResolve()} disabled={busy === "resolve"} className={`${btn} border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}>
              {busy === "resolve" ? <IconLoader2 size={11} className="animate-spin" aria-hidden /> : <IconCircleCheck size={12} aria-hidden />}{top.resolved ? t("github.unresolve") : t("github.resolve")}
            </button>
          )}
        </div>
      </>)}
      {err && <p className="mt-1 break-words text-[10.5px] text-rose-500">{err}</p>}
    </div>
  );
}

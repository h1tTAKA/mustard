"use client";
// 이슈·PR 코멘트 작성 컴포저(#820) — 카드(textarea + 서식 툴바 + 취소/Send).
// 서식 버튼은 선택영역에 Markdown 삽입. Cmd/Ctrl+Enter 전송. write라 명시적 Send만.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconClock, IconX } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import MarkdownToolbar from "@/components/workspace/github/MarkdownToolbar";
import { loadDrafts, saveDrafts, removeDraft, reviewRequest, prDraftKey, PR_DRAFT_EVENT, type DraftComment } from "@/lib/prDraft";

// review(#1131) = 남의 PR이면 Send 옆에 [Approve]·[Request changes] — 입력창 하나(승인은 본문 없어도 됨).
// #1145 PR diff에서 "리뷰에 추가"한 보류 줄 댓글 — 입력창 위 띠. 있으면 Send(Comment)·Approve·Request changes가 그 댓글들과 함께 리뷰 하나로(head = 지금 PR head, 댓글들이 본 커밋이 같으면 그 커밋).
export default function CommentComposer({ root, kind, number, onPosted, review = false, head, onOpenFile }: { root: string; kind: "issue" | "pr"; number: number; onPosted: () => void; review?: boolean; head?: string; onOpenFile?: (file: string) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const [drafts, setDrafts] = useState<DraftComment[]>(() => (kind === "pr" ? loadDrafts(root, number) : []));
  const [showDrafts, setShowDrafts] = useState(false);
  useEffect(() => {
    if (kind !== "pr") return;
    const key = prDraftKey(root, number);
    setDrafts(loadDrafts(root, number)); // eslint-disable-line react-hooks/set-state-in-effect -- PR 바뀌면 그 PR 보류분
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setDrafts(loadDrafts(root, number)); };
    window.addEventListener(PR_DRAFT_EVENT, on);
    return () => window.removeEventListener(PR_DRAFT_EVENT, on);
  }, [root, kind, number]);
  // 보류 댓글 + 판정 = 리뷰 하나. 올라가면 보류분 비움(보낸 것만 — 그사이 diff에서 더 넣은 건 남김).
  const submitDrafts = async (ev: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => {
    const sent = loadDrafts(root, number);
    const req = reviewRequest(sent, head);
    if (req.mixed) { setError(t("github.draftMixed")); return; }
    if (!req.commitId) { setError(t("github.error")); return; }
    const r = await window.nunopiDesktop?.github?.prReviewSubmit?.(root, number, req.commitId, req.comments, { event: ev, body: text.trim() }).catch((e) => ({ ok: false, detail: String((e as Error)?.message || e) }));
    if (!mountedRef.current) return;
    if (r?.ok) {
      const ids = new Set(sent.map((x) => x.id));
      saveDrafts(root, number, loadDrafts(root, number).filter((x) => !ids.has(x.id)));
      setText(""); onPosted();
    } else setError(r?.detail || t("github.error"));
  };
  const [busyEv, setBusyEv] = useState<"approve" | "request-changes" | null>(null);
  const submitReview = async (ev: "approve" | "request-changes") => {
    const body = text.trim();
    if (sending || busyEv || (ev === "request-changes" && !body && !drafts.length)) return;
    if (drafts.length) {
      setBusyEv(ev); setError(null);
      await submitDrafts(ev === "approve" ? "APPROVE" : "REQUEST_CHANGES");
      if (mountedRef.current) setBusyEv(null);
      return;
    }
    setBusyEv(ev); setError(null);
    const r = await window.nunopiDesktop?.github?.prReviewEvent?.(root, number, ev, body).catch((e) => ({ ok: false, detail: String((e as Error)?.message || e) }));
    if (!mountedRef.current) return;
    setBusyEv(null);
    if (r?.ok) { setText(""); onPosted(); } else setError(r?.detail || t("github.error"));
  };
  const send = async () => {
    const body = text.trim();
    if ((!body && !drafts.length) || sending || busyEv) return; // 리뷰 제출 중엔 ⌘Enter로도 안 보냄(리뷰)
    if (drafts.length) { // 보류 댓글 있으면 일반 코멘트 대신 Comment 리뷰로 함께
      setSending(true); setError(null);
      await submitDrafts("COMMENT");
      if (mountedRef.current) setSending(false);
      return;
    }
    const gh = window.nunopiDesktop?.github;
    if (!gh?.addComment) { setError(t("github.desktopOnly")); return; }
    setSending(true); setError(null);
    try {
      const r = await gh.addComment(root, kind, number, body);
      if (!mountedRef.current) return;
      if (r.ok) { setText(""); setSending(false); onPosted(); }
      else { setSending(false); setError(r.detail || t("github.error")); }
    } catch (e) {
      if (mountedRef.current) { setSending(false); setError(String((e as Error)?.message || e)); }
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
      {drafts.length > 0 && (
        <div className="rounded-md bg-mustard-500/10 px-2 py-1 text-[11px] text-mustard-700 dark:text-mustard-400">
          <button type="button" onClick={() => setShowDrafts((v) => !v)} aria-expanded={showDrafts} className="flex w-full items-center gap-1.5 text-left font-medium">
            <IconClock size={12} stroke={2} aria-hidden />{t("github.draftCount", { n: drafts.length })}
            <span className="truncate font-normal text-mustard-700/70 dark:text-mustard-400/70">{t("github.draftHint")}</span>
            <span className="ml-auto shrink-0">{showDrafts ? "▾" : "▸"}</span>
          </button>
          {showDrafts && (
            <ul className="mt-1 space-y-0.5">
              {drafts.map((d) => (
                <li key={d.id} className="flex min-w-0 items-center gap-1.5">
                  <button type="button" onClick={() => onOpenFile?.(d.path)} disabled={!onOpenFile} className="shrink-0 font-mono text-[10.5px] hover:underline disabled:cursor-default disabled:no-underline">{d.path}:{d.startLine ? `${d.startLine}-` : ""}{d.line}</button>
                  <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">{d.body}</span>
                  <button type="button" onClick={() => saveDrafts(root, number, removeDraft(loadDrafts(root, number), d.id))} aria-label={t("github.delete")} title={t("github.delete")}
                    className="ml-auto shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconX size={11} aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="rounded-lg border border-zinc-200 bg-white transition focus-within:border-mustard-500/60 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          ref={taRef} value={text} onChange={(e) => setText(e.target.value)} disabled={sending}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
          placeholder={t("github.commentPlaceholder")} rows={3}
          className="w-full resize-y bg-transparent px-2.5 py-2 text-[12px] text-zinc-700 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-200 dark:placeholder:text-zinc-500" />
        {/* 하단 툴바 + 액션 */}
        <div className="flex flex-wrap items-center gap-0.5 border-t border-zinc-100 px-1.5 py-1 dark:border-zinc-800/60">
          <MarkdownToolbar taRef={taRef} setValue={setText} />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            {text && !sending && <button type="button" onClick={() => setText("")} className="rounded px-2 py-0.5 text-[11px] text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200">{t("github.cancel")}</button>}
            <button type="button" onClick={() => void send()} disabled={sending || !!busyEv || (!text.trim() && !drafts.length)}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500">
              {sending && <IconLoader2 size={12} className="animate-spin" aria-hidden />}
              {sending ? t("github.sending") : t("github.send")}
            </button>
            {review && (<>
              <button type="button" onClick={() => void submitReview("approve")} disabled={sending || !!busyEv}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500">
                {busyEv === "approve" && <IconLoader2 size={12} className="animate-spin" aria-hidden />}{t("github.reviewEvApprove")}
              </button>
              <button type="button" onClick={() => void submitReview("request-changes")} disabled={sending || !!busyEv || (!text.trim() && !drafts.length)}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500">
                {busyEv === "request-changes" && <IconLoader2 size={12} className="animate-spin" aria-hidden />}{t("github.reviewEvRequestChanges")}
              </button>
            </>)}
          </div>
        </div>
      </div>
      {error && <p className="break-words px-1 text-[10px] text-rose-500">{error}</p>}
    </div>
  );
}

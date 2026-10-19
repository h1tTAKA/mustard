"use client";
// GitHub 패널 이슈 상세(#813) — gh issue view(브릿지 #810) → 본문·코멘트(Markdown 재사용).
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconArrowLeft, IconExternalLink, IconPencil, IconCircleCheck, IconCircleDot } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { useConfirm } from "@mustard/core";
import { Markdown } from "@mustard/core";
import MarkdownToolbar from "@/components/workspace/github/MarkdownToolbar";
import { relTime } from "@/lib/relTime";
import CommentComposer from "@/components/workspace/github/CommentComposer";
import CommentItem from "@/components/workspace/github/CommentItem";
import SendToAgent from "@/components/workspace/github/SendToAgent";
import GhAvatar from "@/components/workspace/github/GhAvatar";
import ReactionBar from "@/components/workspace/github/ReactionBar";

type Load = { loading: boolean; data?: GhIssueDetail; error?: string };

export default function IssueDetail({ root, number, reloadKey, host = "github", onBack }: { root: string; number: number; reloadKey: number; host?: "github" | "gitlab" | "other"; onBack: () => void }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ loading: true });
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const reqIdRef = useRef(0); // 요청 세대 — 다른 이슈 빠르게 열 때 옛 fetch가 최신 덮어쓰지 않게(리뷰 🟡)
  const [cmtNonce, setCmtNonce] = useState(0); // 코멘트 작성 후 상세 재조회(#820)
  const [editingBody, setEditingBody] = useState(false); // 제목·본문 편집(#822)
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [actBusy, setActBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const confirm = useConfirm();
  const runAct = async (fn: () => Promise<{ ok: boolean; detail?: string } | undefined>) => {
    setActBusy(true); setActErr(null);
    let r: { ok: boolean; detail?: string } | undefined;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: String((e as Error)?.message || e) }; }
    if (!mountedRef.current) return;
    setActBusy(false);
    if (r?.ok) { setEditingBody(false); setCmtNonce((n) => n + 1); } else setActErr(r?.detail || t("github.error"));
  };
  // 상태 전환은 실제 GitHub에 반영 → 확인 팝업 후 실행(#822).
  const confirmState = async (action: "close" | "reopen", label: string, icon: React.ReactNode) => {
    if (await confirm({ title: label, message: t("github.confirmState"), tone: "warn", confirmText: label, confirmIcon: icon })) {
      void runAct(() => window.nunopiDesktop!.github!.setState(root, "issue", number, action));
    }
  };

  useEffect(() => {
    const nd = window.nunopiDesktop;
    // #964 host별 view — gitlab이면 glabIssueView(GhIssueDetail 정규화).
    const view = host === "gitlab" ? nd?.integrations?.glabIssueView : nd?.github?.issueView;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)/로딩 표시(number 변경마다 재조회)
    if (!view) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const myId = ++reqIdRef.current;
    setLoad((p) => ({ loading: true, data: p.data })); // 데이터 유지(새로고침·코멘트 후 화면 안 비게)
    (async () => {
      const r = await view(root, number);
      if (!mountedRef.current || myId !== reqIdRef.current) return; // 언마운트/stale 결과 드롭
      if (r.ok) setLoad({ loading: false, data: r.data });
      else setLoad({ loading: false, error: r.detail || t("github.error") });
    })();
  }, [root, number, t, cmtNonce, reloadKey, host]);

  const d = load.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800/60">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconArrowLeft size={13} stroke={2} aria-hidden /> {t("github.back")}
        </button>
        <span className="ml-1 shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{number}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {load.loading && !d ? (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>
        ) : (load.error && !d) || !d ? (
          <div className="flex items-start gap-2 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span className="break-words">{load.error || t("github.error")}</span></div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex items-start gap-2">
                {editingBody
                  ? <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} disabled={actBusy} autoFocus className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[14px] font-semibold text-zinc-800 outline-none focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                  : <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{d.title}</h2>}
                {!editingBody && host === "github" && <button type="button" onClick={() => { setTitleDraft(d.title || ""); setBodyDraft(d.body || ""); setEditingBody(true); }} title={t("github.editBody")} aria-label={t("github.editBody")} className="mt-0.5 shrink-0 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"><IconPencil size={14} stroke={2} aria-hidden /></button>}
                {host === "github" && <SendToAgent className="mt-0.5" root={root} size={14} item={{ kind: "issue", number, title: d.title || "", part: "body", url: d.url, author: d.author?.login, body: d.body || "" }} />}
                {d.url && <a href={d.url} target="_blank" rel="noreferrer" title={t("github.openInBrowser")} aria-label={t("github.openInBrowser")} className="mt-0.5 shrink-0 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"><IconExternalLink size={14} stroke={2} aria-hidden /></a>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${d.state.toUpperCase() === "OPEN" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-purple-500/15 text-purple-500 dark:text-purple-400"}`}>{d.state}</span>
                <GhAvatar login={d.author?.login} size={14} />
                <span>{d.author?.login}</span>
                {d.createdAt && <span>· {relTime(d.createdAt)}</span>}
                {d.milestone?.title && <span>· {d.milestone.title}</span>}
              </div>
              {/* 담당자(#813) */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-zinc-400 dark:text-zinc-500">{t("github.assignees")}:</span>
                {d.assignees?.length
                  ? d.assignees.map((a) => <span key={a.login} className="rounded-full bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{a.login}</span>)
                  : <span className="text-zinc-400 dark:text-zinc-500">{t("github.noAssignee")}</span>}
              </div>
            </div>
            {/* 본문 — 편집(#822) */}
            {editingBody ? (
              <div className="flex flex-col gap-1">
                <div className="rounded-md border border-zinc-200 bg-white transition focus-within:border-mustard-500/60 dark:border-zinc-700 dark:bg-zinc-900">
                  <textarea ref={bodyRef} value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} disabled={actBusy} rows={16}
                    className="w-full resize-y bg-transparent px-2 py-1.5 text-[12px] text-zinc-700 outline-none disabled:opacity-60 dark:text-zinc-200" />
                  <div className="border-t border-zinc-100 px-1.5 py-1 dark:border-zinc-800/60"><MarkdownToolbar taRef={bodyRef} setValue={setBodyDraft} /></div>
                </div>
                <div className="flex justify-end gap-1">
                  <button type="button" onClick={() => setEditingBody(false)} className="rounded px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">{t("github.cancel")}</button>
                  <button type="button" onClick={() => void runAct(() => window.nunopiDesktop!.github!.editItem(root, "issue", number, titleDraft.trim(), bodyDraft.trim()))} disabled={actBusy || !titleDraft.trim()} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white">{actBusy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("github.save")}</button>
                </div>
              </div>
            ) : (
              d.body?.trim() ? <Markdown className="text-[12px] text-zinc-700 dark:text-zinc-200">{d.body}</Markdown> : <p className="text-[12px] italic text-zinc-400 dark:text-zinc-500">—</p>
            )}
            {/* 본문 리액션(#822) */}
            {host === "github" && <ReactionBar groups={d.reactionGroups} onReact={(c) => void window.nunopiDesktop?.github?.bodyReact?.(root, number, c).then((r) => { if (r?.ok) setCmtNonce((n) => n + 1); }).catch(() => {})} />}
            {/* 상태 액션(#822) — 닫기/다시 열기. GitLab은 조회 전용(#964)이라 숨김. */}
            {host === "github" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {d.state.toUpperCase() === "OPEN"
                ? <button type="button" onClick={() => void confirmState("close", t("github.close"), <IconCircleCheck size={15} stroke={2} aria-hidden />)} disabled={actBusy} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{actBusy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconCircleCheck size={13} stroke={2} className="text-purple-500" aria-hidden />}{t("github.close")}</button>
                : <button type="button" onClick={() => void confirmState("reopen", t("github.reopen"), <IconCircleDot size={15} stroke={2} aria-hidden />)} disabled={actBusy} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{actBusy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconCircleDot size={13} stroke={2} className="text-emerald-500" aria-hidden />}{t("github.reopen")}</button>}
              {actErr && <span className="break-words text-[10px] text-rose-500">{actErr}</span>}
            </div>
            )}
            {d.comments?.length > 0 && (
              <div className="mt-1 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.comments")} · {d.comments.length}</p>
                {d.comments.map((c, i) => (
                  <CommentItem key={c.url || i} root={root} comment={c} onChanged={() => setCmtNonce((n) => n + 1)} actions={host === "github" ? <SendToAgent root={root} item={{ kind: "issue", number, title: d.title || "", part: "comment", url: c.url, author: c.author?.login, body: c.body }} /> : undefined} />
                ))}
              </div>
            )}
            {/* 코멘트 작성(#820) — GitLab 조회 전용(#964)이라 숨김 */}
            {host === "github" && <CommentComposer root={root} kind="issue" number={number} onPosted={() => setCmtNonce((n) => n + 1)} />}
          </div>
        )}
      </div>
    </div>
  );
}

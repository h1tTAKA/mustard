"use client";
// GitHub 패널 PR 상세(#814) — gh pr view → 제목·상태·머지상태·담당자 + 체크(ChecksView)·본문·코멘트.
import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconAlertTriangle, IconArrowLeft, IconExternalLink, IconPencil, IconGitPullRequest, IconGitPullRequestDraft, IconGitPullRequestClosed, IconGitMerge, IconChevronDown, IconCheck } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { useConfirm } from "@mustard/core";
import { Markdown } from "@mustard/core";
import { relTime } from "@/lib/relTime";
import ChecksView from "@/components/workspace/github/ChecksView";
import MarkdownToolbar from "@/components/workspace/github/MarkdownToolbar";
import CommentComposer from "@/components/workspace/github/CommentComposer";
import CommentItem from "@/components/workspace/github/CommentItem";
import SendToAgent from "@/components/workspace/github/SendToAgent";
import PrAgentReview from "@/components/workspace/github/PrAgentReview";
import PrReviewComments from "@/components/workspace/github/PrReviewComments";
import PrReviews from "@/components/workspace/github/PrReviews";
import MetaRow from "@/components/workspace/github/MetaRow";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import GhAvatar from "@/components/workspace/github/GhAvatar";
import ReactionBar from "@/components/workspace/github/ReactionBar";
import PrFiles from "@/components/workspace/github/PrFiles";

type Load = { loading: boolean; data?: GhPrDetail; error?: string };

function stateLabel(d: GhPrDetail, t: (k: string) => string): { text: string; cls: string } {
  const st = d.state.toUpperCase();
  if (d.isDraft && st === "OPEN") return { text: t("github.draft"), cls: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400" };
  if (st === "MERGED") return { text: t("github.merged"), cls: "bg-purple-500/15 text-purple-500 dark:text-purple-400" };
  if (st === "CLOSED") return { text: d.state, cls: "bg-rose-500/15 text-rose-500 dark:text-rose-400" };
  return { text: d.state, cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
}

// onOpenFile = 변경 파일 → 가운데 diff 탭(#1123, Files changed 탭에서 사용)
export default function PrDetail({ root, number, reloadKey, host = "github", onBack, onOpenFile, agent }: { root: string; number: number; reloadKey: number; host?: "github" | "gitlab" | "other"; onBack: () => void; onOpenFile?: (file: string) => void; agent?: { providerId: AgentProviderKind; providerSettings: ProviderSettings } }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ loading: true });
  const [tab, setTab] = useState<"conversation" | "files">("conversation"); // #1123 대화 | 변경 파일(#1127 에이전트 리뷰는 변경 파일 안 위쪽)
  const [fileCount, setFileCount] = useState<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const reqIdRef = useRef(0);
  const [cmtNonce, setCmtNonce] = useState(0); // 코멘트 작성 후 상세 재조회(#820)
  // #1131 사이드바 항목 바꾸기 — gh pr edit 후 상세 다시 읽기
  const meta = (field: GhMetaField) => async (add: string[], remove: string[]) => {
    const r = await window.nunopiDesktop?.github?.editMeta?.(root, "pr", number, field, add, remove);
    if (r?.ok) setCmtNonce((n) => n + 1);
    return r ?? { ok: false };
  };
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
  // 상태 전환은 실제 GitHub에 반영 → 확인 팝업 후(#822).
  const confirmState = async (action: "close" | "reopen" | "ready" | "draft", label: string, icon: React.ReactNode) => {
    if (await confirm({ title: label, message: t("github.confirmState"), tone: "warn", confirmText: label, confirmIcon: icon })) {
      void runAct(() => window.nunopiDesktop!.github!.setState(root, "pr", number, action));
    }
  };
  // 머지 방식(GitHub식) — 기본 merge commit. 메뉴로 squash/rebase 선택.
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase">("merge");
  const [mergeMenu, setMergeMenu] = useState(false);
  const mergeLabel: Record<typeof mergeMethod, string> = { merge: t("github.mergeCommit"), squash: t("github.squashMerge"), rebase: t("github.rebaseMerge") };
  // 머지는 되돌릴 수 없음(브랜치 삭제 포함) → danger 확인(#822).
  const confirmMerge = async (method: "merge" | "squash" | "rebase") => {
    if (await confirm({ title: mergeLabel[method], message: t("github.confirmMerge"), danger: true, confirmText: t("github.merge"), confirmIcon: <IconGitMerge size={15} stroke={2} aria-hidden /> })) {
      void runAct(() => window.nunopiDesktop!.github!.merge(root, number, method));
    }
  };

  useEffect(() => {
    const nd = window.nunopiDesktop;
    // #964 host별 view — gitlab이면 glabMrView(GhPrDetail 정규화).
    const view = host === "gitlab" ? nd?.integrations?.glabMrView : nd?.github?.prView;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 미지원(web)/로딩 표시(number 변경마다 재조회)
    if (!view) { setLoad({ loading: false, error: t("github.desktopOnly") }); return; }
    const myId = ++reqIdRef.current;
    setLoad((p) => ({ loading: true, data: p.data })); // 데이터 유지(새로고침·코멘트 후 화면 안 비게)
    (async () => {
      const r = await view(root, number);
      if (!mountedRef.current || myId !== reqIdRef.current) return;
      if (r.ok) setLoad({ loading: false, data: r.data });
      else setLoad({ loading: false, error: r.detail || t("github.error") });
    })();
  }, [root, number, t, cmtNonce, reloadKey, host]);

  const d = load.data;
  const sl = d ? stateLabel(d, t) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800/60">
        <button type="button" onClick={onBack} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconArrowLeft size={13} stroke={2} aria-hidden /> {t("github.back")}
        </button>
        <span className="ml-1 shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{number}</span>
        {/* #1123 대화 | 변경 파일 — GitHub만(GitLab은 조회 전용) */}
        {host === "github" && (
          <div className="ml-auto flex min-w-0 items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800/70">
            {(["conversation", "files"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`flex min-w-0 items-center whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium transition ${tab === k ? "bg-white text-zinc-800 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                <span className="truncate">{k === "conversation" ? t("github.tabConversation") : t("github.tabFiles")}</span>
                {k === "files" && fileCount !== null && <span className="ml-1 shrink-0 tabular-nums text-zinc-400">{fileCount}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {host === "github" && tab === "files" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* #1127 에이전트 리뷰 — 파일 목록 위 한 줄(펼치면 지적 목록). 탭 옮겨도 진행 중 리뷰는 다시 열 때 이어받음 */}
          {agent && <PrAgentReview key={`${root}:${number}`} root={root} number={number} providerId={agent.providerId} providerSettings={agent.providerSettings} onOpenFile={onOpenFile} />}
          <PrFiles root={root} number={number} reloadKey={reloadKey} onOpenFile={onOpenFile} onCount={setFileCount} />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {load.loading && !d ? (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={14} className="animate-spin" aria-hidden /> …</div>
        ) : !d || !sl ? (
          <div className="flex items-start gap-2 text-[12px] text-zinc-500 dark:text-zinc-400"><IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span className="break-words">{load.error || t("github.error")}</span></div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex items-start gap-2">
                {editingBody
                  ? <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} disabled={actBusy} autoFocus className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[14px] font-semibold text-zinc-800 outline-none focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                  : <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{d.title}</h2>}
                {!editingBody && host === "github" && <button type="button" onClick={() => { setTitleDraft(d.title || ""); setBodyDraft(d.body || ""); setEditingBody(true); }} title={t("github.editBody")} aria-label={t("github.editBody")} className="mt-0.5 shrink-0 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"><IconPencil size={14} stroke={2} aria-hidden /></button>}
                {host === "github" && <SendToAgent className="mt-0.5" root={root} size={14} item={{ kind: "pr", number, title: d.title || "", part: "body", url: d.url, author: d.author?.login, body: d.body || "" }} />}
                {d.url && <a href={d.url} target="_blank" rel="noreferrer" title={t("github.openInBrowser")} aria-label={t("github.openInBrowser")} className="mt-0.5 shrink-0 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"><IconExternalLink size={14} stroke={2} aria-hidden /></a>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${sl.cls}`}>{sl.text}</span>
                <GhAvatar login={d.author?.login} size={14} />
                <span>{d.author?.login}</span>
                {d.createdAt && <span>· {relTime(d.createdAt)}</span>}
              </div>
              {/* #1131 사이드바 항목(GitHub처럼) — 리뷰어·담당자·라벨·마일스톤 추가·빼기. GitLab은 조회만(옛 담당자 줄) */}
              {host === "github" ? (<div className="mt-0.5 border-b border-zinc-100 pb-2.5 dark:border-zinc-800/60">
                <MetaRow root={root} field="reviewer" title={t("github.reviewers")} empty={t("github.noReviewer")} exclude={d.author?.login ? [d.author.login] : []}
                  items={(d.reviewRequests ?? []).map((r) => ({ value: r.login || r.name || r.slug || "", readonly: !r.login })).filter((x) => x.value)} onChange={meta("reviewer")} />
                <MetaRow root={root} field="assignee" title={t("github.assignees")} empty={t("github.noAssignee")} items={(d.assignees ?? []).map((a) => ({ value: a.login }))} onChange={meta("assignee")} />
                <MetaRow root={root} field="label" title={t("github.labels")} empty={t("github.noLabel")} items={(d.labels ?? []).map((l) => ({ value: l.name, color: l.color }))} onChange={meta("label")} />
                <MetaRow root={root} field="milestone" title={t("github.milestone")} empty={t("github.noMilestone")} single items={d.milestone?.title ? [{ value: d.milestone.title }] : []} onChange={meta("milestone")} />
              </div>) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-zinc-400 dark:text-zinc-500">{t("github.assignees")}:</span>
                {d.assignees?.length
                  ? d.assignees.map((a) => <span key={a.login} className="rounded-full bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{a.login}</span>)
                  : <span className="text-zinc-400 dark:text-zinc-500">{t("github.noAssignee")}</span>}
              </div>
              )}
            </div>
            {/* CI 체크(#814, 서브3 재사용) */}
            {d.statusCheckRollup?.length > 0 && (
              <div className="rounded-md border border-zinc-100 p-2 dark:border-zinc-800/60">
                <p className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.checks")}</p>
                <ChecksView root={root} rollup={d.statusCheckRollup} />
              </div>
            )}
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
                  <button type="button" onClick={() => void runAct(() => window.nunopiDesktop!.github!.editItem(root, "pr", number, titleDraft.trim(), bodyDraft.trim()))} disabled={actBusy || !titleDraft.trim()} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white">{actBusy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("github.save")}</button>
                </div>
              </div>
            ) : (
              d.body?.trim() ? <Markdown className="text-[12px] text-zinc-700 dark:text-zinc-200">{d.body}</Markdown> : <p className="text-[12px] italic text-zinc-400 dark:text-zinc-500">—</p>
            )}
            {/* 본문 리액션(#822) */}
            {host === "github" && <ReactionBar groups={d.reactionGroups} onReact={(c) => void window.nunopiDesktop?.github?.bodyReact?.(root, number, c).then((r) => { if (r?.ok) setCmtNonce((n) => n + 1); }).catch(() => {})} />}
            {/* 상태 액션(#822) — 닫기/열기 + draft↔ready. GitLab은 조회 전용(#964)이라 숨김. */}
            {host === "github" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* 머지 스플릿 버튼(#822) — 본체=선택 방식 실행, ▾=방식 선택 메뉴(GitHub식). */}
              {d.state.toUpperCase() === "OPEN" && !d.isDraft && (
                <div className="relative inline-flex">
                  <button type="button" onClick={() => void confirmMerge(mergeMethod)} disabled={actBusy} className="inline-flex items-center gap-1 rounded-l-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40">{actBusy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconGitMerge size={13} stroke={2} aria-hidden />}{mergeLabel[mergeMethod]}</button>
                  <button type="button" onClick={() => setMergeMenu((v) => !v)} disabled={actBusy} aria-label={t("github.merge")} className="inline-flex items-center rounded-r-md border-l border-emerald-700/60 bg-emerald-600 px-1 py-1 text-white transition hover:bg-emerald-700 disabled:opacity-40"><IconChevronDown size={13} stroke={2} aria-hidden /></button>
                  {mergeMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMergeMenu(false)} />
                      <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                        {(["merge", "squash", "rebase"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => { setMergeMethod(m); setMergeMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
                            <IconCheck size={14} stroke={2.5} className={`shrink-0 ${mergeMethod === m ? "text-emerald-500" : "invisible"}`} aria-hidden />
                            {mergeLabel[m]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {d.state.toUpperCase() === "OPEN" && (d.isDraft
                ? <button type="button" onClick={() => void confirmState("ready", t("github.markReady"), <IconGitPullRequest size={15} stroke={2} aria-hidden />)} disabled={actBusy} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{actBusy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconGitPullRequest size={13} stroke={2} className="text-emerald-500" aria-hidden />}{t("github.markReady")}</button>
                : <button type="button" onClick={() => void confirmState("draft", t("github.markDraft"), <IconGitPullRequestDraft size={15} stroke={2} aria-hidden />)} disabled={actBusy} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{actBusy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconGitPullRequestDraft size={13} stroke={2} className="text-zinc-400" aria-hidden />}{t("github.markDraft")}</button>)}
              {/* Close / Reopen — 항상 오른쪽 끝(ml-auto). */}
              {d.state.toUpperCase() === "OPEN"
                ? <button type="button" onClick={() => void confirmState("close", t("github.close"), <IconGitPullRequestClosed size={15} stroke={2} aria-hidden />)} disabled={actBusy} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{actBusy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconGitPullRequestClosed size={13} stroke={2} className="text-rose-500" aria-hidden />}{t("github.close")}</button>
                : d.state.toUpperCase() === "CLOSED"
                ? <button type="button" onClick={() => void confirmState("reopen", t("github.reopen"), <IconGitPullRequest size={15} stroke={2} aria-hidden />)} disabled={actBusy} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{actBusy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconGitPullRequest size={13} stroke={2} className="text-emerald-500" aria-hidden />}{t("github.reopen")}</button>
                : null}
              {actErr && <span className="w-full break-words text-[10px] text-rose-500">{actErr}</span>}
            </div>
            )}
            {d.comments?.length > 0 && (
              <div className="mt-1 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("github.comments")} · {d.comments.length}</p>
                {d.comments.map((c, i) => (
                  <CommentItem key={c.url || i} root={root} comment={c} onChanged={() => setCmtNonce((n) => n + 1)} actions={host === "github" ? <SendToAgent root={root} item={{ kind: "pr", number, title: d.title || "", part: "comment", url: c.url, author: c.author?.login, body: c.body }} /> : undefined} />
                ))}
              </div>
            )}
            {/* #1127 줄 리뷰 댓글(에이전트 리뷰로 올린 것 포함) — 일반 댓글과 따로 */}
            {host === "github" && <PrReviewComments root={root} number={number} prTitle={d.title || ""} reloadKey={reloadKey + cmtNonce} onOpenFile={onOpenFile} />}
            {/* 코멘트 작성(#820) — GitLab 조회 전용(#964)이라 숨김 */}
            {/* #1131 리뷰 기록(작성자별 판정) */}
            {host === "github" && <PrReviews reviews={d.reviews ?? []} />}
            {/* 입력창 하나 — 남의 PR이면 Send 옆에 Approve·Request changes(#1131, 내 PR은 GitHub가 막아서 숨김) */}
            {host === "github" && <CommentComposer root={root} kind="pr" number={number} review={!!d.viewerLogin && d.viewerLogin !== d.author?.login} onPosted={() => setCmtNonce((n) => n + 1)} />}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

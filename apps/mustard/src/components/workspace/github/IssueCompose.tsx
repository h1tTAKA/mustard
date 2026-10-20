"use client";
// 이슈 생성 폼(#945) — title/body + 담당자·라벨·마일스톤(#1131, 상세와 같은 줄로 골라 만들 때 한 번에). PrCompose 대칭.
// 성공 시 stdout(이슈 URL)서 번호 파싱해 onCreated(number)로 상세 열기.
import { useState } from "react";
import MetaRow, { useMetaDraft } from "@/components/workspace/github/MetaRow";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";

export default function IssueCompose({ root, onCreated, onCancel }: { root: string; onCreated: (n: number) => void; onCancel: () => void }) {
  const t = useT();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // #1131 사이드바 항목 — 만들 때 한 번에(고르는 동안은 화면 상태만)
  const assignees = useMetaDraft(), labels = useMetaDraft(), milestone = useMetaDraft();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    const gh = window.nunopiDesktop?.github;
    if (!gh?.issueCreate) { toast(t("github.desktopOnly"), "error"); return; }
    setBusy(true);
    try {
      const r = await gh.issueCreate(root, { title: title.trim(), body, labels: labels.values, assignees: assignees.values, milestone: milestone.values[0] });
      if (r.ok) {
        toast(t("github.issueCreateSuccess"), "success");
        const m = /\/issues\/(\d+)/.exec(r.stdout || ""); // URL서 이슈 번호
        if (m) onCreated(Number(m[1])); else onCancel();
      } else {
        toast(t("github.issueCreateFailed") + (r.detail ? ` (${r.detail})` : ""), "error");
      }
    } catch {
      toast(t("github.issueCreateFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800/60">
        <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("github.createIssue")}</span>
        <button type="button" onClick={onCancel} aria-label={t("common.cancel")}
          className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconX size={14} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto p-3">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("github.issueTitle")}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("github.issueBody")} rows={6}
          className="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
        <div>
          <MetaRow root={root} field="assignee" title={t("github.assignees")} empty={t("github.noAssignee")} {...assignees} />
          <MetaRow root={root} field="label" title={t("github.labels")} empty={t("github.noLabel")} {...labels} />
          <MetaRow root={root} field="milestone" title={t("github.milestone")} empty={t("github.noMilestone")} single {...milestone} />
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t("common.cancel")}</button>
        <button type="button" onClick={() => void submit()} disabled={!title.trim() || busy}
          className="flex items-center gap-1.5 rounded-lg bg-mustard-500 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-mustard-600 disabled:opacity-50">
          {busy ? <IconLoader2 size={14} className="animate-spin" aria-hidden /> : null}
          {t("github.createIssue")}
        </button>
      </div>
    </div>
  );
}

"use client";
// 트래커 이슈 행동(#1172) — 에이전트에게 보내기(터미널·Crew 역할), 작업공간 만들기(이름에 키 → 상태 동기화가 브랜치로 이슈를 찾음), Crew 카드(이슈 연결, 대기 칸).
import { useState } from "react";
import { IconFolderPlus, IconLayoutKanban, IconLoader2 } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import SendToAgent from "@/components/workspace/github/SendToAgent";
import { formatGithubHandoff, type GhHandoff } from "@/lib/githubHandoff";
import { openNewWorkspace } from "@/lib/repo/workspaceEvents";
import { trackerName } from "@/lib/repo/workspaceName";

export default function TrackerActions({ root, issue }: { root: string; issue: TrackerIssue }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const item: GhHandoff = { kind: "tracker", provider: issue.provider, key: issue.key, number: 0, title: issue.title, part: "body", url: issue.url, body: issue.body ?? "" };
  const toCard = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const op = { op: "create", title: `${issue.key} ${issue.title}`.slice(0, 200), body: formatGithubHandoff(item), status: "backlog", issue: { provider: issue.provider, key: issue.key, url: issue.url } };
      const j = await (await fetch("/api/crew/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, ...op }) })).json().catch(() => null);
      toast(j?.ok ? t("trackers.cardCreated", { key: issue.key }) : j?.error === "issue card exists" ? t("trackers.cardExists", { key: issue.key }) : t("crewchat.sendFailed"), j?.ok ? "success" : "error");
    } finally { setBusy(false); }
  };
  const btn = "inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SendToAgent root={root} item={item} size={12} label={t("github.sendToAgent")} buttonClass={btn} />
      <button type="button" onClick={() => openNewWorkspace(root, { kind: "tracker", name: trackerName(issue.key, issue.title, issue.branchName) })} className={btn}>
        <IconFolderPlus size={12} aria-hidden />{t("trackers.newWorkspace")}
      </button>
      <button type="button" onClick={() => void toCard()} disabled={busy} className={btn}>
        {busy ? <IconLoader2 size={12} className="animate-spin" aria-hidden /> : <IconLayoutKanban size={12} aria-hidden />}{t("trackers.toCard")}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useT, agentEnabled, sortAgents } from "@mustard/core";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";

// 겨루기 후보 고르기(#1174) — 감지되고 켜진 에이전트 칩을 누른 순서대로 후보(같은 에이전트 여러 번 가능, 최대 4개) + 같은 프롬프트.
// 새 작업공간 창과 겨루기 화면(#1313)이 같이 씀. 화면에 뜰 때 에이전트를 한 번 감지(＋ 메뉴와 같은 목록)
export const FANOUT_MAX = 4;
export const fanoutReady = (picks: string[], prompt: string) => picks.length >= 2 && !!prompt.trim();

export function FanoutPicker({ picks, setPicks, prompt, setPrompt, inputClass, disabled }: {
  picks: string[]; setPicks: (f: (p: string[]) => string[]) => void; prompt: string; setPrompt: (v: string) => void; inputClass: string; disabled?: boolean;
}) {
  const t = useT();
  const [agents, setAgents] = useState<string[]>([]);
  useEffect(() => {
    void window.nunopiDesktop?.detectAgents?.(false).then((r) => { if (r.ok) setAgents(sortAgents(r.list.filter((a) => a.status === "ok" && agentEnabled(a.id))).map((a) => a.id)); }).catch(() => {});
  }, []);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {agents.map((a) => (
          <button key={a} type="button" disabled={disabled || picks.length >= FANOUT_MAX} onClick={() => setPicks((p) => [...p, a])}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">
            <AgentLogo agent={a as AgentId} size={13} />{AGENT_META[a as AgentId]?.label ?? a}
          </button>
        ))}
        {!agents.length && <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{t("fanout.noAgents")}</span>}
      </div>
      <div className="flex min-h-[30px] flex-wrap items-center gap-1 rounded-lg bg-zinc-50 px-2 py-1 dark:bg-white/[0.03]">
        {picks.length ? picks.map((a, i) => (
          <button key={i} type="button" disabled={disabled} onClick={() => setPicks((p) => p.filter((_, j) => j !== i))} title={t("fanout.removePick")}
            className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white transition dark:bg-zinc-100 dark:text-zinc-900">
            <AgentLogo agent={a as AgentId} size={13} />{AGENT_META[a as AgentId]?.label ?? a}<span aria-hidden>×</span>
          </button>
        )) : <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{t("fanout.pickHint")}</span>}
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={disabled} rows={4} placeholder={t("fanout.promptPlaceholder")} className={`${inputClass} resize-y`} />
    </div>
  );
}

// setup 스크립트 승인 상자 — 처음 보는(또는 바뀐) 스크립트면 내용을 보여 주고 돌릴지 묻기
export function SetupApproval({ script, busy, onDecide, className = "" }: { script: string; busy: boolean; onDecide: (trust: boolean) => void; className?: string }) {
  const t = useT();
  return (
    <div className={`rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/[0.07] ${className}`}>
      <div className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">{t("newWs.setupTitle")}</div>
      <pre className="nunopi-scroll mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 font-mono text-[11.5px] leading-relaxed text-zinc-700 dark:bg-black/30 dark:text-zinc-300">{script}</pre>
      <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{t("newWs.setupHint")}</p>
      <div className="mt-2 flex justify-end gap-1.5">
        <button type="button" disabled={busy} onClick={() => onDecide(false)} className="rounded-lg px-3 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-amber-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">{t("newWs.skip")}</button>
        <button type="button" disabled={busy} onClick={() => onDecide(true)} className="rounded-lg bg-amber-500 px-3 py-1 text-[12px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40">{t("newWs.trustRun")}</button>
      </div>
    </div>
  );
}

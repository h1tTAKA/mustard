"use client";

import { useEffect, useRef, useState } from "react";
import { useT, agentEnabled, sortAgents } from "@mustard/core";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import { MODEL_FLAG_AGENTS } from "@/lib/agentLaunch";

// 겨루기 후보 고르기(#1174) — 감지되고 켜진 에이전트 칩을 누른 순서대로 후보(같은 에이전트 여러 번 가능, 최대 4개) + 같은 프롬프트.
// 새 작업공간 창과 겨루기 화면(#1313)이 같이 씀. 화면에 뜰 때 에이전트를 한 번 감지(＋ 메뉴와 같은 목록)
// 후보마다 모델(#1313) — 회사마다 모델이 달라 같은 에이전트도 모델을 바꿔 겨룰 수 있게. 비우면 그 에이전트 기본(설정 추가 인자 그대로)
export const FANOUT_MAX = 4;
export type FanoutPick = { agent: string; model: string };
export const fanoutReady = (picks: FanoutPick[], prompt: string) => picks.length >= 2 && !!prompt.trim();
// 모델 이름 제안 — 설정 화면과 같은 목록(/api/agent/models)이 있는 에이전트만, 나머지는 직접 입력
const MODEL_LIST: Record<string, string> = { claude: "claude-agent", codex: "codex-agent", opencode: "opencode-agent" };
// 모델 목록 묻기 — providerId(claude-agent 등)마다 한 번. 후보 칸과 심사 모델 칸이 같이 씀
export function useModelLists(pids: string[]) {
  const [lists, setLists] = useState<Record<string, { models: string[]; def: string }>>({});
  const asked = useRef(new Set<string>());
  const want = pids.join(",");
  useEffect(() => {
    for (const p of want ? want.split(",") : []) {
      if (asked.current.has(p)) continue;
      asked.current.add(p);
      void fetch(`/api/agent/models?providerId=${p}`).then((r) => r.json()).then((d) => { if (d.ok) setLists((m) => ({ ...m, [p]: { models: d.models.map((x: { id: string }) => x.id), def: String(d.defaultModel ?? "") } })); }).catch(() => {});
    }
  }, [want]);
  return lists;
}

export function FanoutPicker({ picks, setPicks, prompt, setPrompt, inputClass, disabled }: {
  picks: FanoutPick[]; setPicks: (f: (p: FanoutPick[]) => FanoutPick[]) => void; prompt: string; setPrompt: (v: string) => void; inputClass: string; disabled?: boolean;
}) {
  const t = useT();
  const [agents, setAgents] = useState<string[]>([]);
  useEffect(() => {
    void window.nunopiDesktop?.detectAgents?.(false).then((r) => { if (r.ok) setAgents(sortAgents(r.list.filter((a) => a.status === "ok" && agentEnabled(a.id))).map((a) => a.id)); }).catch(() => {});
  }, []);
  const lists = useModelLists([...new Set(picks.map((p) => MODEL_LIST[p.agent]).filter(Boolean))]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {agents.map((a) => (
          <button key={a} type="button" disabled={disabled || picks.length >= FANOUT_MAX} onClick={() => setPicks((p) => [...p, { agent: a, model: "" }])}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">
            <AgentLogo agent={a as AgentId} size={13} />{AGENT_META[a as AgentId]?.label ?? a}
          </button>
        ))}
        {!agents.length && <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{t("fanout.noAgents")}</span>}
      </div>
      <div className="flex min-h-[30px] flex-wrap items-center gap-1 rounded-lg bg-zinc-50 px-2 py-1 dark:bg-white/[0.03]">
        {picks.length ? picks.map(({ agent: a }, i) => (
          <button key={i} type="button" disabled={disabled} onClick={() => setPicks((p) => p.filter((_, j) => j !== i))} title={t("fanout.removePick")}
            className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white transition dark:bg-zinc-100 dark:text-zinc-900">
            <AgentLogo agent={a as AgentId} size={13} />{AGENT_META[a as AgentId]?.label ?? a}<span aria-hidden>×</span>
          </button>
        )) : <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{t("fanout.pickHint")}</span>}
      </div>
      {picks.some((p) => MODEL_FLAG_AGENTS.has(p.agent)) && (
        <div className="space-y-1">
          {picks.map((p, i) => MODEL_FLAG_AGENTS.has(p.agent) && (
            <div key={i} className="flex items-center gap-1.5">
              <AgentLogo agent={p.agent as AgentId} size={13} />
              <input value={p.model} disabled={disabled} list={`fanout-models-${p.agent}`} placeholder={t("fanout.modelPlaceholder")} aria-label={`${AGENT_META[p.agent as AgentId]?.label ?? p.agent} ${i + 1}`}
                onChange={(e) => { const v = e.target.value; setPicks((ps) => ps.map((x, j) => (j === i ? { ...x, model: v } : x))); }} className={`${inputClass} font-mono`} />
            </div>
          ))}
          {Object.entries(MODEL_LIST).map(([a, p]) => lists[p] && <datalist key={a} id={`fanout-models-${a}`}>{lists[p].models.map((id) => <option key={id} value={id} />)}</datalist>)}
        </div>
      )}
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

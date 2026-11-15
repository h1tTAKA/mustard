"use client";
// 처음 여는 레포의 터미널 칸 시작 고르기(#1341) — 이전 작업이 없을 때 셸을 바로 띄우지 않고 묻는다.
// 왼쪽 터미널: ＋ 메뉴와 같은 목록(새 터미널 · 기본 에이전트 · 감지된 에이전트). 오른쪽 채팅: 실행 AI → 모델 → [채팅 시작].
// 설정 > 채팅 '처음 여는 레포'가 물어보기일 때만 나옴(터미널·채팅으로 정해 두면 바로 그 모드).
import { useEffect, useState } from "react";
import { IconTerminal2, IconMessageCircle, IconArrowRight } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { AgentLogo, type AgentId } from "@/components/workspace/AgentLogo";
import { PROVIDERS, type Provider } from "@/components/workspace/ChatComposer";

type ModelInfo = { id: string; label: string; legacy?: boolean };

export default function PaneStart({ agents, defaultPick, onTerminal, onChat }: {
  agents: { id: string; label: string }[]; defaultPick: string | null;
  onTerminal: (agent: string | null) => void; onChat: (provider: Provider, model?: string) => void;
}) {
  const t = useT();
  const providers = PROVIDERS.filter((p) => !agents.length || agents.some((a) => a.id === p.agent));
  const [provider, setProvider] = useState<Provider | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [model, setModel] = useState("");
  useEffect(() => {
    if (!provider) return;
    let alive = true;
    setModels(null); // eslint-disable-line react-hooks/set-state-in-effect -- 실행 AI를 바꾸면 그 모델 목록
    void fetch(`/api/chat/models?provider=${provider}`).then((r) => r.json()).then((j) => { if (!alive) return; const ms = (j.models ?? []) as ModelInfo[]; setModels(ms); setModel(ms.find((m) => !m.legacy)?.id ?? ms[0]?.id ?? ""); }).catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [provider]);

  const row = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-zinc-700 transition hover:bg-mustard-500/10 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-mustard-400/10 dark:hover:text-white";
  const card = "flex min-w-0 flex-1 flex-col rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/60";
  const head = "flex items-center gap-2 px-3 pb-1.5 pt-2 text-[13px] font-medium text-zinc-800 dark:text-zinc-100";
  return (
    <div className="nunopi-scroll flex h-full flex-col items-center justify-center overflow-y-auto bg-white p-6 dark:bg-[var(--s-pane)]">
      <p className="mb-1 text-base font-medium text-zinc-800 dark:text-zinc-100">{t("paneStart.title")}</p>
      <p className="mb-5 text-xs text-zinc-500 dark:text-zinc-400">{t("paneStart.sub")}</p>
      <div className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row">
        <div className={card}>
          <p className={head}><IconTerminal2 size={16} stroke={1.8} className="text-mustard-600 dark:text-mustard-400" aria-hidden />{t("achat.modeTerminal")}</p>
          <button type="button" onClick={() => onTerminal(null)} className={row}><IconTerminal2 size={15} stroke={1.8} aria-hidden />{t("workspace.terminalNew")}</button>
          {defaultPick && <button type="button" onClick={() => onTerminal(defaultPick)} className={`${row} font-medium`}><AgentLogo agent={defaultPick as AgentId} size={15} />{t("workspace.launchDefaultAgent")}</button>}
          {agents.length > 0 && <div className="mx-3 my-1 border-t border-zinc-100 dark:border-zinc-800" />}
          {agents.map((a) => <button key={a.id} type="button" onClick={() => onTerminal(a.id)} className={row}><AgentLogo agent={a.id as AgentId} size={15} />{a.label}</button>)}
        </div>
        <div className={card}>
          <p className={head}><IconMessageCircle size={16} stroke={1.8} className="text-mustard-600 dark:text-mustard-400" aria-hidden />{t("achat.modeChat")}</p>
          {providers.map((p) => (
            <button key={p.id} type="button" onClick={() => setProvider(p.id)} aria-pressed={provider === p.id}
              className={`${row} ${provider === p.id ? "bg-mustard-500/10 font-medium text-zinc-900 dark:bg-mustard-400/10 dark:text-white" : ""}`}>
              <AgentLogo agent={p.agent} size={15} />{p.label}
            </button>
          ))}
          {provider && (
            <div className="mt-1 flex items-center gap-2 border-t border-zinc-100 px-3 pb-1 pt-2.5 dark:border-zinc-800">
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!models} aria-label={t("achat.pickModel")}
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[13px] text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                {(models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <button type="button" onClick={() => onChat(provider, model || undefined)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-mustard-500 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-mustard-600">
                {t("paneStart.startChat")}<IconArrowRight size={14} stroke={2} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

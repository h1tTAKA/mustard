"use client";
// 처음 여는 레포의 터미널 칸 시작 고르기(#1341) — 이전 작업이 없을 때 셸을 바로 띄우지 않고 묻는다.
// 위: 제목 + [채팅 | 터미널] 전환. 채팅 = 입력 카드에 첫 메시지를 쓰고 Enter → 고른 실행 AI·모델로 채팅을 열며 그 말을 보냄.
// 터미널 = 새 터미널·감지된 에이전트 로고 타일(기본 에이전트엔 배지). 설정 > 채팅 '처음 여는 레포'가 물어보기일 때만.
import { useEffect, useRef, useState } from "react";
import { IconTerminal2, IconMessageCircle, IconArrowUp, IconChevronDown, IconCheck } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { AgentLogo, type AgentId } from "@/components/workspace/AgentLogo";
import { P, PROVIDERS, type Provider } from "@/components/workspace/ChatComposer";

type ModelInfo = { id: string; label: string; description?: string; legacy?: boolean };

export default function PaneStart({ agents, defaultPick, onTerminal, onChat }: {
  agents: { id: string; label: string }[]; defaultPick: string | null;
  onTerminal: (agent: string | null) => void; onChat: (provider: Provider, model?: string, text?: string) => void;
}) {
  const t = useT();
  const providers = PROVIDERS.filter((p) => !agents.length || agents.some((a) => a.id === p.agent));
  const [tab, setTab] = useState<"chat" | "term">("chat");
  const [provider, setProvider] = useState<Provider>(providers[0]?.id ?? "claude-code");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [model, setModel] = useState("");
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (tab === "chat") taRef.current?.focus(); }, [tab]);
  useEffect(() => {
    let alive = true;
    setModels(null); // eslint-disable-line react-hooks/set-state-in-effect -- 실행 AI를 바꾸면 그 모델 목록
    void fetch(`/api/chat/models?provider=${provider}`).then((r) => r.json()).then((j) => { if (!alive) return; const ms = (j.models ?? []) as ModelInfo[]; setModels(ms); setModel(ms.find((m) => !m.legacy)?.id ?? ms[0]?.id ?? ""); }).catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [provider]);
  const start = () => onChat(provider, model || undefined, text.trim() || undefined);
  const modelLabel = (models?.find((m) => m.id === model)?.label ?? model).replace(/^Claude /, "");
  const seg = (on: boolean) => `flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[13px] transition ${on ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`;
  const tile = "group relative flex flex-col items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:border-mustard-400/70 hover:bg-mustard-500/[.04] dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:hover:border-mustard-400/50 dark:hover:bg-mustard-400/[.05]";

  return (
    <div className="nunopi-scroll flex h-full flex-col items-center justify-center overflow-y-auto bg-white px-4 py-8 dark:bg-[var(--s-pane)]">
      <div className="flex w-full max-w-xl flex-col items-center">
        <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-mustard-500/10 text-mustard-600 dark:bg-mustard-400/10 dark:text-mustard-400">
          {tab === "chat" ? <IconMessageCircle size={22} stroke={1.6} aria-hidden /> : <IconTerminal2 size={22} stroke={1.6} aria-hidden />}
        </span>
        <p className="text-base font-medium text-zinc-800 dark:text-zinc-100">{t("paneStart.title")}</p>
        <p className="mb-5 mt-1 text-center text-xs text-zinc-500 dark:text-zinc-400">{t("paneStart.sub")}</p>
        <div role="tablist" className="mb-5 flex rounded-full bg-zinc-100 p-1 dark:bg-zinc-800">
          <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")} className={seg(tab === "chat")}><IconMessageCircle size={14} stroke={1.8} aria-hidden />{t("achat.modeChat")}</button>
          <button type="button" role="tab" aria-selected={tab === "term"} onClick={() => setTab("term")} className={seg(tab === "term")}><IconTerminal2 size={14} stroke={1.8} aria-hidden />{t("achat.modeTerminal")}</button>
        </div>

        {tab === "chat" ? (
          // 첫 메시지를 바로 — 실행 AI·모델은 카드 안 알약
          <div className="w-full rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm transition focus-within:border-mustard-400/70 focus-within:ring-4 focus-within:ring-mustard-400/10 dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:focus-within:border-mustard-400/50">
            <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={t("paneStart.placeholder", { agent: P(provider).label })}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); start(); } }}
              className="block max-h-48 min-h-14 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-zinc-800 outline-none [field-sizing:content] placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500" />
            <div className="flex items-center gap-2 pt-0.5">
              <div className="relative min-w-0">
                <button type="button" onClick={() => setMenu((v) => !v)}
                  className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-600 transition hover:bg-black/[.06] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100">
                  <AgentLogo agent={P(provider).agent} size={13} /><span className="truncate">{P(provider).label} · {models ? modelLabel : "…"}</span><IconChevronDown size={12} stroke={2} className="shrink-0 opacity-60" aria-hidden />
                </button>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden />
                    <div className="absolute left-0 top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-black/[.14] bg-white/95 p-1 shadow-lg backdrop-blur-2xl dark:border-white/[.12] dark:bg-zinc-800/95">
                      <div className="flex flex-wrap gap-1 border-b border-black/[.08] px-1.5 pb-1.5 pt-1 dark:border-white/[.08]">
                        {providers.map((p) => (
                          <button key={p.id} type="button" onClick={() => setProvider(p.id)}
                            className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition ${p.id === provider ? "bg-mustard-500/15 font-medium text-mustard-700 dark:text-mustard-300" : "text-zinc-600 hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.08]"}`}>
                            <AgentLogo agent={p.agent} size={12} />{p.label}
                          </button>
                        ))}
                      </div>
                      <div className="nunopi-scroll max-h-60 overflow-y-auto py-1">
                        {(models ?? []).filter((m) => !m.legacy).map((m) => (
                          <button key={m.id} type="button" onClick={() => { setModel(m.id); setMenu(false); taRef.current?.focus(); }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-black/[.05] dark:hover:bg-white/[.08]">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-zinc-800 dark:text-zinc-100">{m.label}</span>
                              {m.description && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{m.description}</span>}
                            </span>
                            {m.id === model && <IconCheck size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <span className="ml-auto hidden text-[11px] text-zinc-400 sm:inline dark:text-zinc-500">{t("paneStart.enterHint")}</span>
              <button type="button" onClick={start} aria-label={t("paneStart.startChat")} title={t("paneStart.startChat")}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mustard-500 text-white transition hover:bg-mustard-600 active:opacity-70">
                <IconArrowUp size={16} stroke={2.5} aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          // 터미널 — 로고 타일(새 터미널 + 감지된 에이전트, 기본엔 배지)
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => onTerminal(null)} className={tile}>
              <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><IconTerminal2 size={17} stroke={1.8} aria-hidden /></span>
              <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{t("workspace.terminalNew")}</span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("paneStart.shellOnly")}</span>
            </button>
            {agents.map((a) => (
              <button key={a.id} type="button" onClick={() => onTerminal(a.id)} className={tile}>
                {a.id === defaultPick && <span className="absolute right-2 top-2 rounded bg-mustard-500/15 px-1.5 text-[10.5px] font-medium text-mustard-700 dark:text-mustard-300">{t("paneStart.default")}</span>}
                <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800"><AgentLogo agent={a.id as AgentId} size={17} /></span>
                <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{a.label}</span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("paneStart.inTerminal")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

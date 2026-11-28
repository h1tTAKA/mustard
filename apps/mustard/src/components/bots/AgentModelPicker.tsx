"use client";
// 실행 AI·모델 고르기(#1397 새 봇 창) — 로고 + "AI · 모델" 알약, 누르면 위로 펼침: AI 칩 줄(설치된 것만) + 모델 목록(체크).
// 모양은 레포 첫 화면 시작 고르기(PaneStart)의 알약·메뉴와 같게. 모델 목록은 /api/chat/models(채팅과 같은 출처).
import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { agentEnabled, useT } from "@mustard/core";
import { AgentLogo } from "@/components/workspace/AgentLogo";
import { P, PROVIDERS, type Provider } from "@/components/workspace/ChatComposer";

type ModelInfo = { id: string; label: string; description?: string; legacy?: boolean };

export default function AgentModelPicker({ provider, model, onChange, onAvailable }: {
  provider: Provider; model: string; onChange: (provider: Provider, model: string, byUser?: boolean) => void; // byUser = 사람이 메뉴에서 고름(스스로 맞춤은 아님, #1399 설정 창)
  onAvailable?: (ok: boolean) => void; // 설치·켜진 AI가 하나도 없으면 false(만들기 막기)
}) {
  const t = useT();
  const [installed, setInstalled] = useState<Set<string> | null>(null); // null = 감지 전·웹(전부 보임)
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); triggerRef.current?.focus(); }; // 닫으면 알약으로 포커스(창 첫 칸으로 튀지 않게, 리뷰)

  // 설치·켜진 AI만(채팅 창과 같은 규칙). 감지 실패면 전부.
  useEffect(() => {
    void window.nunopiDesktop?.detectAgents?.(false).then((r) => { if (r.ok) setInstalled(new Set(r.list.filter((a) => a.status === "ok" && agentEnabled(a.id)).map((a) => a.id))); }).catch(() => {});
  }, []);
  // 감지 전(null)·웹은 전부. 감지됐는데 0개면 0개(설치 안 된 AI로 봇을 만들지 않게, 리뷰)
  const providers = useMemo(() => PROVIDERS.filter((p) => !installed || installed.has(p.agent)), [installed]);
  useEffect(() => { onAvailable?.(providers.length > 0); }, [providers, onAvailable]);
  // 고른 AI가 설치 목록에 없으면(감지 뒤) 첫 설치 AI로
  useEffect(() => {
    if (providers.length && !providers.some((p) => p.id === provider)) onChange(providers[0].id, "");
  }, [providers, provider, onChange]);

  // AI를 바꾸면 그 모델 목록 — 모델이 비었거나 목록에 없으면 첫 최신 모델
  useEffect(() => {
    let alive = true;
    setModels(null); // eslint-disable-line react-hooks/set-state-in-effect -- 실행 AI가 바뀌면 목록 다시
    void fetch(`/api/chat/models?provider=${provider}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const ms = ((j.models ?? []) as ModelInfo[]).filter((m) => !m.legacy);
      setModels(ms);
      if (!ms.some((m) => m.id === model)) onChange(provider, ms[0]?.id ?? "");
    }).catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps -- model·onChange는 목록 받을 때 한 번만 맞춤

  // 메뉴가 열려 있으면 Esc는 메뉴만 닫음(새 봇 창까지 닫히지 않게 — 창의 window 리스너보다 먼저 잡음)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setOpen(false); triggerRef.current?.focus(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const modelLabel = (models?.find((m) => m.id === model)?.label ?? model).replace(/^Claude /, "");
  return (
    <div className="relative min-w-0">
      <button ref={triggerRef} type="button" onClick={() => setOpen((v) => !v)} disabled={!providers.length} aria-expanded={open} aria-label={t("bots.new.agent")}
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[12.5px] text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-zinc-50">
        {providers.length ? <AgentLogo agent={P(provider).agent} size={14} /> : null}
        <span className="truncate font-medium">{providers.length ? P(provider).label : t("bots.new.noAgent")}</span>
        {(models === null || modelLabel) && <span className="truncate text-zinc-400 dark:text-zinc-500">· {models ? modelLabel : "…"}</span>}
        <IconChevronDown size={12} stroke={2} className="shrink-0 opacity-60" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
          {/* 창 아래쪽에 있어서 위로 펼침 */}
          <div className="absolute bottom-full left-0 z-50 mb-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-black/[.14] bg-white/95 p-1 shadow-lg backdrop-blur-2xl dark:border-white/[.12] dark:bg-zinc-800/95">
            <div className="flex flex-wrap gap-1 border-b border-black/[.08] px-1.5 pb-1.5 pt-1 dark:border-white/[.08]">
              {providers.map((p) => (
                <button key={p.id} type="button" onClick={() => onChange(p.id, p.id === provider ? model : "", true)} aria-pressed={p.id === provider}
                  className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition ${p.id === provider ? "bg-mustard-500/15 font-medium text-mustard-700 dark:text-mustard-300" : "text-zinc-600 hover:bg-black/[.05] dark:text-zinc-300 dark:hover:bg-white/[.08]"}`}>
                  <AgentLogo agent={p.agent} size={12} />{p.label}
                </button>
              ))}
            </div>
            <div className="nunopi-scroll max-h-60 overflow-y-auto py-1">
              {models === null ? (
                <p className="px-2.5 py-1.5 text-xs text-zinc-400">…</p>
              ) : models.length === 0 ? (
                <p className="px-2.5 py-1.5 text-xs text-zinc-400 dark:text-zinc-500">{t("bots.new.defaultModel")}</p>
              ) : models.map((m) => (
                <button key={m.id} type="button" aria-pressed={m.id === model} onClick={() => { onChange(provider, m.id, true); close(); }}
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
  );
}

"use client";
// 봇 홈 첫 실행·새 봇(#1397) — 맡길 일 한 줄(또는 칩) → /api/crew/bots/recommend → 카드 3개 → 바로 설치.
// 레포 탭이 열려 있으면 그 레포 언어를 추천에 씀(root). 직접 만들기·카탈로그 전체 창은 H3.
import { useRef, useState, type FormEvent } from "react";
import { IconRobot, IconLoader2, IconCheck } from "@tabler/icons-react";
import { useLocale, useT, useToast } from "@mustard/core";
import type { CatalogItem } from "@/lib/crew/crewCatalog";
import BotAvatar from "./BotAvatar";
import type { Bot } from "./useBots";

const CHIPS = ["review", "release", "ci", "mail", "security", "docs"] as const;
const CARD_COLOR = "#e8b93a"; // 설치 전 카드는 브랜드 겨자색 하나(설치하면 봇 색이 정해짐)

export default function BotOnboard({ catalog, bots, root, install, onOpen }: {
  catalog: CatalogItem[]; bots: Bot[]; root?: string;
  install: (catalog: string) => Promise<boolean>; onOpen: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const [want, setWant] = useState("");
  const [asking, setAsking] = useState(false);
  const [picks, setPicks] = useState<string[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const reqRef = useRef(0); // 늦게 온 옛 답이 새 답을 덮지 않게
  const abortRef = useRef<AbortController | null>(null); // 새로 물으면 앞 요청은 취소(AI가 오래 걸려도 막히지 않게, 리뷰)

  const ask = async (text: string) => {
    const w = text.trim();
    if (!w) return;
    const my = ++reqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAsking(true);
    try {
      const j = await fetch("/api/crew/bots/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ want: w, root }), signal: ac.signal }).then((r) => r.json());
      if (my !== reqRef.current) return;
      if (!j?.ok) throw new Error(j?.error);
      setPicks(j.ids);
    } catch { if (my === reqRef.current) toast(t("bots.onboard.recommendFailed"), "error"); }
    finally { if (my === reqRef.current) setAsking(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(want); };
  const chip = (k: (typeof CHIPS)[number]) => { const w = t(`bots.onboard.chip.${k}`); setWant(w); void ask(w); };
  const doInstall = async (id: string) => {
    setInstalling(id);
    const ok = await install(id);
    setInstalling(null);
    if (ok) onOpen(id); else toast(t("bots.onboard.installFailed"), "error");
  };

  const items = (picks ?? []).map((id) => catalog.find((c) => c.id === id)).filter((c): c is CatalogItem => !!c);
  const nameOf = (c: CatalogItem) => (c.builtin ? t(`crew.role.${c.id}`) : c.name![locale]);
  const descOf = (c: CatalogItem) => (c.builtin ? t(`crew.roleDesc.${c.id}`) : c.desc![locale]);

  return (
    <div className="nunopi-scroll flex flex-1 justify-center overflow-y-auto px-6 py-10">
      <div className="my-auto flex w-full max-w-[640px] flex-col items-center gap-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-mustard-500/10 text-mustard-600 ring-1 ring-inset ring-mustard-500/25 dark:text-mustard-400">
          <IconRobot size={28} stroke={1.6} aria-hidden />
        </div>
        <div className="text-center">
          <h1 className="text-[22px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t("bots.onboard.title")}</h1>
          <p className="mt-2 text-[13.5px] text-zinc-500 dark:text-zinc-400">{t("bots.onboard.sub")}</p>
        </div>
        <form onSubmit={submit} className="flex h-[52px] w-full items-center gap-2.5 rounded-2xl border border-zinc-200 bg-white pl-4 pr-2 shadow-sm transition focus-within:border-mustard-400/70 focus-within:ring-4 focus-within:ring-mustard-400/10 dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:focus-within:border-mustard-400/50">
          <input type="text" value={want} onChange={(e) => setWant(e.target.value)} maxLength={500} placeholder={t("bots.onboard.placeholder")} aria-label={t("bots.onboard.want")}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500" />
          <button type="submit" disabled={!want.trim()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-mustard-500 px-4 text-[13px] font-semibold text-brown-900 transition hover:bg-mustard-400 disabled:opacity-50">
            {asking && <IconLoader2 size={14} stroke={2.2} className="animate-spin" aria-hidden />}
            {t(asking ? "bots.onboard.asking" : "bots.onboard.ask")}
          </button>
        </form>
        <div className="flex flex-wrap justify-center gap-2">
          {CHIPS.map((k) => (
            <button key={k} type="button" onClick={() => chip(k)}
              className="h-8 whitespace-nowrap rounded-full border border-zinc-200 bg-white px-3.5 text-[12.5px] text-zinc-600 transition hover:border-mustard-400 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:text-zinc-50">
              {t(`bots.onboard.chip.${k}`)}
            </button>
          ))}
        </div>
        {items.length > 0 && (
          <section aria-label={t("bots.onboard.picks")} className="mt-2 flex w-full flex-col gap-2">
            <h2 className="px-1 text-[12px] font-semibold text-zinc-500 dark:text-zinc-400">{t("bots.onboard.picks")}</h2>
            {items.map((c) => {
              const has = bots.some((b) => b.id === c.id);
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <BotAvatar name={nameOf(c)} color={CARD_COLOR} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50">{nameOf(c)}</div>
                    <div className="truncate text-[12.5px] text-zinc-500 dark:text-zinc-400">{descOf(c)}</div>
                  </div>
                  {has ? (
                    <button type="button" onClick={() => onOpen(c.id)}
                      className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                      <IconCheck size={14} stroke={2.2} className="text-emerald-500" aria-hidden /> {t("bots.onboard.open")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void doInstall(c.id)} disabled={installing !== null}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-300 px-3 text-[12.5px] font-semibold text-zinc-800 transition hover:border-mustard-500 hover:bg-mustard-500/10 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100">
                      {installing === c.id && <IconLoader2 size={14} stroke={2.2} className="animate-spin" aria-hidden />}
                      {t("bots.onboard.install")}
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

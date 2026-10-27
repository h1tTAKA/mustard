"use client";
// 설정 > 브라우저(#1209) — 인앱 브라우저 옵션. 로그인(쿠키)은 레포끼리 공유(유저 결정).
import { useState } from "react";
import { useT, useSetting, setSetting, useConfirm, useToast, BROWSER_KEYS, BROWSER_DEFAULTS } from "@mustard/core";

const ZOOMS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
const ENGINES = [["google", "Google"], ["duckduckgo", "DuckDuckGo"], ["bing", "Bing"], ["kagi", "Kagi"]] as const;
const select = "min-w-0 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export default function BrowserSection() {
  const t = useT();
  const engine = useSetting<string>(BROWSER_KEYS.searchEngine, BROWSER_DEFAULTS.searchEngine);
  const zoom = useSetting<number>(BROWSER_KEYS.defaultZoom, BROWSER_DEFAULTS.defaultZoom);
  const agent = useSetting<boolean>(BROWSER_KEYS.agentControl, BROWSER_DEFAULTS.agentControl);
  const confirm = useConfirm(), toast = useToast();
  const [clearing, setClearing] = useState(false);
  // 쿠키·저장소·캐시 통째로 — 로그인은 모든 레포가 같이 쓰니 전부 로그아웃(확인창)
  const clearData = async () => {
    if (!(await confirm({ title: t("browser.clearData"), message: t("browser.clearConfirm"), confirmText: t("browser.clearDo"), tone: "warn" }))) return;
    setClearing(true);
    const r = await window.nunopiDesktop?.clearBrowserData?.().catch(() => null);
    setClearing(false);
    toast(t(r?.ok ? "browser.cleared" : "browser.clearFailed"), r?.ok ? "success" : "error");
  };
  return (
    <section id="set-browser" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm text-zinc-700 dark:text-zinc-300">{t("browser.agentControl")}</span>
          <span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("browser.agentControlDesc")}</span>
        </span>
        <input type="checkbox" checked={agent} onChange={(e) => setSetting(BROWSER_KEYS.agentControl, e.target.checked)} className="size-4 shrink-0 accent-mustard-500" />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm text-zinc-700 dark:text-zinc-300">{t("browser.searchEngine")}</span>
          <span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("browser.searchEngineDesc")}</span>
        </span>
        <select value={engine} onChange={(e) => setSetting(BROWSER_KEYS.searchEngine, e.target.value)} className={select}>
          {ENGINES.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm text-zinc-700 dark:text-zinc-300">{t("browser.defaultZoom")}</span>
          <span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("browser.defaultZoomDesc")}</span>
        </span>
        <select value={zoom} onChange={(e) => setSetting(BROWSER_KEYS.defaultZoom, Number(e.target.value))} className={select}>
          {ZOOMS.map((z) => <option key={z} value={z}>{z}%</option>)}
        </select>
      </label>
      {typeof window !== "undefined" && window.nunopiDesktop?.clearBrowserData && (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm text-zinc-700 dark:text-zinc-300">{t("browser.clearData")}</span>
            <span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("browser.clearDataDesc")}</span>
          </span>
          <button type="button" onClick={() => void clearData()} disabled={clearing}
            className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-zinc-700 dark:text-rose-400 dark:hover:bg-rose-500/10">{t("browser.clearDo")}</button>
        </div>
      )}
    </section>
  );
}

"use client";
// 설정 > 브라우저(#1209) — 인앱 브라우저 옵션. 로그인(쿠키)은 레포끼리 공유(유저 결정).
import { useT, useSetting, setSetting, BROWSER_KEYS, BROWSER_DEFAULTS } from "@mustard/core";

const ENGINES = [["google", "Google"], ["duckduckgo", "DuckDuckGo"], ["bing", "Bing"], ["kagi", "Kagi"]] as const;
const select = "min-w-0 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export default function BrowserSection() {
  const t = useT();
  const engine = useSetting<string>(BROWSER_KEYS.searchEngine, BROWSER_DEFAULTS.searchEngine);
  return (
    <section id="set-browser" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm text-zinc-700 dark:text-zinc-300">{t("browser.searchEngine")}</span>
          <span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("browser.searchEngineDesc")}</span>
        </span>
        <select value={engine} onChange={(e) => setSetting(BROWSER_KEYS.searchEngine, e.target.value)} className={select}>
          {ENGINES.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
        </select>
      </label>
    </section>
  );
}

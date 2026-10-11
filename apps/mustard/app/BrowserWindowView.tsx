"use client";

// 인앱 브라우저 분리 창(#1034) — main이 ?win=browser&url=&repo= 로 띄움. 멀티 모니터용.
// 신호등(hiddenInset) 자리 + 창 드래그용 제목 줄 아래에 dock과 같은 BrowserPane.
import { useRef, useState } from "react";
import { I18nProvider } from "@mustard/core";
import BrowserPane, { type BrowserState } from "@/components/workspace/BrowserPane";

// 앱 창과 같은 origin이라 localStorage를 같이 씀 — 여기서 쓴 레포별 탭 상태를 앱 창이 storage 이벤트로 받음(#1034).
const key = (repo: string, k: string) => `nunopi:ws:${repo}:${k}`;
function store(k: string, v: string) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } }

export default function BrowserWindowView({ url, repo, devtools }: { url: string; repo: string; devtools?: boolean }) {
  // 시작 탭들 — 앱이 분리하면서 browser-detached에 적어둔 브라우저 통째(탭들·활성·devtools). 없으면 주소 하나.
  const [initial] = useState<BrowserState>(() => {
    try {
      const d = JSON.parse(localStorage.getItem(key(repo, "browser-detached")) || "null");
      const urls = Array.isArray(d?.urls) ? d.urls.filter((u: unknown): u is string => typeof u === "string") : [];
      if (urls.length) return { urls, active: Number(d.active) || 0, devtools: !!d.devtools };
    } catch { /* ignore */ }
    return { urls: [url], active: 0, devtools: !!devtools };
  });
  const [title, setTitle] = useState(initial.urls[initial.active] ?? url);
  // 이 창의 탭들을 레포별로 기억 — 창을 그냥 닫으면 앱에서 지구본 누를 때 그 탭들로 이어짐.
  const docked = useRef(false); // 앱으로 보낸 뒤 창이 닫히기 전 탭 변화가 지운 기억을 다시 쓰지 않게(#1041 리뷰)
  const onTabsChange = (urls: string[], active: number) => { setTitle(urls[active] ?? ""); if (repo && !docked.current) store(key(repo, "browser-detached"), urls.length ? JSON.stringify({ urls, active }) : ""); };
  // 앱 안으로: 탭들 전부를 넘기고(앱 창이 storage 이벤트로 받음) 이 창은 닫음. 이어보기 기억은 지움(중복 방지).
  const dock = (st: BrowserState) => { docked.current = true; store(key(repo, "browser-dock"), JSON.stringify({ ...st, n: Date.now() })); store(key(repo, "browser-detached"), ""); window.close(); };
  const name = repo.split("/").filter(Boolean).pop() ?? "";
  return (
    // h-screen: body가 min-h-full이라 h-full이 안 잡혀 webview가 짧게 잘렸음(AppShell과 같은 방식).
    <I18nProvider>
    <div className="flex h-screen w-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <header className="titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pl-[78px] pr-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {name && <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-200">{name}</span>}
        <span className="truncate">{title}</span>
      </header>
      <div className="min-h-0 flex-1"><BrowserPane repo={repo} initial={initial} onTabsChange={onTabsChange} onDock={repo ? dock : undefined} onEmpty={() => window.close()} /></div>
    </div>
    </I18nProvider>
  );
}

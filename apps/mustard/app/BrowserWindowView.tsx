"use client";

// 인앱 브라우저 분리 창(#1034) — main이 ?win=browser&url=&repo= 로 띄움. 멀티 모니터용.
// 신호등(hiddenInset) 자리 + 창 드래그용 제목 줄 아래에 dock과 같은 BrowserPane.
import { useState } from "react";
import { I18nProvider } from "@mustard/core";
import BrowserPane from "@/components/workspace/BrowserPane";

// 앱 창과 같은 origin이라 localStorage를 같이 씀 — 여기서 쓴 레포별 주소·열림 값을 앱 창이 storage 이벤트로 받음(#1034).
const key = (repo: string, k: string) => `nunopi:ws:${repo}:${k}`;
function store(k: string, v: string) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } }

export default function BrowserWindowView({ url, repo }: { url: string; repo: string }) {
  const [title, setTitle] = useState(url);
  // 보던 주소를 레포별로 기억 — 창 닫고 앱에서 지구본 눌러도 이어서 봄.
  const onUrlChange = (u: string) => { setTitle(u); if (repo) store(key(repo, "browser-url"), u); };
  // 앱 안으로: 주소 + "열림"을 남기면 앱 창이 dock에 열고, 이 창은 닫음.
  const dock = (u: string) => { store(key(repo, "browser-url"), u); store(key(repo, "browser-open"), "1"); window.close(); };
  const name = repo.split("/").filter(Boolean).pop() ?? "";
  return (
    // h-screen: body가 min-h-full이라 h-full이 안 잡혀 webview가 짧게 잘렸음(AppShell과 같은 방식).
    <I18nProvider>
    <div className="flex h-screen w-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <header className="titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pl-[78px] pr-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {name && <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-200">{name}</span>}
        <span className="truncate">{title}</span>
      </header>
      <div className="min-h-0 flex-1"><BrowserPane repo={repo} url={url} onUrlChange={onUrlChange} onDock={repo ? dock : undefined} /></div>
    </div>
    </I18nProvider>
  );
}

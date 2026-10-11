"use client";

// 인앱 브라우저 분리 창(#1034) — main이 ?win=browser&url=&repo= 로 띄움. 멀티 모니터용.
// 신호등(hiddenInset) 자리 + 창 드래그용 제목 줄 아래에 dock과 같은 BrowserPane.
import { useState } from "react";
import BrowserPane from "@/components/workspace/BrowserPane";

export default function BrowserWindowView({ url, repo }: { url: string; repo: string }) {
  const [title, setTitle] = useState(url);
  const name = repo.split("/").filter(Boolean).pop() ?? "";
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <header className="titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pl-[78px] pr-3 text-[12px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {name && <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-200">{name}</span>}
        <span className="truncate">{title}</span>
      </header>
      <div className="min-h-0 flex-1"><BrowserPane repo={repo} url={url} onUrlChange={setTitle} /></div>
    </div>
  );
}

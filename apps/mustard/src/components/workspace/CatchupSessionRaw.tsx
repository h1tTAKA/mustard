"use client";
// 커밋 세션 원본 대화(#1064) — 기본 접힘, 펼치면 서버에 저장된 구간을 처음 한 번 가져와 사용자/AI/도구 순서대로.
import { useRef, useState } from "react";
import { IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import type { SessionMsg } from "@/lib/agentSessionParse";

export default function CatchupSessionRaw({ root, hash }: { root: string; hash: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<SessionMsg[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loadingRef = useRef(false);

  const toggle = () => {
    const next = !open; setOpen(next);
    if (!next || msgs || loadingRef.current) return;
    setFailed(false); loadingRef.current = true;
    fetch(`/api/repo/session-link?root=${encodeURIComponent(root)}&hash=${encodeURIComponent(hash)}`).then((r) => r.json())
      .then((d) => { const m = d?.session?.messages; if (!Array.isArray(m)) throw new Error(); setMsgs(m as SessionMsg[]); })
      .catch(() => setFailed(true)).finally(() => { loadingRef.current = false; });
  };

  return (
    <div className="mb-2">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[10.5px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
        <IconChevronDown size={12} stroke={2} className={`transition ${open ? "" : "-rotate-90"}`} aria-hidden />
        {open ? t("learn.hideSession") : t("learn.showSession")}
      </button>
      {open && (
        failed ? <p className="mt-1 text-[10px] text-rose-500">{t("learn.sessionError")}</p>
        : !msgs ? <div className="flex justify-center py-2"><IconLoader2 size={12} stroke={2} className="animate-spin text-zinc-400" aria-hidden /></div>
        : (
          <div className="nunopi-scroll mt-1 flex max-h-96 flex-col gap-1.5 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
            {msgs.map((m, i) => m.role === "tool" ? (
              // 도구 호출·출력 — 작게, 고정폭, 길면 4줄까지(펼친 상자 안 스크롤로 전체는 원본 파일에)
              <div key={i} className="line-clamp-4 whitespace-pre-wrap break-all rounded bg-zinc-50 px-1.5 py-1 font-mono text-[10px] leading-snug text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">{m.text}</div>
            ) : m.role === "user" ? (
              <div key={i} className="self-end max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-mustard-500/12 px-2 py-1 text-[11px] leading-snug text-zinc-800 dark:text-zinc-100">{m.text}</div>
            ) : (
              <div key={i} className="whitespace-pre-wrap break-words px-0.5 text-[11px] leading-snug text-zinc-700 dark:text-zinc-200">{m.text}</div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

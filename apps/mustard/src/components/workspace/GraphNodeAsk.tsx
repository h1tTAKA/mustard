"use client";
// 코드 그래프 노드 질문(#1326) — 오른쪽 상세의 노드 설명 아래 접이식. 대화는 질문 화면의 그 파일 세션(file:<경로>)에 이어 씀
// → 캐치업 > 질문 이력·코드 탭 "이 파일에 대해 질문"과 같은 대화로 남음(lib/wsChatStore).
// 컨텍스트 = 그 파일 내용 + 노드 이름·종류·줄 + 지금 보이는 노드 설명. 요청은 질문 화면과 같은 chat 모드(레포 읽기 전용 도구).
// 파일마다 key로 새로 붙임(부모) — 답을 기다리는 중 다른 노드로 가도 답은 원래 파일 세션에 저장되고 화면은 섞이지 않음. 접힘 상태는 부모가 들고 있음.
// 한계: 질문 화면에서 같은 파일 세션에 동시에 답을 기다리면 늦게 끝난 쪽 대화가 남음.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronRight, IconArrowUp, IconLoader2 } from "@tabler/icons-react";
import { useT, useLocale, Markdown, stripCardBlock, relocalizeFailure } from "@mustard/core";
import type { AgentProviderKind, ChatMessage, ProviderSettings } from "@mustard/core";
import { readSessionThread, appendSessionMessages, WS_CHAT_EVENT } from "@/lib/wsChatStore";

type StreamEvent = { type: string; line?: string; message?: string; response?: { summary?: string } };

export default function GraphNodeAsk({ root, file, label, kind, line, note, providerId, providerSettings, open, onToggle }: {
  root: string; file: string; label: string; kind: string; line?: number; note?: string; open: boolean; onToggle: () => void;
  providerId: AgentProviderKind; providerSettings: ProviderSettings;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const key = `file:${file}`;
  const repoLabel = t("workspace.chatRepo");
  const subRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => { const r = readSessionThread(root, key, repoLabel); subRef.current = r.subId; setMsgs(r.messages); }, [root, key, repoLabel]);
  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- 파일 바뀌면 그 파일 대화 복원
    const on = (e: Event) => { if ((e as CustomEvent<{ root?: string }>).detail?.root === root) load(); }; // 질문 화면 등 다른 곳에서 쓴 것도 반영
    window.addEventListener(WS_CHAT_EVENT, on);
    return () => window.removeEventListener(WS_CHAT_EVENT, on);
  }, [root, load]);
  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ block: "end" }); }, [open, msgs.length, streaming]);

  // 덧붙이기만(저장소 최신 + add) — 기다리는 사이 다른 곳이 쓴 것도 보존. 화면은 이벤트로 다시 읽음.
  const append = (add: ChatMessage[]) => { subRef.current = appendSessionMessages(root, key, "file", file.split("/").pop() ?? file, add, repoLabel, subRef.current); };

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const thread: ChatMessage[] = [...msgs, { role: "user", content: text }];
    append([thread[thread.length - 1]]);
    setBusy(true); setStreaming("");
    let answer = "";
    try {
      let src = "";
      try { const r = await fetch("/api/repo/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, file }) }); const d = await r.json(); if (r.ok) src = String(d.content ?? ""); } catch { /* 파일 못 읽어도 질문은 감 */ }
      const ctx = `# 코드 그래프에서 고른 노드: ${label} (${kind}) @ ${file}${line ? `:${line}` : ""}\n`
        + (note ? `\n# 이 노드 설명(앞서 보여 준 것)\n${note}\n` : "")
        + (src ? `\n# 그 파일: ${file}\n\`\`\`\n${src}\n\`\`\`\n` : "");
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: thread, providerSettings, noCards: true, workspaceRoot: root } }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "", err = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) {
          if (!l.trim()) continue;
          let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
          if (ev.type === "progress" && providerId !== "codex-agent") setStreaming(ev.line ?? "");
          else if (ev.type === "result") answer = ev.response?.summary ?? "";
          else if (ev.type === "error") err = ev.message ?? "error";
        }
      }
      if (!answer && err) throw new Error(err);
      append([{ role: "assistant", content: answer || t("fallback.emptyResponse") }]);
    } catch {
      append([{ role: "assistant", content: t("fallback.error") }]);
    } finally { setBusy(false); setStreaming(null); }
  }

  const asked = msgs.filter((m) => m.role === "user").length;
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex items-center gap-1 self-start text-[10px] font-semibold uppercase tracking-wide text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
        <IconChevronRight size={12} stroke={2.5} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        {t("graph.ask")}{asked > 0 && ` (${asked})`}
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
          {!msgs.length && streaming == null && <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("graph.askEmpty")}</p>}
          {msgs.map((m, i) => m.role === "user"
            ? <div key={i} className="self-end max-w-[90%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-3 py-1.5 text-[12px] leading-relaxed text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">{m.content}</div>
            : <div key={i} className="max-w-full text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200"><Markdown>{stripCardBlock(relocalizeFailure(m.content, t))}</Markdown></div>)}
          {busy && streaming != null && (
            <div className="max-w-full text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
              {streaming ? <Markdown>{stripCardBlock(streaming)}</Markdown> : <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden /> {t("chat.replying")}</span>}
            </div>
          )}
          <div ref={bottomRef} />
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-1.5">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={t("graph.askPlaceholder")}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              className="max-h-28 min-h-[32px] flex-1 resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[12px] text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500" />
            <button type="submit" disabled={!input.trim() || busy} aria-label={t("learn.askSend")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mustard-500 text-white transition hover:bg-mustard-600 disabled:opacity-40">
              {busy ? <IconLoader2 size={14} stroke={2} className="animate-spin" aria-hidden /> : <IconArrowUp size={14} stroke={2.5} aria-hidden />}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

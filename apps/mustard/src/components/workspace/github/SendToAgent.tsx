"use client";
// 종이비행기(#1129) — 이슈·PR 본문·댓글·줄 리뷰 댓글을 에이전트에게. 덧붙일 말(선택) + 보낼 곳:
// 터미널 에이전트(sendToAgent — 셸이면 안 보냄, 붙여넣기+Enter, 보낸 터미널로 포커스) / Crew 역할(@역할 채팅 → 카드 시작).
import { useEffect, useRef, useState } from "react";
import { IconSend, IconTerminal2, IconLoader2 } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import { sendToAgent } from "@/lib/browser/sendToAgent";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";
import { RoleIcon, roleName, useCrewRoles } from "@/components/workspace/crew/crewUi";
import { formatGithubHandoff, type GhHandoff } from "@/lib/githubHandoff";

export default function SendToAgent({ root, item, size = 12 }: { root: string; item: GhHandoff; size?: number }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "term" | 역할 id
  const box = useRef<HTMLDivElement>(null);
  // 밖을 누르거나 Esc면 닫기
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", down); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [open]);

  const done = () => { setOpen(false); setNote(""); };
  const toTerminal = async () => {
    if (busy) return;
    setBusy("term");
    try {
      const r = await sendToAgent(root, formatGithubHandoff(item, note));
      if (!r.ok) { toast(r.reason === "no-agent" ? t("browser.pickNoAgent") : t("github.sendFailed"), "error"); return; } // 진짜 오류를 "터미널 없음"으로 감추지 않게
      requestTerminalFocus(root, r.id); // 보낸 터미널 탭으로
      toast(t("github.sentToAgent"), "success"); done();
    } finally { setBusy(null); }
  };
  const toCrew = async (role: string) => {
    if (busy) return;
    setBusy(role);
    try {
      const text = `@${role} ${formatGithubHandoff(item, note)}`; // 덧붙인 말·제목·본문을 각각 잘라 8000자 안쪽(펜스 안 잘림)
      const j = await (await fetch("/api/crew/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, text }) })).json().catch(() => null);
      if (!j?.ok) { toast(t("crewchat.sendFailed"), "error"); return; }
      toast(j.created ? t("crewchat.created") : t("github.sentToCrew"), "success"); done();
    } catch { toast(t("crewchat.sendFailed"), "error"); } finally { setBusy(null); }
  };

  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11.5px] text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800";
  return (
    <div ref={box} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((v) => !v)} title={t("github.sendToAgent")} aria-label={t("github.sendToAgent")} aria-expanded={open}
        className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-mustard-600 dark:hover:bg-zinc-700 dark:hover:text-mustard-400">
        <IconSend size={size} stroke={2} aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{t("github.sendToAgent")}</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus placeholder={t("github.sendNote")}
            className="mb-1.5 w-full resize-y rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11.5px] text-zinc-700 outline-none focus:border-mustard-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200" />
          <button type="button" onClick={() => void toTerminal()} disabled={!!busy} className={row}>
            {busy === "term" ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconTerminal2 size={13} stroke={2} aria-hidden />}{t("github.sendTerminal")}
          </button>
          <CrewTargets busy={busy} onPick={(id) => void toCrew(id)} />
        </div>
      )}
    </div>
  );
}

// Crew 역할 목록 — 팝오버를 열었을 때만 불러옴(댓글마다 버튼이 있어 미리 부르면 요청이 댓글 수만큼, 리뷰)
function CrewTargets({ busy, onPick }: { busy: string | null; onPick: (role: string) => void }) {
  const t = useT();
  const [roles] = useCrewRoles();
  if (!roles.length) return null;
  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11.5px] text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800";
  return (<>
    <p className="mb-0.5 mt-1.5 px-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Crew</p>
    <div className="max-h-48 overflow-y-auto">
      {roles.map((r) => (
        <button key={r.id} type="button" onClick={() => onPick(r.id)} disabled={!!busy} className={row}>
          {busy === r.id ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <RoleIcon role={r.id} size={13} />}
          <span className="truncate">{roleName(t, roles, r.id)}</span><span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-400">@{r.id}</span>
        </button>
      ))}
    </div>
  </>);
}

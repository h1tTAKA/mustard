"use client";

import { useCallback, useEffect, useState } from "react";
import { IconSwords, IconX, IconRefresh, IconChevronRight, IconTerminal2, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import { AgentStateIcon } from "@/components/workspace/AgentStateIcon";
import { sessionState, useAgentSessionStates } from "@/lib/agentSessionStates";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";
import type { CandidateDiff, Fanout } from "@/lib/repo/fanout";

// 겨루기 패널(#1174) — 터미널 오른쪽 도크(Crew 보드와 같은 자리 규칙). 고른 겨루기의 후보마다 한 줄:
// 상태(그 터미널 탭 세션 상태) · 바뀐 파일·줄 수 · diff 펼치기 · 그 탭으로 가기. 판정·재판·채택은 뒤 커밋에서 이 패널 아래에 붙음.
const post = async (body: Record<string, unknown>) => (await fetch("/api/repo/fanout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const folder = (dir: string) => dir.split("/").pop() ?? dir;

export default function FanoutPanel({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useT();
  useAgentSessionStates(); // 세션 상태가 바뀌면 다시 그림
  const [list, setList] = useState<Fanout[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<number, CandidateDiff | { error: string }>>({});
  const [open, setOpen] = useState<number | null>(null); // diff 펼친 후보
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const r = await post({ action: "list", path: root }).catch(() => null);
    setList(r?.ok ? r.fanouts : []);
  }, [root]);
  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- 열 때 목록 한 번 읽기(서버 기록)
  useEffect(() => { window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, [load]);
  // 새 겨루기를 시작하면 목록 다시 읽고 그걸 고름(맨 앞 = 최신)
  useEffect(() => { const on = () => { setSel(null); setTimeout(() => void load(), 500); }; window.addEventListener("mustard:fanout-launch", on); return () => window.removeEventListener("mustard:fanout-launch", on); }, [load]);

  const cur = list?.find((f) => f.id === sel) ?? list?.find((f) => f.status === "running") ?? list?.[0] ?? null;
  const refresh = useCallback(async () => {
    if (!cur) return;
    setLoading(true);
    const out: Record<number, CandidateDiff | { error: string }> = {};
    await Promise.all(cur.candidates.map(async (_, i) => {
      const r = await post({ action: "diff", path: root, id: cur.id, index: i }).catch((e) => ({ ok: false, error: String(e) }));
      out[i] = r.ok ? r : { error: String(r.error ?? "") };
    }));
    setDiffs(out); setLoading(false);
  }, [cur?.id, root]); // eslint-disable-line react-hooks/exhaustive-deps -- 고른 겨루기가 바뀔 때만
  useEffect(() => { setDiffs({}); setOpen(null); void refresh(); }, [refresh]); // eslint-disable-line react-hooks/set-state-in-effect -- 고른 겨루기가 바뀌면 다시 셈

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-3 py-1.5 pr-6 dark:border-zinc-800">
        <IconSwords size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("fanout.title")}</span>
        {list && list.length > 1 && (
          <select value={cur?.id ?? ""} onChange={(e) => setSel(e.target.value)} aria-label={t("fanout.pick")}
            className="max-w-[45%] truncate rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11.5px] text-zinc-700 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-200">
            {list.map((f) => <option key={f.id} value={f.id}>{f.name || f.prompt.slice(0, 30)} · {new Date(f.createdAt).toLocaleDateString()}</option>)}
          </select>
        )}
        <button type="button" onClick={() => void refresh()} disabled={!cur || loading} title={t("fanout.refresh")} aria-label={t("fanout.refresh")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          {loading ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconRefresh size={13} stroke={2} aria-hidden />}
        </button>
        <button type="button" onClick={onClose} title={t("fanout.close")} aria-label={t("fanout.close")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconX size={13} stroke={2} aria-hidden />
        </button>
      </div>

      {!cur ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{list ? t("fanout.empty") : ""}</div>
      ) : (
        <div className="nunopi-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          <p className="line-clamp-3 whitespace-pre-wrap rounded-lg bg-zinc-50 px-2.5 py-2 text-[12px] leading-relaxed text-zinc-700 dark:bg-white/[0.03] dark:text-zinc-300" title={cur.prompt}>{cur.prompt}</p>
          {cur.candidates.map((c, i) => {
            const d = diffs[i];
            const st = c.tab ? sessionState(c.tab) : null;
            return (
              <div key={c.dir} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                  <button type="button" onClick={() => setOpen(open === i ? null : i)} disabled={!d || "error" in d || !d.files.length} aria-expanded={open === i}
                    className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                    <IconChevronRight size={13} stroke={2} className={`transition ${open === i ? "rotate-90" : ""}`} aria-hidden />
                  </button>
                  <AgentLogo agent={c.agent as AgentId} size={14} />
                  <span className="min-w-0 truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100" title={c.branch}>{folder(c.dir)}</span>
                  {st && <AgentStateIcon state={st} />}
                  <span className="ml-auto shrink-0 font-mono text-[11.5px] text-zinc-500 dark:text-zinc-400">
                    {!d ? "…" : "error" in d ? <span className="text-rose-500">{t("fanout.diffFailed")}</span>
                      : <>{t("fanout.files", { n: d.files.length })} <span className="text-emerald-600 dark:text-emerald-400">+{d.added}</span> <span className="text-rose-600 dark:text-rose-400">−{d.removed}</span></>}
                  </span>
                  {c.tab && (
                    <button type="button" onClick={() => requestTerminalFocus(root, c.tab!)} title={t("fanout.goTab")} aria-label={t("fanout.goTab")}
                      className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                      <IconTerminal2 size={13} stroke={2} aria-hidden />
                    </button>
                  )}
                </div>
                {open === i && d && !("error" in d) && <DiffView d={d} label={AGENT_META[c.agent as AgentId]?.label ?? c.agent} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 후보 diff — 파일 목록(줄 수) + 파일 누르면 그 파일 diff. 큰 파일은 이름·줄 수만(판정 입력 상한과 같음)
function DiffView({ d, label }: { d: CandidateDiff; label: string }) {
  const t = useT();
  const [file, setFile] = useState<string | null>(null);
  const part = file ? d.diff.split(/^(?=diff --git )/m).find((p) => p.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1] === file) : undefined;
  return (
    <div className="border-t border-zinc-100 px-2.5 py-1.5 dark:border-zinc-800">
      <ul className="space-y-0.5" aria-label={label}>
        {d.files.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => setFile(file === f.path ? null : f.path)} disabled={!!f.big}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left font-mono text-[11.5px] transition hover:bg-zinc-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-zinc-800 ${file === f.path ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}>
              <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{f.path}</span>
              {f.big && <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{t("fanout.tooBig")}</span>}
              <span className="shrink-0 text-emerald-600 dark:text-emerald-400">+{f.added}</span>
              <span className="shrink-0 text-rose-600 dark:text-rose-400">−{f.removed}</span>
            </button>
          </li>
        ))}
      </ul>
      {part && (
        <pre className="nunopi-scroll mt-1.5 max-h-80 overflow-auto rounded-lg bg-zinc-50 p-2 font-mono text-[11px] leading-relaxed dark:bg-black/30">
          {part.split("\n").map((l, i) => (
            <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "text-emerald-700 dark:text-emerald-400" : l.startsWith("-") && !l.startsWith("---") ? "text-rose-700 dark:text-rose-400" : l.startsWith("@@") ? "text-sky-700 dark:text-sky-400" : "text-zinc-600 dark:text-zinc-400"}>{l || " "}</div>
          ))}
        </pre>
      )}
    </div>
  );
}

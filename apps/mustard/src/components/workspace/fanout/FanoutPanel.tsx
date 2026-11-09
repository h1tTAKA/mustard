"use client";

import { useCallback, useEffect, useState } from "react";
import { IconSwords, IconX, IconRefresh, IconChevronRight, IconTerminal2, IconLoader2, IconGavel, IconStarFilled } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import { AgentStateIcon } from "@/components/workspace/AgentStateIcon";
import { sessionState, useAgentSessionStates } from "@/lib/agentSessionStates";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";
import type { CandidateDiff, Fanout } from "@/lib/repo/fanout";
import type { Verdict } from "@/lib/repo/fanoutJudgeRun";
import { LETTERS } from "@/lib/repo/fanoutJudge";

// 겨루기 패널(#1174) — 터미널 오른쪽 도크(Crew 보드와 같은 자리 규칙). 고른 겨루기의 후보마다 한 줄:
// 상태(그 터미널 탭 세션 상태) · 바뀐 파일·줄 수 · diff 펼치기 · 그 탭으로 가기. 판정·재판·채택은 뒤 커밋에서 이 패널 아래에 붙음.
const post = async (body: Record<string, unknown>) => (await fetch("/api/repo/fanout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const folder = (dir: string) => dir.split("/").pop() ?? dir;

export default function FanoutPanel({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
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
  const verdict = cur?.verdict as Verdict | undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(h); }, []);
  const judging = verdict?.state === "running" && now - verdict.at < 20 * 60_000; // 20분 넘게 "판정 중" = 서버가 중간에 꺼짐 → 다시 할 수 있게
  useEffect(() => { if (!judging) return; const h = setInterval(() => void load(), 3000); return () => clearInterval(h); }, [judging, load]); // 판정이 뒤에서 도는 동안 다시 읽기
  const judge = async () => {
    if (!cur) return;
    setNow(Date.now());
    const r = await post({ action: "judge", path: root, id: cur.id }).catch(() => null);
    if (!r?.ok) toast(t("fanout.judgeFailed", { error: String(r?.error ?? "") }), "error");
    void load();
  };
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
                  {verdict?.state === "done" && verdict.chair?.winner === i && <IconStarFilled size={12} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-label={t("fanout.recommended")} />}
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
          <VerdictBox f={cur} verdict={verdict} judging={judging} onJudge={() => void judge()} />
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

// 판정 칸(#1174) — 판정 버튼 · 판정 중 · 결과(추천 승자·이유·점수·심사별 순위·가져올 좋은 점). 가린 이름은 order로 풀어 폴더 이름으로 보여 줌.
const PROVIDER_LABEL: Record<string, string> = { "claude-code": "Claude", codex: "Codex", opencode: "OpenCode" };
function VerdictBox({ f, verdict, judging, onJudge }: { f: Fanout; verdict?: Verdict; judging: boolean; onJudge: () => void }) {
  const t = useT();
  const name = (ci: number) => folder(f.candidates[ci]?.dir ?? "?");
  const byLabel = (l: string) => (verdict?.order ? name(verdict.order[LETTERS.indexOf(l)]) : l);
  const btn = "flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-[11.5px] font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"; // 팀 보드 "새 카드" 버튼과 같은 모양
  const done = verdict?.state === "done" ? verdict : null;
  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <IconGavel size={14} stroke={2} className="shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
        <span className="mr-auto text-[12.5px] font-semibold text-zinc-700 dark:text-zinc-200">{t("fanout.verdict")}</span>
        {judging ? <span className="flex items-center gap-1 text-[11.5px] text-zinc-500 dark:text-zinc-400"><IconLoader2 size={12} className="animate-spin" aria-hidden />{t("fanout.judging")}</span>
          : <button type="button" onClick={onJudge} className={btn}>{done ? t("fanout.judgeAgain") : t("fanout.judge")}</button>}
      </div>
      {!verdict && !judging && <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("fanout.judgeHint")}</p>}
      {verdict?.state === "failed" && <p className="mt-1.5 text-[11.5px] text-rose-500">{t("fanout.judgeFailed", { error: verdict.error ?? "" })}</p>}
      {done?.chair && (
        <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          <div className="flex items-center gap-1.5">
            <IconStarFilled size={12} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
            <span className="font-semibold text-zinc-800 dark:text-zinc-100">{t("fanout.winner", { name: name(done.chair.winner) })}</span>
          </div>
          {done.chair.why && <p>{done.chair.why}</p>}
          <table className="w-full font-mono text-[11.5px]">
            <tbody>
              {done.scores?.map((s, k) => (
                <tr key={s.label} className="text-zinc-600 dark:text-zinc-400">
                  <td className="w-5">{k + 1}</td>
                  <td className="truncate text-zinc-800 dark:text-zinc-200">{name(s.candidate)}</td>
                  <td className="text-right">{t("fanout.score", { n: s.score, firsts: s.firsts })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {done.close && <p className="text-[11.5px] text-amber-700 dark:text-amber-400">{t("fanout.closeRace")}</p>}
          {Object.keys(done.chair.grafts).length > 0 && (
            <div>
              <div className="text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">{t("fanout.grafts")}</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {Object.entries(done.chair.grafts).flatMap(([ci, xs]) => xs.map((x, j) => <li key={`${ci}-${j}`}><span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{name(Number(ci))}</span> {x}</li>))}
              </ul>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">{t("fanout.judges", { n: done.judges?.filter((j) => j.ranking).length ?? 0 })}</summary>
            <ul className="mt-1 space-y-1.5">
              {done.judges?.map((j) => (
                <li key={j.provider}>
                  <div className="font-medium text-zinc-800 dark:text-zinc-200">{PROVIDER_LABEL[j.provider] ?? j.provider}{j.ranking ? `: ${j.ranking.map(byLabel).join(" > ")}` : ""}</div>
                  {j.error ? <div className="text-[11.5px] text-rose-500">{t("fanout.judgeSkipped")}</div>
                    : Object.entries(j.reasons ?? {}).map(([l, r]) => <div key={l} className="text-[11.5px] text-zinc-600 dark:text-zinc-400"><span className="font-mono">{byLabel(l)}</span> {r}</div>)}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

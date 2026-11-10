"use client";

import { useCallback, useEffect, useState } from "react";
import { IconSwords, IconX, IconRefresh, IconChevronRight, IconTerminal2, IconLoader2, IconGavel, IconStarFilled, IconScale, IconCheck, IconTrash, IconSend, IconExternalLink, IconPlus } from "@tabler/icons-react";
import FanoutStart from "./FanoutStart";
import { useT, useToast, useConfirm } from "@mustard/core";
import { closeFanoutTabs } from "@/lib/repo/workspaceEvents";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import { AgentStateIcon } from "@/components/workspace/AgentStateIcon";
import { sessionState, useAgentSessionStates } from "@/lib/agentSessionStates";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";
import type { CandidateDiff, Fanout } from "@/lib/repo/fanout";
import type { Trial, Verdict } from "@/lib/repo/fanoutJudgeRun";
import { LETTERS } from "@/lib/repo/fanoutJudge";

// 겨루기 화면(#1174) — 오른쪽 Crew 대화방 안에 겹쳐 보임(새 패널·탭 안 만듦, 유저 결정). 고른 겨루기의 후보마다 한 줄:
// 상태(그 터미널 탭 세션 상태) · 바뀐 파일·줄 수 · diff 펼치기 · 그 탭으로 가기. 판정·재판·채택은 뒤 커밋에서 이 패널 아래에 붙음.
const post = async (body: Record<string, unknown>) => (await fetch("/api/repo/fanout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const folder = (dir: string) => dir.split("/").pop() ?? dir;

export default function FanoutPanel({ root, onClose, onBusy }: { root: string; onClose: () => void; onBusy?: (b: boolean) => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [acting, setActing] = useState(false);
  useAgentSessionStates(); // 세션 상태가 바뀌면 다시 그림
  const [list, setList] = useState<Fanout[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<number, CandidateDiff | { error: string }>>({});
  const [open, setOpen] = useState<number | null>(null); // diff 펼친 후보
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false); // #1313 기록이 있을 때 헤더 ＋로 여는 시작 칸
  const [startBusy, setStartBusy] = useState(false); // 시작 칸 setup 줄이 도는 중 — 닫기 잠금(닫으면 줄이 끊김)
  useEffect(() => { onBusy?.(startBusy); }, [startBusy, onBusy]); // 대화방 칼 버튼도 같이 잠금

  const load = useCallback(async () => {
    const r = await post({ action: "list", path: root }).catch(() => null);
    setList((prev) => (r?.ok ? r.fanouts : prev ?? [])); // 한 번 못 읽었다고 진행 중 겨루기 버튼을 지우지 않음(리뷰)
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
  const trialRec = cur?.trial as Trial | undefined;
  const trying = trialRec?.state === "running" && now - trialRec.at < 20 * 60_000;
  useEffect(() => { if (!judging && !trying) return; const h = setInterval(() => void load(), 3000); return () => clearInterval(h); }, [judging, trying, load]); // 판정·재판이 뒤에서 도는 동안 다시 읽기
  // 채택(winner 번호) / 모두 버리기 — 되돌릴 수 없어 확인 먼저. 지울 후보 탭을 닫고(터미널 끄기) 서버가 폴더·브랜치를 지움
  const finish = async (winner: number | null) => {
    if (!cur || acting || startBusy) return; // 시작 칸 setup이 도는 중엔 채택·버리기 안 함 — 그 후보 폴더를 setup이 쓰는 중일 수 있음(리뷰)
    const ok = await confirm(winner === null
      ? { title: t("fanout.discardTitle"), message: t("fanout.discardMsg", { n: cur.candidates.length }), confirmText: t("fanout.discard"), tone: "danger" }
      : { title: t("fanout.adoptTitle", { name: folder(cur.candidates[winner].dir) }), message: t("fanout.adoptMsg", { n: cur.candidates.length - 1 }), confirmText: t("fanout.adopt"), tone: "warn" });
    if (!ok) return;
    // 지울 후보의 터미널은 지우기 직전에 끔 — 돌던 에이전트가 지우는 중인 폴더에 쓰지 않게. 채택은 PR이 성공한 뒤에만(실패면 탭·폴더 그대로, 리뷰)
    const losers = cur.candidates.filter((_, i) => i !== winner).map((c) => c.tab).filter((x): x is string => !!x);
    const call = (body: Record<string, unknown>) => post({ path: root, id: cur.id, ...body }).catch((e) => ({ ok: false, error: String(e) }));
    setActing(true);
    let r = winner === null ? null : await call({ action: "adopt", winner });
    if (!r || r.ok) { closeFanoutTabs(root, losers); r = await call(winner === null ? { action: "discard" } : { action: "drop-losers" }); }
    setActing(false);
    if (!r.ok) {
      const err = String(r.error ?? "");
      toast(err.startsWith("secret files:") ? t("fanout.secretBlocked", { files: err.slice(13).trim() }) : t(err === "no changes" ? "fanout.noChanges" : "fanout.finishFailed", { error: err }), "error");
      void load(); return;
    }
    if (r.left?.length) toast(t("fanout.left", { n: r.left.length }), "error");
    else toast(winner === null ? t("fanout.discarded") : t("fanout.adopted"));
    void load(); void refresh(); // 지운 후보는 diff가 "폴더 없음"이 되어야 남은 후보 버튼이 안 뜸(리뷰)
  };
  // 채택 뒤 정리가 중간에 실패했으면(앱 종료·오류) 다시 — 진 후보 폴더가 아직 있을 때만 버튼이 보임(리뷰)
  const leftovers = cur?.status === "adopted" && cur.candidates.some((_, i) => i !== cur.winner && diffs[i] && !("error" in diffs[i]!));
  const dropLeft = async () => {
    if (!cur || acting) return;
    closeFanoutTabs(root, cur.candidates.filter((_, i) => i !== cur.winner).map((c) => c.tab).filter((x): x is string => !!x));
    setActing(true);
    const r = await post({ action: "drop-losers", path: root, id: cur.id }).catch((e) => ({ ok: false, error: String(e) }));
    setActing(false);
    if (!r.ok) toast(t("fanout.finishFailed", { error: String(r.error ?? "") }), "error");
    else if (r.left?.length) toast(t("fanout.left", { n: r.left.length }), "error");
    void refresh();
  };
  // 의장이 고른 "가져올 좋은 점"을 승자 터미널 에이전트에게 — 붙이기만, Enter는 사람이(AI가 쓴 글이라 보고 보내게, 리뷰). 셸이면 안 보냄
  const sendGrafts = async (winner: number, lines: string[]) => {
    const tab = cur?.candidates[winner]?.tab;
    if (!tab || !lines.length) return;
    const r = await window.nunopiDesktop?.terminal?.sendPrompt?.({ id: tab, text: `${t("fanout.graftMsg")}\n${lines.map((x) => `- ${x}`).join("\n")}`, enter: false });
    if (r?.ok || (r && r.reason === "kept")) { toast(t("fanout.graftSent")); requestTerminalFocus(root, tab); } else toast(t("fanout.graftFailed"), "error"); // kept = 붙어 있음(Enter는 원래 사람이)
  };
  const start = async (action: "judge" | "trial") => {
    if (!cur) return;
    setNow(Date.now());
    const r = await post({ action, path: root, id: cur.id }).catch(() => null);
    if (!r?.ok) toast(t(action === "judge" ? "fanout.judgeFailed" : "fanout.trialFailed", { error: String(r?.error ?? "") }), "error");
    void load();
  };
  // 원시값만 의존 — 목록을 다시 읽을 때마다(3초·포커스) 새 객체가 와도 diff를 다시 세거나 펼친 걸 접지 않게(리뷰)
  const curId = cur?.id, curN = cur?.candidates.length ?? 0;
  const refresh = useCallback(async () => {
    if (!curId) return;
    setLoading(true);
    const out: Record<number, CandidateDiff | { error: string }> = {};
    await Promise.all(Array.from({ length: curN }, async (_, i) => {
      const r = await post({ action: "diff", path: root, id: curId, index: i }).catch((e) => ({ ok: false, error: String(e) }));
      out[i] = r.ok ? r : { error: String(r.error ?? "") };
    }));
    setDiffs(out); setLoading(false);
  }, [curId, curN, root]);
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
        {cur && (
          <button type="button" onClick={() => setComposing((v) => !v)} disabled={startBusy} title={t("fanout.new")} aria-label={t("fanout.new")} aria-pressed={composing}
            className={`shrink-0 rounded p-1 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${composing ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>
            <IconPlus size={13} stroke={2} aria-hidden />
          </button>
        )}
        <button type="button" onClick={() => void refresh()} disabled={!cur || loading} title={t("fanout.refresh")} aria-label={t("fanout.refresh")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          {loading ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconRefresh size={13} stroke={2} aria-hidden />}
        </button>
        <button type="button" onClick={onClose} disabled={startBusy} title={t("fanout.close")} aria-label={t("fanout.close")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconX size={13} stroke={2} aria-hidden />
        </button>
      </div>

      {list && (!cur || composing || startBusy) && <FanoutStart root={root} empty={!cur} fill={!cur} onBusy={setStartBusy} onDone={() => setComposing(false)} />}
      {!cur ? null : (
        <div className="nunopi-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          <p className="line-clamp-3 whitespace-pre-wrap rounded-lg bg-zinc-50 px-2.5 py-2 text-[12px] leading-relaxed text-zinc-700 dark:bg-white/[0.03] dark:text-zinc-300" title={cur.prompt}>{cur.prompt}</p>
          {cur.status !== "running" && (
            <div className="flex items-center gap-1.5 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-[12px] text-zinc-600 dark:bg-white/[0.03] dark:text-zinc-300">
              {cur.status === "adopted" ? <IconCheck size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <IconTrash size={13} className="shrink-0 text-zinc-400" aria-hidden />}
              <span className="min-w-0 truncate">{cur.status === "adopted" ? t("fanout.adoptedAs", { name: folder(cur.candidates[cur.winner ?? 0]?.dir ?? "") }) : t("fanout.discarded")}</span>
              {leftovers && (
                <button type="button" onClick={() => void dropLeft()} disabled={acting}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-rose-600 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-rose-400">
                  <IconTrash size={12} stroke={2} aria-hidden />{t("fanout.dropLeft")}
                </button>
              )}
              {cur.prUrl && <a href={cur.prUrl} target="_blank" rel="noreferrer" className="ml-auto flex shrink-0 items-center gap-0.5 font-medium text-mustard-700 hover:underline dark:text-mustard-400">PR<IconExternalLink size={12} aria-hidden /></a>}
            </div>
          )}
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
                  {c.model && <span className="min-w-0 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400" title={c.model}>{c.model}</span>}
                  {st && <AgentStateIcon state={st} />}
                  {verdict?.state === "done" && verdict.chair?.winner === i && <IconStarFilled size={12} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-label={t("fanout.recommended")} />}
                  <span className="ml-auto shrink-0 font-mono text-[11.5px] text-zinc-500 dark:text-zinc-400">
                    {!d ? "…" : "error" in d ? <span className="text-rose-500">{t("fanout.diffFailed")}</span>
                      : <>{t("fanout.files", { n: d.files.length })} <span className="text-emerald-600 dark:text-emerald-400">+{d.added}</span> <span className="text-rose-600 dark:text-rose-400">−{d.removed}</span></>}
                  </span>
                  {cur.status === "running" && (
                    <button type="button" onClick={() => void finish(i)} disabled={acting || startBusy} title={t("fanout.adoptThis")} aria-label={t("fanout.adoptThis")}
                      className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-emerald-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-emerald-400">
                      <IconCheck size={13} stroke={2} aria-hidden />
                    </button>
                  )}
                  {c.tab && cur.status === "running" && (
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
          {cur.status === "running" && <VerdictBox f={cur} verdict={verdict} judging={judging} locked={trying} onJudge={() => void start("judge")} onSendGrafts={(w, xs) => void sendGrafts(w, xs)} />}
          {cur.status === "running" && verdict?.state === "done" && (verdict.scores?.length ?? 0) >= 2 && <TrialBox f={cur} verdict={verdict} trial={trialRec} trying={trying} onStart={() => void start("trial")} />}
          {cur.status === "running" && (
            <div className="flex justify-end">
              <button type="button" onClick={() => void finish(null)} disabled={acting || startBusy}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-rose-600 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-rose-400">
                {acting ? <IconLoader2 size={12} className="animate-spin" aria-hidden /> : <IconTrash size={12} stroke={2} aria-hidden />}{t("fanout.discardAll")}
              </button>
            </div>
          )}
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
function VerdictBox({ f, verdict, judging, locked, onJudge, onSendGrafts }: { f: Fanout; verdict?: Verdict; judging: boolean; locked: boolean; onJudge: () => void; onSendGrafts: (winner: number, lines: string[]) => void }) {
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
          : <button type="button" onClick={onJudge} disabled={locked} title={locked ? t("fanout.trialRunning") : undefined} className={btn}>{done ? t("fanout.judgeAgain") : t("fanout.judge")}</button>}
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
              <div className="flex items-center gap-2">
                <span className="mr-auto text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">{t("fanout.grafts")}</span>
                {f.candidates[done.chair.winner]?.tab && (
                  <button type="button" onClick={() => onSendGrafts(done.chair!.winner, Object.values(done.chair!.grafts).flat())} className={btn}>
                    <IconSend size={12} stroke={2} aria-hidden />{t("fanout.sendGrafts", { name: name(done.chair.winner) })}
                  </button>
                )}
              </div>
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

// 재판 칸(#1174) — 판정 1·2위 두 후보만. 접전이면 버튼을 강조. 결과: 판결·뒤집힐 조건·배심 표, 변론은 접어 둠.
function TrialBox({ f, verdict, trial, trying, onStart }: { f: Fanout; verdict: Verdict; trial?: Trial; trying: boolean; onStart: () => void }) {
  const t = useT();
  const name = (ci: number) => folder(f.candidates[ci]?.dir ?? "?");
  const done = trial?.state === "done" ? trial : null;
  const side = (v?: "A" | "B") => (v && done?.pair ? name(done.pair[v === "A" ? 0 : 1]) : "?");
  const btn = `flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition disabled:opacity-40 ${verdict.close && !done ? "border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10" : "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"}`;
  const a = verdict.scores![0].candidate, b = verdict.scores![1].candidate;
  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <IconScale size={14} stroke={2} className="shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
        <span className="mr-auto truncate text-[12.5px] font-semibold text-zinc-700 dark:text-zinc-200">{t("fanout.trial", { a: name(a), b: name(b) })}</span>
        {trying ? <span className="flex items-center gap-1 text-[11.5px] text-zinc-500 dark:text-zinc-400"><IconLoader2 size={12} className="animate-spin" aria-hidden />{t("fanout.trialRunning")}</span>
          : <button type="button" onClick={onStart} className={btn}>{done ? t("fanout.trialAgain") : t("fanout.trialStart")}</button>}
      </div>
      {!trial && !trying && <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("fanout.trialHint")}</p>}
      {trial?.state === "failed" && <p className="mt-1.5 text-[11.5px] text-rose-500">{t("fanout.trialFailed", { error: trial.error ?? "" })}</p>}
      {done?.judgment && (
        <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          <div className="flex items-center gap-1.5">
            <IconGavel size={12} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
            <span className="font-semibold text-zinc-800 dark:text-zinc-100">{t("fanout.trialWinner", { name: name(done.judgment.winner) })}</span>
            <span className="ml-auto font-mono text-[11.5px] text-zinc-500 dark:text-zinc-400">{t("fanout.jury", { a: done.votes?.filter((v) => v.vote === "A").length ?? 0, b: done.votes?.filter((v) => v.vote === "B").length ?? 0, na: side("A"), nb: side("B") })}</span>
          </div>
          {done.judgment.verdict && <p>{done.judgment.verdict}</p>}
          {done.judgment.flip && <p className="text-[11.5px] text-zinc-600 dark:text-zinc-400"><span className="font-medium">{t("fanout.flip")}</span> {done.judgment.flip}</p>}
          <details>
            <summary className="cursor-pointer text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">{t("fanout.trialRecord")}</summary>
            <div className="mt-1 space-y-1.5 text-[11.5px] text-zinc-600 dark:text-zinc-400">
              <p className="text-zinc-500 dark:text-zinc-500">{t("fanout.claim", { a: side("A"), b: side("B") })}</p>
              {([["fanout.prosecution", done.args?.prosecution], ["fanout.defense", done.args?.defense], ["fanout.rebutProsecution", done.args?.rebutProsecution], ["fanout.rebutDefense", done.args?.rebutDefense]] as const).map(([k, v]) => v && (
                <div key={k}><div className="font-medium text-zinc-700 dark:text-zinc-300">{t(k)}</div><p className="whitespace-pre-wrap">{v}</p></div>
              ))}
              <div>
                <div className="font-medium text-zinc-700 dark:text-zinc-300">{t("fanout.jurors")}</div>
                {done.votes?.map((v) => <div key={v.lens}>{t(`fanout.lens.${v.lens}`)}: {v.vote ? `${side(v.vote)} — ${v.why ?? ""}` : t("fanout.judgeSkipped")}</div>)}
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

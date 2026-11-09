"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconGitBranch, IconGitCommit, IconCircleDot, IconGitPullRequest, IconLoader2, IconFolder } from "@tabler/icons-react";
import { useT, useToast, getSetting, GKEYS, GIT_DEFAULTS, agentEnabled, sortAgents } from "@mustard/core";
import { AgentLogo, AGENT_META, type AgentId } from "@/components/workspace/AgentLogo";
import { branchFor, issueName, slugName } from "@/lib/repo/workspaceName";
import { launchFanout, openRepoTab, openWorkspaceSettings, type NewWorkspaceInitial } from "@/lib/repo/workspaceEvents";

// "새 작업공간"(#1170) — 메인 폴더는 그대로, 옆에 git worktree를 만들어 레포 탭으로 엶. 흐름:
// 시작점(브랜치·커밋·이슈·PR) → 이름(이슈면 제목 slug, PR이면 pr-N) → 만들기 → 탭 열기 → setup(승인 안 된 스크립트면 내용 보여 주고 묻기).
// 창 모양은 Crew TaskDialog와 같은 틀.
type From = "branch" | "commit" | "issue" | "pr";
type Ref = { title: string; headRefName?: string; headRefOid?: string; cross?: boolean };
const post = async (body: Record<string, unknown>) => (await fetch("/api/repo/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

export default function NewWorkspaceDialog({ root, initial, onClose }: { root: string; initial?: NewWorkspaceInitial; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [from, setFrom] = useState<From>(initial && initial.kind !== "tracker" ? initial.kind : "branch");
  const [base, setBase] = useState("");
  const [num, setNum] = useState(initial && initial.kind !== "tracker" ? String(initial.number) : "");
  const [ref, setRef] = useState<Ref | null>(null);
  const [refErr, setRefErr] = useState(false);
  const [name, setName] = useState(initial?.kind === "tracker" ? initial.name : ""); // #1172 트래커 이슈면 이름 미리 채움(키 포함)
  const [nameTouched, setNameTouched] = useState(initial?.kind === "tracker");
  const [branches, setBranches] = useState<string[]>([]);
  const [items, setItems] = useState<{ issue: { number: number; title: string }[]; pr: { number: number; title: string }[] }>({ issue: [], pr: [] }); // 열린 이슈·PR(번호 칸 목록)
  const [busyNow, setBusy] = useState(false);
  const [chain, setChain] = useState(false); // #1174 겨루기 후보 setup 줄이 도는 동안(첫 후보 setup이 끝나도 나머지가 남음) — 만들기·취소·닫기 잠금(리뷰)
  const busy = busyNow || chain;
  const [setup, setSetup] = useState<{ dir: string; script: string } | null>(null); // 승인 기다리는 setup
  const prefix = getSetting<string>(GKEYS.branchPrefix, GIT_DEFAULTS.branchPrefix);
  // #1174 여러 에이전트로(겨루기) — 고른 순서대로 후보(같은 에이전트 여러 번 가능, 2~4개), 같은 프롬프트를 각자 터미널 탭에서
  const [multi, setMulti] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [agents, setAgents] = useState<string[]>([]); // 감지되고(ok) 켜진 에이전트(＋ 메뉴와 같은 목록)
  useEffect(() => {
    if (!multi) return;
    void window.nunopiDesktop?.detectAgents?.(false).then((r) => { if (r.ok) setAgents(sortAgents(r.list.filter((a) => a.status === "ok" && agentEnabled(a.id))).map((a) => a.id)); }).catch(() => {});
  }, [multi]);
  const setupQueue = useRef<string[]>([]); // 겨루기 후보들의 setup을 하나씩(승인은 첫 번째에서 — 같은 스크립트면 뒤는 이미 승인됨)
  const afterSetup = useRef<(() => void) | null>(null); // 겨루기: setup이 전부 끝난 뒤 에이전트 띄우기(setup 중에 에이전트가 같은 폴더를 건드리지 않게, 리뷰)
  const finish = () => {
    const next = setupQueue.current.shift();
    if (next) { void runSetup(next); return; }
    const go = afterSetup.current; afterSetup.current = null;
    setChain(false);
    go?.();
    onClose();
  };

  // 시작점 후보(로컬·원격 브랜치) — 입력칸 자동완성
  useEffect(() => {
    void fetch("/api/repo/git-branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) })
      .then((r) => r.json()).then((d) => { if (d.ok) setBranches([...(d.local ?? []), ...(d.remote ?? [])]); }).catch(() => {});
  }, [root]);

  // 열린 이슈·PR 목록 — 번호 칸에서 골라 넣기(유저 요청). 각 50개
  useEffect(() => {
    const gh = window.nunopiDesktop?.github;
    if (!gh) return;
    const pick = (r: GhResult<{ number: number; title: string }[]> | null) => (r?.ok ? r.data.map(({ number, title }) => ({ number, title })) : []);
    void Promise.all([gh.issueList(root, "open", 50).catch(() => null), gh.prList(root, "open", 50).catch(() => null)])
      .then(([i, p]) => setItems({ issue: pick(i), pr: pick(p) }));
  }, [root]);

  // 이슈·PR 번호 → 제목(이름 제안)·PR head
  const reqRef = useRef(0);
  const lookup = async (kind: From, n: string) => {
    const id = ++reqRef.current;
    setRef(null); setRefErr(false);
    const number = Number(n);
    const gh = window.nunopiDesktop?.github;
    if (!gh || !Number.isInteger(number) || number <= 0 || (kind !== "issue" && kind !== "pr")) return;
    const r = kind === "pr" ? await gh.prView(root, number).catch(() => null) : await gh.issueView(root, number).catch(() => null);
    if (id !== reqRef.current) return;
    if (!r?.ok) { setRefErr(true); return; }
    const d = r.data as GhPrDetail;
    setRef(kind === "pr" ? { title: d.title, headRefName: d.headRefName, headRefOid: d.headRefOid, cross: !!d.isCrossRepository } : { title: d.title });
  };
  useEffect(() => { if (initial && initial.kind !== "tracker") void lookup(initial.kind, String(initial.number)); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- 처음 열 때 이슈·PR 번호를 받았으면 한 번 불러옴

  // 이름 제안 — 직접 고치기 전까지만(이슈 제목 slug / pr-N)
  const suggested = from === "issue" && ref ? issueName(Number(num), ref.title) : from === "pr" && num ? `pr-${Number(num)}` : "";
  const finalName = nameTouched ? slugName(name) : suggested;
  const branch = from === "pr" ? ref?.headRefName ?? "" : branchFor(prefix, finalName || "workspace");
  const fanout = multi && from !== "pr"; // PR 시작은 PR 브랜치 이름을 그대로 써서 후보 여러 개와 안 맞음
  const ready = !busy && (from === "pr" ? !!ref?.headRefName : from === "issue" ? !!ref : from === "commit" ? !!base.trim() : true) && (!fanout || (picks.length >= 2 && !!prompt.trim()));

  const runSetup = async (dir: string) => {
    const s = await post({ action: "setup", path: root, dir }).catch(() => null);
    if (!s?.ok) { toast(t("newWs.setupFailed"), "error"); finish(); return; }
    if (s.status === "untrusted") { setSetup({ dir, script: s.script }); return; }
    if (s.status === "too-long") toast(t("newWs.setupTooLong"), "error");
    else if (s.status === "failed") toast(t("newWs.setupFailed"), "error");
    else if (s.status === "ok") toast(t("newWs.setupOk"));
    finish();
  };
  const decide = async (trust: boolean) => {
    if (!setup) return;
    setBusy(true);
    const r = await post({ action: "trust", kind: "setup", path: root, dir: setup.dir, script: setup.script, skip: !trust }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { toast(t("newWs.setupChanged"), "error"); setSetup(null); finish(); return; }
    const dir = setup.dir;
    setSetup(null);
    if (trust) { toast(t("newWs.setupRunning")); void runSetup(dir); } else finish();
  };

  // #1174 후보 N개 만들기 → 이 레포 터미널에 후보마다 탭 + 에이전트 + 프롬프트 → setup 하나씩
  const createFanout = async () => {
    setBusy(true);
    const r = await fetch("/api/repo/fanout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", path: root, name: finalName, prompt: prompt.trim(), agents: picks, base: from === "issue" ? "" : base.trim(), prefix }) })
      .then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (!r.ok) { toast(t("newWs.failed", { error: String(r.error ?? "") }), "error"); return; }
    const cands = (r.fanout.candidates as { agent: string; dir: string }[]);
    const text = prompt.trim();
    afterSetup.current = () => {
      const tabIds = launchFanout({ root, prompt: text, candidates: cands });
      if (!tabIds.length) { toast(t("fanout.noTerminal"), "error"); return; }
      toast(t("fanout.started", { n: cands.length }));
      // 탭 id 저장 — 채택·버리기가 진 후보 터미널을 끄는 데 씀(못 끄면 돌던 에이전트가 지우는 폴더에 씀) → 한 번 더 시도, 그래도 실패면 알림(리뷰)
      const save = () => fetch("/api/repo/fanout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tabs", path: root, id: r.fanout.id, tabIds }) }).then((x) => x.json()).then((j) => !!j.ok, () => false);
      void save().then((ok) => ok || save()).then((ok) => { if (!ok) toast(t("fanout.tabsNotSaved"), "error"); });
    };
    setupQueue.current = cands.slice(1).map((c) => c.dir);
    setChain(true);
    setBusy(true);
    await runSetup(cands[0].dir);
    setBusy(false);
  };

  const create = async () => {
    if (!ready) return;
    if (fanout) { await createFanout(); return; }
    setBusy(true);
    const body: Record<string, unknown> = { action: "create", path: root, name: finalName, prefix };
    if (from === "branch" || from === "commit") body.base = base.trim();
    if (from === "pr" && ref) body.pr = { number: Number(num), headRefName: ref.headRefName, headRefOid: ref.headRefOid, cross: ref.cross };
    const r = await post(body).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (!r.ok) {
      const key = r.error === "name taken" ? "newWs.nameTaken" : r.error === "pr head moved" ? "newWs.prMoved" : null;
      toast(key ? t(key) : t("newWs.failed", { error: String(r.error ?? "") }), "error");
      return;
    }
    openRepoTab(r.dir, root);
    toast(t("newWs.created", { branch: r.branch }));
    setBusy(true);
    await runSetup(r.dir);
    setBusy(false);
  };

  // Esc = 닫기(setup 승인 중엔 "이번엔 안 돌림"과 같음 — 닫으면 안 돌림)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { if (setup) void decide(false); else onClose(); } }; // 만드는 중엔 안 닫음 — setup 승인 묻기가 사라지지 않게(리뷰)
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tabs: { k: From; Icon: typeof IconGitBranch; label: string }[] = [
    { k: "branch", Icon: IconGitBranch, label: t("newWs.fromBranch") },
    { k: "commit", Icon: IconGitCommit, label: t("newWs.fromCommit") },
    { k: "issue", Icon: IconCircleDot, label: t("newWs.fromIssue") },
    { k: "pr", Icon: IconGitPullRequest, label: t("newWs.fromPr") },
  ];
  const input = "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] text-zinc-800 outline-none focus:border-mustard-500/60 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100";
  const label = "mb-1 block text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={() => { if (busy) return; if (setup) void decide(false); else onClose(); }} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t("newWs.title")}
        className="relative w-full max-w-lg overflow-visible rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        <div className="px-5 pt-4 text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500">{t("newWs.title")}</div>
        {setup ? (
          <div className="mx-5 my-4 rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/[0.07]">
            <div className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">{t("newWs.setupTitle")}</div>
            <pre className="nunopi-scroll mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 font-mono text-[11.5px] leading-relaxed text-zinc-700 dark:bg-black/30 dark:text-zinc-300">{setup.script}</pre>
            <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{t("newWs.setupHint")}</p>
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" disabled={busyNow} onClick={() => void decide(false)} className="rounded-lg px-3 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-amber-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">{t("newWs.skip")}</button>
              <button type="button" disabled={busyNow} onClick={() => void decide(true)} className="rounded-lg bg-amber-500 px-3 py-1 text-[12px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40">{t("newWs.trustRun")}</button>
            </div>
          </div>
        ) : (<>
          <div className="space-y-3 px-5 pb-4 pt-2">
            <p className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("newWs.desc")}</p>
            <div>
              <span className={label}>{t("newWs.from")}</span>
              <div className="flex gap-1">
                {tabs.map(({ k, Icon, label: l }) => (
                  <button key={k} type="button" onClick={() => { reqRef.current++; setFrom(k); setRef(null); setRefErr(false); if (k === "issue" || k === "pr") void lookup(k, num); }}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition ${from === k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"}`}>
                    <Icon size={13} stroke={2} aria-hidden />{l}
                  </button>
                ))}
              </div>
            </div>
            {from === "branch" || from === "commit" ? (
              <div>
                <input value={base} onChange={(e) => setBase(e.target.value)} list={from === "branch" ? "new-ws-branches" : undefined} autoFocus
                  placeholder={t(from === "branch" ? "newWs.basePlaceholder" : "newWs.shaPlaceholder")} className={`${input} font-mono`} />
                {from === "branch" && <datalist id="new-ws-branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>}
              </div>
            ) : (
              <div>
                <input value={num} onChange={(e) => { reqRef.current++; const n = e.target.value.replace(/\D/g, ""); setNum(n); setRef(null); setRefErr(false); if ((from === "pr" ? items.pr : items.issue).some((x) => String(x.number) === n)) void lookup(from, n); }}
                  list="new-ws-items" onBlur={() => void lookup(from, num)}
                  onKeyDown={(e) => { if (e.key === "Enter") void lookup(from, num); }} inputMode="numeric" autoFocus placeholder={t(from === "pr" ? "newWs.prPlaceholder" : "newWs.issuePlaceholder")} className={input} />
                <datalist id="new-ws-items">{(from === "pr" ? items.pr : items.issue).map((x) => <option key={x.number} value={x.number}>{`#${x.number} ${x.title}`}</option>)}</datalist>
                {ref && <p className="mt-1 truncate text-[12px] text-zinc-700 dark:text-zinc-200">#{num} {ref.title}</p>}
                {refErr && <p className="mt-1 text-[11.5px] text-rose-500">{t("newWs.notFound")}</p>}
                {from === "pr" && ref?.cross && <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{t("newWs.forkNote")}</p>}
              </div>
            )}
            {from !== "pr" && (
              <div>
                <label className={label} htmlFor="new-ws-name">{t("newWs.name")}</label>
                <input id="new-ws-name" value={nameTouched ? name : suggested} onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
                  placeholder={t("newWs.namePlaceholder")} className={input} />
              </div>
            )}
            {from !== "pr" && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-[12px] text-zinc-700 dark:text-zinc-300">{t("fanout.toggle")}</span>
                  {/* 작업공간 설정 창 스위치와 같은 모양 */}
                  <button type="button" role="switch" aria-checked={multi} aria-label={t("fanout.toggle")} onClick={() => setMulti((m) => !m)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${multi ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${multi ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
                {multi && (
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("fanout.desc")}</p>
                    <div className="flex flex-wrap gap-1">
                      {agents.map((a) => (
                        <button key={a} type="button" disabled={picks.length >= 4} onClick={() => setPicks((p) => [...p, a])}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">
                          <AgentLogo agent={a as AgentId} size={13} />{AGENT_META[a as AgentId]?.label ?? a}
                        </button>
                      ))}
                      {!agents.length && <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{t("fanout.noAgents")}</span>}
                    </div>
                    <div className="flex min-h-[30px] flex-wrap items-center gap-1 rounded-lg bg-zinc-50 px-2 py-1 dark:bg-white/[0.03]">
                      {picks.length ? picks.map((a, i) => (
                        <button key={i} type="button" onClick={() => setPicks((p) => p.filter((_, j) => j !== i))} title={t("fanout.removePick")}
                          className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white transition dark:bg-zinc-100 dark:text-zinc-900">
                          <AgentLogo agent={a as AgentId} size={13} />{AGENT_META[a as AgentId]?.label ?? a}<span aria-hidden>×</span>
                        </button>
                      )) : <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{t("fanout.pickHint")}</span>}
                    </div>
                    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder={t("fanout.promptPlaceholder")} className={`${input} resize-y`} />
                  </div>
                )}
              </div>
            )}
            <div className="space-y-0.5 rounded-lg bg-zinc-50 px-2.5 py-2 text-[11.5px] text-zinc-500 dark:bg-white/[0.03] dark:text-zinc-400">
              <div className="flex items-center gap-1.5"><IconGitBranch size={12} aria-hidden /><span className="truncate font-mono text-zinc-700 dark:text-zinc-200">{branch || "—"}</span></div>
              <div className="flex items-center gap-1.5"><IconFolder size={12} aria-hidden /><span className="truncate font-mono">~/mustard/workspaces/…/{from === "pr" ? finalName || `pr-${num || "N"}` : finalName || "workspace"}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-b-2xl border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
            {/* #1216 setup 스크립트 등 이 레포 작업공간 설정 */}
            <button type="button" onClick={() => { onClose(); openWorkspaceSettings(root); }} disabled={busy}
              className="text-[12px] font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-700 hover:underline disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-200">{t("wsSettings.title")}</button>
            <span className="flex-1" />
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3.5 py-2 disabled:opacity-40 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.cancel")}</button>
            <button type="button" onClick={() => void create()} disabled={!ready}
              className="inline-flex items-center gap-1 rounded-lg bg-mustard-500 px-3.5 py-2 text-[13px] font-semibold text-brown-900 shadow-sm transition hover:bg-mustard-400 disabled:opacity-40">
              {busy && <IconLoader2 size={13} className="animate-spin" aria-hidden />}{busy ? t("newWs.creating") : t("newWs.create")}
            </button>
          </div>
        </>)}
      </div>
    </div>,
    document.body,
  );
}

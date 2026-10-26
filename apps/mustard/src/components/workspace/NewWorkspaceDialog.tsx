"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconGitBranch, IconGitCommit, IconCircleDot, IconGitPullRequest, IconLoader2, IconFolder } from "@tabler/icons-react";
import { useT, useToast, getSetting, GKEYS, GIT_DEFAULTS } from "@mustard/core";
import { branchFor, issueName, slugName } from "@/lib/repo/workspaceName";
import { openRepoTab, type NewWorkspaceInitial } from "@/lib/repo/workspaceEvents";

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
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ dir: string; script: string } | null>(null); // 승인 기다리는 setup
  const prefix = getSetting<string>(GKEYS.branchPrefix, GIT_DEFAULTS.branchPrefix);

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
  const ready = !busy && (from === "pr" ? !!ref?.headRefName : from === "issue" ? !!ref : from === "commit" ? !!base.trim() : true);

  const runSetup = async (dir: string) => {
    const s = await post({ action: "setup", path: root, dir }).catch(() => null);
    if (!s?.ok) { toast(t("newWs.setupFailed"), "error"); onClose(); return; }
    if (s.status === "untrusted") { setSetup({ dir, script: s.script }); return; }
    if (s.status === "too-long") toast(t("newWs.setupTooLong"), "error");
    else if (s.status === "failed") toast(t("newWs.setupFailed"), "error");
    else if (s.status === "ok") toast(t("newWs.setupOk"));
    onClose();
  };
  const decide = async (trust: boolean) => {
    if (!setup) return;
    setBusy(true);
    const r = await post({ action: "trust", kind: "setup", path: root, dir: setup.dir, script: setup.script, skip: !trust }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { toast(t("newWs.setupChanged"), "error"); setSetup(null); onClose(); return; }
    const dir = setup.dir;
    setSetup(null);
    if (trust) { toast(t("newWs.setupRunning")); void runSetup(dir); } else onClose();
  };

  const create = async () => {
    if (!ready) return;
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
              <button type="button" disabled={busy} onClick={() => void decide(false)} className="rounded-lg px-3 py-1 text-[12px] font-medium text-zinc-600 transition hover:bg-amber-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">{t("newWs.skip")}</button>
              <button type="button" disabled={busy} onClick={() => void decide(true)} className="rounded-lg bg-amber-500 px-3 py-1 text-[12px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40">{t("newWs.trustRun")}</button>
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
            <div className="space-y-0.5 rounded-lg bg-zinc-50 px-2.5 py-2 text-[11.5px] text-zinc-500 dark:bg-white/[0.03] dark:text-zinc-400">
              <div className="flex items-center gap-1.5"><IconGitBranch size={12} aria-hidden /><span className="truncate font-mono text-zinc-700 dark:text-zinc-200">{branch || "—"}</span></div>
              <div className="flex items-center gap-1.5"><IconFolder size={12} aria-hidden /><span className="truncate font-mono">~/mustard/workspaces/…/{from === "pr" ? finalName || `pr-${num || "N"}` : finalName || "workspace"}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-b-2xl border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
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

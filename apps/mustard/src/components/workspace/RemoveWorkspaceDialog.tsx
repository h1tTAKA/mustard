"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconGitBranch, IconLoader2, IconAlertTriangle, IconTrash } from "@tabler/icons-react";
import { useT, useToast, useConfirm } from "@mustard/core";
import { closeWorkspace } from "@/lib/repo/workspaceEvents";

// 작업공간 지우기(#1170) — Orca 삭제 흐름: 점검(미커밋·미푸시) → archive(승인 필요, 실패면 멈춤) → worktree remove → 로컬 브랜치 -d(실패면 남김).
// 미커밋이 있으면 "그래도 지우기"(= git --force). 미푸시는 경고만(Superset). 원격 브랜치는 안 지움.
type Check = { branch: string | null; dirty: number; ignored: string[]; unpushed: number | null; archive: { script: string; trusted: boolean; tooLong: boolean } | null };
const post = async (body: Record<string, unknown>) => (await fetch("/api/repo/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export default function RemoveWorkspaceDialog({ root, dir, onClose }: { root: string; dir: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [check, setCheck] = useState<Check | null>(null);
  const [err, setErr] = useState("");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [trustArchive, setTrustArchive] = useState(false);
  const [failed, setFailed] = useState<string | null>(null); // archive 실패 출력 — "무시하고 지우기"
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await post({ action: "check", path: root, dir }).catch(() => null);
    if (!r?.ok) { setErr(String(r?.error ?? "")); return; }
    setCheck({ branch: r.branch, dirty: r.dirty, ignored: r.ignored ?? [], unpushed: r.unpushed, archive: r.archive });
  }, [root, dir]);
  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- 열 때 한 번 점검

  const forceBranch = async (branch: string) => {
    if (!(await confirm({ title: t("rmWs.forceBranchTitle", { branch }), message: t("rmWs.forceBranchBody"), confirmText: t("rmWs.forceBranch"), danger: true }))) return;
    const r = await post({ action: "delete-branch", path: root, branch }).catch(() => null);
    toast(r?.ok ? t("rmWs.branchDeleted", { branch }) : t("rmWs.failed", { error: String(r?.error ?? "") }), r?.ok ? undefined : "error");
  };

  const remove = async (allowFailedArchive = false) => {
    if (!check) return;
    const a = check.archive;
    const skipArchive = !!a && (a.tooLong || (!a.trusted && !trustArchive));
    setBusy(true);
    try {
      if (a && !a.trusted && !a.tooLong && trustArchive) {
        const tr = await post({ action: "trust", kind: "archive", path: root, script: a.script }).catch(() => null);
        if (!tr?.ok) { toast(t("newWs.setupChanged"), "error"); await load(); return; }
      }
      const r = await post({ action: "remove", path: root, dir, force: check.dirty > 0, expectDirty: check.dirty, expectIgnored: check.ignored.length, deleteBranch, skipArchive, allowFailedArchive }).catch((e) => ({ ok: false, error: String(e) }));
      if (!r.ok) { toast(t("rmWs.failed", { error: String(r.error ?? "") }), "error"); return; }
      if (r.status === "archive-failed") { setFailed(String(r.result?.tail ?? "")); return; }
      if (r.status === "archive-untrusted" || r.status === "dirty") { await load(); return; } // 그 사이 바뀜 — 다시 보여 줌
      closeWorkspace(dir); // 지운 뒤에만 탭 닫고 그 폴더 터미널 끔 — 안 지워졌는데 셸·에이전트만 죽지 않게(리뷰)
      onClose();
      if (r.branch && deleteBranch && r.branchKept) {
        const b = r.branch as string;
        toast(t("rmWs.branchKept", { branch: b }), "error", { label: t("rmWs.forceBranch"), onClick: () => void forceBranch(b) });
      } else toast(t("rmWs.removed", { name: base(dir) }));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const a = check?.archive;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={() => !busy && onClose()} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t("rmWs.title")}
        className="relative w-full max-w-lg overflow-visible rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        <div className="px-5 pt-4 text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500">{t("rmWs.title")}</div>
        <div className="space-y-3 px-5 pb-4 pt-2">
          <div>
            <div className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{base(dir)}</div>
            <div className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500" title={dir}>{dir}</div>
          </div>
          <p className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("rmWs.desc")}</p>
          {err ? <p className="text-[12px] text-rose-500">{t("rmWs.failed", { error: err })}</p> : !check ? (
            <div className="flex items-center gap-1.5 text-[12px] text-zinc-400"><IconLoader2 size={13} className="animate-spin" aria-hidden />{t("rmWs.checking")}</div>
          ) : (<>
            {(check.dirty > 0 || (check.unpushed ?? 0) > 0 || check.ignored.length > 0) && (
              <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/[0.07] dark:text-amber-300">
                <div className="flex items-center gap-1.5 font-semibold"><IconAlertTriangle size={14} aria-hidden />{t("rmWs.warnTitle")}</div>
                {check.dirty > 0 && <p className="mt-1">{t("rmWs.dirty", { n: check.dirty })}</p>}
                {(check.unpushed ?? 0) > 0 && <p className="mt-1">{t("rmWs.unpushed", { n: check.unpushed ?? 0 })}</p>}
                {check.ignored.length > 0 && <p className="mt-1 break-all">{t("rmWs.ignored", { n: check.ignored.length, list: check.ignored.slice(0, 5).join(", ") + (check.ignored.length > 5 ? " …" : "") })}</p>}
              </div>
            )}
            {check.branch && (
              <label className="flex items-center gap-2 text-[12.5px] text-zinc-700 dark:text-zinc-200">
                <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} className="accent-mustard-500" />
                <span>{t("rmWs.deleteBranch")}</span>
                <span className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[11px] text-zinc-400"><IconGitBranch size={12} aria-hidden />{check.branch}</span>
              </label>
            )}
            {check.branch && deleteBranch && <p className="-mt-2 ml-6 text-[11px] text-zinc-400 dark:text-zinc-500">{t("rmWs.deleteBranchHint")}</p>}
            {a && !a.trusted && (
              <div className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
                <div className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t(a.tooLong ? "rmWs.archiveTooLong" : "rmWs.archiveTitle")}</div>
                {!a.tooLong && <>
                  <pre className="nunopi-scroll mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 font-mono text-[11.5px] leading-relaxed text-zinc-700 dark:bg-black/30 dark:text-zinc-300">{a.script}</pre>
                  <label className="mt-1.5 flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
                    <input type="checkbox" checked={trustArchive} onChange={(e) => setTrustArchive(e.target.checked)} className="accent-mustard-500" />{t("rmWs.archiveTrust")}
                  </label>
                </>}
                {!trustArchive && <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{t("rmWs.archiveSkip")}</p>}
              </div>
            )}
            {failed !== null && (
              <div className="rounded-xl border border-rose-300/60 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/[0.07]">
                <div className="text-[12px] font-semibold text-rose-700 dark:text-rose-300">{t("rmWs.archiveFailed")}</div>
                {failed && <pre className="nunopi-scroll mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{failed}</pre>}
              </div>
            )}
          </>)}
        </div>
        <div className="flex items-center gap-2 rounded-b-2xl border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
          <span className="flex-1" />
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.cancel")}</button>
          <button type="button" onClick={() => void remove(failed !== null)} disabled={!check || busy}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:opacity-40">
            {busy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconTrash size={13} aria-hidden />}
            {t(failed !== null ? "rmWs.removeIgnoreArchive" : check && check.dirty > 0 ? "rmWs.removeAnyway" : "rmWs.remove")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconLoader2 } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";

// "작업공간 설정"(#1216) — 이 레포의 새 작업공간 setup·archive 스크립트·공유 폴더를 앱에서 편집.
// 스크립트·공유 폴더 = 레포의 .mustard/config.json(팀과 공유), 자동 실행 = 내 PC 설정. 창 모양은 새 작업공간 창과 같은 틀.
const post = async (body: Record<string, unknown>) => (await fetch("/api/repo/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
type Cfg = { setup: string; archive: string; shared: string; setupAuto: boolean };

export default function WorkspaceSettingsDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    post({ action: "config-get", path: root }).then((r) => {
      if (!alive) return;
      if (!r?.ok) { toast(t("wsSettings.loadFailed"), "error"); onClose(); return; }
      setBroken(!!r.broken);
      setCfg({ setup: r.setup ?? "", archive: r.archive ?? "", shared: (r.shared ?? []).join("\n"), setupAuto: r.setupAuto !== false });
    }).catch(() => { if (alive) { toast(t("wsSettings.loadFailed"), "error"); onClose(); } });
    return () => { alive = false; };
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps -- 열 때 한 번
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = async () => {
    if (!cfg || busy) return;
    setBusy(true);
    const r = await post({ action: "config-set", path: root, setup: cfg.setup, archive: cfg.archive, shared: cfg.shared.split("\n"), setupAuto: cfg.setupAuto }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      const key = r?.error === "broken" ? "wsSettings.broken" : r?.error === "too-long" ? "wsSettings.tooLong" : r?.error === "bad-path" ? "wsSettings.badPath" : "wsSettings.saveFailed";
      toast(t(key), "error");
      return;
    }
    toast(t("wsSettings.saved"));
    onClose();
  };

  const input = "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-[12px] text-zinc-800 outline-none focus:border-mustard-500/60 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100";
  const label = "mb-1 block text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400";
  const hint = "mt-1 text-[11px] text-zinc-400 dark:text-zinc-500";
  const set = (k: keyof Cfg) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setCfg((c) => (c ? { ...c, [k]: e.target.value } : c));

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={() => { if (!busy) onClose(); }} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t("wsSettings.title")}
        className="relative w-full max-w-lg overflow-visible rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        <div className="px-5 pt-4 text-[11.5px] font-medium text-zinc-400 dark:text-zinc-500">{t("wsSettings.title")}</div>
        {!cfg ? (
          <div className="flex justify-center px-5 py-8"><IconLoader2 size={16} className="animate-spin text-zinc-400" aria-hidden /></div>
        ) : (<>
          <div className="space-y-3 px-5 pb-4 pt-2">
            <p className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("wsSettings.desc")}</p>
            {broken && <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">{t("wsSettings.broken")}</p>}
            <div>
              <label className={label} htmlFor="ws-set-setup">{t("wsSettings.setup")}</label>
              <textarea id="ws-set-setup" value={cfg.setup} onChange={set("setup")} rows={3} spellCheck={false} placeholder="pnpm install" className={input} />
              <p className={hint}>{t("wsSettings.setupHint")}</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-[12px] text-zinc-700 dark:text-zinc-300">{t("wsSettings.setupAuto")}</span>
              <button type="button" role="switch" aria-checked={cfg.setupAuto} aria-label={t("wsSettings.setupAuto")} onClick={() => setCfg((c) => (c ? { ...c, setupAuto: !c.setupAuto } : c))}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${cfg.setupAuto ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${cfg.setupAuto ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            <div>
              <label className={label} htmlFor="ws-set-archive">{t("wsSettings.archive")}</label>
              <textarea id="ws-set-archive" value={cfg.archive} onChange={set("archive")} rows={2} spellCheck={false} className={input} />
              <p className={hint}>{t("wsSettings.archiveHint")}</p>
            </div>
            <div>
              <label className={label} htmlFor="ws-set-shared">{t("wsSettings.shared")}</label>
              <textarea id="ws-set-shared" value={cfg.shared} onChange={set("shared")} rows={2} spellCheck={false} placeholder="node_modules" className={input} />
              <p className={hint}>{t("wsSettings.sharedHint")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-b-2xl border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500" title={root}>.mustard/config.json</span>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3.5 py-2 disabled:opacity-40 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.cancel")}</button>
            <button type="button" onClick={() => void save()} disabled={busy || broken}
              className="inline-flex items-center gap-1 rounded-lg bg-mustard-500 px-3.5 py-2 text-[13px] font-semibold text-brown-900 shadow-sm transition hover:bg-mustard-400 disabled:opacity-40">
              {busy && <IconLoader2 size={13} className="animate-spin" aria-hidden />}{t("wsSettings.save")}
            </button>
          </div>
        </>)}
      </div>
    </div>,
    document.body,
  );
}

"use client";
// Crew 자동 계기 창(#1112) — 왼쪽 목록(켜짐 점·종류·조건), 오른쪽 편집(종류·조건·파이프라인·켜기). RolesDialog와 같은 틀.
// 저장 = 레포별(/api/crew/triggers). 확인은 오케스트레이터가 1분마다 — 마지막 실행·오류를 여기서 보여 줌.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconAlertTriangle, IconBolt, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useConfirm, useT, useToast } from "@mustard/core";
import type { CrewRole } from "@/lib/crew/crewRoleDefaults";
import type { CrewTrigger, TriggerKind } from "@/lib/crew/crewTriggers";
import { relTime } from "@/lib/relTime";
import { RoleIcon, roleName } from "./crewUi";

const NEW = "__new__";
const KINDS: TriggerKind[] = ["ci-failed", "issue-label", "schedule", "tracker-assigned"];
type Draft = Partial<CrewTrigger> & { kind: TriggerKind; pipeline: string[] };
const blank = (kind: TriggerKind = "ci-failed"): Draft => ({ kind, enabled: true, pipeline: kind === "ci-failed" ? ["bug-fixer", "test-engineer"] : [] });

export default function TriggersDialog({ root, roles, onClose }: { root: string; roles: CrewRole[]; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<CrewTrigger[]>([]);
  const [sel, setSel] = useState<string>(NEW);
  const [draft, setDraft] = useState<Draft>(blank());
  const [menu, setMenu] = useState(false);
  const cur = list.find((x) => x.id === sel);
  const pick = (id: string, l: CrewTrigger[] = list) => { setSel(id); setDraft(l.find((x) => x.id === id) ?? blank()); setMenu(false); };

  useEffect(() => {
    fetch(`/api/crew/triggers?root=${encodeURIComponent(root)}`).then((r) => r.json())
      .then((j) => { if (!j?.ok) throw new Error(); setList(j.triggers); if (j.triggers[0]) { setSel(j.triggers[0].id); setDraft(j.triggers[0]); } })
      .catch(() => toast(t("crew.loadFailed"), "error"));
  }, [root, t, toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const post = async (body: unknown): Promise<CrewTrigger[] | null> => {
    try {
      const j = await (await fetch("/api/crew/triggers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, ...(body as object) }) })).json();
      if (!j?.ok) throw new Error(j?.error);
      setList(j.triggers); return j.triggers;
    } catch { toast(t("crew.saveFailed"), "error"); return null; }
  };
  const valid = draft.kind === "ci-failed" || (draft.kind === "tracker-assigned" ? !!draft.provider : draft.kind === "issue-label" ? !!draft.label?.trim() : !!draft.title?.trim() && (!!draft.at || !!draft.everyHours));
  const save = async (d: Draft = draft) => {
    const next = await post({ op: "save", trigger: { ...d, id: sel === NEW ? undefined : d.id } });
    if (!next) return;
    toast(t("crew.save.done"), "success");
    pick(sel === NEW ? next[next.length - 1]?.id ?? NEW : d.id!, next);
  };

  const summary = (x: Draft) => x.kind === "ci-failed" ? x.branch || t("crewtrig.defaultBranch")
    : x.kind === "tracker-assigned" ? (x.provider === "jira" ? "Jira" : x.provider === "linear" ? "Linear" : "")
    : x.kind === "issue-label" ? (x.label ? `#${x.label}` : "") : x.everyHours ? t("crewtrig.everyN", { n: x.everyHours }) : x.at ? t("crewtrig.dailyAt", { at: x.at }) : "";
  const field = "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] text-zinc-800 outline-none transition focus:border-zinc-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-100 dark:focus:border-white/25";
  const label = "mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400";
  const seg = (on: boolean) => `rounded-md px-2 py-1 text-[11.5px] font-medium transition ${on ? "bg-white text-zinc-900 shadow-sm dark:bg-white/15 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(cur ?? blank(draft.kind));
  const daily = draft.everyHours === undefined;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t("crewtrig.title")}
        className="relative flex h-[min(600px,85vh)] w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        {/* 목록 */}
        <div className="flex w-64 shrink-0 flex-col border-r border-zinc-100 bg-zinc-50/60 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="px-4 pb-2 pt-4 text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t("crewtrig.title")}</div>
          <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {!list.length && <p className="px-2.5 py-2 text-[11.5px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("crewtrig.empty")}</p>}
            {list.map((x) => (
              <button key={x.id} type="button" onClick={() => pick(x.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${sel === x.id ? "bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-white/[0.06] dark:ring-white/10" : "hover:bg-zinc-100 dark:hover:bg-white/[0.04]"}`}>
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${x.lastError ? "bg-rose-500" : x.enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">{x.kind === "schedule" && x.title ? x.title : t(`crewtrig.kind.${x.kind}`)}</span>
                  <span className="block truncate text-[10.5px] text-zinc-400 dark:text-zinc-500">{summary(x)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-zinc-100 p-2 dark:border-white/5">
            <button type="button" onClick={() => pick(NEW)}
              className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition ${sel === NEW ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-white/[0.06] dark:text-zinc-50 dark:ring-white/10" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.04]"}`}>
              <IconPlus size={14} stroke={2} aria-hidden />{t("crewtrig.new")}
            </button>
          </div>
        </div>

        {/* 편집 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-5 pb-1 pt-4">
            <IconBolt size={16} stroke={2} className="text-mustard-600 dark:text-mustard-400" aria-hidden />
            <span className="truncate text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{sel === NEW ? t("crewtrig.new") : t(`crewtrig.kind.${draft.kind}`)}</span>
            <button type="button" onClick={onClose} aria-label={t("crew.cancel")} className="ml-auto rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
              <IconX size={15} stroke={2} aria-hidden />
            </button>
          </div>
          {cur && (
            <p className="px-5 text-[11.5px] text-zinc-400 dark:text-zinc-500">
              {cur.lastFired ? t("crewtrig.lastFired", { when: relTime(new Date(cur.lastFired).toISOString()) }) : cur.primed || cur.kind === "schedule" ? t("crewtrig.notYet") : t("crewtrig.priming")}
            </p>
          )}

          <div className="nunopi-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
            {cur?.lastError && (
              <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] leading-relaxed text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                <IconAlertTriangle size={14} stroke={2} className="mt-0.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words font-mono">{cur.lastError}</span>
              </div>
            )}
            <div>
              <label className={label}>{t("crewtrig.when")}</label>
              <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-zinc-100 p-0.5 sm:grid-cols-4 dark:bg-white/[0.05]">
                {KINDS.map((k) => (
                  <button key={k} type="button" onClick={() => setDraft(sel === NEW ? blank(k) : { ...draft, kind: k })} className={seg(draft.kind === k)}>{t(`crewtrig.kind.${k}`)}</button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t(`crewtrig.hint.${draft.kind}`)}</p>
            </div>

            {draft.kind === "ci-failed" && (
              <div><label className={label}>{t("crewtrig.branch")}</label><input className={field} value={draft.branch ?? ""} placeholder={t("crewtrig.defaultBranch")} maxLength={200} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} /></div>
            )}
            {draft.kind === "tracker-assigned" && (
              <div><label className={label}>{t("crewtrig.provider")}</label>
                <div className="grid w-44 grid-cols-2 gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.05]">
                  {(["linear", "jira"] as const).map((p) => <button key={p} type="button" onClick={() => setDraft({ ...draft, provider: p })} className={seg(draft.provider === p)}>{p === "linear" ? "Linear" : "Jira"}</button>)}
                </div></div>
            )}
            {draft.kind === "issue-label" && (
              <div><label className={label}>{t("crewtrig.label")}</label><input className={field} value={draft.label ?? ""} placeholder="crew" maxLength={100} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></div>
            )}
            {draft.kind === "schedule" && (
              <>
                <div className="flex items-end gap-3">
                  <div className="grid w-44 shrink-0 grid-cols-2 gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.05]">
                    <button type="button" onClick={() => setDraft({ ...draft, everyHours: undefined, at: draft.at ?? "09:00" })} className={seg(daily)}>{t("crewtrig.daily")}</button>
                    <button type="button" onClick={() => setDraft({ ...draft, at: undefined, everyHours: draft.everyHours ?? 6 })} className={seg(!daily)}>{t("crewtrig.every")}</button>
                  </div>
                  {daily
                    ? <input type="time" className={`${field} w-32`} value={draft.at ?? ""} onChange={(e) => setDraft({ ...draft, at: e.target.value })} />
                    : <label className="flex items-center gap-1.5 text-[12px] text-zinc-500 dark:text-zinc-400"><input type="number" min={1} max={168} className={`${field} w-20 tabular-nums`} value={draft.everyHours ?? 6} onChange={(e) => setDraft({ ...draft, everyHours: Math.min(168, Math.max(1, Number(e.target.value) || 1)) })} />{t("crewtrig.hours")}</label>}
                </div>
                <div><label className={label}>{t("crewtrig.cardTitle")}</label><input className={field} value={draft.title ?? ""} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
                <div><label className={label}>{t("crewtrig.cardBody")}</label><textarea className={`${field} nunopi-scroll min-h-[90px] resize-y`} value={draft.body ?? ""} maxLength={8000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
              </>
            )}

            <div>
              <label className={label}>{t("crew.pipeline")}</label>
              <div className="flex flex-wrap items-center gap-1">
                {draft.pipeline.map((r, i) => (
                  <span key={`${r}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 py-0.5 pl-1.5 pr-0.5 text-[11.5px] text-zinc-700 dark:border-white/10 dark:text-zinc-200">
                    <span className="tabular-nums text-[10px] text-zinc-400">{i + 1}</span>
                    <RoleIcon role={roles.some((x) => x.id === r) ? r : undefined} size={12} />
                    <span>{roleName(t, roles, r)}</span>
                    <button type="button" onClick={() => setDraft({ ...draft, pipeline: draft.pipeline.filter((_, j) => j !== i) })} aria-label={t("crew.removeRole")} className="rounded p-0.5 text-zinc-400 hover:text-rose-500"><IconX size={11} aria-hidden /></button>
                  </span>
                ))}
                <div className="relative">
                  <button type="button" onClick={() => setMenu(!menu)} className="inline-flex items-center gap-1 rounded-md border border-dashed border-zinc-300 px-1.5 py-0.5 text-[11.5px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800 dark:border-white/15 dark:text-zinc-400 dark:hover:text-zinc-200">
                    <IconPlus size={11} stroke={2} aria-hidden />{t("crew.addRole")}
                  </button>
                  {menu && (
                    <div className="nunopi-scroll absolute bottom-full left-0 z-10 mb-1 max-h-60 w-60 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1c24]">
                      {roles.map((r) => (
                        <button key={r.id} type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                          onClick={() => { setDraft({ ...draft, pipeline: [...draft.pipeline, r.id] }); setMenu(false); }}>
                          <RoleIcon role={r.id} size={13} className="text-zinc-500 dark:text-zinc-400" />
                          <span className="flex-1 text-[12.5px] text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r.id)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {!draft.pipeline.length && <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("crew.pipelineHint")}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
            {cur && (
              <>
                <button type="button" onClick={async () => {
                  if (!(await confirm({ message: t("crewtrig.deleteConfirm"), danger: true, confirmText: t("crew.delete") }))) return;
                  const next = await post({ op: "delete", id: cur.id }); if (next) pick(next[0]?.id ?? NEW, next);
                }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">
                  <IconTrash size={14} stroke={2} aria-hidden />{t("crew.delete")}
                </button>
                {/* 켜기/끄기는 바로 저장(다른 수정 중이면 그것도 같이) */}
                <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-300">
                  <input type="checkbox" className="accent-mustard-500" checked={draft.enabled !== false} disabled={!valid} onChange={(e) => void save({ ...draft, enabled: e.target.checked })} />
                  {t("crewtrig.enabled")}
                </label>
              </>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.cancel")}</button>
            <button type="button" onClick={() => void save()} disabled={!dirty || !valid}
              className="rounded-lg bg-mustard-500 px-3.5 py-2 text-[13px] font-semibold text-brown-900 shadow-sm transition hover:bg-mustard-400 disabled:opacity-40">
              {sel === NEW ? t("crew.create") : t("crew.save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

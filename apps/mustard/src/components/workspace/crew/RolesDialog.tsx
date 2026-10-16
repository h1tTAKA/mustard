"use client";
// Crew 역할 관리 창(#1100) — 왼쪽 목록(기본 8 + 커스텀), 오른쪽 편집(이름·설명은 커스텀만, 지시문·실행 AI·모델·권한).
// 기본 역할은 삭제 대신 "기본값으로". 저장은 전역(~/.nunopi/crew/roles.json) — 모든 레포가 같은 역할을 씀.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconPlus, IconRotate, IconTrash, IconX } from "@tabler/icons-react";
import { useConfirm, useT, useToast } from "@mustard/core";
import { CREW_PROVIDERS, type CrewRole } from "@/lib/crew/crewRoleDefaults";
import { PROVIDER_LABEL, RoleIcon, roleDesc, roleName } from "./crewUi";

const NEW = "__new__";

export default function RolesDialog({ roles, onRoles, onClose }: { roles: CrewRole[]; onRoles: (r: CrewRole[]) => void; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [sel, setSel] = useState<string>(roles[0]?.id ?? NEW);
  const cur = roles.find((r) => r.id === sel);
  const blank: CrewRole = { id: "", name: "", description: "", instructions: "", provider: "claude-code", access: "write" };
  const [draft, setDraft] = useState<CrewRole>(cur ?? blank);
  // 선택과 초안을 같이 바꿈(effect로 따라가게 하면 렌더가 한 번 더 돎)
  const pick = (id: string, list: CrewRole[] = roles) => { setSel(id); setDraft(list.find((r) => r.id === id) ?? blank); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const post = async (body: unknown): Promise<CrewRole[] | null> => {
    try {
      const j = await (await fetch("/api/crew/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
      if (!j?.ok) throw new Error(j?.error);
      onRoles(j.roles); return j.roles;
    } catch { toast(t("crew.saveFailed"), "error"); return null; }
  };
  const save = async () => {
    const isNew = sel === NEW;
    if (!draft.builtin && !draft.name.trim()) return;
    const next = await post({ op: "save", role: { ...draft, id: isNew ? undefined : draft.id } });
    if (!next) return;
    toast(t("crew.save.done"), "success");
    if (isNew) pick(next[next.length - 1]?.id ?? NEW, next); // 새 커스텀은 맨 끝
    else setDraft(next.find((r) => r.id === draft.id) ?? draft);
  };

  const field = "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] text-zinc-800 outline-none transition focus:border-zinc-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-100 dark:focus:border-white/25";
  const label = "mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400";
  const dirty = JSON.stringify(draft) !== JSON.stringify(cur ?? blank);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t("crew.rolesTitle")}
        className="relative flex h-[min(640px,85vh)] w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        {/* 목록 */}
        <div className="flex w-64 shrink-0 flex-col border-r border-zinc-100 bg-zinc-50/60 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="flex items-center px-4 pb-2 pt-4">
            <span className="mr-auto text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t("crew.rolesTitle")}</span>
          </div>
          <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {roles.map((r) => (
              <button key={r.id} type="button" onClick={() => pick(r.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${sel === r.id ? "bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-white/[0.06] dark:ring-white/10" : "hover:bg-zinc-100 dark:hover:bg-white/[0.04]"}`}>
                <RoleIcon role={r.id} size={14} className="mt-0.5 text-zinc-500 dark:text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">{roleName(t, roles, r.id)}</span>
                  <span className="block truncate text-[10.5px] text-zinc-400 dark:text-zinc-500">{PROVIDER_LABEL[r.provider] ?? r.provider} · {r.access === "read" ? t("crew.access.read").split(" — ")[0] : t("crew.access.write").split(" — ")[0]}</span>
                </span>
                {!r.builtin && <span className="mt-0.5 shrink-0 rounded bg-mustard-500/15 px-1 text-[9.5px] font-medium text-mustard-700 dark:text-mustard-400">{t("crew.customBadge")}</span>}
              </button>
            ))}
          </div>
          <div className="border-t border-zinc-100 p-2 dark:border-white/5">
            <button type="button" onClick={() => pick(NEW)}
              className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition ${sel === NEW ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-white/[0.06] dark:text-zinc-50 dark:ring-white/10" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.04]"}`}>
              <IconPlus size={14} stroke={2} aria-hidden />{t("crew.newRole")}
            </button>
          </div>
        </div>

        {/* 편집 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-5 pb-1 pt-4">
            <RoleIcon role={sel === NEW ? "custom" : sel} size={16} className="text-mustard-600 dark:text-mustard-400" />
            <span className="truncate text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{sel === NEW ? t("crew.newRole") : roleName(t, roles, sel)}</span>
            {cur && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">{cur.builtin ? t("crew.builtinBadge") : t("crew.customBadge")}</span>}
            <button type="button" onClick={onClose} aria-label={t("crew.cancel")} className="ml-auto rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200">
              <IconX size={15} stroke={2} aria-hidden />
            </button>
          </div>
          {cur?.builtin && <p className="px-5 text-[12px] text-zinc-500 dark:text-zinc-400">{roleDesc(t, roles, sel)}</p>}

          <div className="nunopi-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
            {!draft.builtin && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>{t("crew.roleName")}</label><input className={field} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
                <div><label className={label}>{t("crew.roleDescription")}</label><input className={field} value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>{t("crew.roleProvider")}</label>
                <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.05]">
                  {CREW_PROVIDERS.map((p) => (
                    <button key={p} type="button" onClick={() => setDraft({ ...draft, provider: p })}
                      className={`flex-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition ${draft.provider === p ? "bg-white text-zinc-900 shadow-sm dark:bg-white/15 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                      {PROVIDER_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div><label className={label}>{t("crew.roleModel")}</label><input className={field} value={draft.model ?? ""} placeholder={t("crew.roleModelHint")} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></div>
            </div>
            <div>
              <label className={label}>{t("crew.roleAccess")}</label>
              <div className="grid grid-cols-2 gap-2">
                {(["read", "write"] as const).map((a) => (
                  <button key={a} type="button" onClick={() => setDraft({ ...draft, access: a })}
                    className={`rounded-lg border px-3 py-2 text-left text-[12px] transition ${draft.access === a ? "border-mustard-500/60 bg-mustard-500/[0.06] text-zinc-900 dark:text-zinc-50" : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/20"}`}>
                    {t(`crew.access.${a}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>{t("crew.roleInstructions")}</label>
              <textarea className={`${field} nunopi-scroll min-h-[180px] resize-y font-mono text-[11.5px] leading-relaxed`} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("crew.roleInstructionsHint")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
            {cur?.builtin && (
              <button type="button" onClick={async () => { const next = await post({ op: "reset", id: cur.id }); if (next) setDraft(next.find((r) => r.id === cur.id) ?? draft); }}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] text-zinc-600 transition hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-white/10">
                <IconRotate size={14} stroke={2} aria-hidden />{t("crew.roleReset")}
              </button>
            )}
            {cur && !cur.builtin && (
              <button type="button" onClick={async () => {
                if (!(await confirm({ message: t("crew.roleDeleteConfirm"), danger: true, confirmText: t("crew.roleDelete") }))) return;
                const next = await post({ op: "delete", id: cur.id }); if (next) pick(next[0]?.id ?? NEW, next);
              }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10">
                <IconTrash size={14} stroke={2} aria-hidden />{t("crew.roleDelete")}
              </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-white/10">{t("crew.cancel")}</button>
            <button type="button" onClick={() => void save()} disabled={!dirty || (!draft.builtin && !draft.name.trim())}
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

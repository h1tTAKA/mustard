"use client";
// 설정 > Crew 권한(#1279) — 항목마다 '알아서 허용(켬) / 물어보기(끔)'. 값은 서버 파일(~/.nunopi/crew/permissions.json)이라
// 앱 서버 API로 읽고 씀(앱 화면만 바꿀 수 있음 — 쿠키 검사). 항목 목록은 apps/mustard crewTypes CREW_PERM_CATS와 같게.
import { useEffect, useState } from "react";
import { useT, useToast } from "@mustard/core";
import { SettingRow } from "./settingsControls";

const CATS = ["unknownCmd", "git", "code", "network", "system", "publish", "mcp"] as const;
type Perms = Record<(typeof CATS)[number], boolean>;

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function CrewPermSection() {
  const t = useT();
  const toast = useToast();
  const [perms, setPerms] = useState<Perms | null>(null);
  useEffect(() => {
    fetch("/api/crew/permissions").then((r) => r.json()).then((j) => { if (j.ok) setPerms(j.perms); else throw new Error(j.error); })
      .catch(() => toast(t("crewPerm.loadFailed"), "error"));
  }, [t, toast]);
  const set = async (c: keyof Perms, v: boolean) => {
    if (!perms) return;
    const prev = perms;
    setPerms({ ...perms, [c]: v }); // 바로 반영, 실패하면 되돌림
    try {
      const j = await (await fetch("/api/crew/permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [c]: v }) })).json();
      if (!j.ok) throw new Error(j.error);
      setPerms(j.perms);
    } catch { setPerms(prev); toast(t("crewPerm.saveFailed"), "error"); }
  };
  return (
    <section id="set-crew" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="space-y-1">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("crewPerm.desc")}</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("crewPerm.fixed")}</p>
      </div>
      {CATS.map((c) => (
        <SettingRow key={c} title={t(`crewPerm.${c}`)} desc={t(`crewPerm.${c}Desc`)}>
          <Switch on={!!perms?.[c]} label={t(`crewPerm.${c}`)} disabled={!perms} onChange={(v) => void set(c, v)} />
        </SettingRow>
      ))}
    </section>
  );
}

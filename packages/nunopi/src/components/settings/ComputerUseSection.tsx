"use client";
// 컴퓨터 사용(#1175·#1189) — 에이전트의 데스크톱 앱 조작.
// 화면 = ① 상태 + 켜기 스위치 + 비상 정지 ② 준비(조작 도우미·권한 — 할 일만 버튼) ③ 막는 앱 ④ 최근 기록.
// 조작 자체는 Mustard MCP의 computer_* → main → 도우미(없으면 외부 드라이버). 이 화면은 main 설정만 바꿈.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconLoader2, IconCopy, IconX, IconDeviceDesktop, IconAccessible, IconScreenshot, IconCpu, IconShieldLock, IconHistory, IconCircleCheckFilled, IconExternalLink, IconRefresh, IconPlus, IconAlertTriangle } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";

const card = "rounded-2xl border border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/40";
const ghost = "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
const primary = "inline-flex shrink-0 items-center gap-1 rounded-lg bg-mustard-500 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-mustard-600 disabled:opacity-50";
const INSTALL_MAC = `/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"`;
const INSTALL_WIN = "irm https://cua.ai/driver/install.ps1 | iex";
// 가속키 → 키 하나씩(mac은 기호)
const keysOf = (k: string, mac: boolean) => k.split("+").map((p) => (mac ? ({ Control: "⌃", Alt: "⌥", Command: "⌘", Shift: "⇧" } as Record<string, string>)[p] ?? p : p));

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
// 준비 목록의 한 줄 — 아이콘·이름·설명, 오른쪽엔 할 일 버튼(다 됐으면 체크)
function Step({ icon, title, desc, done, children }: { icon: ReactNode; title: string; desc: string; done: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${done ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{title}{done && <IconCircleCheckFilled size={14} className="text-emerald-500" aria-hidden />}</p>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{desc}</p>
      </div>
      {children}
    </div>
  );
}

export default function ComputerUseSection() {
  const t = useT();
  const toast = useToast();
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.computer : undefined;
  const [st, setSt] = useState<ComputerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState("");
  const [adding, setAdding] = useState(false);
  const addDone = useRef(false); // 입력칸이 닫힐 때 blur가 한 번 더 와도(Enter·Esc 뒤) 두 번 처리하지 않게(리뷰)
  const stRef = useRef<ComputerStatus | null>(null);
  useEffect(() => { stRef.current = st; }, [st]);
  const seq = useRef(0); // 늦게 온 옛 응답이 새 값을 덮지 않게 — 마지막 요청 응답만 반영
  const refresh = useCallback(async (force = false) => {
    if (!api) return;
    const my = ++seq.current;
    setBusy(true);
    try { const r = await api.status(force); if (my === seq.current) setSt(r); } catch { /* 다음 확인 때 */ } finally { setBusy(false); }
  }, [api]);
  // 뜰 때 + 창에 돌아올 때(시스템 설정에서 허용 후) + 비상 정지 때
  useEffect(() => {
    void refresh(); // eslint-disable-line react-hooks/set-state-in-effect -- 뜰 때 한 번 확인
    const onFocus = () => void refresh(!stRef.current?.driver); // 드라이버가 없을 때만 셸 PATH부터 다시
    window.addEventListener("focus", onFocus);
    const off = api?.onChanged(() => void refresh());
    return () => { window.removeEventListener("focus", onFocus); off?.(); };
  }, [api, refresh]);
  if (!api) return null;
  if (!st) return <div className="flex items-center gap-2 p-2 text-[12px] text-zinc-400"><IconLoader2 size={14} className="animate-spin" aria-hidden />{t("computer.checking")}</div>;

  const mac = st.platform === "darwin";
  const builtin = !!st.driver?.builtin;
  const perms = mac && st.driver ? (["accessibility", "screen"] as const) : [];
  const missing = (st.driver ? 0 : 1) + perms.filter((k) => st.permissions?.[k] !== "granted").length;
  const state = !st.enabled ? "off" : missing ? "setup" : "ready";
  const set = async (patch: { enabled?: boolean; blocked?: string[] }) => { const my = ++seq.current; const r = await api.set(patch); if (my === seq.current) setSt(r); };
  const copy = (s: string) => { void navigator.clipboard.writeText(s).then(() => toast(t("computer.copied"), "success")); };
  const grant = async (kind?: "accessibility" | "screen") => { setBusy(true); try { const r = await api.grant(kind); toast(t(r.ok ? "computer.grantOpened" : "computer.grantFailed"), r.ok ? "success" : "error"); } finally { setBusy(false); void refresh(true); } };
  const reset = async () => { setBusy(true); try { const r = await api.reset(); toast(t(r.ok ? "computer.resetDone" : "computer.resetFailed"), r.ok ? "success" : "error"); } finally { setBusy(false); void refresh(true); } };
  const addBlocked = (cancel = false) => {
    if (addDone.current) return;
    addDone.current = true;
    const v = cancel ? "" : add.trim(); if (v && !st.blocked.some((b) => b.toLowerCase() === v.toLowerCase())) void set({ blocked: [...st.blocked, v] }); setAdd(""); setAdding(false);
  };
  const install = st.platform === "win32" ? INSTALL_WIN : INSTALL_MAC;

  return (
    <div className="space-y-4">
      {/* ① 상태 + 켜기 + 비상 정지 */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${state === "ready" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : state === "setup" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"}`}>
            <IconDeviceDesktop size={20} stroke={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t(`computer.state.${state}`, { n: missing })}</p>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{t(`computer.state.${state}Desc`)}</p>
          </div>
          {busy && <IconLoader2 size={14} className="animate-spin text-zinc-400" aria-hidden />}
          <Switch on={st.enabled} onChange={(v) => void set({ enabled: v })} label={t("computer.enable")} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
          <span className="text-[12px] text-zinc-600 dark:text-zinc-300">{t("computer.stopKey")}</span>
          <span className="flex gap-1">{keysOf(st.stopKey, mac).map((k, i) => <kbd key={i} className="min-w-[22px] rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-center font-mono text-[11px] text-zinc-700 shadow-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">{k}</kbd>)}</span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("computer.stopKeyHint")}</span>
          {st.enabled && !st.stopKeyOk && <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><IconAlertTriangle size={12} aria-hidden />{t("computer.stopKeyTaken")}</span>}
        </div>
      </div>

      {/* ② 준비 — 다 된 건 체크, 할 일만 버튼 */}
      <div className={card}>
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("computer.setup")}</p>
          <button type="button" onClick={() => void refresh(true)} disabled={busy} className={ghost}><IconRefresh size={13} aria-hidden />{t("computer.recheck")}</button>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          <Step icon={<IconCpu size={16} aria-hidden />} done={!!st.driver}
            title={t(builtin ? "computer.builtin" : "computer.driver")}
            desc={st.driver ? t(builtin ? "computer.builtinDesc" : "computer.driverDesc", { version: st.driver.version }) : t("computer.driverMissingDesc")} />
          {!st.driver && (
            <div className="flex items-center gap-2 px-4 pb-3">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-2 py-1.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{install}</code>
              <button type="button" onClick={() => copy(install)} className={ghost} aria-label={t("computer.copy")}><IconCopy size={14} aria-hidden /></button>
            </div>
          )}
          {perms.map((k) => {
            const ok = st.permissions?.[k] === "granted";
            return (
              <Step key={k} icon={k === "accessibility" ? <IconAccessible size={16} aria-hidden /> : <IconScreenshot size={16} aria-hidden />} done={ok}
                title={t(`computer.perm.${k}`)} desc={t(`computer.perm.${k}Hint`)}>
                {ok
                  ? <button type="button" onClick={() => void api.openPrivacy(k)} className={ghost} aria-label={t("computer.openSettings")}><IconExternalLink size={13} aria-hidden /></button>
                  : <button type="button" onClick={() => void (builtin ? grant(k) : api.openPrivacy(k))} disabled={busy} className={primary}>{t("computer.allow")}</button>}
              </Step>
            );
          })}
        </div>
        {perms.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800/70">
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t(builtin ? "computer.builtinPermsHint" : "computer.permsHint")}</p>
            {builtin
              ? <button type="button" onClick={() => void reset()} disabled={busy} className={ghost}>{t("computer.reset")}</button>
              : <button type="button" onClick={() => void grant()} disabled={busy} className={ghost}>{t("computer.grant")}</button>}
          </div>
        )}
      </div>

      {/* ③ 막는 앱 */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2">
          <IconShieldLock size={16} className="text-zinc-500 dark:text-zinc-400" aria-hidden />
          <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{t("computer.blocked")}</p>
          <button type="button" onClick={() => void set({ blocked: st.defaults })} className={`ml-auto ${ghost}`}>{t("computer.blockedReset")}</button>
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{t("computer.blockedHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {st.blocked.map((b) => (
            <span key={b} className="flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 py-0.5 pl-2.5 pr-1 text-[12px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">{b}
              <button type="button" onClick={() => void set({ blocked: st.blocked.filter((x) => x !== b) })} aria-label={t("computer.remove", { name: b })}
                className="rounded-full p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"><IconX size={11} aria-hidden /></button>
            </span>
          ))}
          {adding ? (
            <input autoFocus value={add} onChange={(e) => setAdd(e.target.value)} onBlur={() => addBlocked()}
              onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; /* 한글·일본어 조합 중 Enter는 글자 확정용(리뷰) */ if (e.key === "Enter") addBlocked(); if (e.key === "Escape") addBlocked(true); }}
              placeholder={t("computer.blockedPh")} aria-label={t("computer.blocked")}
              className="w-40 rounded-full border border-mustard-400 bg-transparent px-2.5 py-0.5 text-[12px] text-zinc-800 outline-none dark:text-zinc-100" />
          ) : (
            <button type="button" onClick={() => { addDone.current = false; setAdding(true); }} className="flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-0.5 text-[12px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-200">
              <IconPlus size={12} aria-hidden />{t("computer.add")}
            </button>
          )}
        </div>
      </div>

      {/* ④ 최근 기록 */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2">
          <IconHistory size={16} className="text-zinc-500 dark:text-zinc-400" aria-hidden />
          <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{t("computer.log")}</p>
        </div>
        {st.log.length === 0 ? <p className="mt-2 text-[12px] text-zinc-400 dark:text-zinc-500">{t("computer.logEmpty")}</p> : (
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto">
            {st.log.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.result === "ok" ? "bg-emerald-500" : l.result === "blocked" || l.result === "stopped" ? "bg-rose-500" : "bg-amber-500"}`} aria-hidden />
                <span className="w-16 shrink-0 font-mono text-[11px] text-zinc-400">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200"><span className="font-mono text-[11px]">{l.tool}</span>{l.app ? <span className="text-zinc-400"> · {l.app}</span> : null}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">{t(`computer.result.${["ok", "blocked", "stopped"].includes(l.result) ? l.result : "other"}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

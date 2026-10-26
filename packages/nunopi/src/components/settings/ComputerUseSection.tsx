"use client";
// 컴퓨터 사용(#1175) — 에이전트의 데스크톱 앱 조작. 켜기(기본 끔)·비상 정지 단축키·드라이버(설치는 유저가 터미널에서)·권한·막는 앱·최근 기록.
// 조작 자체는 Mustard MCP의 computer_* → main → 드라이버. 이 화면은 main 설정 파일만 바꿈.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconLoader2, IconCopy, IconX } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";

const card = "space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700";
const title = "text-sm font-semibold text-zinc-800 dark:text-zinc-100";
const hint = "text-[11px] text-zinc-400 dark:text-zinc-500";
const btn = "shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[13px] text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800";
const pill = (ok: boolean) => `rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400"}`;
const INSTALL_MAC = `/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"`;
const INSTALL_WIN = "irm https://cua.ai/driver/install.ps1 | iex";
// 가속키 → 보기 좋은 글자(mac 기호)
const keyLabel = (k: string, mac: boolean) => mac ? k.replace("Control+", "⌃").replace("Alt+", "⌥").replace("Command+", "⌘").replace("Shift+", "⇧") : k.replace(/\+/g, " + ");

export default function ComputerUseSection() {
  const t = useT();
  const toast = useToast();
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.computer : undefined;
  const [st, setSt] = useState<ComputerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState("");
  const stRef = useRef<ComputerStatus | null>(null);
  useEffect(() => { stRef.current = st; }, [st]);
  const seq = useRef(0); // 늦게 온 옛 응답이 새 값을 덮지 않게 — 마지막 요청 응답만 반영(리뷰)
  const refresh = useCallback(async (force = false) => {
    if (!api) return;
    const my = ++seq.current;
    setBusy(true);
    try { const r = await api.status(force); if (my === seq.current) setSt(r); } catch { /* 다음 확인 때 */ } finally { setBusy(false); } // busy는 늘 풂(set이 seq를 올려도 안 멈추게, 리뷰)
  }, [api]);
  // 뜰 때 + 창에 돌아올 때(시스템 설정·터미널에서 설치 후) + 비상 정지 때
  useEffect(() => {
    void refresh(); // eslint-disable-line react-hooks/set-state-in-effect -- 뜰 때 한 번 확인
    const onFocus = () => void refresh(!stRef.current?.driver); // 드라이버가 없을 때만 셸 PATH부터 다시(방금 터미널에서 설치했을 수 있음), 있으면 빠르게(리뷰)
    window.addEventListener("focus", onFocus);
    const off = api?.onChanged(() => void refresh());
    return () => { window.removeEventListener("focus", onFocus); off?.(); };
  }, [api, refresh]);
  if (!api) return null;
  if (!st) return <div className="flex items-center gap-2 p-2 text-[12px] text-zinc-400"><IconLoader2 size={14} className="animate-spin" aria-hidden />{t("computer.checking")}</div>;

  const mac = st.platform === "darwin";
  const set = async (patch: { enabled?: boolean; blocked?: string[] }) => { const my = ++seq.current; const r = await api.set(patch); if (my === seq.current) setSt(r); };
  const copy = (s: string) => { void navigator.clipboard.writeText(s).then(() => toast(t("computer.copied"), "success")); };
  const builtin = !!st.driver?.builtin; // #1189 내장 도우미 — 설치 필요 없음, 권한은 줄마다 받기
  const grant = async (kind?: "accessibility" | "screen") => { setBusy(true); try { const r = await api.grant(kind); toast(t(r.ok ? "computer.grantOpened" : "computer.grantFailed"), r.ok ? "success" : "error"); } finally { setBusy(false); void refresh(true); } };
  const reset = async () => { setBusy(true); try { const r = await api.reset(); toast(t(r.ok ? "computer.resetDone" : "computer.resetFailed"), r.ok ? "success" : "error"); } finally { setBusy(false); void refresh(true); } };
  const addBlocked = () => { const v = add.trim(); if (!v || st.blocked.some((b) => b.toLowerCase() === v.toLowerCase())) return; void set({ blocked: [...st.blocked, v] }); setAdd(""); };
  const permRow = (kind: "accessibility" | "screen") => {
    const v = st.permissions?.[kind] ?? "unknown";
    return (
      <div key={kind} className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-zinc-700 dark:text-zinc-200">{t(`computer.perm.${kind}`)}</p>
          <p className={hint}>{t(`computer.perm.${kind}Hint`)}</p>
        </div>
        <span className={pill(v === "granted")}>{t(`computer.permState.${v}`)}</span>
        {builtin && v !== "granted" && <button type="button" onClick={() => void grant(kind)} disabled={busy} className={btn}>{t("computer.allow")}</button>}
        <button type="button" onClick={() => void api.openPrivacy(kind)} className={btn}>{t("computer.openSettings")}</button>
      </div>
    );
  };

  return (
    <>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("computer.desc")}</p>

      {/* 켜기 + 비상 정지 */}
      <div className={card}>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={st.enabled} onChange={(e) => void set({ enabled: e.target.checked })} className="accent-mustard-500" />
          <span className={title}>{t("computer.enable")}</span>
          {busy && <IconLoader2 size={12} className="animate-spin text-zinc-400" aria-hidden />}
        </label>
        <p className={hint}>{t("computer.enableHint")}</p>
        <p className="text-[12px] text-zinc-600 dark:text-zinc-300">{t("computer.stopKey")} <kbd className="rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-600">{keyLabel(st.stopKey, mac)}</kbd></p>
        {st.enabled && !st.stopKeyOk && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("computer.stopKeyTaken")}</p>}
      </div>

      {/* 드라이버 */}
      <div className={card}>
        <div className="flex items-center gap-2">
          <span className={title}>{t(builtin ? "computer.builtin" : "computer.driver")}</span>
          <span className={`ml-auto ${pill(!!st.driver)}`}>{st.driver ? t("computer.driverOk", { version: st.driver.version }) : t("computer.driverMissing")}</span>
          <button type="button" onClick={() => void refresh(true)} disabled={busy} className={btn}>{t("computer.recheck")}</button>
        </div>
        <p className={hint}>{t(builtin ? "computer.builtinHint" : "computer.driverHint")}</p>
        {!st.driver && (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-2 py-1.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">{st.platform === "win32" ? INSTALL_WIN : INSTALL_MAC}</code>
            <button type="button" onClick={() => copy(st.platform === "win32" ? INSTALL_WIN : INSTALL_MAC)} className={btn} aria-label={t("computer.copy")}><IconCopy size={14} aria-hidden /></button>
          </div>
        )}
        {!st.driver && <p className={hint}>{t("computer.installHint")}</p>}
      </div>

      {/* 권한(macOS, 드라이버가 있을 때) — 권한은 드라이버 앱이 받음 */}
      {mac && st.driver && (
        <div className={card}>
          <div className="flex items-center gap-2">
            <span className={title}>{t("computer.perms")}</span>
            {builtin
              ? <button type="button" onClick={() => void reset()} disabled={busy} className={`ml-auto ${btn}`}>{t("computer.reset")}</button>
              : <button type="button" onClick={() => void grant()} disabled={busy} className={`ml-auto ${btn}`}>{t("computer.grant")}</button>}
          </div>
          <p className={hint}>{t(builtin ? "computer.builtinPermsHint" : "computer.permsHint")}</p>
          {permRow("accessibility")}
          {permRow("screen")}
        </div>
      )}

      {/* 막는 앱 */}
      <div className={card}>
        <div className="flex items-center gap-2">
          <span className={title}>{t("computer.blocked")}</span>
          <button type="button" onClick={() => void set({ blocked: st.defaults })} className={`ml-auto ${btn}`}>{t("computer.blockedReset")}</button>
        </div>
        <p className={hint}>{t("computer.blockedHint")}</p>
        <div className="flex flex-wrap gap-1.5">
          {st.blocked.map((b) => (
            <span key={b} className="flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2 pr-1 text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{b}
              <button type="button" onClick={() => void set({ blocked: st.blocked.filter((x) => x !== b) })} aria-label={t("computer.remove", { name: b })} className="rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"><IconX size={10} aria-hidden /></button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addBlocked(); }} placeholder={t("computer.blockedPh")} aria-label={t("computer.blocked")}
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
          <button type="button" onClick={addBlocked} disabled={!add.trim()} className={btn}>{t("computer.add")}</button>
        </div>
      </div>

      {/* 최근 기록 */}
      <div className={card}>
        <span className={title}>{t("computer.log")}</span>
        {st.log.length === 0 ? <p className={hint}>{t("computer.logEmpty")}</p> : (
          <ul className="max-h-48 space-y-0.5 overflow-auto font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
            {st.log.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex gap-2">
                <span className="shrink-0 text-zinc-400">{new Date(l.at).toLocaleTimeString()}</span>
                <span className="min-w-0 flex-1 truncate">{l.tool}{l.app ? ` · ${l.app}` : ""}</span>
                <span className={l.result === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{l.result}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

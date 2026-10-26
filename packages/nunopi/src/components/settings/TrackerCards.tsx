"use client";
// 이슈 트래커 연결 카드(#1172) — Linear(API 키), Jira(사이트·이메일(선택)·토큰). 저장 = main이 먼저 확인하고 맞을 때만 저장.
// 배지: 연결됨 · 이름(조직/사이트) / 다시 연결 필요(401) / 권한 없음 / 연결 안 됨. 토큰 값은 화면으로 안 옴.
import { useCallback, useEffect, useState } from "react";
import { IconBrandJira, IconLoader2 } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";

function LinearLogo({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}><path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" /></svg>;
}

type Status = Awaited<ReturnType<NonNullable<NonNullable<Window["nunopiDesktop"]>["trackers"]>["status"]>> | null;
const input = "min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function Card({ provider }: { provider: TrackerProvider }) {
  const t = useT();
  const toast = useToast();
  const api = typeof window !== "undefined" ? window.nunopiDesktop?.trackers : undefined;
  const [st, setSt] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const refresh = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try { const r = await api.status(provider); setSt(r); if (provider === "jira") { setSite((v) => v || r.site || ""); setEmail((v) => v || r.email || ""); } }
    catch { setSt({ ok: false, state: "error" }); } finally { setBusy(false); }
  }, [api, provider]);
  useEffect(() => { void refresh(); }, [refresh]); // eslint-disable-line react-hooks/set-state-in-effect -- 카드가 뜰 때 한 번 확인
  if (!api) return null;
  const connected = !!st?.ok, needsAuth = st && !st.ok && st.state === "not-authed";
  const badge = busy ? { txt: t("trackers.checking"), cls: "bg-zinc-500/15 text-zinc-500" }
    : connected && st?.ok ? { txt: t("trackers.connectedAs", { name: st.data.name, account: st.data.account }), cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" }
    : needsAuth ? { txt: t("trackers.reconnect"), cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" }
    : st && !st.ok && st.state === "forbidden" ? { txt: t("trackers.forbidden"), cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" }
    : st && !st.ok && (st.state === "offline" || st.state === "rate-limited" || st.state === "error") ? { txt: t(`trackers.err.${st.state}`), cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" }
    : { txt: t("settings.hostNotConfigured"), cls: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400" };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.connect(provider, { token, site, email });
      if (r.ok) { toast(t("trackers.connected", { name: r.data.name }), "success"); setToken(""); }
      else toast(t(r.state === "not-authed" ? "trackers.badToken" : r.detail === "site" ? "trackers.badSite" : `trackers.err.${["forbidden", "offline", "rate-limited"].includes(r.state) ? r.state : "error"}`), "error");
    } finally { setBusy(false); void refresh(); }
  };
  const clear = async () => { await api.disconnect(provider); setToken(""); if (provider === "jira") { setSite(""); setEmail(""); } toast(t("settings.ghPatCleared"), "success"); void refresh(); };
  const label = provider === "linear" ? "Linear" : "Jira";
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-center gap-2">
        {provider === "linear" ? <LinearLogo className="shrink-0 text-[#5E6AD2]" /> : <IconBrandJira size={18} stroke={1.75} className="shrink-0 text-[#2684FF]" aria-hidden />}
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{label}</span>
        <span className={`ml-auto flex items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{busy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{badge.txt}</span>
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t(provider === "linear" ? "trackers.linearHint" : "trackers.jiraHint")}</p>
      {provider === "jira" && (
        <div className="flex gap-2">
          <input type="url" value={site} onChange={(e) => setSite(e.target.value)} placeholder="your-team.atlassian.net" aria-label={t("trackers.site")} className={input} />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("trackers.emailPh")} aria-label={t("trackers.email")} className={input} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={connected ? "••••••••" : t(provider === "linear" ? "trackers.linearKeyPh" : "trackers.jiraTokenPh")} aria-label={`${label} token`} className={input} />
        <button type="button" onClick={() => void save()} disabled={busy || !token.trim() || (provider === "jira" && !site.trim())}
          className="shrink-0 rounded-lg bg-mustard-500 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-mustard-600 disabled:opacity-50">{t("trackers.connect")}</button>
        {(connected || needsAuth) && (
          <button type="button" onClick={() => void clear()}
            className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[13px] text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{t("settings.clear")}</button>
        )}
      </div>
    </div>
  );
}

export default function TrackerCards() {
  return <><Card provider="linear" /><Card provider="jira" /></>;
}

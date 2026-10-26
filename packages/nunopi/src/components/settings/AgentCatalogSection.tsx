"use client";
// 에이전트 설정(#1184) — 배치: 기본 에이전트 칩 · 에이전트 권한(전체) · 설치됨 N · 설치 가능 N.
// 줄 = 로고·이름·실제 실행 명령 · 따로 정한 권한 배지 · 켜짐/꺼짐 · 기본값 · 문서 링크 · 펼치기(권한·추가 인자·경로 지정·상태).
// 카탈로그·감지·플래그는 main(IPC detectAgents)이 줌 — 여기선 그리기 + 설정 키(core AKEYS)만.
// 규칙(사용자 편의): 전체 권한을 바꿔도 따로 정한 에이전트는 그대로 + 되돌리기 토스트, 목록은 기본 → 최근 쓴 순 → 안 쓴 것 → 꺼진 것,
// 설치 가능은 접어 두고 검색·이름순, 전체 액세스는 처음 한 번 확인, 줄에 마지막 사용 시각.
import { useState, type ReactNode } from "react";
import { IconChevronDown, IconExternalLink, IconLoader2, IconCheck, IconSearch } from "@tabler/icons-react";
import { AKEYS, AGENT_DEFAULTS, getSetting, setSetting, sortAgents, useConfirm, useLocale, useSetting, useT, useToast, type AgentPermission } from "@mustard/core";

const PERMS: AgentPermission[] = ["own", "ask", "auto", "full-access"]; // 전체 세그먼트(편집 수락은 줄 메뉴에서만)
const FLAG_KEY: Record<string, "ask" | "edits" | "auto" | "full"> = { ask: "ask", "accept-edits": "edits", auto: "auto", "full-access": "full" };
const btn = "rounded-lg px-2.5 py-1 text-xs font-medium transition";
const seg = (on: boolean) => `${btn} ${on ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`;

// 전체 액세스 확인 — 처음 한 번만(확인하면 AKEYS.fullOk, 다음부턴 안 물음)
function useFullAccessGuard() {
  const confirm = useConfirm();
  const t = useT();
  return async (choice: string) => {
    if (choice !== "full-access" || getSetting<boolean>(AKEYS.fullOk, false)) return true;
    const ok = await confirm({ title: t("agents.fullTitle"), message: t("agents.fullMsg"), confirmText: t("agents.perm.full-access"), tone: "warn" });
    if (ok) setSetting(AKEYS.fullOk, true);
    return ok;
  };
}
// "3분 전" — 브라우저 Intl(앱 언어)
function ago(ms: number, locale: string) {
  const s = Math.round((ms - Date.now()) / 1000), f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const a = Math.abs(s);
  return a < 60 ? f.format(Math.round(s), "second") : a < 3600 ? f.format(Math.round(s / 60), "minute") : a < 86400 ? f.format(Math.round(s / 3600), "hour") : f.format(Math.round(s / 86400), "day");
}

// 화면에 보일 명령 — main 카탈로그 launchLine과 같은 순서([env] 명령 플래그 유저인자). 유저 인자가 권한 옵션을 쓰는 경우의 생략은 main만 앎(표시는 근사).
// 유저 인자에 이 에이전트의 권한 옵션이 있으면 플래그를 안 붙임(main과 같은 판단 — carriers는 main 카탈로그가 줌)
const CODEX_CFG = ["approval_policy", "sandbox_mode", "approvals_reviewer", "sandbox_workspace_write"];
const argsSetPermission = (a: AgentDetect, args: string) => {
  const t = args.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return t.some((tok, i) => (a.carriers ?? []).includes(a.id === "codex" && /^-[as].+/.test(tok) ? tok.slice(0, 2) : tok.split("=")[0])
    || (a.id === "codex" && (tok === "-c" || tok === "--config") && CODEX_CFG.includes(String(t[i + 1] || "").split("=")[0].split(".")[0].trim())));
};
function lineOf(a: AgentDetect, choice: string, args: string, cmd?: string) {
  const flag = choice === "own" || argsSetPermission(a, args) ? "" : a.flags?.[FLAG_KEY[choice]] ?? "";
  const env = choice === "full-access" && a.env ? Object.entries(a.env).map(([k, v]) => `${k}=${v} `).join("") : "";
  return `${env}${cmd || a.cmd || a.id}${flag ? ` ${flag}` : ""}${args.trim() ? ` ${args.trim()}` : ""}`;
}

type PathCtl = { value: string; set: (v: string) => void; save: () => void };
export interface AgentCatalogSectionProps {
  list: AgentDetect[] | null;
  checking: boolean;
  onRefresh: () => void;
  agentLogo?: (id: string) => ReactNode;
  paths: Record<string, PathCtl>; // 경로 지정(claude·codex·opencode — SNA와 같은 값)
  pathDirty: boolean;
  onRelaunch?: () => void;
}

export default function AgentCatalogSection({ list, checking, onRefresh, agentLogo, paths, pathDirty, onRelaunch }: AgentCatalogSectionProps) {
  const t = useT();
  const toast = useToast();
  const def = useSetting<string>(AKEYS.default, AGENT_DEFAULTS.default);
  const all = useSetting<string>(AKEYS.perm, AGENT_DEFAULTS.perm);
  useSetting<number>("agent.rev", 0); // 줄별 키(off·perm) 변경도 다시 그리게(아래 setAgent가 올림)
  const guard = useFullAccessGuard();
  const [showAvail, setShowAvail] = useState(false);
  const [q, setQ] = useState("");
  const installed = sortAgents((list ?? []).filter((a) => a.status !== "missing"));
  const available = (list ?? []).filter((a) => a.status === "missing").sort((x, y) => x.label.localeCompare(y.label));
  const shownAvail = q.trim() ? available.filter((a) => `${a.label} ${a.cmd ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())) : available;
  const enabled = (id: string) => !getSetting<boolean>(AKEYS.off(id), false);
  const chips = installed.filter((a) => a.status === "ok" && enabled(a.id));
  const overridden = (list ?? []).filter((a) => getSetting<string>(AKEYS.permOf(a.id), ""));
  const permLabel = (c: string) => t(`agents.perm.${c}`);

  const setAll = async (c: string) => {
    const prev = all;
    if (prev === c || !(await guard(c))) return;
    setSetting(AKEYS.perm, c);
    if (prev !== c) toast(t("agents.permAllSet", { mode: permLabel(c) }), "success", { label: t("agents.undo"), onClick: () => setSetting(AKEYS.perm, prev) });
  };
  const followAll = () => { for (const a of overridden) setSetting(AKEYS.permOf(a.id), ""); setSetting("agent.rev", Date.now()); };

  return (
    <div className="space-y-6">
      {/* 기본 에이전트 — 자동 = 감지되고 켜진 첫 에이전트(목록 순서), 셸만 = 에이전트 없이 */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t("settings.defaultAgent")}</h4>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.defaultAgentHint")}</p>
        <div className="flex flex-wrap gap-1.5">
          {[{ id: "auto", label: t("agents.auto") }, { id: "blank", label: t("agents.shellOnly") }, ...chips.map((a) => ({ id: a.id, label: a.label })),
            ...(def !== "auto" && def !== "blank" && !chips.some((a) => a.id === def) ? [{ id: def, label: (list ?? []).find((a) => a.id === def)?.label ?? def, stale: true }] : [])].map((c) => (
            <button key={c.id} type="button" onClick={() => setSetting(AKEYS.default, c.id)} title={"stale" in c ? t("agents.defaultStale") : undefined}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${def === c.id ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-50" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800/60"} ${"stale" in c ? "opacity-60" : ""}`}>
              {agentLogo && c.id !== "auto" && c.id !== "blank" && <span className="flex size-4 items-center justify-center">{agentLogo(c.id)}</span>}
              {c.label}{def === c.id && <IconCheck size={12} stroke={2.5} aria-hidden />}
            </button>
          ))}
        </div>
      </div>

      {/* 에이전트 권한(전체) — 지원하는 에이전트에만 적용, 따로 정한 에이전트는 그대로 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t("agents.permTitle")}</h4>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">{all === "own" ? t("agents.permOwnHint") : t("agents.permHint")}</p>
          </div>
          <div className="flex shrink-0 gap-0.5 rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-700" role="radiogroup" aria-label={t("agents.permTitle")}>
            {PERMS.map((c) => <button key={c} type="button" role="radio" aria-checked={all === c} onClick={() => void setAll(c)} className={`${seg(all === c)} ${c === "full-access" && all === c ? "!text-amber-600 dark:!text-amber-400" : ""}`}>{permLabel(c)}</button>)}
          </div>
        </div>
        {overridden.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("agents.permOverridden", { n: overridden.length })}</p>
            <button type="button" onClick={followAll} className={`${btn} shrink-0 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`}>{t("agents.permFollowAll")}</button>
          </div>
        )}
      </div>

      {/* 설치됨 / 설치 가능 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t("agents.installed")}</h4>
          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{t("agents.detectedN", { n: installed.length })}</span>
          <button type="button" onClick={onRefresh} disabled={checking} title={t("agents.recheck")}
            className={`${btn} ml-auto flex items-center gap-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800`}>
            <IconLoader2 size={13} stroke={2} className={checking ? "animate-spin" : ""} aria-hidden />{checking ? t("agents.checking") : t("agents.refresh")}
          </button>
        </div>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("agents.statusHint")}</p>
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
          {list === null && <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400"><IconLoader2 size={12} className="animate-spin" aria-hidden />{t("agents.checking")}</div>}
          {installed.map((a) => <AgentRow key={a.id} a={a} logo={agentLogo?.(a.id)} isDefault={def === a.id} path={paths[a.id]} all={all} guard={guard} />)}
        </div>
        {pathDirty && onRelaunch && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
            <p className="text-xs text-amber-700 dark:text-amber-300">{t("settings.cliPathRestartHint")}</p>
            <button type="button" onClick={onRelaunch} className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-amber-700">{t("settings.relaunchNow")}</button>
          </div>
        )}
      </div>
      {/* 설치 가능 — 기본 접힘(우리 규칙: 긴 목록을 늘 펼치지 않음), 펼치면 검색·이름순 */}
      {available.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowAvail(!showAvail)} aria-expanded={showAvail} className="flex w-full items-center gap-2 text-left">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t("agents.available")}</h4>
            <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{t("agents.availableN", { n: available.length })}</span>
            <span className="ml-auto text-xs text-zinc-500">{showAvail ? t("agents.hide") : t("agents.show")}</span>
            <IconChevronDown size={14} stroke={1.75} className={`text-zinc-400 ${showAvail ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {showAvail && (<>
            <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-700">
              <IconSearch size={13} className="text-zinc-400" aria-hidden />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("agents.searchPh")} aria-label={t("agents.searchPh")}
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-900 outline-none dark:text-zinc-50" />
            </label>
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
              {shownAvail.map((a) => <AgentRow key={a.id} a={a} logo={agentLogo?.(a.id)} isDefault={false} all={all} guard={guard} />)}
              {shownAvail.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">{t("agents.noMatch")}</p>}
            </div>
          </>)}
        </div>
      )}
    </div>
  );
}

// 줄 하나 — 설정 키를 줄마다 구독(켜짐·권한·인자)
function AgentRow({ a, logo, isDefault, path, all, guard }: { a: AgentDetect; logo?: ReactNode; isDefault: boolean; path?: PathCtl; all: string; guard: (c: string) => Promise<boolean> }) {
  const t = useT();
  const { locale } = useLocale();
  const used = useSetting<number>(AKEYS.usedAt(a.id), 0);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const off = useSetting<boolean>(AKEYS.off(a.id), false);
  const mine = useSetting<string>(AKEYS.permOf(a.id), "");
  const savedArgs = useSetting<string>(AKEYS.args(a.id), "");
  const [args, setArgs] = useState<string | null>(null); // 편집 중 값(blur 때 저장)
  const choices = a.choices ?? ["own"];
  const eff = choices.includes(mine || all) ? mine || all : "own";
  const ok = a.status === "ok";
  const bump = () => setSetting("agent.rev", Date.now());
  const setOff = (v: boolean) => {
    setSetting(AKEYS.off(a.id), v);
    if (v && getSetting<string>(AKEYS.default, AGENT_DEFAULTS.default) === a.id) setSetting(AKEYS.default, "auto"); // 기본을 끄면 자동으로
    bump();
  };
  const setPerm = async (v: string) => { if (!(await guard(v))) return; setSetting(AKEYS.permOf(a.id), v === "default" ? "" : v); bump(); };
  // 인자 저장 — 알려진 권한 플래그를 쓰면 빼서 이 에이전트 권한으로 + 토스트
  const saveArgs = async () => {
    if (args === null) return;
    const v = args.trim(); setArgs(null);
    let r = v ? await window.nunopiDesktop?.liftAgentArgs?.(a.id, v).catch(() => null) : null;
    // 인자로 전체 액세스를 고른 경우도 처음 한 번 확인(리뷰) — 거절하면 그 플래그만 빼고 저장(권한은 그대로)
    if (r && !(await guard(r.choice))) { setSetting(AKEYS.args(a.id), r.rest); return; }
    if (r) { setSetting(AKEYS.args(a.id), r.rest); setSetting(AKEYS.permOf(a.id), r.choice); bump(); toast(t("agents.permLifted", { name: a.label, mode: t(`agents.perm.${r.choice}`) })); }
    else setSetting(AKEYS.args(a.id), v);
  };
  const badge = a.status === "broken" ? { txt: t("agents.broken"), cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" }
    : ok && a.auth === "unauthenticated" ? { txt: t("agents.loginNeeded"), cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" } : null;
  const customPath = path?.value.trim();

  return (
    <div className={`px-3 py-2.5 ${off ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700">{logo}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{a.label}</span>
            {ok && a.version && <span className="font-mono text-[11px] text-zinc-400">v{a.version}</span>}
            {badge && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.txt}</span>}
            {used > 0 && <span className="hidden truncate text-[11px] text-zinc-400 sm:inline" title={new Date(used).toLocaleString(locale)}>· {t("agents.lastUsed", { when: ago(used, locale) })}</span>}
          </div>
          <p className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500" title={lineOf(a, eff, savedArgs, customPath)}>{lineOf(a, eff, savedArgs, customPath)}</p>
          {argsSetPermission(a, savedArgs) && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("agents.argsOverridePerm")}</p>}
        </div>
        {mine && choices.includes(mine) && (
          <button type="button" onClick={() => setOpen(true)} className="hidden shrink-0 rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 sm:block dark:border-zinc-600 dark:text-zinc-300">
            {mine === "own" ? t("agents.permOwnOf", { name: a.label }) : t(`agents.perm.${mine}`)}
          </button>
        )}
        <div className="flex shrink-0 gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          <button type="button" onClick={() => setOff(false)} className={seg(!off)}>{t("agents.enabled")}</button>
          <button type="button" onClick={() => setOff(true)} className={seg(off)}>{t("agents.disabled")}</button>
        </div>
        {ok && !off && (
          <button type="button" onClick={() => setSetting(AKEYS.default, isDefault ? "blank" : a.id)} title={isDefault ? t("agents.clearDefault") : undefined}
            className={`${btn} hidden w-24 shrink-0 md:block ${isDefault ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
            {isDefault ? `✓ ${t("agents.isDefault")}` : t("agents.setDefault")}
          </button>
        )}
        {a.url && <a href={a.url} target="_blank" rel="noreferrer" title={ok ? t("agents.docs") : t("agents.install")} aria-label={ok ? t("agents.docs") : t("agents.install")} className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"><IconExternalLink size={15} stroke={1.75} /></a>}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={a.label} className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <IconChevronDown size={15} stroke={1.75} className={open ? "rotate-180" : ""} aria-hidden />
        </button>
      </div>

      {open && (
        <div className="mt-2.5 space-y-2.5 pl-[38px]">
          {choices.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-zinc-500">{t("agents.permShort")}</span>
              <select value={mine && choices.includes(mine) ? mine : "default"} onChange={(e) => void setPerm(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
                <option value="default">{t("agents.permSameAsAll", { mode: t(`agents.perm.${choices.includes(all) ? all : "own"}`) })}</option>
                {choices.map((c) => <option key={c} value={c}>{c === "own" ? t("agents.permOwnOf", { name: a.label }) : t(`agents.perm.${c}`)}</option>)}
              </select>
            </label>
          )}
          {ok && (
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-zinc-500">{t("settings.agentExtraArgs")}</span>
              <input type="text" value={args ?? savedArgs} onChange={(e) => setArgs(e.target.value)} onBlur={() => void saveArgs()} placeholder={t("agents.argsPh")}
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[12px] text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </label>
          )}
          {path && (
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-zinc-500">{t("agents.setPath")}</span>
              <input type="text" value={path.value} onChange={(e) => path.set(e.target.value)} onBlur={path.save} placeholder={a.path || ""}
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[12px] text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </label>
          )}
          {path && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("agents.setPathHint")}</p>}
          {a.path && <p className={`truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500 ${customPath ? "line-through" : ""}`} title={a.path}>{a.path}</p>}
          {a.status === "broken" && a.tried[0] && <p className="break-all text-[11px] text-rose-500">{a.tried[0].error || t("agents.brokenHint")}</p>}
          {ok && a.tried.length > 0 && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("agents.skipped", { n: a.tried.length })}</p>}
          {!ok && a.install && (
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={a.install}>{a.install}</code>
              <button type="button" onClick={() => { void navigator.clipboard.writeText(a.install!).then(() => toast(t("agents.copied"))); }}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800">{t("agents.copy")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

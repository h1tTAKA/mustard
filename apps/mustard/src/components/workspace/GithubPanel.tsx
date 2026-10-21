"use client";
// GitHub 패널(Epic #809, 서브2 #811) — 우측 패널의 GitHub 모드 컨테이너.
// 이번 서브는 골격: gh 연결 상태(서브1 #810 authDiagnose) 진단 + owner/repo 표시 + 안내.
// 실제 이슈·PR·CI는 서브3~5(#812/#813/#814)가 이 자리에 채운다.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconBrandGithub, IconBrandGitlab, IconLoader2, IconRefresh, IconAlertTriangle } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import IssueList from "@/components/workspace/github/IssueList";
import IssueDetail from "@/components/workspace/github/IssueDetail";
import PrList from "@/components/workspace/github/PrList";
import PrDetail from "@/components/workspace/github/PrDetail";
import type { CiDot } from "@/components/workspace/github/useBranchCi";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";

type AuthState = "ok" | "not-installed" | "not-authed" | "rate-limited" | "offline" | "error"; // offline = 인터넷 끊김(#1151)
type Probe = { loading: boolean; state?: AuthState; detail?: string };
type OpenItem = { kind: "issue" | "pr"; number: number }; // 상세 열림 — 반반 분할(#824)이라 kind로 이슈/PR 구분

// onOpenPrDiff = PR 변경 파일 클릭 → 가운데 diff 탭(#1123)
// 진단 안내 중 앱이 낸 문구는 표시 때 번역(언어 바뀌어도 재진단 없이 따라옴, #1125) — gh/glab detail은 원문 그대로.
const DESKTOP_ONLY = "\u0000desktopOnly";

export default function GithubPanel({ root, ciDot, onOpenPrDiff, agent }: { root: string; ciDot?: CiDot; onOpenPrDiff?: (pr: number, file: string) => void; agent?: { providerId: AgentProviderKind; providerSettings: ProviderSettings } }) {
  const t = useT();
  const [probe, setProbe] = useState<Probe>({ loading: true });
  const [owner, setOwner] = useState<string | null>(null);
  const [host, setHost] = useState<"github" | "gitlab" | "other">("github"); // #964 origin 호스트
  const [open, setOpen] = useState<OpenItem | null>(null); // 상세 열림. null=반반 목록(#824).
  const [reload, setReload] = useState(0); // 헤더 새로고침 → 목록 재조회 트리거.
  // 토큰(PAT) 폴백(#826) — 미인증 시 토큰 연결. hasToken=저장됨(값 비노출), tokenVal=입력중, tokenBusy=저장중.
  const [hasToken, setHasToken] = useState(false);
  const [tokenVal, setTokenVal] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const [topRatio, setTopRatio] = useState(0.5); // 이슈:PR 세로 비율(#824) — 가운데 선 드래그로 조절.
  const splitRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null); // 진행 중 드래그 정리 함수(언마운트 시 호출)
  // 가운데 선 드래그 — 컨테이너 높이 대비 마우스 Y로 비율 계산(0.15~0.85 클램프).
  const onDragDivider = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const el = splitRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      setTopRatio(Math.min(0.85, Math.max(0.15, (ev.clientY - r.top) / r.height)));
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", cleanup);
      document.body.style.userSelect = "";
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup; // 드래그 중 언마운트되면 useEffect가 이걸 호출
    document.body.style.userSelect = "none"; // 드래그 중 텍스트 선택 방지
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
  }, []);
  // 드래그 중 언마운트 대비 — 남은 리스너·userSelect 정리(리뷰 🟡).
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const repo = root ? root.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? null : null; // ciDot는 WorkspaceView서 prop(중복 폴링 방지 #812)

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // #964 host별 진단 — gitlab이면 glabStatus, else gh auth.
  const run = useCallback(async (h: "github" | "gitlab" | "other" = "github") => {
    const nd = window.nunopiDesktop;
    if (!root) { setProbe({ loading: false, state: "error", detail: DESKTOP_ONLY }); return; }
    setProbe({ loading: true });
    try {
      if (h === "gitlab") {
        const int = nd?.integrations;
        if (!int?.glabStatus) { if (mountedRef.current) setProbe({ loading: false, state: "error", detail: DESKTOP_ONLY }); return; }
        const r = await int.glabStatus(root);
        if (mountedRef.current) setProbe({ loading: false, state: r.state, detail: r.detail });
      } else {
        const gh = nd?.github;
        if (!gh?.auth) { if (mountedRef.current) setProbe({ loading: false, state: "error", detail: DESKTOP_ONLY }); return; }
        const r = await gh.auth(root);
        if (mountedRef.current) setProbe({ loading: false, state: r.state, detail: r.detail });
      }
    } catch (e) {
      if (mountedRef.current) setProbe({ loading: false, state: "error", detail: String((e as Error)?.message || e) });
    }
  }, [root]);

  // 토큰 존재 여부 로드(#826) — 마운트 시 1회.
  useEffect(() => {
    let alive = true;
    void window.nunopiDesktop?.github?.tokenStatus?.().then((r) => { if (alive) setHasToken(!!r?.hasToken); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // 토큰 저장 → 재진단(#826). gh가 GH_TOKEN으로 인증되면 probe가 ok로.
  const saveToken = useCallback(async () => {
    const tok = tokenVal.trim();
    if (!tok || tokenBusy) return;
    setTokenBusy(true); setTokenErr(null);
    try {
      const r = await window.nunopiDesktop?.github?.setToken?.(tok);
      if (!mountedRef.current) return;
      if (r?.ok) { setHasToken(true); setTokenVal(""); void run(host); }
      else setTokenErr(r?.detail || t("github.error"));
    } catch (e) { if (mountedRef.current) setTokenErr(String((e as Error)?.message || e)); }
    finally { if (mountedRef.current) setTokenBusy(false); }
  }, [tokenVal, tokenBusy, run, host, t]);
  // 토큰 해제 → 재진단(#826).
  const clearToken = useCallback(async () => {
    setTokenBusy(true); setTokenErr(null);
    try { await window.nunopiDesktop?.github?.clearToken?.(); if (mountedRef.current) { setHasToken(false); void run(host); } }
    catch (e) { if (mountedRef.current) setTokenErr(String((e as Error)?.message || e)); }
    finally { if (mountedRef.current) setTokenBusy(false); }
  }, [run, host]);

  // owner·host는 git-remote route(#777/#964)로 판정 후, 그 host에 맞게 진단. root 바뀌면 재실행.
  useEffect(() => {
    let alive = true;
    (async () => {
      let h: "github" | "gitlab" | "other" = "github";
      try {
        const rs = await fetch("/api/repo/git-remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
        const d = await rs.json();
        if (alive) { setOwner(rs.ok ? (d.owner ?? null) : null); h = (rs.ok && d.host) || "github"; setHost(h); }
      } catch { if (alive) { setOwner(null); setHost("github"); } }
      // host 판정 후 진단(gitlab이면 glab). other는 github로 폴백(기존 동작).
      if (alive) void run(h === "gitlab" ? "gitlab" : "github");
    })();
    return () => { alive = false; };
  }, [root, run]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 헤더 — 레포 식별 + 새로고침 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        {host === "gitlab"
          ? <IconBrandGitlab size={14} stroke={2} className="shrink-0 text-orange-500" aria-hidden />
          : <IconBrandGithub size={14} stroke={2} className="shrink-0 text-zinc-700 dark:text-zinc-200" aria-hidden />}
        <span className="min-w-0 truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
          {owner ? `${owner}/${repo ?? ""}` : (repo ?? (host === "gitlab" ? "GitLab" : "GitHub"))}
        </span>
        {/* 유일한 새로고침(#820) — 목록·상세·상태 다 갱신(reload를 자식에 전달). */}
        <button type="button" onClick={() => { setReload((n) => n + 1); void run(host); }} disabled={probe.loading}
          className="ml-auto shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title={t("github.refresh")} aria-label={t("github.refresh")}>
          <IconRefresh size={13} stroke={2} className={probe.loading ? "animate-spin" : ""} aria-hidden />
        </button>
      </div>

      {/* 본문 — 연결(ok)이면 이슈 목록/상세(#813), 아니면 상태별 안내 */}
      {probe.loading ? (
        <div className="flex items-center gap-2 p-4 text-[12px] text-zinc-400 dark:text-zinc-500">
          <IconLoader2 size={14} className="animate-spin" aria-hidden /> {t("github.checking")}
        </div>
      ) : probe.state === "ok" ? (
        open == null ? (
          /* 상하 분할(#824) — 위=이슈 목록, 아래=PR 목록 동시. 가운데 선 드래그로 비율 조절. */
          <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
            <section className="flex min-h-0 flex-col" style={{ flex: topRatio }}>
              <div className="flex shrink-0 items-center gap-1.5 bg-zinc-50 px-3 py-1 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900/40 dark:text-zinc-400">
                {t("github.issues")}
              </div>
              <div className="min-h-0 flex-1"><IssueList root={root} reloadKey={reload} host={host} onOpen={(n) => setOpen({ kind: "issue", number: n })} /></div>
            </section>
            {/* 드래그 핸들 — 가운데 선. 잡고 위아래로 끌면 비율 변경. */}
            <div role="separator" aria-orientation="horizontal" onMouseDown={onDragDivider}
              className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-zinc-200 bg-zinc-100 transition hover:bg-mustard-500/20 dark:border-zinc-800 dark:bg-zinc-800/60 dark:hover:bg-mustard-500/20">
              <span className="h-0.5 w-8 rounded-full bg-zinc-300 transition group-hover:bg-mustard-500/60 dark:bg-zinc-600" aria-hidden />
            </div>
            <section className="flex min-h-0 flex-col" style={{ flex: 1 - topRatio }}>
              <div className="flex shrink-0 items-center gap-1.5 bg-zinc-50 px-3 py-1 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900/40 dark:text-zinc-400">
                {t("github.prs")}
                {ciDot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ciDot === "running" ? "animate-pulse bg-amber-400" : ciDot === "failure" ? "bg-rose-500" : "bg-emerald-500"}`} />}
              </div>
              <div className="min-h-0 flex-1"><PrList root={root} reloadKey={reload} host={host} onOpen={(n) => setOpen({ kind: "pr", number: n })} /></div>
            </section>
          </div>
        ) : (
          /* 상세 — 전체 차지(#824). 뒤로가기로 반반 목록 복귀. */
          <div className="min-h-0 flex-1">
            {open.kind === "issue"
              ? <IssueDetail key={`issue-${open.number}`} root={root} number={open.number} reloadKey={reload} host={host} onBack={() => setOpen(null)} />
              : <PrDetail key={`pr-${open.number}`} root={root} number={open.number} onOpenFile={onOpenPrDiff ? (file: string) => onOpenPrDiff(open.number, file) : undefined} reloadKey={reload} host={host} agent={agent} onBack={() => setOpen(null)} />}
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <IconAlertTriangle size={15} stroke={2} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                  {probe.state === "not-installed" ? t("github.notInstalled")
                    : probe.state === "not-authed" ? t("github.notAuthed")
                    : probe.state === "rate-limited" ? t("github.rateLimited")
                    : probe.state === "offline" ? t("github.offline")
                    : t("github.error")}
                </p>
                {probe.detail && <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{probe.detail === DESKTOP_ONLY ? t("github.desktopOnly") : probe.detail}</p>}
              </div>
            </div>
            <button type="button" onClick={() => void run(host)}
              className="self-start rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {t("github.retry")}
            </button>
            {/* 토큰(PAT) 폴백(#826) — gh 미설치가 아니면 토큰으로 연결. 이 에러 화면에 있다는 건 아직 인증 안 됐다는 뜻
                → 항상 입력 노출(교체 가능). 저장된 토큰이 있는데 여기 왔으면 그 토큰이 인증 실패한 것. */}
            {host === "github" && probe.state !== "not-installed" && probe.state !== "offline" && ( /* #1151 인터넷 끊김엔 토큰 무의미(저장 토큰 '안 됨' 오안내도) */
              <div className="mt-1 flex flex-col gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                {hasToken && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">{t("github.tokenStoredInvalid")}</span>
                    <button type="button" onClick={() => void clearToken()} disabled={tokenBusy}
                      className="rounded px-1.5 py-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                      {t("github.tokenRemove")}
                    </button>
                  </div>
                )}
                <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">{t("github.tokenConnect")}</p>
                <p className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("github.tokenHelp")}</p>
                <div className="flex items-center gap-1.5">
                  <input type="password" value={tokenVal} onChange={(e) => setTokenVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveToken(); }}
                    placeholder="ghp_…" disabled={tokenBusy} autoComplete="off" spellCheck={false}
                    className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 outline-none focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                  <button type="button" onClick={() => void saveToken()} disabled={tokenBusy || !tokenVal.trim()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white">
                    {tokenBusy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("github.tokenSave")}
                  </button>
                </div>
                {tokenErr && <p className="break-words text-[10px] text-rose-500">{tokenErr}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

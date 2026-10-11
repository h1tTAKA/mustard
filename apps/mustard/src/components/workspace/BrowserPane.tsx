"use client";

// 인앱 브라우저 패널(#1034) — dock 패널·분리 창 공용. 보안·팝업·권한은 main(browser-guest.cjs)이 강제.
// <webview>는 React 속성 대신 직접 만든다 — allowpopups·partition은 붙기 전에 있어야 하고, src를 React가 바꾸면 매번 새로 이동해서.
import { useEffect, useRef, useState } from "react";
import type { WebviewTag } from "electron";
import { IconArrowLeft, IconArrowRight, IconRefresh, IconX, IconCode, IconAppWindow, IconWorld } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { normalizeBrowserUrl } from "@/lib/browser/url";

const PARTITION = "persist:mustard-browser"; // main의 PARTITION과 같아야 붙음(다르면 거부)

// guest가 넘겨준 단축키를 window에 다시 쏴서 기존 dispatcher가 처리 — 창당 한 번만 구독(패널 여러 개여도 중복 X).
let keySubs = 0;
let keyOff: (() => void) | null = null;
function subscribeGuestKeys() {
  const api = window.nunopiDesktop?.browser;
  if (!api) return () => {};
  if (keySubs++ === 0) keyOff = api.onKey((k) => window.dispatchEvent(new KeyboardEvent("keydown", { ...k, bubbles: true, cancelable: true })));
  return () => { if (--keySubs === 0) { keyOff?.(); keyOff = null; } };
}

export default function BrowserPane({ repo, url, onUrlChange, onDetach }: {
  repo: string;
  url: string;                          // 처음 열 주소("" = 빈 화면)
  onUrlChange?: (url: string) => void;  // 실제 이동한 주소(레포별 저장용)
  onDetach?: (url: string) => void;     // 별도 창으로 떼기(분리 창 자신엔 없음)
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<WebviewTag | null>(null);
  const [current, setCurrent] = useState(url);
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nav, setNav] = useState({ back: false, fwd: false });
  const [ports, setPorts] = useState<number[]>([]);
  const editingRef = useRef(false); // 주소창 입력 중엔 페이지 이동으로 덮어쓰지 않음
  useEffect(() => { editingRef.current = editing; }, [editing]);
  const onUrlChangeRef = useRef(onUrlChange);
  useEffect(() => { onUrlChangeRef.current = onUrlChange; }, [onUrlChange]);

  useEffect(() => subscribeGuestKeys(), []);

  // 이 레포 터미널에서 뜬 dev 서버 포트(#880 감지 재사용) — 10초마다.
  useEffect(() => {
    const api = window.nunopiDesktop?.ports;
    if (!api || !repo) return;
    let alive = true;
    const load = () => { void api.list(repo).then((ps) => { if (alive) setPorts(ps.map((p) => p.port)); }).catch(() => {}); };
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [repo]);

  // webview는 주소가 처음 생길 때 한 번 만든다. 이후 이동은 loadURL.
  const hasPage = !!current;
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasPage || viewRef.current) return;
    const wv = document.createElement("webview") as WebviewTag;
    wv.setAttribute("partition", PARTITION);
    wv.setAttribute("allowpopups", "");
    wv.setAttribute("src", current);
    wv.style.width = "100%"; wv.style.height = "100%";
    const sync = () => {
      const u = wv.getURL();
      setCurrent(u); if (!editingRef.current) setDraft(u);
      setNav({ back: wv.canGoBack(), fwd: wv.canGoForward() });
      onUrlChangeRef.current?.(u);
    };
    wv.addEventListener("did-navigate", sync);
    wv.addEventListener("did-navigate-in-page", sync);
    wv.addEventListener("did-start-loading", () => setLoading(true));
    wv.addEventListener("did-stop-loading", () => setLoading(false));
    host.appendChild(wv);
    viewRef.current = wv;
    return () => { wv.remove(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 만들 때의 주소만 씀(이후는 loadURL)
  }, [hasPage]);
  const go = (raw: string) => {
    const u = normalizeBrowserUrl(raw);
    if (!u) return;
    setDraft(u); setEditing(false);
    if (viewRef.current) void viewRef.current.loadURL(u).catch(() => {}); // 실패(연결 거부 등)는 페이지가 보여줌
    else setCurrent(u);
  };

  const btn = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100";
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭바와 같은 높이·색. pr-[17px]: dock 이동 그립 자리(#716). */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-zinc-200 bg-zinc-100/70 py-1 pl-1.5 pr-[17px] dark:border-zinc-800 dark:bg-[var(--s-bar)]">
        <button type="button" className={btn} disabled={!nav.back} onClick={() => viewRef.current?.goBack()} title={t("browser.back")} aria-label={t("browser.back")}><IconArrowLeft size={14} stroke={2} aria-hidden /></button>
        <button type="button" className={btn} disabled={!nav.fwd} onClick={() => viewRef.current?.goForward()} title={t("browser.forward")} aria-label={t("browser.forward")}><IconArrowRight size={14} stroke={2} aria-hidden /></button>
        <button type="button" className={btn} disabled={!hasPage} onClick={() => (loading ? viewRef.current?.stop() : viewRef.current?.reload())} title={loading ? t("browser.stop") : t("browser.reload")} aria-label={loading ? t("browser.stop") : t("browser.reload")}>
          {loading ? <IconX size={14} stroke={2} aria-hidden /> : <IconRefresh size={14} stroke={2} aria-hidden />}
        </button>
        <form className="mx-1 min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); go(draft); }}>
          <input value={draft} onChange={(e) => { setDraft(e.target.value); setEditing(true); }} onFocus={(e) => e.currentTarget.select()}
            onBlur={() => { setEditing(false); setDraft(current); }} onKeyDown={(e) => { if (e.key === "Escape") { setDraft(current); e.currentTarget.blur(); } }}
            placeholder={t("browser.addressPlaceholder")} aria-label={t("browser.address")} spellCheck={false}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] text-zinc-700 outline-none focus:border-mustard-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
        </form>
        {ports.map((p) => (
          <button key={p} type="button" onClick={() => go(`:${p}`)} title={`localhost:${p}`}
            className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100">:{p}</button>
        ))}
        <button type="button" className={btn} disabled={!hasPage} onClick={() => viewRef.current?.openDevTools()} title={t("browser.devtools")} aria-label={t("browser.devtools")}><IconCode size={14} stroke={2} aria-hidden /></button>
        {onDetach && <button type="button" className={btn} onClick={() => onDetach(current)} title={t("browser.detach")} aria-label={t("browser.detach")}><IconAppWindow size={14} stroke={2} aria-hidden /></button>}
      </div>
      <div ref={hostRef} className="relative min-h-0 flex-1 bg-white">
        {!hasPage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-[12px] text-zinc-400 dark:bg-[var(--s-pane)] dark:text-zinc-500">
            <IconWorld size={22} stroke={1.5} aria-hidden />
            <span>{ports.length ? t("browser.emptyPorts") : t("browser.empty")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

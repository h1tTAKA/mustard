"use client";

// 인앱 브라우저 패널(#1034) — dock 패널·분리 창 공용. 보안·팝업·권한은 main(browser-guest.cjs)이 강제.
// <webview>는 React 속성 대신 직접 만든다 — allowpopups·partition은 붙기 전에 있어야 하고, src를 React가 바꾸면 매번 새로 이동해서.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WebviewTag } from "electron";
import { IconArrowLeft, IconArrowRight, IconRefresh, IconX, IconCode, IconAppWindow, IconWorld, IconArrowsMinimize, IconPlus, IconPointer, IconLoader2 } from "@tabler/icons-react";
import { useT, useSetting, appChords, SHORTCUT_OVERRIDES_KEY, type ShortcutOverrides } from "@mustard/core";
import { normalizeBrowserUrl } from "@/lib/browser/url";
import { PICK_SCRIPT, PICK_CANCEL, type PickedElement } from "@/lib/browser/pickScript";
import { formatPickFeedback } from "@/lib/browser/feedback";
import { sendToAgent } from "@/lib/browser/sendToAgent";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";

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

// 탭 하나 — 주소창·뒤/앞/새로고침·개발자 도구·webview. 안 보이는 탭도 언마운트하지 않음(페이지 유지).
function BrowserPage({ repo, url, visible, ports, onUrlChange, onTitle, onDetach, onDock }: {
  repo: string;
  url: string;                          // 처음 열 주소("" = 빈 화면)
  visible: boolean;
  ports: number[];
  onUrlChange: (url: string) => void;
  onTitle: (title: string) => void;
  onDetach?: (url: string) => void;     // 별도 창으로 떼기(분리 창 자신엔 없음)
  onDock?: (url: string) => void;       // 분리 창 → 앱 안으로 되돌리기(분리 창에만)
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<WebviewTag | null>(null);
  const [current, setCurrent] = useState(url);
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nav, setNav] = useState({ back: false, fwd: false });
  const [ready, setReady] = useState(false); // guest 붙기 전엔 loadURL·reload 등이 예외를 던짐(#1034 리뷰)
  const [devtools, setDevtools] = useState(false); // 같은 화면 안 개발자 도구(별도 창 X)
  const [wide, setWide] = useState(true);           // 넓으면 오른쪽, 좁으면 아래
  const areaRef = useRef<HTMLDivElement>(null);
  const dtHostRef = useRef<HTMLDivElement>(null);
  // 요소 집어서 에이전트한테(#1037) — picking: 페이지에서 고르는 중, picked: 고른 요소(+스크린샷) → 코멘트 팝오버.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ el: PickedElement; shot?: string; pos: { left: number; top: number } } | null>(null);
  const [comment, setComment] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "no-agent">("idle");
  const pickGen = useRef(0); // 선택 회차 — 페이지 이동 뒤 늦게 끝난 옛 선택이 상태를 덮지 않게
  const editingRef = useRef(false); // 주소창 입력 중엔 페이지 이동으로 덮어쓰지 않음
  useEffect(() => { editingRef.current = editing; }, [editing]);
  const onUrlChangeRef = useRef(onUrlChange);
  const onTitleRef = useRef(onTitle);
  useEffect(() => { onUrlChangeRef.current = onUrlChange; onTitleRef.current = onTitle; });

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
      onUrlChangeRef.current(u);
    };
    wv.addEventListener("did-navigate", sync);
    wv.addEventListener("did-navigate-in-page", sync);
    wv.addEventListener("did-start-loading", () => setLoading(true));
    wv.addEventListener("did-stop-loading", () => setLoading(false));
    // 이동하면 선택 스크립트는 옛 페이지와 함께 사라지고 Promise가 안 끝날 수 있음 → 선택 상태·팝오버 정리(#1037 리뷰).
    wv.addEventListener("dom-ready", () => { setReady(true); pickGen.current++; setPicking(false); setPicked(null); });
    wv.addEventListener("page-title-updated", (e) => onTitleRef.current((e as unknown as { title: string }).title));
    host.appendChild(wv);
    viewRef.current = wv;
    return () => { wv.remove(); viewRef.current = null; setReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 만들 때의 주소만 씀(이후는 loadURL)
  }, [hasPage]);
  // 페이지+개발자도구 영역 폭으로 배치 결정 — 방향만 CSS로 바꿔 webview를 옮기지 않음(옮기면 페이지가 죽음).
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (el.clientWidth) setWide(el.clientWidth >= 760); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 개발자 도구 — main이 창에 붙인 네이티브 뷰(WebContentsView)에 띄우고, 여기 dtHost 자리에 겹쳐 그림(#1039 실측:
  // webview 안 devtools는 페이지와 연결이 안 됨). 자리는 크기 변화(관찰자) + 렌더마다(위치만 바뀐 경우) 알려줌, 같으면 안 보냄.
  const dtKey = useRef("");
  const visibleRef = useRef(visible); // 탭 전환마다 devtools를 닫았다 열지 않게 — 보임 여부는 ref로(자리 보고에서 0으로), 아래 레이아웃 이펙트가 갱신
  const reportDevtools = useCallback(() => {
    const page = viewRef.current, host = dtHostRef.current, api = window.nunopiDesktop?.browser;
    if (!page || !host || !api) return;
    const r = host.getBoundingClientRect();
    const rect = visibleRef.current ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
    const k = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`;
    if (k === dtKey.current) return;
    dtKey.current = k;
    try { api.devtoolsBounds(page.getWebContentsId(), rect); } catch { /* 붙기 전 */ }
  }, []);
  useEffect(() => {
    const page = viewRef.current, host = dtHostRef.current, api = window.nunopiDesktop?.browser;
    if (!devtools || !ready || !page || !host || !api) return;
    const pageId = page.getWebContentsId();
    const r = host.getBoundingClientRect();
    dtKey.current = "";
    void api.openDevTools(pageId, { x: r.left, y: r.top, w: r.width, h: r.height }).then(() => reportDevtools());
    const ro = new ResizeObserver(() => reportDevtools());
    ro.observe(host);
    window.addEventListener("resize", reportDevtools);
    return () => { ro.disconnect(); window.removeEventListener("resize", reportDevtools); void api.closeDevTools(pageId); };
  }, [devtools, ready, reportDevtools]);
  useLayoutEffect(() => { visibleRef.current = visible; if (devtools && ready) reportDevtools(); });

  // 선택 시작/취소 — 스크립트가 클릭 때까지 기다렸다 요소 정보를 돌려줌(Esc·취소 = null).
  const togglePick = () => {
    const wv = viewRef.current;
    if (!wv || !ready) return;
    if (picking) { void wv.executeJavaScript(PICK_CANCEL).catch(() => {}); return; }
    setPicked(null); setSendState("idle"); setPicking(true);
    const gen = ++pickGen.current;
    void (wv.executeJavaScript(PICK_SCRIPT, true) as Promise<PickedElement | null>)
      .then(async (el) => {
        if (gen !== pickGen.current) return;
        setPicking(false);
        if (!el) return;
        const shot = await window.nunopiDesktop?.browser?.capture(wv.getWebContentsId(), el.rect).catch(() => undefined);
        if (gen !== pickGen.current) return;
        // 팝오버 자리 — 고른 요소 바로 아래(모자라면 위), 폭 300이 칸 밖으로 안 나가게. 고를 때 한 번 계산.
        const W = hostRef.current?.clientWidth ?? 400, H = hostRef.current?.clientHeight ?? 400, r = el.rect;
        const pos = { left: Math.max(4, Math.min(r.x, W - 304)), top: r.y + r.h + 150 < H ? r.y + r.h + 6 : Math.max(4, r.y - 146) };
        setPicked({ el, shot: shot?.ok ? shot.path : undefined, pos });
        setComment("");
      })
      .catch(() => { if (gen === pickGen.current) setPicking(false); }); // 페이지 이동 등으로 스크립트가 끊김
  };
  const send = async () => {
    if (!picked || !comment.trim() || sendState === "sending") return;
    setSendState("sending");
    const r = await sendToAgent(repo, formatPickFeedback(picked.el, comment, picked.shot));
    if (!r.ok) { setSendState("no-agent"); return; }
    setPicked(null); setSendState("idle");
    requestTerminalFocus(repo, r.id); // 보낸 터미널 탭으로 — 에이전트가 받는 걸 보이게
  };

  const go = (raw: string) => {
    // 빈 주소로 Enter = 페이지 닫고 처음 빈 화면으로(webview 제거, 저장 주소도 비움).
    if (!raw.trim()) { setDevtools(false); setCurrent(""); setDraft(""); setEditing(false); setNav({ back: false, fwd: false }); setLoading(false); onUrlChangeRef.current(""); onTitleRef.current(""); return; }
    const u = normalizeBrowserUrl(raw);
    if (!u) return;
    setDraft(u); setEditing(false);
    const wv = viewRef.current;
    if (!wv) setCurrent(u);
    else if (ready) void wv.loadURL(u).catch(() => {}); // 실패(연결 거부 등)는 페이지가 보여줌
    else wv.src = u; // 아직 안 붙음 — 속성으로 이동(붙을 때 그 주소로)
  };

  const btn = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100";
  return (
    <div className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-zinc-200 bg-white py-1 pl-1.5 pr-1.5 dark:border-zinc-800 dark:bg-[var(--s-pane)]">
        <button type="button" className={btn} disabled={!ready || !nav.back} onClick={() => viewRef.current?.goBack()} title={t("browser.back")} aria-label={t("browser.back")}><IconArrowLeft size={14} stroke={2} aria-hidden /></button>
        <button type="button" className={btn} disabled={!ready || !nav.fwd} onClick={() => viewRef.current?.goForward()} title={t("browser.forward")} aria-label={t("browser.forward")}><IconArrowRight size={14} stroke={2} aria-hidden /></button>
        <button type="button" className={btn} disabled={!ready} onClick={() => (loading ? viewRef.current?.stop() : viewRef.current?.reload())} title={loading ? t("browser.stop") : t("browser.reload")} aria-label={loading ? t("browser.stop") : t("browser.reload")}>
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
        <button type="button" className={`${btn} ${picking ? "bg-mustard-500/20 text-mustard-700 dark:text-mustard-300" : ""}`} disabled={!ready} aria-pressed={picking} onClick={togglePick} title={t("browser.pick")} aria-label={t("browser.pick")}><IconPointer size={14} stroke={2} aria-hidden /></button>
        <button type="button" className={`${btn} ${devtools ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : ""}`} disabled={!ready} aria-pressed={devtools} onClick={() => setDevtools((v) => !v)} title={t("browser.devtools")} aria-label={t("browser.devtools")}><IconCode size={14} stroke={2} aria-hidden /></button>
        {onDock && <button type="button" className={btn} onClick={() => onDock(current)} title={t("browser.dock")} aria-label={t("browser.dock")}><IconArrowsMinimize size={14} stroke={2} aria-hidden /></button>}
        {onDetach && <button type="button" className={btn} onClick={() => onDetach(current)} title={t("browser.detach")} aria-label={t("browser.detach")}><IconAppWindow size={14} stroke={2} aria-hidden /></button>}
      </div>
      <div ref={areaRef} className={`flex min-h-0 flex-1 ${wide ? "flex-row" : "flex-col"}`}>
        <div ref={hostRef} className="relative min-h-0 min-w-0 flex-1 bg-white">
          {!hasPage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-[12px] text-zinc-400 dark:bg-[var(--s-pane)] dark:text-zinc-500">
              <IconWorld size={22} stroke={1.5} aria-hidden />
              <span>{ports.length ? t("browser.emptyPorts") : t("browser.empty")}</span>
            </div>
          )}
          {picked && (
            <div className="absolute z-10 w-[300px] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
              style={picked.pos}>
              <div className="mb-1 truncate font-mono text-[10px] text-zinc-400">{picked.el.kind === "region"
                ? `${t("browser.pickArea")} ${picked.el.rect.w}×${picked.el.rect.h}${picked.el.items.length ? ` · ${picked.el.items.length}` : ""}`
                : picked.el.sources[0]
                  ? `${picked.el.sources[0].file.split("/").pop()}:${picked.el.sources[0].line} · ${picked.el.tag}`
                  : `${picked.el.react[0] ? `${picked.el.react[0]} · ` : ""}${picked.el.tag}${picked.el.text ? ` "${picked.el.text.slice(0, 40)}"` : ""}`}</div>
              <textarea autoFocus value={comment} onChange={(e) => { setComment(e.target.value); if (sendState === "no-agent") setSendState("idle"); }}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } else if (e.key === "Escape") setPicked(null); }}
                placeholder={t("browser.pickPlaceholder")} rows={3}
                className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-800 outline-none focus:border-mustard-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              <div className="mt-1.5 flex items-center gap-1.5">
                {sendState === "no-agent" && <span className="min-w-0 flex-1 truncate text-[10px] text-rose-500">{t("browser.pickNoAgent")}</span>}
                <span className="flex-1" />
                <button type="button" onClick={() => setPicked(null)} className="rounded-md px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">{t("browser.pickCancel")}</button>
                <button type="button" disabled={!comment.trim() || sendState === "sending"} onClick={() => void send()}
                  className="inline-flex items-center gap-1 rounded-md bg-mustard-500 px-2 py-0.5 text-[11px] font-medium text-zinc-900 transition hover:bg-mustard-400 disabled:opacity-40">
                  {sendState === "sending" && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("browser.pickSend")}
                </button>
              </div>
            </div>
          )}
        </div>
        {/* ponytail: 45% 고정 — 경계 드래그 리사이즈는 필요해지면 */}
        {devtools && ready && <div ref={dtHostRef} className={`shrink-0 border-zinc-200 dark:border-zinc-800 ${wide ? "w-[45%] border-l" : "h-[45%] border-t"}`} />}
      </div>
    </div>
  );
}

// 탭 묶음(#1034) — dock·분리 창 공용. 탭 줄은 코드 탭바와 같은 모양, pr-[17px]은 dock 이동 그립 자리(#716).
type Tab = { id: number; url: string; title: string };
let tabSeq = 0;
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export default function BrowserPane({ repo, initial, incoming, onTabsChange, onDetach, onDock, onEmpty }: {
  repo: string;
  initial: { urls: string[]; active: number };            // 처음 탭들(레포별 저장분)
  incoming?: { url: string; n: number; at?: number } | null; // 바깥에서 탭 밀어넣기(분리 창 → 앱으로). n이 바뀔 때마다, at = 원래 자리
  onTabsChange?: (urls: string[], active: number) => void; // 저장용
  onDetach?: (url: string, index: number) => Promise<boolean>; // 활성 탭을 별도 창으로(성공하면 이 탭은 닫음). index = 떼기 전 자리
  onDock?: (url: string) => void;                          // 분리 창: 활성 탭을 앱 안으로
  onEmpty?: () => void;                                    // 떼거나 보내서 탭이 0개가 됨
}) {
  const t = useT();
  // 탭 목록과 활성 탭은 한 state — 지우기·추가가 둘을 같이 바꿔서, 따로 두면 업데이트 순서에 기대게 됨(#1034 리뷰).
  const [st, setSt] = useState<{ tabs: Tab[]; activeId: number }>(() => {
    const tabs = (initial.urls.length ? initial.urls : [""]).map((url) => ({ id: ++tabSeq, url, title: "" }));
    return { tabs, activeId: tabs[Math.min(Math.max(initial.active, 0), tabs.length - 1)].id };
  });
  const { tabs, activeId } = st;
  const setActiveId = (id: number) => setSt((p) => ({ ...p, activeId: id }));
  const [ports, setPorts] = useState<number[]>([]);

  // main에 "브라우저 포커스 중에도 앱이 가져갈 조합" 알림 — 설정에서 단축키 바꾸면 다시 보냄(#1034 리뷰).
  // dock(메인 창)에서만 — 분리 창엔 단축키 처리기가 없어서 가로채면 키가 그냥 사라짐.
  const docked = !!onDetach;
  const overrides = useSetting<ShortcutOverrides>(SHORTCUT_OVERRIDES_KEY, {});
  useEffect(() => { if (docked) return subscribeGuestKeys(); }, [docked]);
  useEffect(() => { if (docked) window.nunopiDesktop?.browser?.setAppChords(appChords(overrides)); }, [docked, overrides]);

  // 이 레포 터미널에서 뜬 dev 서버 포트(#880 감지 재사용) — 10초마다, 탭들이 공유.
  useEffect(() => {
    const api = window.nunopiDesktop?.ports;
    if (!api || !repo) return;
    let alive = true;
    const load = () => { void api.list(repo).then((ps) => { if (alive) setPorts(ps.map((p) => p.port)); }).catch(() => {}); };
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [repo]);

  const onTabsChangeRef = useRef(onTabsChange);
  useEffect(() => { onTabsChangeRef.current = onTabsChange; });
  const urlsKey = JSON.stringify(tabs.map((x) => x.url)); // [""]와 []도 구분
  const activeIdx = Math.max(0, tabs.findIndex((x) => x.id === activeId));
  useEffect(() => { onTabsChangeRef.current?.(tabs.map((x) => x.url), activeIdx); }, [urlsKey, activeIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // at: 넣을 자리(분리했다 돌아온 탭은 원래 자리로). 없으면 끝에.
  const addTab = (url = "", at?: number) => {
    const tab = { id: ++tabSeq, url, title: "" };
    setSt((p) => { const i = at === undefined ? p.tabs.length : Math.min(Math.max(at, 0), p.tabs.length); return { tabs: [...p.tabs.slice(0, i), tab, ...p.tabs.slice(i)], activeId: tab.id }; });
  };
  const lastIncoming = useRef(0);
  useEffect(() => {
    if (!incoming || incoming.n === lastIncoming.current) return;
    lastIncoming.current = incoming.n;
    addTab(incoming.url, incoming.at); // 바깥 신호(n 변경)로 탭 추가
  }, [incoming]);

  // 탭 제거 — 함수형 업데이트(창 분리는 await 뒤에 불려서, 그 사이 바뀐 탭·제목을 덮어쓰면 안 됨, #1034 리뷰).
  // 활성 탭이면 옆 탭으로. 옮겨서 0개가 되면 [] → 아래 이펙트가 저장([])·onEmpty. 그냥 닫아서 0개면 빈 탭 하나.
  const blankId = () => ++tabSeq; // 업데이트 함수 밖에서 뽑음(StrictMode 이중 호출에도 순수)
  const removeTab = (id: number, viaMove = false) => {
    const fresh = blankId();
    setSt((p) => {
      const idx = p.tabs.findIndex((x) => x.id === id);
      if (idx < 0) return p;
      const rest = p.tabs.filter((x) => x.id !== id);
      if (!rest.length && !(viaMove && onEmpty)) rest.push({ id: fresh, url: "", title: "" });
      const activeId = p.activeId !== id ? p.activeId : rest.length ? rest[Math.min(idx, rest.length - 1)].id : 0;
      return { tabs: rest, activeId };
    });
  };
  const onEmptyRef = useRef(onEmpty);
  useEffect(() => { onEmptyRef.current = onEmpty; });
  useEffect(() => { if (!tabs.length) onEmptyRef.current?.(); }, [tabs.length]);
  const patch = (id: number, d: Partial<Tab>) => setSt((p) => ({ ...p, tabs: p.tabs.map((x) => (x.id === id ? { ...x, ...d } : x)) }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[var(--s-bar)]">
        <div className="nunopi-scroll flex min-w-0 items-stretch overflow-x-auto">
          {tabs.map((tab) => {
            const on = tab.id === activeId;
            return (
              <div key={tab.id} onClick={() => setActiveId(tab.id)}
                className={`group relative flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[var(--s-pane)] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}>
                {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-mustard-500" aria-hidden />}
                <IconWorld size={13} stroke={2} className={`shrink-0 ${on ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`} aria-hidden />
                <span className="truncate">{tab.title || (tab.url ? hostOf(tab.url) : t("browser.newTab"))}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("mem.close")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => addTab()} title={t("browser.newTab")} aria-label={t("browser.newTab")}
          className="flex shrink-0 items-center px-2 text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200">
          <IconPlus size={13} stroke={2} aria-hidden />
        </button>
      </div>
      {tabs.map((tab) => (
        <BrowserPage key={tab.id} repo={repo} url={tab.url} visible={tab.id === activeId} ports={ports}
          onUrlChange={(u) => patch(tab.id, { url: u })} onTitle={(title) => patch(tab.id, { title })}
          onDetach={onDetach ? (u) => { void onDetach(u, tabs.findIndex((x) => x.id === tab.id)).then((ok) => { if (ok) removeTab(tab.id, true); }); } : undefined}
          onDock={onDock ? (u) => { onDock(u); removeTab(tab.id, true); } : undefined} />
      ))}
    </div>
  );
}

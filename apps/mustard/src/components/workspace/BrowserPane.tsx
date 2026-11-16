"use client";

// 인앱 브라우저 패널(#1034) — dock 패널·분리 창 공용. 보안·팝업·권한은 main(browser-guest.cjs)이 강제.
// <webview>는 React 속성 대신 직접 만든다 — allowpopups·partition은 붙기 전에 있어야 하고, src를 React가 바꾸면 매번 새로 이동해서.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WebviewTag } from "electron";
import { IconArrowLeft, IconArrowRight, IconRefresh, IconX, IconCode, IconAppWindow, IconWorld, IconArrowsMinimize, IconPlus, IconPointer, IconLoader2, IconChevronDown, IconChevronUp, IconPencil, IconTrash, IconSend, IconCornerDownLeft } from "@tabler/icons-react";
import { useT, useSetting, appChords, SHORTCUT_OVERRIDES_KEY, type ShortcutOverrides, getSetting, BROWSER_KEYS, BROWSER_DEFAULTS, browserTarget, normalizeBrowserUrl } from "@mustard/core";
import { PICK_SCRIPT, PICK_CANCEL, type PickedElement } from "@/lib/browser/pickScript";
import { formatPickBatch, type PickNote } from "@/lib/browser/feedback";
import { sendToAgent } from "@/lib/browser/sendToAgent";
import { markScript } from "@/lib/browser/markScript";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";

const PARTITION = "persist:mustard-browser";
const MAX_NOTES = 10; // #1361 탭마다 담을 수 있는 곳 — 넘으면 담기를 막고 안내(오래된 걸 몰래 버리지 않음)
type Note = PickNote & { id: number };
let noteSeq = 0;
// 고른 곳 머리 — 태그 뱃지 + 제목(소스 파일:줄 > 컴포넌트 > 글자 > 선택자). 팝오버 머리·담은 목록 공용. 긴 선택자는 툴팁으로만.
function pickHead(el: PickedElement, area: string): { tag: string; title: string } {
  if (el.kind === "region") return { tag: area, title: `${el.rect.w}×${el.rect.h}${el.items.length ? ` · ${el.items.length}` : ""}` };
  const src = el.sources[0];
  return { tag: el.tag, title: src ? `${src.file.split("/").pop()}:${src.line}` : el.components[0] ?? (el.text ? `"${el.text.slice(0, 40)}"` : el.selector) };
}
// #1361 숫자 원(목록·팝오버) — 페이지 위 번호 원과 같은 색
function NoteNum({ n }: { n: number }) {
  return <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-mustard-500 text-[10px] font-semibold text-zinc-900 shadow-[0_0_0_1px_rgba(255,255,255,0.9)] dark:shadow-none">{n}</span>;
}
const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } }; // main의 PARTITION과 같아야 붙음(다르면 거부)

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
function BrowserPage({ repo, url, initialDevtools, visible, ports, onUrlChange, onTitle, onDetach, onDock, onSelect, onClose }: {
  repo: string;
  url: string;                          // 처음 열 주소("" = 빈 화면)
  visible: boolean;
  ports: number[];
  onUrlChange: (url: string) => void;
  onTitle: (title: string) => void;
  initialDevtools?: boolean;            // 창 분리·되돌리기 때 개발자 도구 열림을 이어받음
  onDetach?: (url: string, devtools: boolean) => void; // 별도 창으로 떼기(분리 창 자신엔 없음)
  onDock?: (url: string, devtools: boolean) => void;   // 분리 창 → 앱 안으로 되돌리기(분리 창에만)
  onSelect: () => void;                                 // 에이전트가 이 탭을 고름(#1041)
  onClose: () => void;                                  // 에이전트가 이 탭을 닫음
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
  const [devtools, setDevtools] = useState(!!initialDevtools); // 같은 화면 안 개발자 도구(별도 창 X)
  const [wide, setWide] = useState(true);           // 넓으면 오른쪽, 좁으면 아래
  const areaRef = useRef<HTMLDivElement>(null);
  const dtHostRef = useRef<HTMLDivElement>(null);
  // 요소 집어서 에이전트한테(#1037) — picking: 페이지에서 고르는 중, picked: 고른 요소(+스크린샷) → 코멘트 팝오버.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ el: PickedElement; shot?: string; pos: { left: number; top: number } } | null>(null);
  const [comment, setComment] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "no-agent" | "error" | "full">("idle");
  // #1361 담은 곳들 — 탭 상태라 페이지를 옮겨도 남음. 보내기에 성공해야 비움.
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editNote, setEditNote] = useState<{ id: number; text: string } | null>(null);
  const [domTick, setDomTick] = useState(0); // 페이지가 새로 뜰 때마다(새로고침·이동) — 번호 표시 다시 넣기
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
    wv.addEventListener("dom-ready", () => { setReady(true); pickGen.current++; setPicking(false); setPicked(null); setDomTick((n) => n + 1); });
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
    // 부모가 잘라내는 만큼(overflow) 잘라서 — 칸이 좁아져도 네이티브 뷰가 패널 밖으로 안 삐져나오게(#1039 리뷰).
    const r = host.getBoundingClientRect(), a = areaRef.current?.getBoundingClientRect() ?? r;
    const x = Math.max(r.left, a.left), y = Math.max(r.top, a.top), w = Math.min(r.right, a.right) - x, h = Math.min(r.bottom, a.bottom) - y;
    const rect = visibleRef.current && w > 0 && h > 0 ? { x, y, w, h } : { x: 0, y: 0, w: 0, h: 0 };
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
    // 크기 변화는 관찰자, 위치만 바뀌는 경우(dock 재배치 등)는 프레임마다 확인 — 같으면 안 보내서 싸다(#1039 리뷰).
    const ro = new ResizeObserver(() => reportDevtools());
    ro.observe(host);
    let raf = 0;
    const tick = () => { reportDevtools(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); void api.closeDevTools(pageId); };
  }, [devtools, ready, reportDevtools]);
  useLayoutEffect(() => { visibleRef.current = visible; if (devtools && ready) reportDevtools(); });

  // 에이전트 MCP(#1041)가 이 탭을 찾게 main에 등록(레포·보임). 보임이 바뀌면 다시, 사라지면 해제.
  useEffect(() => {
    const page = viewRef.current, api = window.nunopiDesktop?.browser;
    if (!ready || !page || !api?.register) return;
    let id: number;
    try { id = page.getWebContentsId(); } catch { return; }
    api.register(id, repo, visible);
    return () => api.unregister(id);
  }, [ready, visible, repo]);

  // 에이전트 탭 명령(#1041) — 이 탭(webview id)에 온 고르기/닫기만.
  const onSelectRef = useRef(onSelect), onCloseRef = useRef(onClose);
  useEffect(() => { onSelectRef.current = onSelect; onCloseRef.current = onClose; });
  useEffect(() => {
    const page = viewRef.current, api = window.nunopiDesktop?.browser;
    if (!ready || !page || !api?.onTabCommand) return;
    let id: number;
    try { id = page.getWebContentsId(); } catch { return; }
    return api.onTabCommand(({ guestId, action }) => {
      if (guestId !== id) return;
      if (action === "select") onSelectRef.current(); else if (action === "close") onCloseRef.current();
    });
  }, [ready]);

  // #1361 담은 곳 번호 표시 — 지금 페이지에서 담은 것만, 번호는 전체 목록 순서. 목록·페이지가 바뀔 때마다 다시 넣음(빈 목록이면 지움).
  const marksKey = JSON.stringify(notes.map((n, i) => n.el.url === current ? [n.id, i + 1, n.el.selector, n.el.rect.x, n.el.rect.y] : null));
  useEffect(() => {
    const wv = viewRef.current;
    if (!ready || !wv) return;
    const marks = notes.flatMap((n, i) => (n.el.url === current ? [{ id: n.id, n: i + 1, selector: n.el.kind === "region" ? "" : n.el.selector, rect: { x: n.el.rect.x, y: n.el.rect.y }, scroll: n.el.scroll }] : []));
    void wv.executeJavaScript(markScript(marks)).catch(() => {}); // 붙기 전·이동 중이면 다음 dom-ready에 다시
  }, [ready, domTick, marksKey]); // eslint-disable-line react-hooks/exhaustive-deps -- notes·current는 marksKey로

  // 선택 시작/취소 — 스크립트가 클릭 때까지 기다렸다 요소 정보를 돌려줌(Esc·취소 = null).
  const startPick = () => {
    const wv = viewRef.current;
    if (!wv || !ready) return;
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
        const pos = { left: Math.max(4, Math.min(r.x, W - 324)), top: r.y + r.h + 190 < H ? r.y + r.h + 8 : Math.max(4, r.y - 188) }; // 팝오버 320×약 180
        setPicked({ el, shot: shot?.ok ? shot.path : undefined, pos });
        setComment("");
      })
      .catch(() => { if (gen === pickGen.current) setPicking(false); }); // 페이지 이동 등으로 스크립트가 끊김
  };
  const togglePick = () => {
    if (sendState === "sending") return; // 보내는 중엔 새로 고르지 않음(보내기 상태가 풀려 같은 묶음이 두 번 나가지 않게, 리뷰)
    if (picking) { void viewRef.current?.executeJavaScript(PICK_CANCEL).catch(() => {}); return; }
    startPick();
  };
  // #1361 담기 — 목록에 넣고 바로 다음 곳 고르기(Esc·포인터 버튼으로 끝)
  const addNote = () => {
    if (!picked || !comment.trim() || sendState === "sending") return; // 보내는 중엔 안 담음(보낸 뒤 목록 정리와 엉키지 않게, 리뷰)
    if (notes.length >= MAX_NOTES) { setSendState("full"); return; }
    setNotes((xs) => [...xs, { id: ++noteSeq, el: picked.el, shot: picked.shot, comment: comment.trim() }]);
    startPick();
  };
  // 보내기 — 담은 곳 + 지금 고른 곳(메모 있으면)을 한 덩어리로. 하나면 지금과 같은 글.
  const send = async () => {
    if (sendState === "sending") return;
    const cur = picked && comment.trim() ? [{ el: picked.el, shot: picked.shot, comment }] : [];
    if (picked && !cur.length) return; // 팝오버에서 메모 없이 보내기 X
    const list = [...notes, ...cur];
    if (!list.length) return;
    if (list.length > MAX_NOTES) { setSendState("full"); return; } // 지금 고른 것까지 10곳(리뷰)
    setSendState("sending");
    const r = await sendToAgent(repo, formatPickBatch(list));
    if (!r.ok) { setSendState(r.reason === "no-agent" ? "no-agent" : "error"); return; } // 데몬 실패를 "터미널 없음"으로 감추지 않게(#1129). 목록은 그대로
    const sent = new Set(list.map((x) => ("id" in x ? x.id : 0)));
    setNotes((xs) => xs.filter((x) => !sent.has(x.id))); // 보낸 것만 뺌(리뷰)
    if (notes.every((x) => sent.has(x.id))) setNotesOpen(false);
    setPicked(null); setSendState("idle"); setEditNote(null);
    if (picking) void viewRef.current?.executeJavaScript(PICK_CANCEL).catch(() => {}); // 띠에서 보냈으면 고르는 중이던 것도 끝
    requestTerminalFocus(repo, r.id); // 보낸 터미널 탭으로 — 에이전트가 받는 걸 보이게
  };

  const go = (raw: string) => {
    // 빈 주소로 Enter = 페이지 닫고 처음 빈 화면으로(webview 제거, 저장 주소도 비움).
    if (!raw.trim()) { setDevtools(false); setCurrent(""); setDraft(""); setEditing(false); setNav({ back: false, fwd: false }); setLoading(false); onUrlChangeRef.current(""); onTitleRef.current(""); return; }
    const u = browserTarget(raw, getSetting<string>(BROWSER_KEYS.searchEngine, BROWSER_DEFAULTS.searchEngine)); // #1209 URL이 아니면 검색
    if (!u) return;
    setDraft(u); setEditing(false);
    const wv = viewRef.current;
    if (!wv) setCurrent(u);
    else if (ready) void wv.loadURL(u).catch(() => {}); // 실패(연결 거부 등)는 페이지가 보여줌
    else wv.src = u; // 아직 안 붙음 — 속성으로 이동(붙을 때 그 주소로)
  };

  const h = picked ? pickHead(picked.el, t("browser.pickArea")) : null; // 팝오버 머리
  const err = sendState === "no-agent" || sendState === "error" || sendState === "full";
  const btn = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100";
  return (
    <div className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
      {/* 툴바(#1058) — @container로 자기 폭 기준 반응. 좁으면 포트 바로가기 숨겨 주소창 자리 확보, overflow-hidden으로 옆 패널 침범 방지 */}
      <div className="@container flex shrink-0 items-center gap-0.5 overflow-hidden border-b border-zinc-200 bg-white py-1 pl-1.5 pr-1.5 dark:border-zinc-800 dark:bg-[var(--s-pane)]">
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
        {ports.length > 0 && <div className="hidden shrink-0 items-center gap-0.5 @[28rem]:flex">{ports.map((p) => (
          <button key={p} type="button" onClick={() => go(`:${p}`)} title={`localhost:${p}`}
            className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100">:{p}</button>
        ))}</div>}
        <button type="button" className={`${btn} ${picking ? "bg-mustard-500/20 text-mustard-700 dark:text-mustard-300" : ""}`} disabled={!ready || sendState === "sending"} aria-pressed={picking} onClick={togglePick} title={t("browser.pick")} aria-label={t("browser.pick")}><IconPointer size={14} stroke={2} aria-hidden /></button>
        <button type="button" className={`${btn} ${devtools ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : ""}`} disabled={!ready} aria-pressed={devtools} onClick={() => setDevtools((v) => !v)} title={t("browser.devtools")} aria-label={t("browser.devtools")}><IconCode size={14} stroke={2} aria-hidden /></button>
        {onDock && <button type="button" className={btn} onClick={() => onDock(current, devtools)} title={t("browser.dock")} aria-label={t("browser.dock")}><IconArrowsMinimize size={14} stroke={2} aria-hidden /></button>}
        {onDetach && <button type="button" className={btn} onClick={() => onDetach(current, devtools)} title={t("browser.detach")} aria-label={t("browser.detach")}><IconAppWindow size={14} stroke={2} aria-hidden /></button>}
      </div>
      <div ref={areaRef} className={`flex min-h-0 flex-1 ${wide ? "flex-row" : "flex-col"}`}>
        <div ref={hostRef} className="relative min-h-0 min-w-0 flex-1 bg-white">
          {!hasPage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-[12px] text-zinc-400 dark:bg-[var(--s-pane)] dark:text-zinc-500">
              <IconWorld size={22} stroke={1.5} aria-hidden />
              <span>{ports.length ? t("browser.emptyPorts") : t("browser.empty")}</span>
            </div>
          )}
          {picked && h && (
            <div className="absolute z-20 w-[320px] rounded-lg border border-black/[0.08] bg-white p-3 text-zinc-800 shadow-[0_10px_24px_rgba(0,0,0,0.18)] dark:border-white/[0.1] dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-[0_20px_44px_rgba(0,0,0,0.42)]"
              style={picked.pos}>
              {/* 머리 — 번호(담은 게 있으면) · 태그 뱃지 · 제목, 긴 선택자는 툴팁 */}
              <div className="mb-2 flex min-w-0 items-center gap-1.5" title={picked.el.selector || undefined}>
                {notes.length > 0 && <NoteNum n={notes.length + 1} />}
                <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] leading-none text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{h.tag}</span>
                <span className="truncate text-[12px] font-medium">{h.title}</span>
              </div>
              <textarea autoFocus value={comment} readOnly={sendState === "sending"} onChange={(e) => { setComment(e.target.value); if (err) setSendState("idle"); }}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (e.shiftKey) addNote(); else void send(); } else if (e.key === "Escape") setPicked(null); }}
                placeholder={t("browser.pickPlaceholder")}
                className="h-20 w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-[12px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-mustard-500 focus:ring-2 focus:ring-mustard-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              {err && <div className="mt-1.5 text-[11px] text-rose-500">{t(sendState === "error" ? "github.sendFailed" : sendState === "full" ? "browser.pickFull" : "browser.pickNoAgent")}</div>}
              <div className="mt-2.5 flex items-center justify-end gap-1.5">
                <button type="button" onClick={() => setPicked(null)} className="h-7 rounded-md px-2.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">{t("browser.pickCancel")}</button>
                <button type="button" disabled={!comment.trim() || sendState === "sending"} onClick={addNote} title="⇧⌘↵"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 text-[12px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  <IconPlus size={12} stroke={2} aria-hidden />{t("browser.pickAdd")}</button>
                <button type="button" disabled={!comment.trim() || sendState === "sending"} onClick={() => void send()}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-mustard-500 px-2.5 text-[12px] font-medium text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition hover:bg-mustard-400 disabled:opacity-40">
                  {sendState === "sending" ? <IconLoader2 size={12} className="animate-spin" aria-hidden /> : <IconSend size={12} stroke={2} aria-hidden />}
                  {t("browser.pickSend")}{notes.length > 0 && ` · ${notes.length + 1}`}
                  <kbd className="ml-0.5 inline-flex items-center gap-0.5 rounded border border-black/15 px-1 py-px font-sans text-[10px] leading-none text-zinc-900/70">⌘<IconCornerDownLeft size={10} stroke={2} aria-hidden /></kbd>
                </button>
              </div>
            </div>
          )}
          {/* #1361 담은 곳 — 브라우저 칸 오른쪽 아래에 뜬 카드. 머리(접기·개수·비우기·보내기) + 펼치면 목록(번호·제목·메모, 올리면 고치기·지우기) */}
          {notes.length > 0 && !picked && ( // 메모 쓰는 동안엔 숨김 — 팝오버와 겹치지 않게(리뷰)
            <div className="absolute bottom-3 right-3 z-10 flex max-h-[45%] w-[min(20rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-white text-zinc-800 shadow-[0_10px_24px_rgba(0,0,0,0.18)] dark:border-white/[0.1] dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-[0_20px_44px_rgba(0,0,0,0.42)]">
              <div className="flex items-center gap-1.5 py-1.5 pl-2 pr-1.5">
                <button type="button" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-mustard-500/40">
                  {notesOpen ? <IconChevronDown size={14} stroke={2} className="shrink-0 text-zinc-400" aria-hidden /> : <IconChevronUp size={14} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />}
                  <span className="truncate">{t("browser.notes", { n: notes.length })}</span>
                </button>
                <button type="button" disabled={sendState === "sending"} onClick={() => { setNotes([]); setNotesOpen(false); setEditNote(null); if (sendState === "full") setSendState("idle"); }} title={t("browser.notesClear")} aria-label={t("browser.notesClear")}
                  className="flex size-6 disabled:opacity-40 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconTrash size={12} stroke={2} aria-hidden /></button>
                <button type="button" disabled={sendState === "sending" || !!picked} onClick={() => void send()}
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-mustard-500 px-2 text-[11px] font-medium text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition hover:bg-mustard-400 disabled:opacity-40">
                  {sendState === "sending" && !picked ? <IconLoader2 size={12} className="animate-spin" aria-hidden /> : <IconSend size={12} stroke={2} aria-hidden />}{t("browser.pickSend")}
                </button>
              </div>
              {!picked && (sendState === "no-agent" || sendState === "error") && <div className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-rose-500 dark:border-zinc-800">{t(sendState === "error" ? "github.sendFailed" : "browser.pickNoAgent")}</div>}
              {notesOpen && (
                <ol className="nunopi-scroll min-h-0 flex-1 overflow-y-auto border-t border-zinc-100 p-1.5 dark:border-zinc-800">
                  {notes.map((n, i) => { const h = pickHead(n.el, t("browser.pickArea")); return (
                    <li key={n.id} className="group flex gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors hover:bg-zinc-100 focus-within:bg-zinc-100 dark:hover:bg-zinc-800/70 dark:focus-within:bg-zinc-800/70">
                      <span className="mt-px"><NoteNum n={i + 1} /></span>
                      <div className="min-w-0 flex-1" title={n.el.selector || undefined}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] leading-none text-zinc-500 group-hover:bg-white dark:bg-zinc-800 dark:text-zinc-400 dark:group-hover:bg-zinc-900">{h.tag}</span>
                          <span className="truncate font-medium">{h.title}</span>
                        </div>
                        {editNote?.id === n.id ? (
                          <textarea autoFocus value={editNote.text} readOnly={sendState === "sending"} onChange={(e) => setEditNote({ id: n.id, text: e.target.value })}
                            onBlur={() => { const v = editNote.text.trim(); if (v) setNotes((xs) => xs.map((x) => (x.id === n.id ? { ...x, comment: v } : x))); setEditNote(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.stopPropagation(); setEditNote(null); } }}
                            className="mt-1 h-16 w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-800 outline-none focus:border-mustard-500 focus:ring-2 focus:ring-mustard-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
                        ) : <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-zinc-500 dark:text-zinc-400">{n.comment}</p>}
                        {n.el.url !== current && <div className="mt-1 truncate text-[11px] text-zinc-400">{pathOf(n.el.url)}</div>}
                      </div>
                      {editNote?.id !== n.id && sendState !== "sending" && <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <button type="button" onClick={() => setEditNote({ id: n.id, text: n.comment })} title={t("browser.noteEdit")} aria-label={t("browser.noteEdit")}
                          className="flex size-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"><IconPencil size={12} stroke={2} aria-hidden /></button>
                        <button type="button" onClick={() => setNotes((xs) => xs.filter((x) => x.id !== n.id))} title={t("browser.noteRemove")} aria-label={t("browser.noteRemove")}
                          className="flex size-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"><IconTrash size={12} stroke={2} aria-hidden /></button>
                      </div>}
                    </li>
                  ); })}
                </ol>
              )}
            </div>
          )}
        </div>
        {/* 한계: 45% 고정 — 경계 드래그 리사이즈는 필요해지면 */}
        {devtools && ready && <div ref={dtHostRef} className={`shrink-0 border-zinc-200 dark:border-zinc-800 ${wide ? "w-[45%] border-l" : "h-[45%] border-t"}`} />}
      </div>
    </div>
  );
}

// 탭 묶음(#1034) — dock·분리 창 공용. 탭 줄은 코드 탭바와 같은 모양, pr-[17px]은 dock 이동 그립 자리(#716).
type Tab = { id: number; url: string; title: string; devtools?: boolean }; // devtools = 처음 열 때 개발자 도구도
export type BrowserState = { urls: string[]; active: number; devtools: boolean };
let tabSeq = 0;
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

// #1209 기본 홈 페이지 — 새 탭(+ 버튼·처음 열 때)이 갈 주소. 비었거나 못 알아들으면 빈 탭.
function homeUrl(): string {
  const h = getSetting<string>(BROWSER_KEYS.homePage, BROWSER_DEFAULTS.homePage).trim();
  return h ? normalizeBrowserUrl(h) ?? "" : "";
}

export default function BrowserPane({ repo, initial, incoming, onTabsChange, onDetach, onDock, onEmpty }: {
  repo: string;
  initial: { urls: string[]; active: number; devtools?: boolean }; // 처음 탭들(레포별 저장분). devtools = 활성 탭에 개발자 도구(분리 창용)
  incoming?: { url: string; n: number; devtools?: boolean; urls?: string[]; active?: number; background?: boolean } | null; // 바깥에서 탭 밀어넣기(에이전트 열기 요청 = url 하나, 분리 창 → 앱 = urls 전부). n이 바뀔 때마다
  onTabsChange?: (urls: string[], active: number) => void; // 저장용
  // 창 분리·앱 안으로는 탭 하나가 아니라 브라우저 통째로(유저 요청) — 탭 주소들·활성 탭·활성 탭 devtools.
  onDetach?: (state: BrowserState) => void;                // 앱 → 별도 창(부모가 창 열고 패널 닫음)
  onDock?: (state: BrowserState) => void;                  // 분리 창 → 앱 안(부모가 넘기고 창 닫음)
  onEmpty?: () => void;                                    // 떼거나 보내서 탭이 0개가 됨
}) {
  const t = useT();
  // 탭 목록과 활성 탭은 한 state — 지우기·추가가 둘을 같이 바꿔서, 따로 두면 업데이트 순서에 기대게 됨(#1034 리뷰).
  const [st, setSt] = useState<{ tabs: Tab[]; activeId: number }>(() => {
    const tabs: Tab[] = (initial.urls.length ? initial.urls : [homeUrl()]).map((url) => ({ id: ++tabSeq, url, title: "" }));
    const active = tabs[Math.min(Math.max(initial.active, 0), tabs.length - 1)];
    if (initial.devtools) active.devtools = true;
    return { tabs, activeId: active.id };
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
  const defaultZoom = useSetting<number>(BROWSER_KEYS.defaultZoom, BROWSER_DEFAULTS.defaultZoom); // #1209 새 탭 기본 줌 → main(웹뷰 붙일 때 적용)
  useEffect(() => { window.nunopiDesktop?.browser?.setDefaultZoom?.(defaultZoom / 100); }, [defaultZoom]);

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
  // background = 지금 보는 탭은 그대로 두고 뒤에 추가(#1209 링크를 백그라운드에서 열기).
  // 주소를 들고 온 탭인데 지금 탭이 빈 탭이면 그 빈 탭 자리에 넣음(빈 탭이 남지 않게 — 여러 탭 경로와 같은 규칙, 리뷰)
  const addTab = (url = "", at?: number, devtools?: boolean, background = false) => {
    const tab: Tab = { id: ++tabSeq, url, title: "", devtools };
    setSt((p) => {
      const cur = p.tabs.find((x) => x.id === p.activeId);
      if (url && at === undefined && cur && !cur.url) return { tabs: p.tabs.map((x) => (x.id === cur.id ? tab : x)), activeId: tab.id };
      const i = at === undefined ? p.tabs.length : Math.min(Math.max(at, 0), p.tabs.length);
      return { tabs: [...p.tabs.slice(0, i), tab, ...p.tabs.slice(i)], activeId: background && cur?.url ? p.activeId : tab.id };
    });
  };
  const lastIncoming = useRef(0);
  useEffect(() => {
    if (!incoming || incoming.n === lastIncoming.current) return;
    lastIncoming.current = incoming.n;
    if (incoming.urls?.length) { // 여러 탭을 한꺼번에(분리 창이 돌아옴) — 뒤에 붙이고 그중 활성 탭을 보이게
      const add: Tab[] = incoming.urls.map((u) => ({ id: ++tabSeq, url: u, title: "" }));
      const act = add[Math.min(Math.max(incoming.active ?? 0, 0), add.length - 1)];
      if (incoming.devtools) act.devtools = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 바깥 신호(n 변경)로 탭 추가(addTab과 같은 경로)
      setSt((p) => ({ tabs: [...p.tabs.filter((x) => x.url), ...add], activeId: act.id })); // 빈 탭은 버림
      return;
    }
    addTab(incoming.url, undefined, incoming.devtools, !!incoming.background); // 바깥 신호(n 변경)로 탭 추가
  }, [incoming]);

  // 탭 제거 — 함수형 업데이트(창 분리는 await 뒤에 불려서, 그 사이 바뀐 탭·제목을 덮어쓰면 안 됨, #1034 리뷰).
  // 활성 탭이면 옆 탭으로. 0개가 되면(닫든 옮기든) [] → 아래 이펙트가 저장([])·onEmpty = 브라우저 패널/분리 창이 닫힘(유저 요청).
  const blankId = () => ++tabSeq; // 업데이트 함수 밖에서 뽑음(StrictMode 이중 호출에도 순수)
  const removeTab = (id: number) => {
    const fresh = blankId();
    setSt((p) => {
      const idx = p.tabs.findIndex((x) => x.id === id);
      if (idx < 0) return p;
      const rest = p.tabs.filter((x) => x.id !== id);
      if (!rest.length && !onEmpty) rest.push({ id: fresh, url: "", title: "" }); // 0개면 onEmpty(브라우저·분리 창 닫기), 없을 때만 빈 탭
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
        <button type="button" onClick={() => addTab(homeUrl())} title={t("browser.newTab")} aria-label={t("browser.newTab")}
          className="flex shrink-0 items-center px-2 text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200">
          <IconPlus size={13} stroke={2} aria-hidden />
        </button>
      </div>
      {tabs.map((tab) => (
        <BrowserPage key={tab.id} repo={repo} url={tab.url} initialDevtools={tab.devtools} visible={tab.id === activeId} ports={ports}
          onUrlChange={(u) => patch(tab.id, { url: u })} onTitle={(title) => patch(tab.id, { title })}
          onDetach={onDetach ? (_u, dt) => onDetach({ urls: tabs.map((x) => x.url), active: activeIdx, devtools: dt }) : undefined}
          onDock={onDock ? (_u, dt) => onDock({ urls: tabs.map((x) => x.url), active: activeIdx, devtools: dt }) : undefined}
          onSelect={() => setActiveId(tab.id)} onClose={() => removeTab(tab.id)} />
      ))}
    </div>
  );
}

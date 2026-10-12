"use client";
// 워크스페이스 모드(#647) — 누노피 안에서 화면전환 없이 에이전트 코딩+즉시 학습.
// 골격(커밋1): 4존 셸 [파일트리 | 터미널 | 코드 | 챗]. 각 존은 후속 커밋서 채움(트리·코드·챗·pty터미널).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { IconFolderOpen, IconFiles, IconFileCode, IconFileText, IconLoader2, IconGitBranch, IconGitCommit, IconX, IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMessages, IconCards, IconSettings, IconSitemap, IconTerminal2, IconBrandGithub, IconMessageCircle, IconActivity, IconWorld } from "@tabler/icons-react";
import { useShortcut, useShortcutHint, withShortcutHint, useT, getSetting, useSetting, WKEYS, WORKSPACE_DEFAULTS, CUKEYS, CATCHUP_DEFAULTS } from "@mustard/core";
import { useFullscreen } from "@mustard/nunopi";
import { isNunopiEnabled } from "@/lib/product";
import FileTree from "@/components/workspace/FileTree";
import CodePane from "@/components/workspace/CodePane";
import WorkspaceChat, { type ChatFocus } from "@/components/workspace/WorkspaceChat";
import GithubPanel from "@/components/workspace/GithubPanel";
import RepoLearnStream from "@/components/workspace/RepoLearnStream";
import { useAutoCommitExplain } from "@/lib/useAutoCommitExplain";
import { useBranchCi } from "@/components/workspace/github/useBranchCi";
import TerminalPane from "@/components/workspace/TerminalPane";
import UsageMonitor from "@/components/workspace/UsageMonitor";
import GitGraph from "@/components/workspace/GitGraph";
import DiffPane from "@/components/workspace/DiffPane";
import DocViewer from "@/components/workspace/DocViewer";
import RepoFlowPane from "@/components/workspace/RepoFlowPane";
import BrowserPane, { type BrowserState } from "@/components/workspace/BrowserPane";
import RepoAnalyzeSection from "@/components/workspace/RepoAnalyzeSection";
import RepoGraphViewer from "@/components/workspace/RepoGraphViewer";
import { FlyCardProvider } from "@mustard/nunopi";
import WorkspaceDockLayout, { defaultTree, pruneTree, leavesOf, isDockNode, appendPanel, removePanel, type DockNode, type PanelId } from "@/components/workspace/WorkspaceDockLayout";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
// 코드/diff 멀티탭 한 건(#714) — 파일 또는 diff(커밋 diff는 hash, 워킹트리 diff는 worktree).
type CodeTab = { kind: "file"; file: string } | { kind: "diff"; hash?: string; file: string; worktree?: "staged" | "unstaged" | "untracked" };
// 탭 식별 키(중복 열기 방지·활성 지정). file / diff(hash) / diff(워킹트리) 구분.
const codeTabKey = (tb: CodeTab) => tb.kind === "file" ? `file:${tb.file}` : `diff:${tb.hash ?? "wt:" + (tb.worktree ?? "")}:${tb.file}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// git status 문자(index,work) → 파일 트리 도트 종류. 삭제(D)는 트리에 행이 없어 스킵(#687).
function statusKind(index: string, work: string): "added" | "modified" | null {
  if (index === "D" || work === "D") return null;      // 삭제 — 트리 미표시
  if (index === "?" || index === "A") return "added";  // untracked / staged-add = 신규
  return "modified";                                   // M / R / C 등 = 수정
}

// 빈 존 자리표시 — 후속 커밋서 실제 트리/코드/챗/터미널로 교체.
function ZonePlaceholder({ Icon, label }: { Icon: typeof IconFiles; label: string }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-zinc-300 dark:text-zinc-600">
      <Icon size={22} stroke={1.75} aria-hidden />
      <span className="text-[11px] font-medium">{label} <span className="opacity-70">{t("workspace.soon")}</span></span>
    </div>
  );
}

// path(레포)는 WorkspaceTabs가 소유해 prop로 내려준다(#731). key={path}로 탭마다 인스턴스 분리.
export default function WorkspaceView({ path, active = true, agentWorking = false, providerId, providerSettings, onExitWorkspace, onOpenMemorize, onOpenSettings, tabStrip }: { path: string; active?: boolean; agentWorking?: boolean; providerId: AgentProviderKind; providerSettings: ProviderSettings; onExitWorkspace?: () => void; onOpenMemorize?: () => void; onOpenSettings?: () => void; tabStrip?: ReactNode }) {
  const t = useT();
  const fullscreen = useFullscreen(); // 타이틀바 통합(#779) — 신호등 자리 좌측 패딩 토글
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [fileStatus, setFileStatus] = useState<Record<string, "added" | "modified">>({}); // 변경 파일 도트(#687)
  const [treeLoading, setTreeLoading] = useState(false);
  // 문서 뷰어(#693) — 레포와 별개 문서 폴더. docTabs/activeDoc은 docsRoot 기준 상대경로.
  const [docsRoot, setDocsRoot] = useState<string | null>(null);
  const [docsFiles, setDocsFiles] = useState<string[]>([]);
  const [docTabs, setDocTabs] = useState<string[]>([]); // 열린 문서 탭(rel 경로들, #693)
  const [activeDoc, setActiveDoc] = useState<string | null>(null); // 활성 문서
  const [docsOpen, setDocsOpen] = useState(false); // 좌측 문서 섹션 열림
  // 중앙 3패널 커스텀 도킹 분할 트리(#716) — 터미널·코드·문서를 자유 배치. null이면 기본 트리 생성.
  const [dockTree, setDockTree] = useState<DockNode | null>(null);
  // 코드/diff 멀티탭(#714) — 파일·diff를 탭으로 쌓음(터미널·문서처럼). openFile/openDiff 단일 슬롯 대체.
  const [codeTabs, setCodeTabs] = useState<CodeTab[]>([]);
  const [activeCode, setActiveCode] = useState<string | null>(null); // 활성 탭 키(codeTabKey)
  // 챗 포커스 신호(#653) — 파일/diff/브랜치 클릭 시 그 챗 세션 열기. n(nonce)로 같은 대상 재클릭도 발화.
  const [chatFocus, setChatFocus] = useState<ChatFocus | null>(null);
  const focusN = useRef(0);
  const focusChat = (key: string, kind: ChatFocus["kind"], label: string) => { focusN.current += 1; setChatFocus({ key, kind, label, n: focusN.current }); };
  // 패널 폭(px) — 드래그 리사이즈, localStorage 영속.
  const [treeW, setTreeW] = useState(240);
  const [chatW, setChatW] = useState(320);
  const [chatOpen, setChatOpen] = useState(true);  // 우측 챗 패널 열림(#695)
  useAutoCommitExplain(path, providerId, providerSettings); // #1054 새 커밋 diff 미리 설명(설정 > git)
  const [rightModeSel, setRightMode] = useState<"chat" | "github" | "learn">("chat");
  // #1062 캐치업 전체 끄기 — 패널·버튼 숨김(선택돼 있었으면 질문으로), 실시간 해설 서버 플래그도 끔(패널이 안 떠도 여기서 알림).
  const catchupOn = useSetting<boolean>(CUKEYS.enabled, CATCHUP_DEFAULTS.enabled);
  const explainAnalyze = useSetting<boolean>(CUKEYS.explainAnalyze, CATCHUP_DEFAULTS.explainAnalyze);
  const rightMode = rightModeSel === "learn" && !catchupOn ? "chat" : rightModeSel;
  const explainProvider = useSetting<string>(CUKEYS.explainProvider, "");
  useEffect(() => { void fetch("/api/repo/learn/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narration: catchupOn && explainAnalyze, provider: explainProvider || providerId }) }).catch(() => {}); }, [catchupOn, explainAnalyze, explainProvider, providerId]); // 우측 패널 모드(#811·#855) — 질문 ↔ GitHub ↔ 캐치업(#992, 구 학습 스트림)
  const [leftOpen, setLeftOpen] = useState(true);  // 좌측 사이드바(폴더/아키텍처/깃/문서트리) 펼침(#758)
  const [collapsed, setCollapsed] = useState<Set<PanelId>>(new Set()); // 접힌 중앙 패널(내용 유지·숨김만, #758)
  const [gitOpen, setGitOpen] = useState(false);   // 좌 하단 깃 그래프 열림
  const [treeOpen, setTreeOpen] = useState(true);  // 파일 트리 열림(#733) — 하단 아이콘 바 토글, 기본 열림
  const [analyzeOpen, setAnalyzeOpen] = useState(false); // 좌측 "레포 분석하기" 섹션 열림(#743)
  const [graphOpen, setGraphOpen] = useState(false); // 코드그래프 raw 뷰어 모달(#842 서브5, opt-in)
  const [flowFeature, setFlowFeature] = useState<string | null>(null); // 열린 플로우 패널의 기능(null=닫힘). dock에 flow 패널 존재 여부와 동기(#743)
  const [browserOpen, setBrowserOpen] = useState(false); // 인앱 브라우저 패널(#1034) — 레포별 저장
  const [browserTabs, setBrowserTabs] = useState<{ urls: string[]; active: number }>({ urls: [], active: 0 }); // 탭 주소들(레포별)
  const [browserIncoming, setBrowserIncoming] = useState<{ url: string; n: number; devtools?: boolean; urls?: string[]; active?: number } | null>(null); // 에이전트 열기 요청·분리 창에서 돌아온 탭들
  const [browserRect, setBrowserRect] = useState<SlotRect | null>(null); // dock 속 브라우저 자리(고정 레이어 위치)
  const dockRef = useRef<HTMLElement>(null);
  const browserPrevRef = useRef(false); // 증분 이펙트가 본 마지막 browserOpen
  const [chatPrefill, setChatPrefill] = useState<{ text: string; n: number } | null>(null); // 챗 입력창 자동 삽입 신호(#746)
  const flyNoSources = useMemo(() => new Set<string>(), []); // FlyCardProvider용 빈 출처(워크스페이스 카드는 출처이동 없음, #750)
  const [gitH, setGitH] = useState(220);           // 깃 그래프 높이(px)
  const [docsH, setDocsH] = useState(220);         // 문서 브라우저 높이(px, #693)
  const [analyzeH, setAnalyzeH] = useState(240);   // 레포 분석 섹션 높이(px, #743)
  const asideRef = useRef<HTMLElement | null>(null); // 좌측 사이드바 — 세로 리사이즈 상한 계산용(#743)
  const dragRef = useRef<{ kind: "tree" | "chat" | "gitH" | "docsH" | "analyzeH"; startX: number; startY: number; startVal: number } | null>(null);
  const wRef = useRef({ tree: 240, chat: 320, gitH: 220, docsH: 220, analyzeH: 240 }); // 최신 폭·높이 미러(드래그 종료 시 영속용). 중앙은 도킹 트리 관리.
  const [mounted, setMounted] = useState(false);
  const repoLoadedRef = useRef<string | null>(null); // 현재 열린 상태가 복원된 레포 path — 전환 중 오염 방지·저장 게이트(#712)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회(SSR/Electron 판별 안전)
  useEffect(() => setMounted(true), []);
  const desktop = mounted ? window.nunopiDesktop : undefined;

  // 저장된 패널 폭 복원.
  useEffect(() => {
    if (!mounted) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 후 저장 폭 복원(1회)
      const t = Number(localStorage.getItem("nunopi:ws-tree-w")); if (t) { const v = clamp(t, 140, 560); setTreeW(v); wRef.current.tree = v; }
      const c = Number(localStorage.getItem("nunopi:ws-chat-w")); if (c) { const v = clamp(c, 200, 640); setChatW(v); wRef.current.chat = v; }
      const gh = Number(localStorage.getItem("nunopi:ws-git-h")); if (gh) { const v = clamp(gh, 80, 1600); setGitH(v); wRef.current.gitH = v; }
      const dh = Number(localStorage.getItem("nunopi:ws-docs-h")); if (dh) { const v = clamp(dh, 80, 1600); setDocsH(v); wRef.current.docsH = v; }
      const ah = Number(localStorage.getItem("nunopi:ws-analyze-h")); if (ah) { const v = clamp(ah, 80, 1600); setAnalyzeH(v); wRef.current.analyzeH = v; }
      setGitOpen(localStorage.getItem("nunopi:ws-git-open") === "1");
      setTreeOpen(localStorage.getItem("nunopi:ws-tree-open") !== "0"); // 기본 열림, "0"일 때만 닫힘(#733)
      setAnalyzeOpen(localStorage.getItem("nunopi:ws-analyze-open") === "1"); // 기본 닫힘(#743)
      setChatOpen(localStorage.getItem("nunopi:ws-chat-open") !== "0"); // 기본 열림, "0"일 때만 닫힘(#695)
      { const m = localStorage.getItem("nunopi:ws-right-mode"); setRightMode(m === "github" ? "github" : m === "learn" ? "learn" : "chat"); } // 우측 모드 복원(#811·#855)
      setLeftOpen(localStorage.getItem("nunopi:ws-left-open") !== "0"); // 기본 열림(#758)
      try { const c = JSON.parse(localStorage.getItem("nunopi:ws-collapsed") || "[]"); if (Array.isArray(c)) setCollapsed(new Set(c.filter((x): x is PanelId => x === "terminal" || x === "code" || x === "doc" || x === "flow"))); } catch { /* ignore */ } // 접힘 복원(#758)
    } catch { /* ignore */ }
  }, [mounted]);

  // 좌측 최소 하나 보장(#733·#743) — 트리·git·문서·분석 전부 닫힘이면 트리를 연다(빈 사이드바 방지·구 상태 복구).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mounted && !treeOpen && !gitOpen && !docsOpen && !analyzeOpen) setTreeOpen(true);
  }, [mounted, treeOpen, gitOpen, docsOpen, analyzeOpen]);

  // 레포별 열린 상태 복원(#712) — path(레포) 바뀔 때마다 그 레포의 저장분을 로드(챗처럼 레포 스코프). 없으면 초기화.
  useEffect(() => {
    if (!mounted) return;
    const p = path;
    if (!p) { repoLoadedRef.current = null; return; }
    const K = (b: string) => `nunopi:ws:${p}:${b}`;
    try {
      /* eslint-disable react-hooks/set-state-in-effect -- path 변경 시 그 레포 상태 복원 */
      // 코드/diff 탭 복원(#714) — file은 경로, diff는 hash 또는 worktree 중 하나는 반드시 있어야 통과(둘 다 없는 깨진 탭 배제).
      let ctabs: CodeTab[] = [];
      try { const ct = JSON.parse(localStorage.getItem(K("code-tabs")) || "null"); if (Array.isArray(ct)) ctabs = ct.filter((x): x is CodeTab => x && typeof x.file === "string" && (x.kind === "file" || (x.kind === "diff" && (typeof x.hash === "string" || typeof x.worktree === "string")))); } catch { /* ignore */ }
      setCodeTabs(ctabs);
      // 활성 키가 복원된 탭에 없으면 마지막 탭으로 폴백(빈 pane 방지).
      const ac = localStorage.getItem(K("active-code"));
      setActiveCode(ctabs.some((tb) => codeTabKey(tb) === ac) ? ac : (ctabs.length ? codeTabKey(ctabs[ctabs.length - 1]) : null));
      setDocsRoot(localStorage.getItem(K("docs-root")) || null);
      try { const dt = JSON.parse(localStorage.getItem(K("doc-tabs")) || "null"); setDocTabs(Array.isArray(dt) ? dt.filter((x): x is string => typeof x === "string") : []); } catch { setDocTabs([]); }
      setActiveDoc(localStorage.getItem(K("active-doc")) || null);
      setDocsOpen(localStorage.getItem(K("docs-open")) === "1");
      setBrowserOpen(localStorage.getItem(K("browser-open")) === "1");
      // 탭 복원 — 옛 단일 주소(browser-url)는 탭 하나로 이전.
      try {
        const bt = JSON.parse(localStorage.getItem(K("browser-tabs")) || "null");
        if (bt && Array.isArray(bt.urls)) setBrowserTabs({ urls: bt.urls.filter((u: unknown): u is string => typeof u === "string"), active: Number(bt.active) || 0 });
        else { const old = localStorage.getItem(K("browser-url")); setBrowserTabs({ urls: old ? [old] : [], active: 0 }); }
      } catch { setBrowserTabs({ urls: [], active: 0 }); }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch { /* ignore */ }
    repoLoadedRef.current = p;
  }, [path, mounted]);

  // 레포 스코프 저장(#712) — 복원된 레포와 현재 path 일치할 때만(전환 중 A→B 오염 방지). deps는 값만, path는 클로저.
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:docs-root`; try { if (docsRoot) localStorage.setItem(k, docsRoot); else localStorage.removeItem(k); } catch { /* ignore */ } }, [docsRoot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:doc-tabs`; try { if (docTabs.length) localStorage.setItem(k, JSON.stringify(docTabs)); else localStorage.removeItem(k); } catch { /* ignore */ } }, [docTabs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:active-doc`; try { if (activeDoc) localStorage.setItem(k, activeDoc); else localStorage.removeItem(k); } catch { /* ignore */ } }, [activeDoc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:docs-open`; try { localStorage.setItem(k, docsOpen ? "1" : "0"); } catch { /* ignore */ } }, [docsOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:browser-open`; try { localStorage.setItem(k, browserOpen ? "1" : "0"); } catch { /* ignore */ } }, [browserOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; try { localStorage.setItem(`nunopi:ws:${path}:browser-tabs`, JSON.stringify(browserTabs)); localStorage.removeItem(`nunopi:ws:${path}:browser-url`); } catch { /* ignore */ } }, [browserTabs]); // eslint-disable-line react-hooks/exhaustive-deps
  // 에이전트가 이 레포 브라우저를 열어달라고 함(#1041 browser_navigate, 안 열려 있을 때) — cwd가 이 레포 안이면 새 탭으로.
  useEffect(() => {
    const api = window.nunopiDesktop?.browser;
    if (!path || !api?.onOpenRequest) return;
    // 손들기만(main이 실경로로 판정·가장 깊은 레포 하나에 grant) → grant 받은 레포만 엶(중복 탭 방지).
    const offReq = api.onOpenRequest(({ cwd, reqId }) => api.claimOpen(reqId, path, cwd));
    const offGrant = api.onOpenGrant(({ repo, url }) => {
      if (repo !== path) return;
      setBrowserIncoming((prev) => ({ url, n: (prev?.n ?? 0) + 1 }));
      setBrowserOpen(true);
    });
    return () => { offReq(); offGrant(); };
  }, [path]);
  // 분리 브라우저 창(#1034)과 같은 origin localStorage로 주고받음 — storage 이벤트는 다른 창에서 쓸 때만 옴.
  // browser-dock {urls,active,devtools,n} = 분리 창의 "앱 안에서 열기" → 그 탭들 전부를 dock 브라우저로(유저 요청: 통째로).
  // 브라우저가 닫혀 있으면 그 탭들로 열고, 열려 있으면 뒤에 붙임.
  const browserOpenRef = useRef(browserOpen);
  useEffect(() => { browserOpenRef.current = browserOpen; }, [browserOpen]);
  useEffect(() => {
    if (!path) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== `nunopi:ws:${path}:browser-dock` || !e.newValue) return;
      try {
        const d = JSON.parse(e.newValue);
        const urls = Array.isArray(d.urls) ? d.urls.filter((u: unknown): u is string => typeof u === "string") : [];
        if (!urls.length) return;
        if (browserOpenRef.current) setBrowserIncoming((prev) => ({ url: "", urls, active: Number(d.active) || 0, devtools: !!d.devtools, n: (prev?.n ?? 0) + 1 }));
        else { setBrowserTabs({ urls, active: Number(d.active) || 0 }); setBrowserIncoming(null); setBrowserOpen(true); }
      } catch { /* ignore */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [path]);
  // 코드/diff 탭 영속(#714).
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:code-tabs`; try { if (codeTabs.length) localStorage.setItem(k, JSON.stringify(codeTabs)); else localStorage.removeItem(k); } catch { /* ignore */ } }, [codeTabs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!path || repoLoadedRef.current !== path) return; const k = `nunopi:ws:${path}:active-code`; try { if (activeCode) localStorage.setItem(k, activeCode); else localStorage.removeItem(k); } catch { /* ignore */ } }, [activeCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 드래그 리사이즈 — 전역 mousemove/up 리스너.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      // 세로 리사이즈 상한 = 사이드바 높이 - 여유(위 채움 섹션 + 하단 바). 500 고정 캡 제거(#743).
      const maxH = Math.max(160, (asideRef.current?.clientHeight ?? 800) - 120);
      if (d.kind === "tree") { const v = clamp(d.startVal + dx, 140, 560); setTreeW(v); wRef.current.tree = v; }
      else if (d.kind === "chat") { const v = clamp(d.startVal - dx, 200, 640); setChatW(v); wRef.current.chat = v; }
      else if (d.kind === "gitH") { const v = clamp(d.startVal - dy, 80, maxH); setGitH(v); wRef.current.gitH = v; }
      else if (d.kind === "analyzeH") { const v = clamp(d.startVal - dy, 80, maxH); setAnalyzeH(v); wRef.current.analyzeH = v; }
      else { const v = clamp(d.startVal - dy, 80, maxH); setDocsH(v); wRef.current.docsH = v; } // docsH
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = "";
      try {
        localStorage.setItem("nunopi:ws-tree-w", String(wRef.current.tree));
        localStorage.setItem("nunopi:ws-chat-w", String(wRef.current.chat));
        localStorage.setItem("nunopi:ws-git-h", String(wRef.current.gitH));
        localStorage.setItem("nunopi:ws-docs-h", String(wRef.current.docsH));
        localStorage.setItem("nunopi:ws-analyze-h", String(wRef.current.analyzeH));
      } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const startDrag = (kind: "tree" | "chat" | "gitH" | "docsH" | "analyzeH", startVal: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    // eslint-disable-next-line react-hooks/refs -- 이벤트 핸들러 내 ref 쓰기(렌더 중 아님)
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startVal };
    document.body.style.cursor = (kind === "gitH" || kind === "docsH" || kind === "analyzeH") ? "row-resize" : "col-resize"; document.body.style.userSelect = "none";
  };

  // 중앙 도킹 트리 동기화·영속(#716) — 존재 패널(터미널 항상·코드=탭·문서=열림)에 맞춰 트리 유지.
  // 레포 전환 시 그 레포의 저장 트리를 base로 로드(레포별 영속), 아니면 이전 트리 유지. 리프 집합 같으면 배치·비율 보존, 다르면 prune 후 필요 시 기본.
  const hasCode = codeTabs.length > 0;
  const hasDoc = !!(docsRoot && activeDoc && docTabs.length);
  const panelExists = (p: PanelId) => p === "terminal" || (p === "code" && hasCode) || (p === "doc" && hasDoc) || (p === "flow" && flowFeature !== null) || (p === "browser" && browserOpen);
  const panelVisible = (p: PanelId) => panelExists(p) && !collapsed.has(p);
  const dockRepoRef = useRef<string | null>(null); // 현재 dockTree가 로드된 레포 — 전환 감지·저장 게이트
  const flowRepoRef = useRef<string | null>(null); // flowFeature가 복원된 레포 — 전환 시 그 레포 저장값으로 복원(#743)
  useEffect(() => {
    if (!mounted || !path) return;
    // 접힌 패널은 dock에서 뺀다(#758) — 존재해도 숨김. collapsed는 deps에 없어(아래 증분 이펙트가 토글 처리) 여기선 클로저 현재값.
    const switched = dockRepoRef.current !== path;
    // 브라우저 열림은 같은 커밋의 복원 이펙트가 아직 state에 반영 전 → 전환 시엔 저장값을 직접 읽어야 저장 배치가 안 지워짐(#1034 리뷰).
    let browserHas = browserOpen;
    if (switched) { try { browserHas = localStorage.getItem(`nunopi:ws:${path}:browser-open`) === "1"; } catch { /* ignore */ } }
    const has: Record<PanelId, boolean> = { terminal: !collapsed.has("terminal"), code: hasCode && !collapsed.has("code"), doc: hasDoc && !collapsed.has("doc"), flow: flowFeature !== null && !collapsed.has("flow"), browser: browserHas };
    let stored: DockNode | null = null;
    if (switched) { try { const j = JSON.parse(localStorage.getItem(`nunopi:ws:${path}:dock-tree`) || "null"); if (isDockNode(j)) stored = j; } catch { /* ignore */ } dockRepoRef.current = path; }
    setDockTree((prev) => {
      const base = switched ? stored : prev;
      const pruned = base ? pruneTree(base, has) : null;
      const cur = pruned ? leavesOf(pruned) : new Set<PanelId>();
      const need = (["terminal", "code", "doc", "flow", "browser"] as PanelId[]).filter((p) => has[p]);
      const same = pruned && need.length === cur.size && need.every((p) => cur.has(p));
      return same ? pruned : defaultTree(has);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flowFeature는 아래 전용 이펙트가 증분 삽입/제거(여기 넣으면 배치 재빌드로 커스텀 배치 유실)
  }, [path, hasCode, hasDoc, mounted]);
  // 패널 증분 삽입/제거(#743·#758) — flowFeature/접힘 토글 시 커스텀 dock 배치를 보존하며 해당 리프만 추가/삭제.
  // (존재 변화 hasCode/hasDoc는 위 메인 이펙트가 재빌드로 처리 → 여기 deps엔 안 넣어 이중 처리 방지.)
  useEffect(() => {
    if (!mounted) return;
    // 브라우저는 열림 값이 "바뀐" 때만 넣고 뺌(#1034 리뷰) — 복원 커밋에선 이 이펙트가 아직 옛 값(false)을 봐서
    // 메인 이펙트가 저장 배치로 넣어둔 브라우저를 지웠다가 오른쪽 절반으로 다시 붙여 배치가 날아갔음.
    const browserChanged = browserPrevRef.current !== browserOpen;
    browserPrevRef.current = browserOpen;
    setDockTree((prev) => {
      if (!prev) return prev;
      let tree = prev;
      for (const p of ["terminal", "code", "doc", "flow", "browser"] as PanelId[]) {
        if (p === "browser" && !browserChanged) continue;
        const want = panelVisible(p);
        const inTree = leavesOf(tree).has(p);
        if (want && !inTree) tree = appendPanel(tree, p, p === "browser" ? 0.5 : undefined); // 브라우저는 오른쪽 절반(defaultTree와 같게)
        else if (!want && inTree) tree = removePanel(tree, p) ?? tree;
      }
      return tree;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collapsed·flowFeature 토글만 감시(존재 변화는 메인 이펙트가 재빌드)
  }, [collapsed, flowFeature, browserOpen, mounted]);
  // 도킹 트리 저장(#716) — 로드된 레포와 현재 path 일치할 때만(전환 오염 방지).
  useEffect(() => { if (!path || dockRepoRef.current !== path || !dockTree) return; try { localStorage.setItem(`nunopi:ws:${path}:dock-tree`, JSON.stringify(dockTree)); } catch { /* ignore */ } }, [dockTree]); // eslint-disable-line react-hooks/exhaustive-deps -- path 제외: 전환 커밋에 옛 트리를 새 레포 키에 쓰는 오염 방지(dockTree 변할 때만 저장)

  // 열린 플로우 기능 영속(#743) — 레포 전환/재진입 시 그 레포에 저장된 flowFeature 복원(플로우 패널 자동 복귀).
  useEffect(() => {
    if (!mounted || !path || flowRepoRef.current === path) return;
    flowRepoRef.current = path;
    let saved: string | null = null;
    try { saved = localStorage.getItem(`nunopi:ws:${path}:flow-feature`) || null; } catch { /* ignore */ }
    setFlowFeature(saved);
  }, [path, mounted]);
  useEffect(() => {
    if (!path || flowRepoRef.current !== path) return; // 전환 커밋에 옛 값 오염 방지
    try { if (flowFeature) localStorage.setItem(`nunopi:ws:${path}:flow-feature`, flowFeature); else localStorage.removeItem(`nunopi:ws:${path}:flow-feature`); } catch { /* ignore */ }
  }, [flowFeature]); // eslint-disable-line react-hooks/exhaustive-deps -- flowFeature 변할 때만 저장(path 변화는 위 복원 이펙트가 담당)

  // 좌측 4섹션(트리·git·문서·분석) 중 최소 하나는 열려 있어야 — 빈 사이드바 방지(#733·#743). 마지막 하나는 못 끔.
  const leftOpenCount = (treeOpen ? 1 : 0) + (gitOpen ? 1 : 0) + (docsOpen ? 1 : 0) + (analyzeOpen ? 1 : 0);
  // 남는 세로 공간을 채우는(flex-1) 섹션 = 열린 것 중 최상위(순서: 폴더>레포분석>깃>문서). 나머지는 고정 높이(#733·#743).
  const leftFill: "tree" | "analyze" | "git" | "docs" = treeOpen ? "tree" : analyzeOpen ? "analyze" : gitOpen ? "git" : "docs";
  const toggleGit = () => { if (gitOpen && leftOpenCount === 1) return; setGitOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-git-open", n ? "1" : "0"); } catch { /* ignore */ } return n; }); };
  const toggleTree = () => { if (treeOpen && leftOpenCount === 1) return; setTreeOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-tree-open", n ? "1" : "0"); } catch { /* ignore */ } return n; }); };
  const toggleDocs = () => { if (docsOpen && leftOpenCount === 1) return; setDocsOpen((v) => !v); };
  const toggleAnalyze = () => { if (analyzeOpen && leftOpenCount === 1) return; setAnalyzeOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-analyze-open", n ? "1" : "0"); } catch { /* ignore */ } return n; }); };
  const toggleChat = () => setChatOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-chat-open", n ? "1" : "0"); } catch { /* ignore */ } return n; });
  const pickRightMode = (m: "chat" | "github" | "learn") => setRightMode(() => { try { localStorage.setItem("nunopi:ws-right-mode", m); } catch { /* ignore */ } return m; }); // 우측 모드 전환(#811·#855)
  const ciDot = useBranchCi(path); // 현재 브랜치 CI 상태 도트(#812) — GitHub 토글 아이콘 배지
  const toggleLeft = () => setLeftOpen((v) => { const n = !v; try { localStorage.setItem("nunopi:ws-left-open", n ? "1" : "0"); } catch { /* ignore */ } return n; }); // 좌측 사이드바 접기/펴기(#758)
  // #1027 패널 단축키 — 보이는 레포만. git은 접힌 사이드바면 사이드바부터 열고 git 섹션 표시.
  // #1029 기존 툴팁 끝에 단축키 병기(aria-label은 그대로)
  const hintLeft = useShortcutHint("view.left"), hintRight = useShortcutHint("view.right"), hintGit = useShortcutHint("view.git");
  useShortcut(["view.left", "view.right", "view.git"], (d) => {
    if (!active) return false;
    if (d.id === "view.left") toggleLeft();
    else if (d.id === "view.right") toggleChat();
    else if (!leftOpen) { toggleLeft(); if (!gitOpen) toggleGit(); }
    else toggleGit();
  });
  // 중앙 패널 접기/펴기(#758) — 콘텐츠는 유지하고 dock 표시만. 존재하는 패널만 대상.
  const toggleCollapse = (p: PanelId) => setCollapsed((prev) => {
    const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p);
    try { localStorage.setItem("nunopi:ws-collapsed", JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });
  // 접혀 있던 패널을 콘텐츠 열 때 자동으로 펴기(#801) — 접어둔 걸 잊고 파일/문서/아키텍처를 열면 안 보여 혼란.
  // 이미 펴져 있으면 같은 Set 반환(no-op) — 매 클릭 불필요 리렌더 방지. toggle은 반대로 접어버리니 "펴기 전용" 별도.
  const ensureExpanded = (p: PanelId) => setCollapsed((prev) => {
    if (!prev.has(p)) return prev;
    const n = new Set(prev); n.delete(p);
    try { localStorage.setItem("nunopi:ws-collapsed", JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });
  // 인앱 브라우저(#1034) — 툴바 아이콘으로 열기/닫기(닫으면 페이지도 닫힘, 주소는 기억). 분리하면 dock에서 빼고 별도 창.
  // 열 때 — 분리 창을 그냥 닫았으면 거기 있던 탭들(browser-detached)로 엶(한 번 쓰면 지움).
  // ponytail: 분리 창이 아직 열려 있어도 가져옴(같은 페이지가 두 군데) — 창 생존 추적은 필요해지면.
  // 닫을 때 넘어온 탭 신호도 비움 — 안 비우면 다시 열 때 새 BrowserPane이 같은 탭을 또 추가.
  const closeBrowser = () => { setBrowserOpen(false); setBrowserRect(null); setBrowserIncoming(null); };
  const toggleBrowser = () => {
    if (browserOpen) { closeBrowser(); return; }
    try {
      const k = `nunopi:ws:${path}:browser-detached`, raw = localStorage.getItem(k);
      if (raw) {
        localStorage.removeItem(k);
        const d = JSON.parse(raw);
        const urls = Array.isArray(d?.urls) ? d.urls.filter((u: unknown): u is string => typeof u === "string") : [];
        if (urls.length) setBrowserTabs({ urls, active: Number(d.active) || 0 });
      }
    } catch { /* ignore */ }
    setBrowserOpen(true);
  };

  // 브라우저 통째로 별도 창으로(유저 요청) — 탭들을 browser-detached에 적어두면 분리 창이 그걸로 시작. 여긴 패널 닫고 탭 비움.
  const detachBrowser = async (state: BrowserState) => {
    try { localStorage.setItem(`nunopi:ws:${path}:browser-detached`, JSON.stringify(state)); } catch { /* ignore */ }
    const ok = !!(await window.nunopiDesktop?.browser?.openWindow({ url: state.urls[state.active] || "", repo: path, devtools: state.devtools }))?.ok;
    if (ok) { setBrowserTabs({ urls: [], active: 0 }); closeBrowser(); }
  };
  // 활성 탭이 탭바 오버플로로 스크롤 밖에 있으면 안 보임(#801) — 활성 탭 DOM에 콜백 ref 달아 스크롤 인투 뷰.
  // 활성 탭 바뀔 때만 ref 재부착(콜백 identity 안정) → 그때 nearest로 최소 스크롤. 이미 보이면 no-op.
  const scrollTabIntoView = useCallback((el: HTMLElement | null) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, []);
  // 이 아키텍처(기능)에 대해 질문(#746) — 우측 챗에 arch 세션 열고(focus) 챗 패널 펴기.
  const askArch = (feature: string) => { focusChat(`arch:${feature}`, "arch", feature); setChatOpen(true); try { localStorage.setItem("nunopi:ws-chat-open", "1"); } catch { /* ignore */ } };
  // 카드→좌표 삽입(#746) — 챗 패널이 열려 있으면 이 기능의 arch 세션으로 전환 + 지칭 문구를 입력창에.
  // (챗 닫혀 있으면 카드 클릭=포커스만. 질문할 땐 챗이 열려 있음.)
  const quoteNode = (text: string) => {
    if (!chatOpen || flowFeature == null) return;
    focusChat(`arch:${flowFeature}`, "arch", flowFeature); // arch 세션 활성(없으면 생성)
    setChatPrefill((p) => ({ text, n: (p?.n ?? 0) + 1 }));
  };

  // 워킹트리 변경 상태맵 로드(#687 도트 + #689 챗 승계 트리거). 경로 로드·깃 새로고침 시 호출.
  const loadGitStatus = useCallback(async (p: string) => {
    try {
      const rs = await fetch("/api/repo/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
      const ds = await rs.json();
      const map: Record<string, "added" | "modified"> = {};
      // 키는 트리(scan)와 같은 repo-relative POSIX. git porcelain은 항상 "/"지만 방어적 정규화.
      if (rs.ok && ds.isGit && Array.isArray(ds.files)) for (const f of ds.files) { const k = statusKind(f.index ?? "", f.work ?? ""); if (k && typeof f.path === "string") map[f.path.replace(/\\/g, "/")] = k; }
      setFileStatus(map);
    } catch { setFileStatus({}); }
  }, []);
  // 변경 파일 경로 집합(챗 승계 판별용, #689) — fileStatus 바뀔 때만 새 identity(effect 무한루프 방지).
  const changedFileSet = useMemo(() => new Set(Object.keys(fileStatus)), [fileStatus]);
  // 깃 그래프 새로고침 시 상태맵도 갱신 — stable(inline이면 GitGraph load가 매 렌더 재생성→무한 fetch).
  const handleGitRefreshed = useCallback(() => { if (path) void loadGitStatus(path); }, [path, loadGitStatus]);

  // 실시간 갱신(#739) — 활성 워크스페이스의 레포를 파일 워처로 감시. 변경 시 도트 재로드 + gitNonce↑(GitGraph 재fetch).
  // 활성 path만 watch(keep-alive 멀티탭 중복 방지). recursive 미지원이면 폴링 폴백.
  const [gitNonce, setGitNonce] = useState(0);
  const [treeNonce, setTreeNonce] = useState(0); // 워처 변경 시 파일트리·문서 목록 재조회 신호(#830)
  useEffect(() => {
    if (!mounted || !active || !path) return;
    const api = window.nunopiDesktop;
    if (!api?.repo) return;
    const id = path;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    // heavy 갱신 — 상태 도트 + GitGraph(gitNonce) + 파일트리·문서(treeNonce). 실제 fs 변경 때만(#838).
    const refresh = () => { void loadGitStatus(path); setGitNonce((n) => n + 1); setTreeNonce((n) => n + 1); };
    const onChange = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(refresh, 250); };
    const off = api.repo.onChanged((p) => { if (p.id === id) onChange(); });
    // 성능(#838): 그래프(1965커밋 재조회+재렌더)·트리 통째 재조회(heavy)는 fs 이벤트서만. 안전망 폴링은 도트(git status)만
    // 저비용 갱신 — 변경 없어도 15초마다 heavy로 돌던 churn 제거. fs.watch가 조용히 죽어도 도트는 유지, 그래프·트리는 수동 새로고침 커버.
    // 단 watch 미지원/실패면 fs 이벤트가 아예 없으니 폴링이 heavy 유일 수단 → 그땐 refresh(heavy) 유지.
    void api.repo.watch({ id, root: path })
      .then((r) => {
        poll = (r && r.supported === false)
          ? setInterval(refresh, 3000)                             // 미지원: fs 이벤트 없음 → 폴링이 heavy
          : setInterval(() => void loadGitStatus(path), 15000);    // 지원: 폴링은 도트만(heavy는 fs 이벤트서)
      })
      .catch(() => { poll = setInterval(refresh, 3000); });         // watch 실패 → heavy 폴링(유일 수단)
    return () => {
      off();
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
      void api.repo?.unwatch({ id });
    };
  }, [mounted, active, path, loadGitStatus]);

  // 폴더 정해지면 파일트리 로드(레포 전환 시). 스피너는 이 전환 로드에만 — 워처 갱신과 분리(무한 스피너 방지, #830).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 폴더 바뀌면 트리 재로드(경로 변경 시)
    if (!path) { setFiles([]); setFileStatus({}); return; }
    let cancelled = false;
    setTreeLoading(true);
    // 레포 전환 시 이전 목록·상태 즉시 비움 — key={path}로 리마운트되는 FileTree가 옛 레포의 changedAncestors(변경 폴더)를
    // 물어 그 폴더 펼침이 새 레포 저장분에 섞이는 것 방지(#712 리뷰). 열린 파일 초기화는 안 함(위 path 이펙트가 레포별 복원).
    setFiles([]); setFileStatus({});
    (async () => {
      try {
        const r = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const d = await r.json();
        if (!cancelled) setFiles(r.ok && Array.isArray(d.files) ? d.files : []);
      } catch { if (!cancelled) setFiles([]); }
      finally { if (!cancelled) setTreeLoading(false); }
      if (!cancelled) void loadGitStatus(path); // 변경 파일 상태 도트(#687)·워킹트리 챗 승계(#689)용
    })();
    return () => { cancelled = true; };
  }, [path, loadGitStatus]);

  // 워처 변경(treeNonce) 시 파일트리 무-스피너 재조회(#830) — 목록 안 비우고 결과만 in-place 교체(깜빡임 없음).
  // treeLoading을 안 건드려 스피너가 갱신에 끼지 않게 함(전환 로드와 분리).
  useEffect(() => {
    if (!path || treeNonce === 0) return; // 초기(전환 이펙트가 담당) 스킵
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const d = await r.json();
        if (!cancelled && r.ok && Array.isArray(d.files)) setFiles(d.files); // 실패 시 기존 목록 유지
      } catch { /* 기존 목록 유지 */ }
    })();
    return () => { cancelled = true; };
  }, [path, treeNonce]);

  // 문서 폴더 파일 목록 로드(#693) — /api/repo/tree 재사용(root=docsRoot). 워처 변경(treeNonce) 시 재조회(#830).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 문서 폴더 변경 시 재로드
    if (!docsRoot) { setDocsFiles([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: docsRoot }) });
        const d = await r.json();
        if (!cancelled && r.ok && Array.isArray(d.files)) setDocsFiles(d.files); // 실패 시 기존 유지
      } catch { /* 기존 목록 유지 */ }
    })();
    return () => { cancelled = true; };
  }, [docsRoot, treeNonce]);

  // 문서 폴더 선택(#693) — 범용 폴더 선택기 재사용.
  async function pickDocs() {
    if (!desktop?.pickRepoFolder || picking) return;
    setPicking(true);
    try {
      const r = await desktop.pickRepoFolder({ defaultPath: getSetting<string>(WKEYS.defaultFolder, WORKSPACE_DEFAULTS.defaultFolder) || undefined });
      if (!r.canceled && r.path) {
        setDocsRoot(r.path);
        setDocTabs([]); setActiveDoc(null); // 새 문서 폴더 = 이전 탭 무효. 레포 스코프 저장 이펙트가 반영(#712)
      }
    } catch { /* 무시 */ } finally { setPicking(false); }
  }

  // 문서 탭 열기/닫기(#693) — 브라우저서 클릭해 열림(+ 버튼 없음).
  function openDoc(id: string) { setDocTabs((prev) => (prev.includes(id) ? prev : [...prev, id])); setActiveDoc(id); ensureExpanded("doc"); }
  function closeDocTab(id: string) {
    setDocTabs((prev) => prev.filter((x) => x !== id));
    setActiveDoc((cur) => { if (cur !== id) return cur; const rest = docTabs.filter((x) => x !== id); return rest.length ? rest[rest.length - 1] : null; });
  }

  // 코드/diff 탭(#714) — 문서 탭과 동형. 그 탭 컨텍스트로 챗 포커스도 맞춘다.
  const focusForTab = (tb: CodeTab) => {
    const name = tb.file.split("/").pop() ?? tb.file;
    if (tb.kind === "file") focusChat(`file:${tb.file}`, "file", name);
    else if (tb.hash) focusChat(`diff:${tb.hash}:${tb.file}`, "diff", `${name} @${tb.hash.slice(0, 7)}`);
    else { const f = tb.file.replace(/\\/g, "/"); focusChat(`wt:${f}`, "worktree", `${f.split("/").pop() ?? f} · 변경`); }
  };
  function openCodeTab(tb: CodeTab) {
    const key = codeTabKey(tb);
    setCodeTabs((prev) => (prev.some((x) => codeTabKey(x) === key) ? prev : [...prev, tb])); // 있으면 그대로(활성만 바꿈), 없으면 추가
    setActiveCode(key);
    focusForTab(tb);
    ensureExpanded("code");
  }
  function activateCode(key: string) {
    setActiveCode(key);
    const tb = codeTabs.find((x) => codeTabKey(x) === key);
    if (tb) focusForTab(tb);
  }
  function closeCodeTab(key: string) {
    setCodeTabs((prev) => prev.filter((x) => codeTabKey(x) !== key));
    setActiveCode((cur) => { if (cur !== key) return cur; const rest = codeTabs.filter((x) => codeTabKey(x) !== key); return rest.length ? codeTabKey(rest[rest.length - 1]) : null; });
  }
  const activeTab = codeTabs.find((tb) => codeTabKey(tb) === activeCode) ?? null;
  const activeFile = activeTab?.kind === "file" ? activeTab.file : null; // FileTree 선택 하이라이트용

  // 웹(비데스크톱): 터미널·폴더접근 불가 → 안내.
  if (mounted && !desktop) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">{t("workspace.desktopOnly")}</div>
    );
  }

  // 코드/diff 노드(멀티탭, #714) — 문서 뷰어(DocViewer)와 동형 탭 바 + 활성 pane. 코드 영역 분할 배치에 재사용(#693).
  const codeNode = codeTabs.length ? (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭 바(스크롤) — 파일/diff 각 탭. × 로 닫기, 클릭으로 전환. pr-6: 우상단 이동 그립 자리 예약(#716). */}
      <div className="flex shrink-0 items-stretch border-b border-zinc-200 bg-zinc-100/70 pr-[17px] dark:border-zinc-800 dark:bg-[var(--s-bar)]">
        <div className="nunopi-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {codeTabs.map((tb) => {
            const key = codeTabKey(tb);
            const on = key === activeCode;
            const name = tb.file.split("/").pop() ?? tb.file;
            return (
              <div key={key} ref={on ? scrollTabIntoView : undefined} onClick={() => activateCode(key)}
                className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-200 px-3 py-1.5 text-[12px] transition dark:border-zinc-800 ${on ? "bg-white text-zinc-800 dark:bg-[var(--s-pane)] dark:text-zinc-100" : "text-zinc-500 hover:bg-white/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"}`}>
                {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-mustard-500" aria-hidden />}
                {tb.kind === "diff"
                  ? <IconGitCommit size={13} stroke={2} className={`shrink-0 ${on ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`} aria-hidden />
                  : <IconFileCode size={13} stroke={2} className={`shrink-0 ${on ? "text-mustard-600 dark:text-mustard-400" : "text-zinc-400"}`} aria-hidden />}
                <span className="whitespace-nowrap">{name}{tb.kind === "diff" && <span className="ml-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{tb.hash ? `@${tb.hash.slice(0, 7)}` : `· ${tb.worktree}`}</span>}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); closeCodeTab(key); }}
                  className={`ml-1 shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={t("mem.close")}>
                  <IconX size={12} stroke={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {activeTab?.kind === "diff"
          ? <DiffPane key={activeCode} root={path} hash={activeTab.hash} file={activeTab.file} worktree={activeTab.worktree} providerId={providerId} providerSettings={providerSettings} />
          : activeTab?.kind === "file"
            ? <CodePane key={activeCode} root={path} file={activeTab.file} />
            : null}
      </div>
    </div>
  ) : null;
  // 문서 노드(#716) — 배치는 도킹 트리가 담당하므로 DocViewer의 dock 토글은 넘기지 않음(디자인·탭은 그대로).
  const docNode = hasDoc ? (
    <DocViewer root={docsRoot!} tabs={docTabs} activeDoc={activeDoc!} onActivate={setActiveDoc} onCloseTab={closeDocTab} />
  ) : null;
  // 도킹 트리에 넘길 패널 3종(존재하는 것만 트리 리프로 렌더됨). 기존 컴포넌트 그대로.
  const dockPanels: Record<PanelId, ReactNode> = {
    terminal: <TerminalPane cwd={path} active={active} />,
    code: codeNode,
    doc: docNode,
    // 기능별 아키텍처 플로우(#743) — flowFeature 있을 때만 dock에 삽입됨. 노드 클릭 → 코드 탭 열기.
    // 브라우저(#1034)는 dock엔 자리(slot)만 — 실제 페이지는 아래 고정 레이어. dock 트리가 바뀌면 리프가 다시 만들어지는데
    // <webview>는 DOM에서 빠지면 페이지가 죽어서(새로고침·기록 유실) 위치만 따라가게 한다(orca 방식).
    browser: browserOpen ? <BrowserSlot anchor={dockRef} onRect={setBrowserRect} /> : null,
    flow: <RepoFlowPane feature={flowFeature} root={path} providerId={providerId} providerSettings={providerSettings} onOpenFile={(file) => openCodeTab({ kind: "file", file })} onAskArch={askArch} onQuoteNode={quoteNode} onClose={() => setFlowFeature(null)} />,
  };

  // 4존 셸.
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 헤더 한 줄(#731) — 좌: 워크스페이스 탭(이름이 탭에 있어 별도 폴더명 줄 없음), 우: 영역 컨트롤. */}
      <header className={`titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 pr-2 dark:border-zinc-800 ${fullscreen ? "" : "pl-[78px]"}`}>
        {/* 좌측 도크 툴바(#758) — 왼쪽 사이드바 토글 | (커밋2: 중앙 패널 접기/펴기 토글들). */}
        <div className="flex shrink-0 items-center gap-0.5 pl-1.5">
          {/* 제목 줄(창 드래그 영역)은 Electron이 기본 title 툴팁을 안 띄움 → 앱의 기존 말풍선 방식(GitGraph 헤더와 동일)(#1029) */}
          <span className="group/lt relative flex shrink-0">
            <button type="button" onClick={toggleLeft} aria-label={leftOpen ? t("workspace.leftCollapse") : t("workspace.leftExpand")} aria-pressed={leftOpen}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
              {leftOpen ? <IconLayoutSidebarLeftCollapse size={18} stroke={2} aria-hidden /> : <IconLayoutSidebarLeftExpand size={18} stroke={2} aria-hidden />}
            </button>
            <span className="pointer-events-none absolute top-full z-50 mt-1 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow transition dark:bg-zinc-700 left-0 group-hover/lt:opacity-100" aria-hidden>{withShortcutHint(leftOpen ? t("workspace.leftCollapse") : t("workspace.leftExpand"), hintLeft)}</span>
          </span>
          <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          {/* 중앙 패널 접기/펴기(#758) — 없는 패널은 비활성(회색), 있으면 클릭해 접기/펴기(펼침=강조). */}
          {([
            { p: "terminal" as PanelId, Icon: IconTerminal2, key: "workspace.panelTerminal" },
            { p: "code" as PanelId, Icon: IconFileCode, key: "workspace.panelCode" },
            { p: "doc" as PanelId, Icon: IconFileText, key: "workspace.panelDoc" },
            { p: "flow" as PanelId, Icon: IconSitemap, key: "workspace.panelArch" },
            { p: "browser" as PanelId, Icon: IconWorld, key: "workspace.panelBrowser" },
          ]).map(({ p, Icon, key }) => {
            // 브라우저는 접기 대신 열기/닫기 — 안 열려 있어도 눌러서 연다(#1034).
            const isBrowser = p === "browser";
            const exists = isBrowser || panelExists(p), vis = isBrowser ? browserOpen : panelVisible(p);
            return (
              <button key={p} type="button" disabled={!exists} onClick={() => (isBrowser ? toggleBrowser() : toggleCollapse(p))} aria-pressed={vis}
                title={t(key)} aria-label={t(key)}
                className={`shrink-0 rounded-lg p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${vis ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
                <Icon size={16} stroke={2} aria-hidden />
              </button>
            );
          })}
        </div>
        <span className="h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
        {tabStrip}
        {/* 영역 컨트롤(#721) — 질문·분석으로 나가기 / 암기(카드덱) / 설정 / 챗 토글. */}
        {isNunopiEnabled() && (onExitWorkspace || onOpenMemorize) && <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />}
        {isNunopiEnabled() && onExitWorkspace && (
          <button type="button" onClick={onExitWorkspace} title={t("workspace.toQA")} aria-label={t("workspace.toQA")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconMessages size={16} stroke={2} aria-hidden />
          </button>
        )}
        {isNunopiEnabled() && onOpenMemorize && (
          <button type="button" onClick={onOpenMemorize} title={t("mode.memorize")} aria-label={t("mode.memorize")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <IconCards size={16} stroke={2} aria-hidden />
          </button>
        )}
        {/* 설정은 워크스페이스에선 하단 바(토큰 사용량 옆)로 이동(#752). */}
        {/* 영역 nav(질문·분석/암기) ↔ 패널 유틸(챗 토글) 구분선(#785) — AppShell 헤더와 동일 패턴. nunopi off면 위 nav가 없어 구분선도 숨김(#908). */}
        {isNunopiEnabled() && (onExitWorkspace || onOpenMemorize) && <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />}
        {/* 우측 패널 모드 토글(#811) — 순서: 학습스트림 → 질문(Chat) → GitHub(#908). 우측 패널 열려 있을 때만. */}
        {chatOpen && (
          <>
            {/* 캐치업(#855·#992) — 에이전트 작업 실시간 해설. 설정에서 끄면 버튼 없음(#1062). */}
            {catchupOn && <button type="button" onClick={() => pickRightMode("learn")} aria-pressed={rightMode === "learn"} title={t("learn.mode")} aria-label={t("learn.mode")}
              className={`shrink-0 rounded-lg p-1.5 transition ${rightMode === "learn" ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
              <IconActivity size={16} stroke={2} aria-hidden />
            </button>}
            <button type="button" onClick={() => pickRightMode("chat")} aria-pressed={rightMode === "chat"} title={t("chat.title")} aria-label={t("chat.title")}
              className={`shrink-0 rounded-lg p-1.5 transition ${rightMode === "chat" ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
              <IconMessageCircle size={16} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={() => pickRightMode("github")} aria-pressed={rightMode === "github"} title="GitHub" aria-label="GitHub"
              className={`relative shrink-0 rounded-lg p-1.5 transition ${rightMode === "github" ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`}>
              <IconBrandGithub size={16} stroke={2} aria-hidden />
              {/* CI 상태 도트(#812) — 진행(노랑,깜빡)/통과(초록)/실패(빨강). PR 없음·끝남이면 숨김. */}
              {ciDot && <span aria-hidden className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-[var(--s-pane)] ${ciDot === "running" ? "animate-pulse bg-amber-400" : ciDot === "failure" ? "bg-rose-500" : "bg-emerald-500"}`} />}
            </button>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          </>
        )}
        {/* 우측 챗 패널 접기/펴기(#716·#695) — 헤더 토글. 열림=collapse 아이콘, 접힘=expand 아이콘. */}
        <span className="group/rt relative flex shrink-0">
          <button type="button" onClick={toggleChat} aria-label={chatOpen ? t("workspace.chatCollapse") : t("workspace.chatExpand")}
            className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            {chatOpen ? <IconLayoutSidebarRightCollapse size={16} stroke={2} aria-hidden /> : <IconLayoutSidebarRightExpand size={16} stroke={2} aria-hidden />}
          </button>
          <span className="pointer-events-none absolute top-full z-50 mt-1 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow transition dark:bg-zinc-700 right-0 group-hover/rt:opacity-100" aria-hidden>{withShortcutHint(chatOpen ? t("workspace.chatCollapse") : t("workspace.chatExpand"), hintRight)}</span>
        </span>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {/* 좌: 파일트리(위) + 깃 그래프(아래, 접기·세로 리사이즈). leftOpen=false면 통째로 접힘(#758). */}
        {leftOpen && (
        <aside ref={asideRef} style={{ width: treeW }} className="flex shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          {treeOpen && (
            <div className="min-h-0 flex-1 overflow-hidden">
              {treeLoading ? (
                <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>
              ) : files.length > 0 ? (
                <FileTree key={path} files={files} status={fileStatus} selected={activeFile} storageKey={path ? `nunopi:ws:${path}:tree-open` : undefined} onSelect={(id) => openCodeTab({ kind: "file", file: id })} />
              ) : (
                <ZonePlaceholder Icon={IconFiles} label={t("workspace.tree")} />
              )}
            </div>
          )}
          {/* 레포 분석하기 섹션(#743) — [분석하기]→카테고리→기능 플로우. 순서: 폴더 다음. 세로 리사이즈·전체영역. */}
          {analyzeOpen && (
            <>
              {leftFill !== "analyze" && <div onMouseDown={startDrag("analyzeH", analyzeH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-mustard-500/40 dark:hover:bg-mustard-400/40" />}
              <div style={leftFill === "analyze" ? undefined : { height: analyzeH }} className={`flex flex-col overflow-hidden border-t border-zinc-200 dark:border-zinc-800 ${leftFill === "analyze" ? "min-h-0 flex-1" : "shrink-0"}`}>
                <RepoAnalyzeSection root={path} providerId={providerId} providerSettings={providerSettings} onOpenFlow={(f) => { setFlowFeature(f); ensureExpanded("flow"); }} onOpenGraph={() => setGraphOpen(true)} />
              </div>
            </>
          )}
          {gitOpen && (
            <>
              {leftFill !== "git" && <div onMouseDown={startDrag("gitH", gitH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-mustard-500/40 dark:hover:bg-mustard-400/40" />}
              <div style={leftFill === "git" ? undefined : { height: gitH }} className={`overflow-hidden border-t border-zinc-200 dark:border-zinc-800 ${leftFill === "git" ? "min-h-0 flex-1" : "shrink-0"}`}><GitGraph root={path} onOpenDiff={(hash, file) => openCodeTab({ kind: "diff", hash, file })} onFocusBranch={(b) => focusChat(`branch:${b}`, "branch", b)} onOpenChange={(file, worktree) => openCodeTab({ kind: "diff", file, worktree })} onRefreshed={handleGitRefreshed} refreshNonce={gitNonce} /></div>
            </>
          )}
          {/* 문서 폴더 브라우저(#693) — .md/.txt 클릭 시 뷰어에 표시(뷰어는 커밋2). */}
          {docsOpen && (
            <>
            {leftFill !== "docs" && <div onMouseDown={startDrag("docsH", docsH)} className="h-1 shrink-0 cursor-row-resize transition hover:bg-mustard-500/40 dark:hover:bg-mustard-400/40" />}
            <div style={leftFill === "docs" ? undefined : { height: docsH }} className={`flex flex-col overflow-hidden border-t border-zinc-200 dark:border-zinc-800 ${leftFill === "docs" ? "min-h-0 flex-1" : "shrink-0"}`}>
              {docsRoot ? (
                <>
                  <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-2.5 py-1 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                    <IconFolderOpen size={11} stroke={2} className="shrink-0" aria-hidden />
                    <span className="truncate">{docsRoot.split("/").filter(Boolean).pop()}</span>
                    <button type="button" onClick={pickDocs} className="ml-auto shrink-0 rounded px-1 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">{t("workspace.docsChangeFolder")}</button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <FileTree key={docsRoot} files={docsFiles} selected={activeDoc} storageKey={path ? `nunopi:ws:${path}:docs-tree-open` : undefined} onSelect={(id) => { if (/\.(md|markdown|txt)$/i.test(id)) openDoc(id); }} />
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center p-3">
                  <button type="button" onClick={pickDocs} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <IconFolderOpen size={13} stroke={2} aria-hidden /> {t("workspace.docsOpenFolder")}
                  </button>
                </div>
              )}
            </div>
            </>
          )}
          {/* 하단 아이콘 바(#733·#743) — 폴더·분석·git·문서 패널 토글(순서 일치). */}
          <div className="flex shrink-0 items-center gap-0.5 border-t border-zinc-200 px-1.5 py-0.5 dark:border-zinc-800">
            <button type="button" onClick={toggleTree} title={t("workspace.tree")} aria-label={t("workspace.tree")} aria-pressed={treeOpen}
              className={`rounded-md p-1 transition ${treeOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconFiles size={14} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={toggleAnalyze} title={t("repo.analyzeSection")} aria-label={t("repo.analyzeSection")} aria-pressed={analyzeOpen}
              className={`rounded-md p-1 transition ${analyzeOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconSitemap size={14} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={toggleGit} title={withShortcutHint("git", hintGit)} aria-label="git" aria-pressed={gitOpen}
              className={`rounded-md p-1 transition ${gitOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconGitBranch size={14} stroke={2} aria-hidden />
            </button>
            <button type="button" onClick={toggleDocs} title={t("workspace.docs")} aria-label={t("workspace.docs")} aria-pressed={docsOpen}
              className={`rounded-md p-1 transition ${docsOpen ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"}`}>
              <IconFileText size={14} stroke={2} aria-hidden />
            </button>
            {/* 우측 끝 — 설정·토큰 사용량(#735) 모니터. active일 때만 폴링(중복 방지). 포트(#880)는 레포 호버카드에. */}
            <div className="ml-auto flex items-center gap-0.5">
              {onOpenSettings && (
                <button type="button" onClick={onOpenSettings} title={t("header.settings")} aria-label={t("header.settings")}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                  <IconSettings size={14} stroke={2} aria-hidden />
                </button>
              )}
              <UsageMonitor active={active} />
            </div>
          </div>
        </aside>
        )}
        {leftOpen && <div onMouseDown={startDrag("tree", treeW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-mustard-500/40 dark:hover:bg-mustard-400/40" />}
        {/* 가운데: 커스텀 도킹 분할 트리(터미널·코드·문서 자유 배치, #716). 기존 패널 그대로 렌더만 재배치. */}
        <section ref={dockRef} className="relative flex min-w-0 flex-1">
          {dockTree && <WorkspaceDockLayout tree={dockTree} panels={dockPanels} onTreeChange={setDockTree} />}
          {/* 브라우저 고정 레이어(#1034) — slot 위치에 겹쳐 그림. z-20: dock 드롭 오버레이(z-30)·이동 그립(z-40)은 위로. */}
          {browserOpen && browserRect && (
            <div className="absolute z-20" style={{ left: browserRect.l, top: browserRect.t, width: browserRect.w, height: browserRect.h }}>
              <BrowserPane repo={path} initial={browserTabs} incoming={browserIncoming} onTabsChange={(urls, active) => setBrowserTabs({ urls, active })} onDetach={(st) => void detachBrowser(st)} onEmpty={closeBrowser} />
            </div>
          )}
        </section>
        {/* 우: 챗룸(접기/펴기 #695) — 접힘 시 aside·divider 미렌더(폭 0). 토글은 아래 플로팅 엣지 탭. */}
        {chatOpen && (
          <>
            <div onMouseDown={startDrag("chat", chatW)} className="w-1 shrink-0 cursor-col-resize transition hover:bg-mustard-500/40 dark:hover:bg-mustard-400/40" />
            <aside style={{ width: chatW }} className="flex shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
              {/* 우측 패널 모드(#811·#855) — 질문(Chat) ↔ GitHub ↔ 캐치업 배타 렌더. 토글은 상단 헤더. */}
              {rightMode === "github" ? (
                <GithubPanel root={path} ciDot={ciDot} />
              ) : rightMode === "learn" ? (
                /* #1051 캐치업 용어 → 추가된 카드 클릭 시 확대(throwCard) — 질문 패널과 같은 FlyCardProvider */
                <FlyCardProvider active={active} providerId={providerId} providerSettings={providerSettings} sourceIds={flyNoSources} onGoToSource={() => {}}>
                  <RepoLearnStream key={path} root={path} active={active} agentWorking={agentWorking} providerId={providerId} providerSettings={providerSettings} onOpenDiff={(hash, file) => openCodeTab({ kind: "diff", hash, file })} />
                </FlyCardProvider>
              ) : (
                /* FlyCardProvider(#750) — 세션 카드 목록에서 카드 클릭 시 확대·상세(throwCard). 워크스페이스 카드는 출처이동 없음(빈 sourceIds). */
                <FlyCardProvider active={active} providerId={providerId} providerSettings={providerSettings} sourceIds={flyNoSources} onGoToSource={() => {}}>
                  <WorkspaceChat root={path} files={files} focus={chatFocus} prefill={chatPrefill} changedFiles={changedFileSet} providerId={providerId} providerSettings={providerSettings} />
                </FlyCardProvider>
              )}
            </aside>
          </>
        )}
        {/* 코드그래프 raw 뷰어(#842 서브5) — 헤더 밑 콘텐츠 영역 오버레이(전체화면 아님). 노드 클릭 → 코드 탭. */}
        {graphOpen && <RepoGraphViewer root={path} onOpenFile={(file) => openCodeTab({ kind: "file", file })} onClose={() => setGraphOpen(false)} />}
      </div>
    </div>
  );
}

// 브라우저 자리 표시(#1034) — dock 리프 안 빈 칸. 크기·위치를 anchor(dock 영역) 기준으로 재서 고정 레이어에 알려줌.
// 리프가 다시 만들어져도 이건 그냥 다시 재면 끝(레이어는 그대로라 페이지 유지). 값 같으면 state 안 바꿔 렌더 루프 방지.
type SlotRect = { l: number; t: number; w: number; h: number };
function BrowserSlot({ anchor, onRect }: { anchor: RefObject<HTMLElement | null>; onRect: (r: SlotRect) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef("");
  const measure = () => {
    const el = ref.current, a = anchor.current;
    if (!el || !a) return;
    const ar = a.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!r.width || !r.height) return; // 숨은 레포 탭(display:none) — 마지막 위치 유지
    const next = { l: Math.round(r.left - ar.left), t: Math.round(r.top - ar.top), w: Math.round(r.width), h: Math.round(r.height) };
    // 같으면 setState 자체를 안 부름 — 렌더마다 재는 이펙트라, 같은 값이라도 업데이트를 걸면
    // React가 부모를 다시 렌더 → 또 잼 → 무한 루프(#185, 앱이 "This page couldn't load")였음.
    const key = `${next.l},${next.t},${next.w},${next.h}`;
    if (key === last.current) return;
    last.current = key;
    onRect(next);
  };
  const measureRef = useRef(measure);
  useLayoutEffect(() => { measureRef.current = measure; measure(); }); // 렌더마다(트리 변경으로 자리만 옮겨진 경우)
  useLayoutEffect(() => { // 크기 변화(창·사이드바·경계 드래그)는 관찰자 하나로
    const el = ref.current, a = anchor.current;
    if (!el || !a) return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(el); ro.observe(a);
    return () => ro.disconnect();
  }, [anchor]);
  return <div ref={ref} className="h-full w-full" />;
}

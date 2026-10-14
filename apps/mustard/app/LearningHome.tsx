"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@mustard/nunopi";
import { QASubToggle } from "@mustard/nunopi";
import ModeSwapToggle from "@/components/brand/ModeSwapToggle";
import { LearningPanel } from "@mustard/nunopi";
import { SettingsDrawer } from "@mustard/nunopi";
import { ConfirmProvider } from "@mustard/core";
import { ToastProvider } from "@mustard/core";
import GlobalCommandPalette from "@/components/ui/GlobalCommandPalette";
import { isNunopiEnabled, setNunopiEnabled } from "@/lib/product";
// nunopiEnabled=true 경로의 학습 홈(#896 서브6). page.tsx가 React.lazy로 로드 —
// 학습 표면(useCodeAnalysis·학습 컴포넌트) 전부 여기 static import라 false면 이 청크가 안 실린다.
import { I18nProvider } from "@mustard/core";
import { CodeInputArea } from "@mustard/nunopi";
import { TextInputArea } from "@mustard/nunopi";
import { EditorChatColumn } from "@mustard/nunopi";
import { ChatRoom } from "@mustard/nunopi";
import { MemorizeView } from "@mustard/nunopi";
import { AskView } from "@mustard/nunopi";
import { HistoryView } from "@mustard/nunopi";
import WorkspaceTabs, { type WorkspaceTabsHandle } from "@/components/workspace/WorkspaceTabs";
import type { HistoryNav } from "@mustard/nunopi";
import { type ViewMode, VIEW_MODE_KEY } from "@mustard/core";
import { type ThemeId, applyTheme, getStoredTheme, setStoredTheme } from "@mustard/core";
import { applyStoredAppearance } from "@mustard/core";
import { deckStats } from "@mustard/nunopi";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { type HistoryEntry, getAllHistory } from "@mustard/nunopi";
import { loadExclusions } from "@mustard/nunopi";
import { type Collection, loadCollections } from "@mustard/nunopi";
import { useCodeAnalysis, generateAutoTitle } from "@mustard/nunopi";
import { useCollapsed } from "@mustard/nunopi";
import { AnalysisProvider } from "@mustard/nunopi";
import { type LearnProviderMode, type ModeModels, type ModeProviders, loadModeModels, loadModeProviders, saveModeModels, saveModeProviders, resolveModeModel, resolveModeProvider, withModel } from "@mustard/nunopi";
const SETTINGS_STORAGE_KEY = "nunopi:provider-settings";
const DEFAULT_PROVIDER_ID: AgentProviderKind = "claude-agent";

export default function LearningHome() {
  // ── 전역 공유 상태(page 소유 — 암기·질문·기록·설정 등 여러 뷰가 쓴다). code/text 분석 로직은 useCodeAnalysis 훅.
  const [providerId, setProviderId] = useState<AgentProviderKind>(DEFAULT_PROVIDER_ID);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 테마(#914 멀티) — data-theme + .dark(base)로 팔레트 재색조. Monaco/Shiki는 .dark MutationObserver로 반응.
  const [theme, setTheme] = useState<ThemeId>("dark");
  useEffect(() => {
    const t = getStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(t);
    applyTheme(t);
    applyStoredAppearance(); // #937 저장된 UI 줌·폰트 복원
  }, []);
  function changeTheme(next: ThemeId) {
    setTheme(next);
    applyTheme(next);
    setStoredTheme(next);
  }

  // 카드보기 날아오는 애니메이션 on/off (#641).
  const [cardFlyAnimation, setCardFlyAnimation] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCardFlyAnimation(localStorage.getItem("nunopi:card-fly") !== "off");
  }, []);
  function changeCardFlyAnimation(next: boolean) {
    setCardFlyAnimation(next);
    try { localStorage.setItem("nunopi:card-fly", next ? "on" : "off"); } catch {}
  }

  // 분석 히스토리(암기·기록 뷰와 공유). 목록·제외 용어(설정·글분석 공유)도 여기 소유.
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [excludedTerms, setExcludedTerms] = useState<string[]>([]);

  // 화면 전환 축(코드/글/암기/질문/기록/워크스페이스).
  // Mustard(ADE)는 워크스페이스-우선(#900 피봇) — 신규/미저장 부팅은 워크스페이스 빈 시작화면.
  // 학습(code/text/ask/memorize/history)은 nav·탭으로 도달. 복귀 유저는 아래 복원 로직이 마지막 뷰로.
  const [viewMode, setViewMode] = useState<ViewMode>("workspace");
  // 모드 전용 창(#789) — ?win=<kind>로 뜬 별도 창이면 그 모드만 렌더(영역전환·복원·영속 스킵).
  const winKind = useMemo<ViewMode | null>(() => {
    if (typeof window === "undefined") return null;
    const w = new URLSearchParams(window.location.search).get("win");
    return w === "ask" || w === "code" || w === "text" || w === "memorize" ? (w as ViewMode) : null;
  }, []);
  const vm: ViewMode = winKind ?? viewMode; // AppShell 슬롯 판정에 쓰는 유효 뷰모드.
  const lastQAViewRef = useRef<ViewMode>("code"); // 질문·분석 진입 시 복귀할 직전 하위뷰(ask/code/text).
  const lastLearnViewRef = useRef<ViewMode>("history"); // nunopi(학습) 진입 시 복원할 마지막 학습뷰(#912). 워크스페이스 제외.
  const memorizeOriginRef = useRef<ViewMode>("code"); // 암기 진입 직전 영역(#785) — 돌아가기 목적지.
  const wsRef = useRef<WorkspaceTabsHandle>(null); // 명령 팔레트(#878)가 워크스페이스 탭 조작
  const [askGoTarget, setAskGoTarget] = useState<{ sessionId: string; subId?: string; quizId?: string; nonce: number } | undefined>(undefined);
  const askGoNonceRef = useRef(0);
  const [memGoTarget, setMemGoTarget] = useState<{ cardKey: string; nonce: number } | undefined>(undefined);
  const memGoNonceRef = useRef(0);
  const [memorizeDue, setMemorizeDue] = useState(0);
  // 모드별 provider(#985). providerId(위)는 코드/글 드롭다운의 "지금 값" — 히스토리 열기로 일시 변경될 수 있음.
  const [modeProviders, setModeProviders] = useState<ModeProviders>({});
  const [modeModels, setModeModels] = useState<ModeModels>({}); // #987
  const updateModeModel = useCallback((mode: LearnProviderMode | "default", model: string | undefined) => {
    setModeModels((prev) => {
      const next = { ...prev };
      if (model) next[mode] = model; else delete next[mode]; // undefined = 기본 모델
      saveModeModels(next);
      return next;
    });
  }, []);
  const updateModeProvider = useCallback((mode: LearnProviderMode | "default", id: AgentProviderKind | undefined) => {
    setModeProviders((prev) => {
      const next = { ...prev };
      if (id) next[mode] = id; else delete next[mode]; // undefined = 기본값 따라감
      saveModeProviders(next);
      return next;
    });
    updateModeModel(mode, undefined); // provider가 바뀌면 그 행 모델은 다른 provider 것 → 초기화(#987)
  }, [updateModeModel]);

  // ── 코드/글 분석 로직(훅). 공유 상태를 주입한다. shared는 워크스페이스 탭의 CodeAnalysisView가
  // Context로 받아 같은 저장소를 보게 하는 통로이기도 하다(#773).
  const shared = useMemo(() => ({ historyEntries, setHistoryEntries, collections, setCollections, excludedTerms, setExcludedTerms, providerId, setProviderId, providerSettings, setMemorizeDue, modeProviders, setModeProvider: updateModeProvider, modeModels }), [historyEntries, setHistoryEntries, collections, setCollections, excludedTerms, setExcludedTerms, providerId, setProviderId, providerSettings, setMemorizeDue, modeProviders, updateModeProvider, modeModels]);
  const ca = useCodeAnalysis(shared);
  // 뷰별 요청 providerSettings = 기본 + 그 모드 모델(#987). 참조 안정 위해 memo.
  const viewPs = useMemo(() => {
    const ps = (m: LearnProviderMode | "default") => withModel(providerSettings, resolveModeProvider(modeProviders, m), resolveModeModel(modeProviders, modeModels, m));
    return { ask: ps("ask"), history: ps("history"), memorize: ps("memorize"), default: ps("default") };
  }, [providerSettings, modeProviders, modeModels]);
  // 왼쪽 패널 접힘 — 헤더 토글이 제어(훅 밖 소유). 코드/글=입력 패널(#781), 질문=세션 패널(#783).
  const [editorCollapsed, toggleEditorCollapsed] = useCollapsed("nunopi:editor-collapsed");
  const [sessionCollapsed, toggleSessionCollapsed] = useCollapsed("nunopi:ask-panel-collapsed");
  // 암기 진입 출처 복원(#785) — 앱 재시작 후 암기 화면이면 돌아가기가 마지막 출처로 가게.
  // 손상/수동편집 대비 유효한 non-memorize ViewMode만 채택(VIEW_MODE 복원과 동일 방식).
  useEffect(() => {
    try {
      const o = localStorage.getItem("nunopi:memorize-origin");
      if (o === "code" || o === "text" || o === "ask" || o === "history" || o === "workspace") memorizeOriginRef.current = o;
      const l = localStorage.getItem("nunopi:last-learn-view");
      if (l === "code" || l === "text" || l === "ask" || l === "history") lastLearnViewRef.current = l;
    } catch { /* ignore */ }
  }, []);

  // 히스토리 최초 로드.
  useEffect(() => { getAllHistory().then(setHistoryEntries).catch(() => {}); }, []);

  // 뷰·모드·암기 provider 복원. 모드 전용 창(#789)이면 뷰 복원은 스킵하고 창의 kind로 고정.
  useEffect(() => {
    let startMode: "code" | "text" = winKind === "text" ? "text" : "code";
    if (winKind) {
      if (winKind === "text") ca.setMode("text");
    } else {
      const storedView = localStorage.getItem(VIEW_MODE_KEY);
      if (storedView === "code" || storedView === "text" || storedView === "memorize" || storedView === "ask" || storedView === "history" || storedView === "workspace") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setViewMode(storedView);
        if (storedView === "text") { ca.setMode("text"); startMode = "text"; }
      }
    }
    // 모드별 provider 로드(옛 암기 키 이관 포함) → 드롭다운 시작값 = 시작 모드 설정값.
    const mp = loadModeProviders();
    setModeProviders(mp);
    setModeModels(loadModeModels());
    setProviderId(resolveModeProvider(mp, startMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 제외·목록 로드.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExcludedTerms(loadExclusions("text"));
    setCollections(loadCollections());
  }, []);

  // 분석 설정 로드.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setProviderSettings(JSON.parse(raw) as ProviderSettings);
    } catch { /* ignore */ }
  }, []);

  // 암기 탭 배지 due 수 — 뷰 전환 시 재계산.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemorizeDue(deckStats("all", new Date()).due);
  }, [viewMode]);

  // 설정 화면서 바꿀 때 — 코드/글 결과가 안 떠 있으면 드롭다운도 바로 맞춤(떠 있으면 그 결과의 provider 유지).
  function handleModeProviderChange(mode: LearnProviderMode | "default", id: AgentProviderKind | undefined) {
    updateModeProvider(mode, id);
    const cur: "code" | "text" = ca.mode === "text" ? "text" : "code";
    if ((mode === cur || mode === "default") && !ca.analysisResult && !ca.isLoading) {
      const next = { ...modeProviders };
      if (id) next[mode] = id; else delete next[mode];
      setProviderId(resolveModeProvider(next, cur));
    }
  }

  // #989 알림 클릭 → 워크스페이스로 전환(레포·터미널 탭은 WorkspaceTabs가 처리). 학습 화면에 있어도 이동.
  useEffect(() => {
    const nd = typeof window !== "undefined" ? window.nunopiDesktop : undefined;
    if (!nd?.onNotifyActivate) return;
    return nd.onNotifyActivate(() => {
      setViewMode("workspace");
      try { localStorage.setItem(VIEW_MODE_KEY, "workspace"); } catch { /* ignore */ } // handleViewModeChange와 같은 영속
    });
  }, []);

  function handleViewModeChange(next: ViewMode) {
    if (next === viewMode) return;
    // 암기 진입 시 직전 영역을 기억 → 돌아가기로 그 자리 복귀(#785). 암기→암기 재진입은 무시.
    if (next === "memorize" && viewMode !== "memorize") {
      memorizeOriginRef.current = viewMode;
      try { localStorage.setItem("nunopi:memorize-origin", viewMode); } catch { /* ignore */ }
    }
    if (next === "ask" || next === "code" || next === "text") lastQAViewRef.current = next;
    // nunopi 학습뷰(워크스페이스·암기 제외)면 마지막 학습뷰로 기억 → 브랜드 토글이 여기로 복원(#912).
    // 암기는 카드 없이 진입하면 빈 화면이라 착지 대상서 제외(진입은 +메뉴·워크스페이스 탭 경유).
    if (next !== "workspace" && next !== "memorize") {
      lastLearnViewRef.current = next;
      try { localStorage.setItem("nunopi:last-learn-view", next); } catch { /* ignore */ }
    }
    setViewMode(next);
    try { localStorage.setItem(VIEW_MODE_KEY, next); } catch { /* ignore */ }
    // 코드/글은 분석 모드와 연동(암기는 분석 상태 보존).
    if (next === "code" || next === "text") ca.handleModeChange(next);
  }
  const enterQAArea = () => handleViewModeChange(lastQAViewRef.current);
  // 브랜드 토글(#912): 워크스페이스 → 마지막 학습뷰 복원(없으면 history 기본).
  const enterNunopi = () => handleViewModeChange(lastLearnViewRef.current);

  function handleSettingsSave(next: ProviderSettings) {
    setProviderSettings(next);
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // 암기 카드 → 그 카드를 담은 분석 히스토리로 이동. 뷰 전환 + 엔트리 복원(훅).
  function handleGoToSource(sourceId: string, sessionId?: string) {
    const entry = historyEntries.find((e) => e.id === sourceId);
    if (!entry) return;
    handleViewModeChange((entry.mode ?? "code") === "text" ? "text" : "code");
    ca.restoreHistory(entry);
    if (sessionId) ca.openChatSession(entry, sessionId);
  }

  function handleGoToAskSource(sessionId: string, subId?: string, quizId?: string) {
    setAskGoTarget({ sessionId, subId, quizId, nonce: askGoNonceRef.current + 1 });
    askGoNonceRef.current += 1;
    handleViewModeChange("ask");
  }

  function handleGoToHistory(nav: HistoryNav) {
    if (nav.mode === "ask" && nav.sessionId) handleGoToAskSource(nav.sessionId, nav.subId, nav.quizId);
    else if ((nav.mode === "code" || nav.mode === "text") && nav.sourceId) handleGoToSource(nav.sourceId, nav.sessionId);
    else if (nav.mode === "memorize") {
      if (nav.cardKey) { setMemGoTarget({ cardKey: nav.cardKey, nonce: memGoNonceRef.current + 1 }); memGoNonceRef.current += 1; }
      handleViewModeChange("memorize");
    } else handleViewModeChange(nav.mode);
  }

  const currentEntry = historyEntries.find((e) => e.id === ca.currentHistoryId);
  const currentHistoryTitle = currentEntry?.title ?? (ca.analysisResult ? generateAutoTitle(ca.analysisResult, ca.code) : undefined);

  return (
    <AnalysisProvider value={shared}>
    <I18nProvider>
    <ConfirmProvider>
    <ToastProvider>
      <AppShell
        subToggleInMemorize
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogoClick={() => handleViewModeChange("history")}
        editorCollapsed={editorCollapsed}
        chatOpen={ca.chatOpen}
        windowMode={!!winKind}
        windowTitle={winKind ? `mode.${winKind}` : undefined}
        leftPanelCollapsed={vm === "ask" ? sessionCollapsed : editorCollapsed}
        onToggleLeftPanel={vm === "ask" ? toggleSessionCollapsed : toggleEditorCollapsed}
        showLeftPanelToggle={vm === "code" || vm === "text" || vm === "ask"}
        memorize={vm === "memorize"}
        memorizeView={<MemorizeView active={vm === "memorize"} providerId={resolveModeProvider(modeProviders, "memorize")} providerSettings={viewPs.memorize} sourceIds={new Set(historyEntries.map((e) => e.id))} onGoToSource={handleGoToSource} onGoToAskSource={handleGoToAskSource} goToCard={memGoTarget} />}
        ask={vm === "ask"}
        askView={<AskView active={vm === "ask"} providerId={resolveModeProvider(modeProviders, "ask")} providerSettings={viewPs.ask} goToTarget={askGoTarget} collapsed={sessionCollapsed} />}
        history={vm === "history"}
        historyView={<HistoryView active={vm === "history"} onNavigate={handleGoToHistory} providerId={resolveModeProvider(modeProviders, "history")} providerSettings={viewPs.history} />}
        workspace={vm === "workspace"}
        workspaceView={<WorkspaceTabs ref={wsRef} active={vm === "workspace"} providerId={resolveModeProvider(modeProviders, "default")} providerSettings={viewPs.default} onExitWorkspace={enterQAArea} onOpenMemorize={() => handleViewModeChange("memorize")} onOpenSettings={() => setIsSettingsOpen(true)} />}
        modeToggle={
          <ModeSwapToggle
            viewMode={vm}
            onEnterNunopi={enterNunopi}
            onEnterWorkspace={() => handleViewModeChange("workspace")}
            memorizeBadge={memorizeDue}
            disabled={ca.isLoading}
          />
        }
        subToggle={
          <QASubToggle
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            withCards // #1083 카드 갤러리 = nunopi 첫 화면
            disabled={ca.isLoading}
          />
        }
        learningPanel={
        <LearningPanel
          providerId={providerId}
          mode={ca.mode}
          isLoading={ca.isLoading}
          onResumePartial={ca.handleResume}
          progressLine={ca.progressLine}
          analysisStartedAt={ca.analysisStartedAt}
          elapsedMs={ca.lastElapsedMs}
          chunkProgress={ca.chunkProgress}
          errorMessage={ca.errorMessage}
          result={ca.analysisResult}
          code={ca.code}
          activeTermId={ca.activeTermId}
          activeLine={ca.activeLineLink?.line ?? null}
          activeLineSource={ca.activeLineLink?.source}
          onLineFocus={ca.focusLineFromPanel}
          onFillLine={ca.fillLine}
          fillModalLine={ca.fillModalLine}
          onCloseFillModal={ca.closeFillModal}
          fillErrorLine={ca.fillErrorLine}
          pinnedLine={currentEntry?.pinnedLine ?? null}
          onPinLine={ca.handlePinLine}
          onMarkLines={ca.setMarkedLines}
          excludedTerms={excludedTerms}
          onExclude={ca.handleExclude}
          onDeleteToken={ca.handleDeleteToken}
          explainingTokens={ca.explainingTokens}
          onTokenExplain={ca.handleTokenExplain}
          onConceptExplain={ca.handleConceptExplain}
          onDeleteConcept={ca.handleDeleteConcept}
          explainingConcepts={ca.explainingConcepts}
          historyEntries={historyEntries}
          onRestoreHistory={ca.restoreHistory}
          onDeleteHistory={ca.handleDeleteHistory}
          onClearHistory={ca.handleClearHistory}
          onUpdateHistory={ca.handleUpdateHistory}
          currentHistoryId={ca.currentHistoryId}
          currentHistoryTitle={currentHistoryTitle}
          currentHistoryIsPinned={currentEntry?.isPinned ?? false}
          onSetCurrentTitle={(title) => { if (ca.currentHistoryId) ca.handleUpdateHistory(ca.currentHistoryId, { title: title || undefined }); }}
          onToggleCurrentPin={() => { if (ca.currentHistoryId && currentEntry) ca.handleUpdateHistory(ca.currentHistoryId, { isPinned: !currentEntry.isPinned }); }}
          collections={ca.visibleCollections}
          activeCollectionId={ca.activeCollectionId}
          onSelectCollection={ca.setActiveCollectionId}
          onCreateCollection={ca.handleCreateCollection}
          onDeleteCollection={ca.handleDeleteCollection}
          onToggleEntryCollection={ca.handleToggleEntryCollection}
        />
      }
        editor={
          <EditorChatColumn
            chatOpen={ca.chatOpen}
            editorCollapsed={editorCollapsed}
            editor={
              ca.mode === "text" ? (
                <TextInputArea
                  code={ca.code}
                  isLoading={ca.isLoading}
                  onCodeChange={ca.handleCodeChange}
                  chatOpen={ca.chatOpen}
                  onToggleChat={() => ca.setChatOpen((v) => !v)}
                  locked={ca.analysisResult != null}
                  onClear={ca.handleClearInput}
                  terms={ca.analysisResult?.terms ?? []}
                  onTermClick={ca.setActiveTermId}
                  providerId={providerId}
                  onProviderChange={ca.handleProviderChange}
                  onAnalyze={ca.handleAnalyze}
                  onCancel={ca.handleCancel}
                  resumable={ca.resumable && ca.analysisResult != null}
                  onResume={ca.handleResume}
                  errorMessage={ca.errorMessage}
                />
              ) : (
                <CodeInputArea
                  code={ca.code}
                  isLoading={ca.isLoading}
                  languageChoice={ca.languageChoice}
                  editorLanguage={ca.editorLanguage}
                  onLanguageChoiceChange={ca.setLanguageChoice}
                  onCodeChange={ca.handleCodeChange}
                  activeLine={ca.activeLineLink?.line ?? null}
                  onLineClick={ca.focusLineFromEditor}
                  markedLines={ca.markedLines}
                  chatOpen={ca.chatOpen}
                  onToggleChat={() => ca.setChatOpen((v) => !v)}
                  locked={ca.analysisResult != null}
                  onClear={ca.handleClearInput}
                  providerId={providerId}
                  onProviderChange={ca.handleProviderChange}
                  onAnalyze={ca.handleAnalyze}
                  onCancel={ca.handleCancel}
                  resumable={ca.resumable && ca.analysisResult != null}
                  onResume={ca.handleResume}
                  errorMessage={ca.errorMessage}
                />
              )
            }
            chat={
              <ChatRoom
                messages={ca.activeMessages}
                streaming={ca.chatStreaming}
                isLoading={ca.chatLoading}
                disabled={!ca.code.trim()}
                mode={ca.mode === "text" ? "text" : "code"}
                onSend={ca.handleSendChat}
                onClear={ca.handleClearChat}
                sessionIds={ca.chatSessions.map((s) => s.id)}
                activeSessionId={ca.activeSessionIdResolved}
                onSwitchSession={ca.handleSwitchSession}
                onNewSession={ca.handleNewSession}
                onDeleteSession={ca.handleDeleteSession}
                onCardAction={ca.handleChatCardAction}
              />
            }
          />
        }
      />
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        variant={viewMode === "workspace" ? "modal" : "drawer"}
        settings={providerSettings}
        onSave={handleSettingsSave}
        excludedTerms={excludedTerms}
        onRemoveExclusion={ca.handleRemoveExclusion}
        theme={theme}
        onThemeChange={changeTheme}
        cardFlyAnimation={cardFlyAnimation}
        onCardFlyAnimationChange={changeCardFlyAnimation}
        modeProviders={modeProviders}
        onModeProviderChange={handleModeProviderChange}
        modeModels={modeModels}
        onModeModelChange={updateModeModel}
        nunopiEnabled={isNunopiEnabled()}
        onNunopiEnabledChange={(on) => { setNunopiEnabled(on); location.reload(); }}
      />
      <GlobalCommandPalette onNavigate={handleViewModeChange} onOpenSettings={() => setIsSettingsOpen(true)} vm={vm} workspaceRef={wsRef} />
    </ToastProvider>
    </ConfirmProvider>
    </I18nProvider>
    </AnalysisProvider>
  );
}

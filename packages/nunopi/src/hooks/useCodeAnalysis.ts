// 코드/글 분석 모드의 상태·핸들러·effect를 캡슐화한 훅(#773 서브3).
// page.tsx(독립 모드)와 CodeAnalysisView(워크스페이스 탭)가 같은 로직을 공유하되
// 인스턴스별 독립 상태를 갖게 한다. 공유 데이터(historyEntries·collections·excludedTerms·
// providerId 등, 다른 뷰와도 쓰임)는 소유자(page.tsx)가 파라미터로 주입한다.
// 로직은 page.tsx 원본에서 그대로 옮겼다 — 동작 불변(회귀 0 목표).
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createChatCard } from "@mustard/core";
import { removeSuggestedCard, stripCardBlock, type SuggestedCard } from "@mustard/core";
import { deckStats } from "../lib/srs/due";
import { detectLanguage } from "../lib/translator/detectLanguage";
import { type LanguageChoice } from "../components/translator/CodeInputArea";
import { MESSAGES } from "@mustard/core";
import { desktopNotify } from "@mustard/core";
import type { CodeToken } from "@mustard/core";
import type { AgentAnalyzeResponse, AgentProviderKind, AnalyzeMode, ChatMessage, ProviderSettings } from "../lib/agent";
import {
  type HistoryEntry,
  type ChatSession,
  saveToHistory,
  getAllHistory,
  updateHistory,
  deleteFromHistory,
  clearHistory,
  entryChatSessions,
  freshChatSessions,
  newSessionId,
} from "../lib/historyDB";
import { saveExclusions } from "../lib/exclusions";
import { type ModeModels, type ModeProviders, resolveModeModel, resolveModeProvider, withModel } from "../lib/modeProviders";
import { type Collection, saveCollections } from "../lib/collections";
import { translate } from "@mustard/core/messages";

const DEFAULT_CODE = `const [count, setCount] = useState(0);\n\nreturn <button className="px-4 py-2">{count}</button>;`;

// 토큰 카드 클릭/북마크 시 on-demand로 받는 뜻(#505/#509). 북마크 저장에 붙인다.
export type TokenMeaning = { label: string; description: string; example?: string };

type AnalyzeStreamEvent =
  | { type: "progress"; line: string }
  | { type: "thinking"; line: string }
  | { type: "partial"; providerId: AgentProviderKind; response: AgentAnalyzeResponse }
  | { type: "chunk-progress"; done: number; total: number }
  | { type: "result"; providerId: AgentProviderKind; response: AgentAnalyzeResponse }
  | { type: "error"; message: string };

interface AnalyzeApiErrorResponse {
  ok: false;
  error: {
    code: "INVALID_REQUEST" | "PROVIDER_NOT_FOUND" | "PROVIDER_FAILED";
    message: string;
    providerId?: string;
  };
}

export function generateAutoTitle(result: AgentAnalyzeResponse, code: string): string {
  // 1순위: 모델이 뽑은 핵심 명사구 제목. 길면 컷.
  if (result.title?.trim()) {
    const t = result.title.trim();
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  }
  // 2순위 폴백: 요약 앞부분(문장이라 핵심은 약하지만 제목 없을 때 최후).
  if (result.summary?.trim()) {
    const s = result.summary.trim();
    return s.length > 40 ? s.slice(0, 40) + "…" : s;
  }
  const firstLine = code.trim().split(/\r?\n/)[0] ?? "";
  const preview = firstLine.length > 28 ? firstLine.slice(0, 28) + "…" : firstLine;
  return `${result.language}: ${preview}`;
}

// 분석 출력 언어 — UI 언어(localStorage)와 동일. I18nProvider 바깥이라 직접 읽는다.
function getAnalysisLocale(): "ko" | "ja" | "en" {
  try {
    const l = localStorage.getItem("nunopi:locale");
    return l === "ja" || l === "en" ? l : "ko";
  } catch {
    return "ko";
  }
}

function formatFetchError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return translate(getAnalysisLocale(), "analyze.unknownError");
}

// 소유자(page.tsx)가 주입하는 공유 상태 — 다른 뷰(암기·기록·설정)와도 쓰이므로 훅이 소유하지 않는다.
export interface CodeAnalysisShared {
  historyEntries: HistoryEntry[];
  setHistoryEntries: Dispatch<SetStateAction<HistoryEntry[]>>;
  collections: Collection[];
  setCollections: Dispatch<SetStateAction<Collection[]>>;
  excludedTerms: string[];
  setExcludedTerms: Dispatch<SetStateAction<string[]>>;
  providerId: AgentProviderKind;
  setProviderId: Dispatch<SetStateAction<AgentProviderKind>>;
  providerSettings: ProviderSettings;
  setMemorizeDue: Dispatch<SetStateAction<number>>;
  // 모드별 provider(#985) — 코드/글 전환 시 그 모드 값, 드롭다운 변경은 그 모드에 저장.
  modeProviders: ModeProviders;
  setModeProvider: (mode: "code" | "text", id: AgentProviderKind) => void;
  modeModels: ModeModels; // #987 모드별 모델

}

export function useCodeAnalysis(shared: CodeAnalysisShared, initialMode: AnalyzeMode = "code") {
  const { historyEntries, setHistoryEntries, collections, setCollections, setExcludedTerms, providerId, setProviderId, providerSettings: baseProviderSettings, setMemorizeDue, modeProviders, setModeProvider, modeModels } = shared;

  // 분석 모드(코드/글). 모드별로 입력을 따로 유지해 토글해도 서로 안 지워지게 한다.
  const [mode, setMode] = useState<AnalyzeMode>(initialMode);
  // 요청 providerSettings = 기본 + 현재 모드 모델(#987). 히스토리 열기로 provider가 일시로 달라졌으면
  // 그 모드 모델은 다른 provider 것이라 안 넣는다(기본 모델로).
  const providerSettings = useMemo(() => {
    const m = mode === "text" ? "text" : "code";
    return resolveModeProvider(modeProviders, m) === providerId
      ? withModel(baseProviderSettings, providerId, resolveModeModel(modeProviders, modeModels, m))
      : baseProviderSettings;
  }, [mode, modeProviders, modeModels, providerId, baseProviderSettings]);
  const [codeInput, setCodeInput] = useState(DEFAULT_CODE);
  const [textInput, setTextInput] = useState("");
  const code = mode === "text" ? textInput : codeInput;
  const codeInputRef = useRef(codeInput);
  const textInputRef = useRef(textInput);
  const [isLoading, setIsLoading] = useState(false);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);
  const [resumable, setResumable] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AgentAnalyzeResponse | null>(null);
  const [historyIdState, setCurrentHistoryId] = useState<string | null>(null);
  const currentHistoryId = historyIdState;
  const [languageChoice, setLanguageChoice] = useState<LanguageChoice>("auto");
  const abortRef = useRef<AbortController | null>(null);
  const fillAbortRef = useRef<AbortController | null>(null);
  type AnalysisSnapshot = {
    providerId: AgentProviderKind; // #985 복귀 시 그 결과를 만든 provider로(히스토리 일시 변경 포함)
    analysisResult: AgentAnalyzeResponse | null;
    currentHistoryId: string | null;
    explainingTokens: string[];
    explainingConcepts: string[];
    chatSessions: ChatSession[];
    activeSessionId: string | null;
    chatStreaming: string | null;
    activeCollectionId: string | null;
    errorMessage: string | null;
    resumable: boolean;
    lastElapsedMs: number | null;
    chunkProgress: { done: number; total: number } | null;
  };
  const analysisSnapshotRef = useRef<Record<"code" | "text", AnalysisSnapshot | null>>({ code: null, text: null });
  const [progressLine, setProgressLine] = useState("");
  const [activeLineLink, setActiveLineLink] = useState<{ line: number; source: "editor" | "panel" } | null>(null);
  const focusLineFromEditor = (line: number) => setActiveLineLink({ line, source: "editor" });
  const focusLineFromPanel = (line: number) => setActiveLineLink({ line, source: "panel" });
  const [markedLines, setMarkedLines] = useState<number[]>([]);
  const [fillingLine, setFillingLine] = useState<number | null>(null);
  const [fillErrorLine, setFillErrorLine] = useState<number | null>(null);
  const [fillModalLine, setFillModalLine] = useState<number | null>(null);
  const [explainingTokens, setExplainingTokens] = useState<string[]>([]);
  const [explainingConcepts, setExplainingConcepts] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(freshChatSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatStreaming, setChatStreaming] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const activeSessionIdResolved = activeSessionId ?? chatSessions[0]?.id ?? null;
  const activeMessages = chatSessions.find((s) => s.id === activeSessionIdResolved)?.messages ?? [];
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

  const editorLanguage: string = useMemo(() => {
    if (languageChoice !== "auto") return languageChoice;
    const detected = detectLanguage(code).primary;
    return detected === "unknown" ? "typescript" : detected;
  }, [code, languageChoice]);

  // 접기 상태 복원.

  useEffect(() => { codeInputRef.current = codeInput; }, [codeInput]);
  useEffect(() => { textInputRef.current = textInput; }, [textInput]);

  // 현재 항목의 result 동기화 — on-demand 토큰·개념 append 반영.
  useEffect(() => {
    if (isLoading) return;
    if (!currentHistoryId || !analysisResult) return;
    const saved = analysisResult;
    updateHistory(currentHistoryId, { result: saved }).catch(() => {});
    setHistoryEntries((prev) => prev.map((e) => (e.id === currentHistoryId ? { ...e, result: saved } : e)));
  }, [analysisResult, currentHistoryId, isLoading, setHistoryEntries]);

  // 챗 세션 동기화.
  useEffect(() => {
    if (!currentHistoryId) return;
    const saved = chatSessions;
    const activeId = activeSessionIdResolved ?? undefined;
    updateHistory(currentHistoryId, { chatSessions: saved, activeChatSessionId: activeId }).catch(() => {});
    setHistoryEntries((prev) => prev.map((e) => (e.id === currentHistoryId ? { ...e, chatSessions: saved, activeChatSessionId: activeId } : e)));
  }, [chatSessions, activeSessionIdResolved, currentHistoryId, setHistoryEntries]);

  // 목록은 분석 모드별로 분리(코드/글).
  const collectionMode: "code" | "text" = mode === "text" ? "text" : "code";
  const visibleCollections = collections.filter((c) => (c.mode ?? "code") === collectionMode);

  function handleCreateCollection(name: string): string {
    const id = crypto.randomUUID();
    setCollections((prev) => {
      const next = [...prev, { id, name, createdAt: new Date().toISOString(), mode: collectionMode }];
      saveCollections(next);
      return next;
    });
    return id;
  }

  function handleDeleteCollection(id: string) {
    setCollections((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveCollections(next);
      return next;
    });
    setActiveCollectionId((cur) => (cur === id ? null : cur));
  }

  function handleToggleEntryCollection(entryId: string, collectionId: string) {
    const entry = historyEntries.find((e) => e.id === entryId);
    if (!entry) return;
    const current = entry.collectionIds ?? [];
    const next = current.includes(collectionId) ? current.filter((c) => c !== collectionId) : [...current, collectionId];
    updateHistory(entryId, { collectionIds: next }).catch(() => {});
    setHistoryEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, collectionIds: next } : e)));
  }

  function handleExclude(_targetMode: AnalyzeMode, text: string) {
    setExcludedTerms((prev) => {
      const next = prev.includes(text) ? prev : [...prev, text];
      saveExclusions("text", next);
      return next;
    });
  }

  function handleRemoveExclusion(_targetMode: AnalyzeMode, text: string) {
    setExcludedTerms((prev) => {
      const next = prev.filter((t) => t !== text);
      saveExclusions("text", next);
      return next;
    });
  }

  useEffect(() => {
    if (isLoading) {
      document.title = translate(getAnalysisLocale(), "docTitle.analyzing");
    } else if (errorMessage) {
      document.title = translate(getAnalysisLocale(), "docTitle.error");
    } else if (analysisResult) {
      document.title = translate(getAnalysisLocale(), "docTitle.done");
    } else {
      document.title = "Nunopi";
    }
  }, [isLoading, errorMessage, analysisResult]);


  function handleCodeChange(nextCode: string) {
    const current = mode === "text" ? textInputRef.current : codeInputRef.current;
    if (nextCode === current) return;
    if (mode === "text") setTextInput(nextCode);
    else setCodeInput(nextCode);
    if (errorMessage) setErrorMessage(null);
    if (analysisResult) {
      setAnalysisResult(null);
      setExplainingTokens([]);
      setExplainingConcepts([]);
      setChatSessions(freshChatSessions());
      setActiveSessionId(null);
      setChatStreaming(null);
    }
    setResumable(false);
    setCurrentHistoryId(null);
  }

  function handleModeChange(nextMode: "code" | "text") {
    if (nextMode === mode) return;
    if (chatLoading) return;
    const fromMode: "code" | "text" = mode === "text" ? "text" : "code";
    analysisSnapshotRef.current[fromMode] = {
      providerId, analysisResult, currentHistoryId, explainingTokens, explainingConcepts,
      chatSessions, activeSessionId, chatStreaming, activeCollectionId,
      errorMessage, resumable, lastElapsedMs, chunkProgress,
    };
    setMode(nextMode);
    const snap = analysisSnapshotRef.current[nextMode];
    // 결과가 있으면 그 결과를 만든 provider, 없으면 그 모드 설정값(설정 변경이 바로 반영되게).
    setProviderId(snap?.analysisResult ? snap.providerId : resolveModeProvider(modeProviders, nextMode));
    if (snap) {
      setAnalysisResult(snap.analysisResult);
      setCurrentHistoryId(snap.currentHistoryId);
      setExplainingTokens(snap.explainingTokens);
      setExplainingConcepts(snap.explainingConcepts);
      setChatSessions(snap.chatSessions);
      setActiveSessionId(snap.activeSessionId);
      setChatStreaming(snap.chatStreaming);
      setActiveCollectionId(snap.activeCollectionId);
      setErrorMessage(snap.errorMessage);
      setResumable(snap.resumable);
      setLastElapsedMs(snap.lastElapsedMs);
      setChunkProgress(snap.chunkProgress);
    } else {
      setErrorMessage(null);
      setAnalysisResult(null);
      setCurrentHistoryId(null);
      setExplainingTokens([]);
      setExplainingConcepts([]);
      setChatSessions(freshChatSessions());
      setActiveSessionId(null);
      setChatStreaming(null);
      setActiveCollectionId(null);
      setResumable(false);
      setLastElapsedMs(null);
      setChunkProgress(null);
    }
  }

  function handleProviderChange(nextProviderId: AgentProviderKind) {
    if (chatLoading) return;
    setProviderId(nextProviderId);
    setModeProvider(mode === "text" ? "text" : "code", nextProviderId); // #985 드롭다운 = 그 모드 설정 저장
    if (errorMessage) setErrorMessage(null);
    if (analysisResult) setAnalysisResult(null);
    setCurrentHistoryId(null);
    setChatSessions(freshChatSessions());
    setActiveSessionId(null);
    setChatStreaming(null);
  }

  function handleAnalyze() { void runAnalyze(); }
  function handleResume() { if (analysisResult) void runAnalyze(analysisResult); }

  async function runAnalyze(resumeFrom?: AgentAnalyzeResponse) {
    const nextCode = code.trim();
    if (!nextCode) {
      setErrorMessage(translate(getAnalysisLocale(), mode === "text" ? "analyze.needText" : "analyze.needCode"));
      setAnalysisResult(null);
      return;
    }
    if (isLoading) return;
    if (chatLoading) return;
    fillAbortRef.current?.abort();
    const startedAt = Date.now();
    setAnalysisStartedAt(startedAt);
    setLastElapsedMs(null);
    setResumable(false);
    setChunkProgress(null);
    setIsLoading(true);
    setErrorMessage(null);
    if (!resumeFrom) {
      setAnalysisResult(null);
      setCurrentHistoryId(null);
    }
    setActiveTermId(null);
    setProgressLine("");
    setExplainingTokens([]);
    setExplainingConcepts([]);
    if (!resumeFrom) {
      setChatSessions(freshChatSessions());
      setActiveSessionId(null);
      setChatStreaming(null);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const historyId: string | null = resumeFrom ? currentHistoryId : null;
    let lastPartial: AgentAnalyzeResponse | null = resumeFrom ?? null;
    try {
      const response = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          request: { code: nextCode, locale: getAnalysisLocale(), providerId, mode, providerSettings, ...(resumeFrom ? { resumeFrom } : {}) },
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as AnalyzeApiErrorResponse | null;
        setAnalysisResult(null);
        setErrorMessage(result?.ok === false ? result.error.message : translate(getAnalysisLocale(), "analyze.requestFailed"));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: AgentAnalyzeResponse | null = null;
      let streamError: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: AnalyzeStreamEvent;
          try { event = JSON.parse(line) as AnalyzeStreamEvent; } catch { continue; }
          if (event.type === "progress") setProgressLine(event.line);
          else if (event.type === "partial") { lastPartial = event.response; setAnalysisResult(event.response); }
          else if (event.type === "chunk-progress") setChunkProgress({ done: event.done, total: event.total });
          else if (event.type === "result") finalResult = event.response;
          else if (event.type === "error") streamError = event.message;
        }
      }
      if (streamError) {
        setAnalysisResult(null);
        setErrorMessage(streamError);
        return;
      }
      if (finalResult) {
        const saved = finalResult;
        setLastElapsedMs(Date.now() - startedAt);
        setResumable(false);
        setAnalysisResult(saved);
        {
          const loc = getAnalysisLocale();
          const nTitle = MESSAGES[loc][mode === "code" ? "notify.codeDone" : "notify.textDone"];
          const nBody = saved.title || saved.summary?.slice(0, 80) || "";
          desktopNotify({ title: nTitle, body: nBody }).catch(() => {});
        }
        if (resumeFrom) {
          const priorLines = new Set((resumeFrom.lineExplanations ?? []).map((l) => l.line));
          const filled = (saved.lineExplanations ?? []).map((l) => l.line).filter((l) => !priorLines.has(l));
          if (filled.length > 0) focusLineFromEditor(Math.min(...filled));
        }
        if (historyId) {
          const id = historyId;
          updateHistory(id, { result: saved, incomplete: false }).catch(() => {});
          setHistoryEntries((prev) => prev.map((e) => (e.id === id ? { ...e, result: saved, incomplete: false } : e)));
        } else {
          saveToHistory({
            code: nextCode, providerId, mode, result: saved, incomplete: false,
            title: generateAutoTitle(saved, nextCode), createdAt: new Date().toISOString(),
          }).then((savedId) => { setCurrentHistoryId(savedId); return getAllHistory(); }).then(setHistoryEntries).catch(() => {});
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setResumable(true);
        if (lastPartial) {
          const partial = lastPartial;
          if (historyId) {
            const id = historyId;
            updateHistory(id, { result: partial, incomplete: true }).catch(() => {});
            setHistoryEntries((prev) => prev.map((e) => (e.id === id ? { ...e, result: partial, incomplete: true } : e)));
          } else {
            saveToHistory({
              code: nextCode, providerId, mode, result: partial, incomplete: true,
              title: generateAutoTitle(partial, nextCode), createdAt: new Date().toISOString(),
            }).then((savedId) => { setCurrentHistoryId(savedId); return getAllHistory(); }).then(setHistoryEntries).catch(() => {});
          }
        }
      } else {
        setAnalysisResult(null);
        setErrorMessage(formatFetchError(error));
      }
    } finally {
      abortRef.current = null;
      setAnalysisStartedAt(null);
      setChunkProgress(null);
      setProgressLine("");
      setIsLoading(false);
    }
  }

  function handleCancel() { abortRef.current?.abort(); }

  // 누락 줄 채우기 모달 닫기(진행 요청 abort + 상태 리셋). LearningPanel onCloseFillModal에 전달.
  function closeFillModal() {
    fillAbortRef.current?.abort();
    setFillModalLine(null);
    setFillErrorLine(null);
    setFillingLine(null);
  }

  async function fillLine(line: number) {
    if (mode !== "code" || isLoading || fillingLine != null || !analysisResult) return;
    const codeLines = code.split(/\r?\n/);
    if (line < 1 || line > codeLines.length) return;
    const snippet = codeLines[line - 1];
    const controller = new AbortController();
    fillAbortRef.current = controller;
    setFillModalLine(line);
    setFillingLine(line);
    setFillErrorLine(null);
    try {
      const response = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: snippet, locale: getAnalysisLocale(), providerId, mode: "code", providerSettings, lineRange: { start: line, end: line } } }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) { setFillErrorLine(line); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", final: AgentAnalyzeResponse | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          let ev: AnalyzeStreamEvent;
          try { ev = JSON.parse(l) as AnalyzeStreamEvent; } catch { continue; }
          if (ev.type === "result") final = ev.response;
          else if (ev.type === "partial") final = ev.response;
        }
      }
      const first = (final?.lineExplanations ?? [])[0];
      if (!first || !first.explanation?.trim()) { setFillErrorLine(line); return; }
      const filled = { ...first, line, code: snippet };
      let nextResult: AgentAnalyzeResponse | null = null;
      setAnalysisResult((prev) => {
        if (!prev) return prev;
        if ((prev.lineExplanations ?? []).some((le) => le.line === line)) return prev;
        nextResult = { ...prev, lineExplanations: [...(prev.lineExplanations ?? []), filled].sort((a, b) => a.line - b.line) };
        return nextResult;
      });
      if (nextResult && currentHistoryId) {
        const id = currentHistoryId;
        updateHistory(id, { result: nextResult }).catch(() => {});
        setHistoryEntries((entries) => entries.map((e) => (e.id === id ? { ...e, result: nextResult! } : e)));
      }
      focusLineFromEditor(line);
      setFillModalLine(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") { setFillModalLine(null); return; }
      setFillErrorLine(line);
    } finally {
      if (fillAbortRef.current === controller) fillAbortRef.current = null;
      setFillingLine(null);
    }
  }

  async function handleTokenExplain(tokenText: string): Promise<TokenMeaning | null> {
    const existing = analysisResult?.tokens.find((t) => t.token === tokenText);
    if (existing?.description) return { label: existing.label, description: existing.description, example: existing.example };
    if (explainingTokens.includes(tokenText)) return null;
    const input = code.trim();
    if (!input) return null;
    setExplainingTokens((prev) => [...prev, tokenText]);
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: input, locale: getAnalysisLocale(), providerId, mode: "explain-token", targetToken: tokenText, providerSettings } }),
      });
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fetched: CodeToken | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try { const event = JSON.parse(l) as AnalyzeStreamEvent; if (event.type === "result") fetched = event.response.tokens?.[0]; } catch { /* skip */ }
        }
      }
      if (!fetched) return null;
      const targetHistoryId = currentHistoryId;
      let merged: AgentAnalyzeResponse | null = null;
      setAnalysisResult((prev) => {
        if (!prev || !prev.tokens.some((t) => t.token === tokenText)) return prev;
        merged = { ...prev, tokens: prev.tokens.map((t) => t.token === tokenText ? { ...t, label: fetched!.label, description: fetched!.description, example: fetched!.example } : t) };
        return merged;
      });
      if (merged && targetHistoryId) {
        const m = merged;
        updateHistory(targetHistoryId, { result: m }).catch(() => {});
        setHistoryEntries((prev) => prev.map((e) => (e.id === targetHistoryId ? { ...e, result: m } : e)));
      }
      return { label: fetched.label, description: fetched.description, example: fetched.example };
    } catch {
      return null;
    } finally {
      setExplainingTokens((prev) => prev.filter((t) => t !== tokenText));
    }
  }

  function handleDeleteToken(tokenText: string) {
    setAnalysisResult((prev) => prev ? { ...prev, tokens: prev.tokens.filter((t) => t.token !== tokenText) } : prev);
  }

  function appendToSession(sid: string, msg: ChatMessage) {
    setChatSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s)));
  }

  function handleSendChat(text: string) {
    if (chatLoading) return;
    const input = code.trim();
    const sid = activeSessionIdResolved;
    if (!sid) return;
    const activeMsgs = chatSessions.find((s) => s.id === sid)?.messages ?? [];
    appendToSession(sid, { role: "user", content: text });
    const otherMsgs = chatSessions.filter((s) => s.id !== sid).flatMap((s) => s.messages);
    const contextMessages: ChatMessage[] = [...otherMsgs, ...activeMsgs, { role: "user", content: text }];
    setChatStreaming("");
    setChatLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, request: { code: input || "(코드 없음)", locale: getAnalysisLocale(), providerId, mode: "chat", messages: contextMessages, providerSettings } }),
        });
        if (!res.ok || !res.body) { appendToSession(sid, { role: "assistant", content: translate(getAnalysisLocale(), "fallback.chatRequestFailed") }); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            try {
              const event = JSON.parse(l) as AnalyzeStreamEvent;
              if (event.type === "progress" && providerId !== "codex-agent") setChatStreaming(event.line);
              else if (event.type === "result") answer = event.response.summary;
            } catch { /* skip */ }
          }
        }
        appendToSession(sid, { role: "assistant", content: answer || translate(getAnalysisLocale(), "fallback.emptyResponse") });
      } catch {
        appendToSession(sid, { role: "assistant", content: translate(getAnalysisLocale(), "fallback.chatError") });
      } finally {
        setChatStreaming(null);
        setChatLoading(false);
      }
    })();
  }

  function handleClearChat() {
    const sid = activeSessionIdResolved;
    setChatSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, messages: [] } : s)));
    setChatStreaming(null);
  }

  function handleChatCardAction(messageIndex: number, action: { add?: SuggestedCard; dismiss?: boolean }): boolean {
    const sid = activeSessionIdResolved;
    if (!sid) return false;
    let created = false;
    if (action.add) {
      const kind = action.add.kind ?? (mode === "text" ? "term" : "concept");
      const title = historyEntries.find((e) => e.id === currentHistoryId)?.title ?? (analysisResult ? generateAutoTitle(analysisResult, code) : undefined);
      created = createChatCard(kind, action.add.term, action.add.definition, title, currentHistoryId ?? undefined, { kind: "analysis", sessionId: sid });
      setMemorizeDue(deckStats("all", new Date()).due);
    }
    const addedTerm = action.add?.term;
    setChatSessions((prev) => prev.map((s) => {
      if (s.id !== sid) return s;
      return { ...s, messages: s.messages.map((m, i) => i === messageIndex && m.role === "assistant" ? { ...m, content: addedTerm ? removeSuggestedCard(m.content, addedTerm) : stripCardBlock(m.content) } : m) };
    }));
    return created;
  }

  function handleNewSession() {
    if (chatLoading) return;
    const sess: ChatSession = { id: newSessionId(), messages: [] };
    setChatSessions((prev) => [...prev, sess]);
    setActiveSessionId(sess.id);
  }

  function handleSwitchSession(id: string) { setActiveSessionId(id); setChatStreaming(null); }

  function handleDeleteSession(id: string) {
    if (chatLoading) return;
    if (chatSessions.length <= 1) return;
    const next = chatSessions.filter((s) => s.id !== id);
    if (id === activeSessionIdResolved) setActiveSessionId(next[next.length - 1].id);
    setChatSessions(next);
    setChatStreaming(null);
  }

  function handleClearInput() {
    if (chatLoading) return;
    if (mode === "text") setTextInput("");
    else setCodeInput("");
    setAnalysisResult(null);
    setErrorMessage(null);
    setCurrentHistoryId(null);
    setChatSessions(freshChatSessions());
    setActiveSessionId(null);
    setChatStreaming(null);
    setExplainingTokens([]);
    setExplainingConcepts([]);
    setActiveLineLink(null);
    setMarkedLines([]);
    setActiveTermId(null);
  }

  function handleDeleteConcept(conceptId: string) {
    setAnalysisResult((prev) => prev ? { ...prev, concepts: prev.concepts.filter((c) => c.conceptId !== conceptId) } : prev);
  }

  async function handleConceptExplain(conceptId: string, title: string): Promise<string | null> {
    if (explainingConcepts.includes(conceptId)) return null;
    const existing = analysisResult?.concepts.find((c) => c.conceptId === conceptId);
    if (existing?.description) return existing.description;
    const input = code.trim();
    if (!input) return null;
    setExplainingConcepts((prev) => [...prev, conceptId]);
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: input, locale: getAnalysisLocale(), providerId, mode: "explain-concept", targetConcept: title, providerSettings } }),
      });
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let description: string | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try { const event = JSON.parse(l) as AnalyzeStreamEvent; if (event.type === "result") description = event.response.concepts?.[0]?.description; } catch { /* skip */ }
        }
      }
      if (!description) return null;
      const desc = description;
      const targetHistoryId = currentHistoryId;
      let merged: AgentAnalyzeResponse | null = null;
      setAnalysisResult((prev) => {
        if (!prev) return prev;
        merged = { ...prev, concepts: prev.concepts.map((c) => c.conceptId === conceptId ? { ...c, description: desc } : c) };
        return merged;
      });
      if (merged && targetHistoryId) {
        const m = merged;
        updateHistory(targetHistoryId, { result: m }).catch(() => {});
        setHistoryEntries((prev) => prev.map((e) => (e.id === targetHistoryId ? { ...e, result: m } : e)));
      }
      return desc;
    } catch {
      return null;
    } finally {
      setExplainingConcepts((prev) => prev.filter((x) => x !== conceptId));
    }
  }

  // 히스토리 항목 복원 — 외부(암기·기록 "출처로 가기")에서도 호출된다(page.tsx가 반환값을 씀).
  function restoreHistory(entry: HistoryEntry) {
    if (chatLoading) return;
    const entryMode = entry.mode ?? "code";
    setLastElapsedMs(null);
    setResumable(Boolean(entry.incomplete));
    setMode(entryMode);
    setExplainingTokens([]);
    setExplainingConcepts([]);
    setChatStreaming(null);
    const sessions = entryChatSessions(entry);
    setChatSessions(sessions);
    setActiveSessionId(entry.activeChatSessionId && sessions.some((s) => s.id === entry.activeChatSessionId) ? entry.activeChatSessionId : sessions[0].id);
    if (entryMode === "text") { textInputRef.current = entry.code; setTextInput(entry.code); }
    else { codeInputRef.current = entry.code; setCodeInput(entry.code); }
    setProviderId(entry.providerId);
    setAnalysisResult(entry.result);
    setErrorMessage(null);
    setActiveTermId(null);
    setActiveCollectionId(null);
    setCurrentHistoryId(entry.id);
    if (entryMode !== "text" && entry.pinnedLine != null) focusLineFromEditor(entry.pinnedLine);
  }

  // 챗 카드 → 그 챗 세션 활성화 + 챗 패널 열기(handleGoToSource 후속).
  function openChatSession(entry: HistoryEntry, sessionId: string) {
    const sessions = entryChatSessions(entry);
    if (sessions.some((s) => s.id === sessionId)) setActiveSessionId(sessionId);
    setChatOpen(true);
  }

  function handlePinLine(line: number) {
    if (!currentHistoryId) return;
    const id = currentHistoryId;
    const cur = historyEntries.find((e) => e.id === id)?.pinnedLine;
    const next = cur === line ? undefined : line;
    updateHistory(id, { pinnedLine: next }).catch(() => {});
    setHistoryEntries((prev) => prev.map((e) => (e.id === id ? { ...e, pinnedLine: next } : e)));
  }

  function handleDeleteHistory(id: string) {
    deleteFromHistory(id).then(() => getAllHistory()).then(setHistoryEntries).catch(() => {});
    if (id === currentHistoryId) handleClearInput(); // 지금 보고 있던 분석을 지웠으면 화면도 비운다.
  }

  function handleClearHistory() {
    // 현재 모드의 히스토리만 삭제하고 목록을 다시 읽어 다른 모드 항목은 보존.
    clearHistory(mode).then(() => getAllHistory()).then(setHistoryEntries).catch(() => {});
  }

  function handleUpdateHistory(id: string, changes: Partial<Pick<HistoryEntry, "isPinned" | "title">>) {
    updateHistory(id, changes).then(() => getAllHistory()).then(setHistoryEntries).catch(() => {});
  }

  return {
    // state
    mode, code, codeInput, textInput, isLoading, analysisStartedAt, lastElapsedMs, resumable, chunkProgress,
    errorMessage, analysisResult, currentHistoryId, languageChoice, editorLanguage, progressLine, activeLineLink,
    markedLines, fillingLine, fillErrorLine, fillModalLine, explainingTokens, explainingConcepts, chatOpen,
    chatSessions, activeSessionId, activeSessionIdResolved, activeMessages, chatStreaming,
    chatLoading, activeTermId, activeCollectionId, collectionMode, visibleCollections,
    // setters exposed for render wiring
    setChatOpen, setActiveTermId, setActiveCollectionId, setMarkedLines, setLanguageChoice, setCurrentHistoryId, setMode,
    // handlers
    focusLineFromEditor, focusLineFromPanel, handleCodeChange, handleModeChange,
    handleProviderChange, handleAnalyze, handleResume, runAnalyze, handleCancel, fillLine, handleTokenExplain,
    handleDeleteToken, handleSendChat, handleClearChat, handleChatCardAction, handleNewSession, handleSwitchSession,
    handleDeleteSession, handleClearInput, handleDeleteConcept, handleConceptExplain, restoreHistory, openChatSession,
    handlePinLine, handleCreateCollection, handleDeleteCollection, handleToggleEntryCollection, handleExclude,
    handleRemoveExclusion, closeFillModal, handleDeleteHistory, handleClearHistory, handleUpdateHistory,
  };
}

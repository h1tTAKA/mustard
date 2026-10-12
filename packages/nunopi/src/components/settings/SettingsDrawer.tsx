import { Fragment, useState, useEffect, useCallback } from "react";
import type { AgentProviderKind, AnalyzeMode, ProviderSettings } from "@mustard/core";
import { PROVIDER_CATALOG } from "../../lib/agent/catalog";
import { type LearnProviderMode, type ModeModels, type ModeProviders, LEARN_PROVIDER_MODES, resolveModeModel, resolveModeProvider } from "../../lib/modeProviders";
import { XIcon } from "../learning/icons";
import ShortcutsSection from "./ShortcutsSection";
import { IconKeyboard, IconArrowLeft, IconPalette, IconLanguage, IconRobot, IconSparkles, IconTerminal2, IconChevronDown, IconBell, IconShieldHalf, IconFolder, IconGitBranch, IconPlug, IconBrandGithub, IconLoader2, IconBrandGitlab, IconBrandBitbucket, IconBrandAzure, IconActivity } from "@tabler/icons-react";
import { useSetting, setSetting, TKEYS, TERMINAL_DEFAULTS, type TerminalCursorStyle, AKEYS, AGENT_DEFAULTS, NKEYS, NOTIF_DEFAULTS, CKEYS, CONFIRM_DEFAULTS, APKEYS, APPEARANCE_DEFAULTS, type UiFontPref, applyUiZoom, applyUiFont, WKEYS, WORKSPACE_DEFAULTS, GKEYS, GIT_DEFAULTS, CUKEYS, CATCHUP_DEFAULTS } from "@mustard/core";
// 에이전트 런치(#927) — 기본 에이전트 후보. AGENT_META/AgentLogo는 apps 소유(패키지 경계)라 여기선 id 목록만.
const LAUNCH_AGENTS = ["claude", "codex", "grok", "opencode", "omp", "antigravity", "cursor", "hermes"];
const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", grok: "Grok", opencode: "OpenCode", omp: "OMP", antigravity: "Antigravity", cursor: "Cursor", hermes: "Hermes" };
import { useLocale, useT, useToast } from "@mustard/core";
import { LOCALES, type Locale } from "@mustard/core";
import { THEMES, type ThemeId } from "@mustard/core";
import { type TerminalThemePref, getTerminalThemePref, setTerminalThemePref } from "@mustard/core";
// 테마 미리보기 스와치(배경/도트) — 피커 버튼용. 실제 색은 globals.css [data-theme] 블록서 온다.
const THEME_SWATCH: Record<ThemeId, { bg: string; dot: string }> = {
  dark: { bg: "#111219", dot: "#d4a017" },
  light: { bg: "#ffffff", dot: "#d4a017" },
  sepia: { bg: "#f4ecd8", dot: "#a67c11" },
  midnight: { bg: "#0b1020", dot: "#9aa8c8" },
  nord: { bg: "#2e3440", dot: "#88c0d0" },
  "solarized-light": { bg: "#fdf6e3", dot: "#b58900" },
  "solarized-dark": { bg: "#002b36", dot: "#2aa198" },
};
interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: "drawer" | "modal"; // drawer=우측 슬라이드(기본), modal=중앙 팝업(워크스페이스, #752)
  settings: ProviderSettings;
  onSave: (next: ProviderSettings) => void;
  excludedTerms?: string[];
  onRemoveExclusion?: (mode: AnalyzeMode, text: string) => void;
  theme: ThemeId;
  onThemeChange: (next: ThemeId) => void;
  // 학습 전용 설정 노출 여부(#896 서브6). false=Mustard-only → 카드애니·암기provider·제외용어 숨김.
  showLearning?: boolean;
  // 카드보기 날아오는 애니메이션 on/off (#641). 학습 전용(showLearning=false면 미사용).
  cardFlyAnimation?: boolean;
  onCardFlyAnimationChange?: (next: boolean) => void;
  // 학습모듈 모드별 provider(#985). id undefined = 기본값 따라감. 학습 전용.
  modeProviders?: ModeProviders;
  onModeProviderChange?: (mode: LearnProviderMode | "default", id: AgentProviderKind | undefined) => void;
  // 모드별 모델(#987). model undefined = 그 provider 기본 모델.
  modeModels?: ModeModels;
  onModeModelChange?: (mode: LearnProviderMode | "default", model: string | undefined) => void;
  // nunopi 학습 모듈 설치/사용 토글(#924) — 온보딩 외 설정서도. 핸들러 있으면 nunopi 섹션 노출.
  // apps/mustard는 isNunopiEnabled/setNunopiEnabled 주입(변경 시 reload로 게이트 반영). apps/nunopi 스탠드얼론은 미주입.
  nunopiEnabled?: boolean;
  onNunopiEnabledChange?: (on: boolean) => void;
}

// 연동(#960) 브랜드 로고 — tabler 부실해 공식 로고 SVG 인라인(CSP상 외부 로드 불가). tabler 아이콘과 동일 시그니처(size/className).
function VercelLogo({ size = 18, className = "" }: { size?: number; className?: string; stroke?: number }) {
  return <svg width={size} height={size} viewBox="0 0 1155 1000" className={className} aria-hidden><path d="M577.3 0 1155 1000H0z" fill="currentColor" /></svg>;
}
function SupabaseLogo({ size = 18, className = "" }: { size?: number; className?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 109 113" className={className} fill="none" aria-hidden>
      <path d="M63.7 110.3c-2.8 3.5-8.5 1.6-8.6-2.9L53.8 40h30.4c8.2 0 12.8 9.5 7.7 15.9l-28.2 54.4z" fill="#3ECF8E" />
      <path d="M45.3 2.6c2.8-3.5 8.5-1.6 8.6 2.9l.6 67.4H24.7c-8.2 0-12.8-9.5-7.7-15.9L45.3 2.6z" fill="#3ECF8E" fillOpacity="0.5" />
    </svg>
  );
}

// 제외 그룹 1개(코드 토큰 / IT 용어) — 칩 + ✕ 해제.
function ExclusionGroup({
  label,
  items,
  onRemove,
}: {
  label: string;
  items: string[];
  onRemove: (text: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {label} ({items.length})
      </span>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.excludeEmpty")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((text) => (
            <span
              key={text}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <code className="font-mono">{text}</code>
              <button
                type="button"
                onClick={() => onRemove(text)}
                className="text-zinc-400 transition hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                title="제외 해제"
                aria-label={`${text} 제외 해제`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsDrawer({
  isOpen,
  onClose,
  variant = "drawer",
  settings,
  onSave,
  excludedTerms = [],
  onRemoveExclusion,
  theme,
  onThemeChange,
  showLearning = true,
  cardFlyAnimation = true,
  onCardFlyAnimationChange,
  modeProviders = {},
  onModeProviderChange,
  modeModels = {},
  onModeModelChange,
  nunopiEnabled,
  onNunopiEnabledChange,
}: SettingsDrawerProps) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const toast = useToast();
  // 테스트 알림(#928) — 결과를 토스트로 피드백(OS가 조용히 드롭해도 전송 여부/사유 확인).
  const sendTestNotif = async () => {
    const nd = typeof window !== "undefined" ? window.nunopiDesktop : undefined;
    if (!nd?.notify) { toast(t("settings.notifTestNoDesktop"), "error"); return; }
    try {
      const r = await nd.notify({ title: t("settings.notifTestTitle"), body: t("settings.notifTestBody"), suppressWhileFocused: false });
      if (r?.ok) toast(t("settings.notifTestSent"), "success");
      else toast(t("settings.notifTestFailed") + (r?.reason ? ` (${r.reason})` : ""), "error");
    } catch { toast(t("settings.notifTestFailed"), "error"); }
  };
  // 터미널 테마(#914) — 앱 테마와 분리. getTerminalThemePref는 localStorage try/catch라 SSR 안전.
  const [termPref, setTermPref] = useState<TerminalThemePref>(() => getTerminalThemePref());
  const changeTermPref = (p: TerminalThemePref) => { setTermPref(p); setTerminalThemePref(p); };
  const [activeSection, setActiveSection] = useState("set-appearance"); // 좌측 선택 = 우측 그 섹션만 렌더(#925). 훅은 early-return 위에.
  // 모델 목록(#987) — nunopi 섹션 열릴 때 쓰이는 provider만 /api/agent/models로 1회 조회(세션 내 캐시).
  type ModelList = { models: { id: string; label: string; latest?: boolean }[]; defaultModel: string } | "loading" | "error";
  const [modelLists, setModelLists] = useState<Partial<Record<AgentProviderKind, ModelList>>>({});
  const usedProviders = [...new Set((["default", ...LEARN_PROVIDER_MODES] as const).map((m) => resolveModeProvider(modeProviders, m)))].sort().join(",");
  useEffect(() => {
    if (activeSection !== "set-nunopi" || !showLearning || !onModeModelChange) return;
    for (const p of usedProviders.split(",") as AgentProviderKind[]) {
      if (modelLists[p]) continue;
      setModelLists((prev) => ({ ...prev, [p]: "loading" }));
      fetch(`/api/agent/models?providerId=${encodeURIComponent(p)}`)
        .then((r) => r.json())
        .then((j) => setModelLists((prev) => ({ ...prev, [p]: j?.ok ? { models: j.models, defaultModel: j.defaultModel } : "error" })))
        .catch(() => setModelLists((prev) => ({ ...prev, [p]: "error" })));
    }
    // modelLists는 캐시 확인용 — 넣으면 loading 세팅마다 재실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, showLearning, onModeModelChange, usedProviders]);
  // 터미널 설정(#926) — useSetting으로 구독(변경 즉시 반영). 모든 훅은 early-return 위.
  const tFontSize = useSetting<number>(TKEYS.fontSize, TERMINAL_DEFAULTS.fontSize);
  const tFontFamily = useSetting<string>(TKEYS.fontFamily, TERMINAL_DEFAULTS.fontFamily);
  const tLineHeight = useSetting<number>(TKEYS.lineHeight, TERMINAL_DEFAULTS.lineHeight);
  const tCursorStyle = useSetting<TerminalCursorStyle>(TKEYS.cursorStyle, TERMINAL_DEFAULTS.cursorStyle);
  const tCursorBlink = useSetting<boolean>(TKEYS.cursorBlink, TERMINAL_DEFAULTS.cursorBlink);
  const tScrollback = useSetting<number>(TKEYS.scrollback, TERMINAL_DEFAULTS.scrollback);
  const tCopyOnSelect = useSetting<boolean>(TKEYS.copyOnSelect, TERMINAL_DEFAULTS.copyOnSelect);
  const tRightClickPaste = useSetting<boolean>(TKEYS.rightClickPaste, TERMINAL_DEFAULTS.rightClickPaste);
  const tGpu = useSetting<boolean>(TKEYS.gpu, TERMINAL_DEFAULTS.gpu);
  // 터미널 심화(#941)
  const tFontWeight = useSetting<string>(TKEYS.fontWeight, TERMINAL_DEFAULTS.fontWeight);
  const tScrollSensitivity = useSetting<number>(TKEYS.scrollSensitivity, TERMINAL_DEFAULTS.scrollSensitivity);
  const tMacOptionIsMeta = useSetting<boolean>(TKEYS.macOptionIsMeta, TERMINAL_DEFAULTS.macOptionIsMeta);
  const tFocusFollowsMouse = useSetting<boolean>(TKEYS.focusFollowsMouse, TERMINAL_DEFAULTS.focusFollowsMouse);
  // 에이전트 런치(#927)
  const aDefault = useSetting<string>(AKEYS.default, AGENT_DEFAULTS.default);
  const aArgsClaude = useSetting<string>(AKEYS.args("claude"), "");
  const aArgsCodex = useSetting<string>(AKEYS.args("codex"), "");
  const aArgsOpencode = useSetting<string>(AKEYS.args("opencode"), "");
  // 알림(#928)
  const nAgentDone = useSetting<boolean>(NKEYS.agentDone, NOTIF_DEFAULTS.agentDone);
  const nSuppress = useSetting<boolean>(NKEYS.suppressWhileWatching, NOTIF_DEFAULTS.suppressWhileWatching);
  const nMaster = useSetting<boolean>(NKEYS.master, NOTIF_DEFAULTS.master);   // #939
  const nSilent = useSetting<boolean>(NKEYS.silent, NOTIF_DEFAULTS.silent);   // #939
  const wDefaultFolder = useSetting<string>(WKEYS.defaultFolder, WORKSPACE_DEFAULTS.defaultFolder); // #939
  // git/소스컨트롤(#954)
  const gPrBase = useSetting<string>(GKEYS.prBaseDefault, GIT_DEFAULTS.prBaseDefault);
  const gPrDraft = useSetting<boolean>(GKEYS.prDraftDefault, GIT_DEFAULTS.prDraftDefault);
  const gAutoFetch = useSetting<boolean>(GKEYS.autoFetch, GIT_DEFAULTS.autoFetch);
  const gAutoExplain = useSetting<boolean>(GKEYS.autoExplainCommits, GIT_DEFAULTS.autoExplainCommits); // #1054
  const cuCommands = useSetting<boolean>(CUKEYS.commands, CATCHUP_DEFAULTS.commands); // #1049
  const cuTerms = useSetting<boolean>(CUKEYS.terms, CATCHUP_DEFAULTS.terms);
  const gBranchPrefix = useSetting<string>(GKEYS.branchPrefix, GIT_DEFAULTS.branchPrefix);
  // 연동(#958) — GitHub gh auth 상태 + PAT.
  const [ghAuth, setGhAuth] = useState<{ state: string; detail?: string } | null>(null);
  const [ghChecking, setGhChecking] = useState(false);
  const [ghHasToken, setGhHasToken] = useState(false);
  const [ghToken, setGhToken] = useState("");
  // 연동 확장(#960) — GitLab glab 상태 + bitbucket/azure 토큰.
  const [glabAuth, setGlabAuth] = useState<{ state: string; detail?: string } | null>(null);
  const [btToken, setBtToken] = useState("");
  const [btHasToken, setBtHasToken] = useState(false);
  const [azToken, setAzToken] = useState("");
  const [azHasToken, setAzHasToken] = useState(false);
  const [vcToken, setVcToken] = useState("");
  const [vcHasToken, setVcHasToken] = useState(false);
  const [sbToken, setSbToken] = useState("");
  const [sbHasToken, setSbHasToken] = useState(false);
  const refreshGh = useCallback(async () => {
    const nd = typeof window !== "undefined" ? window.nunopiDesktop : undefined;
    const gh = nd?.github; const int = nd?.integrations;
    if (gh?.auth) {
      setGhChecking(true);
      try {
        const a = await gh.auth(""); setGhAuth(a);
        if (gh.tokenStatus) { const ts = await gh.tokenStatus(); setGhHasToken(ts.hasToken); }
      } catch { setGhAuth({ state: "error" }); }
      finally { setGhChecking(false); }
    }
    if (int?.glabStatus) { try { setGlabAuth(await int.glabStatus()); } catch { setGlabAuth({ state: "error" }); } }
    if (int?.tokenStatus) {
      try { setBtHasToken((await int.tokenStatus("bitbucket")).hasToken); } catch { /* ignore */ }
      try { setAzHasToken((await int.tokenStatus("azure")).hasToken); } catch { /* ignore */ }
      try { setVcHasToken((await int.tokenStatus("vercel")).hasToken); } catch { /* ignore */ }
      try { setSbHasToken((await int.tokenStatus("supabase")).hasToken); } catch { /* ignore */ }
    }
  }, []);
  useEffect(() => { if (isOpen) void refreshGh(); }, [isOpen, refreshGh]);
  // 확인 다이얼로그(#929)
  const cSkipDelete = useSetting<boolean>(CKEYS.skipDelete, CONFIRM_DEFAULTS.skipDelete);
  const cSkipCloseTab = useSetting<boolean>(CKEYS.skipCloseTab, CONFIRM_DEFAULTS.skipCloseTab);
  const cConfirmCloseTerminal = useSetting<boolean>(CKEYS.confirmCloseTerminal, CONFIRM_DEFAULTS.confirmCloseTerminal);
  // 외관(#937)
  const apZoom = useSetting<number>(APKEYS.uiZoom, APPEARANCE_DEFAULTS.uiZoom);
  const apFont = useSetting<UiFontPref>(APKEYS.uiFont, APPEARANCE_DEFAULTS.uiFont);
  const [baseUrl, setBaseUrl] = useState(
    settings["openai-compatible"]?.baseUrl ?? "http://localhost:11434/v1",
  );
  const [model, setModel] = useState(
    settings["openai-compatible"]?.model ?? "hermes-3",
  );
  const [apiKey, setApiKey] = useState(
    settings["openai-compatible"]?.apiKey ?? "",
  );
  const [claudeCliPath, setClaudeCliPath] = useState(
    settings["claude-agent"]?.cliPath ?? "",
  );
  const [codexCliPath, setCodexCliPath] = useState(
    settings["codex-agent"]?.cliPath ?? "",
  );
  const [openCodeCliPath, setOpenCodeCliPath] = useState(
    settings["opencode-agent"]?.cliPath ?? "",
  );
  const desktop = typeof window !== "undefined" ? window.nunopiDesktop : undefined;

  if (!isOpen) return null;

  // orca식 즉시 적용(#924) — 저장 버튼 없이 입력 blur 시 자동 반영. onClose 호출 안 함.
  function handleSave() {
    onSave({
      "openai-compatible": {
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      },
      "claude-agent": {
        cliPath: claudeCliPath.trim() || undefined,
      },
      "codex-agent": {
        cliPath: codexCliPath.trim() || undefined,
      },
      "opencode-agent": {
        cliPath: openCodeCliPath.trim() || undefined,
      },
    });
    // 데스크톱: 런타임 서버(main 소유)가 재시작 시 읽는 userData에도 영속(재시작 후 적용).
    desktop?.setRuntimePaths({
      claudeCode: claudeCliPath.trim() || undefined,
      codex: codexCliPath.trim() || undefined,
      opencode: openCodeCliPath.trim() || undefined,
    }).catch((e) => console.warn("[settings] desktop runtime-paths save failed:", e));
  }

  // orca식 풀페이지 설정(#925) — 좌측 섹션 사이드바(스크롤 앵커) + 우측 내용. variant는 이제 무시(항상 풀페이지).
  // 좌측 nav 그룹(#983) — 순서 = 그룹 순서. 그룹 첫 항목 위에 헤더.
  const SECTIONS: { id: string; label: string; Icon: typeof IconPalette; show: boolean; group: string }[] = [
    { id: "set-appearance", label: t("settings.screen"), Icon: IconPalette, show: true, group: t("settings.groupGeneral") },
    { id: "set-language", label: t("settings.language"), Icon: IconLanguage, show: true, group: t("settings.groupGeneral") },
    { id: "set-notifications", label: t("settings.notifications"), Icon: IconBell, show: true, group: t("settings.groupGeneral") },
    { id: "set-confirm", label: t("settings.confirmations"), Icon: IconShieldHalf, show: true, group: t("settings.groupGeneral") },
    { id: "set-terminal", label: t("settings.terminalSection"), Icon: IconTerminal2, show: true, group: t("settings.groupEnvironment") },
    { id: "set-workspace", label: t("settings.workspaceSection"), Icon: IconFolder, show: true, group: t("settings.groupEnvironment") },
    { id: "set-git", label: t("settings.gitSection"), Icon: IconGitBranch, show: true, group: t("settings.groupEnvironment") },
    { id: "set-shortcuts", label: t("settings.shortcutsSection"), Icon: IconKeyboard, show: true, group: t("settings.groupEnvironment") }, // #1027
    { id: "set-agents", label: t("settings.provider"), Icon: IconRobot, show: true, group: t("settings.groupAgents") },
    { id: "set-catchup", label: t("settings.catchupSection"), Icon: IconActivity, show: true, group: t("settings.groupAgents") }, // #1049
    { id: "set-integrations", label: t("settings.integrations"), Icon: IconPlug, show: true, group: t("settings.groupAgents") },
    { id: "set-nunopi", label: t("settings.nunopiModule"), Icon: IconSparkles, show: !!onNunopiEnabledChange, group: t("settings.groupAgents") },
  ];
  // 외관(#937) — 즉시 적용(저장 + 실제 반영).
  const setZoom = (v: number) => { const z = Math.min(1.4, Math.max(0.8, Math.round(v * 10) / 10)); setSetting(APKEYS.uiZoom, z); applyUiZoom(z); };
  const setFont = (f: UiFontPref) => { setSetting(APKEYS.uiFont, f); applyUiFont(f); };
  // 연동(#958) — PAT 저장/삭제 후 상태 재확인.
  const saveGhToken = async () => {
    const gh = typeof window !== "undefined" ? window.nunopiDesktop?.github : undefined;
    if (!gh?.setToken || !ghToken.trim()) return;
    const r = await gh.setToken(ghToken.trim());
    if (r.ok) { toast(t("settings.ghPatSaved"), "success"); setGhToken(""); void refreshGh(); }
    else toast(t("settings.ghPatFailed") + (r.detail ? ` (${r.detail})` : ""), "error");
  };
  const clearGhToken = async () => {
    const gh = typeof window !== "undefined" ? window.nunopiDesktop?.github : undefined;
    if (!gh?.clearToken) return;
    await gh.clearToken(); toast(t("settings.ghPatCleared"), "success"); void refreshGh();
  };
  // 연동 확장(#960) — host별 토큰 저장/삭제.
  const saveHostToken = async (host: "bitbucket" | "azure" | "vercel" | "supabase", token: string, reset: () => void) => {
    const int = typeof window !== "undefined" ? window.nunopiDesktop?.integrations : undefined;
    if (!int?.setToken || !token.trim()) return;
    const r = await int.setToken(host, token.trim());
    if (r.ok) { toast(t("settings.ghPatSaved"), "success"); reset(); void refreshGh(); }
    else toast(t("settings.ghPatFailed") + (r.detail ? ` (${r.detail})` : ""), "error");
  };
  const clearHostToken = async (host: "bitbucket" | "azure" | "vercel" | "supabase") => {
    const int = typeof window !== "undefined" ? window.nunopiDesktop?.integrations : undefined;
    if (!int?.clearToken) return;
    await int.clearToken(host); toast(t("settings.ghPatCleared"), "success"); void refreshGh();
  };
  // 워크스페이스 기본 폴더 선택(#939) — OS 폴더 창서 고른 경로 저장.
  const pickDefaultFolder = async () => {
    const nd = typeof window !== "undefined" ? window.nunopiDesktop : undefined;
    if (!nd?.pickRepoFolder) return;
    const r = await nd.pickRepoFolder({ defaultPath: wDefaultFolder || undefined });
    if (!r.canceled && r.path) setSetting(WKEYS.defaultFolder, r.path);
  };
  void variant;
  return (
    <div className="fixed inset-0 z-[90] flex bg-white text-zinc-900 dark:bg-[var(--ink)] dark:text-zinc-100">
      {/* 좌측 섹션 사이드바 — 상단 titlebar 공간(pt) 확보(macOS 신호등 버튼 겹침 방지) + 창 이동 드래그. */}
      <nav className="titlebar-drag flex w-56 shrink-0 flex-col gap-0.5 border-r border-zinc-200 px-3 pb-3 pt-10 dark:border-zinc-800">
        <button type="button" onClick={onClose} className="mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          <IconArrowLeft size={16} stroke={2} aria-hidden /> {t("settings.backToApp")}
        </button>
        {SECTIONS.filter((s) => s.show).map((s, i, arr) => {
          const on = activeSection === s.id;
          const header = i === 0 || arr[i - 1].group !== s.group;
          return (
            <Fragment key={s.id}>
            {header && (
              <div className={`px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 ${i === 0 ? "pt-1" : "pt-4"}`}>{s.group}</div>
            )}
            <button type="button" aria-current={on} onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition ${on ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"}`}>
              <s.Icon size={16} stroke={1.75} className={`shrink-0 ${on ? "text-mustard-500" : "text-zinc-400 dark:text-zinc-500"}`} aria-hidden /> {s.label}
            </button>
            </Fragment>
          );
        })}
      </nav>
      {/* 우측 내용 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t("settings.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label={t("settings.close")}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* 내용 폭 제한(#983) — 넓은 창서 카드가 끝까지 늘어나지 않게 가운데 정렬. */}
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {/* 섹션 제목(#983) — 카드 밖 페이지 제목. 카드 안 중복 h3는 제거(하위 카드 제목은 유지). */}
          <h2 className="pb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {SECTIONS.find((s) => s.id === activeSection)?.label}
          </h2>
          {/* 화면 카드 */}
          {activeSection === "set-appearance" && (
          <section id="set-appearance" className="scroll-mt-4 space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.theme")}</span>
              <div role="radiogroup" aria-label={t("settings.theme")} className="grid grid-cols-2 gap-1.5">
                {THEMES.map((opt) => {
                  const selected = theme === opt.id;
                  const sw = THEME_SWATCH[opt.id];
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => onThemeChange(opt.id)}
                      className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[13px] font-medium transition ${
                        selected
                          ? "border-mustard-500 bg-mustard-500/10 text-zinc-900 dark:text-zinc-50"
                          : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600"
                      }`}
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-black/10 dark:border-white/10"
                        style={{ background: sw.bg }}
                        aria-hidden
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: sw.dot }} />
                      </span>
                      <span className="min-w-0 truncate">{t(opt.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* UI 줌(#937) */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.uiZoom")}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setZoom(apZoom - 0.1)} aria-label={t("settings.uiZoomOut")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">−</button>
                <span className="min-w-[3.5rem] text-center text-sm tabular-nums text-zinc-700 dark:text-zinc-200">{Math.round(apZoom * 100)}%</span>
                <button type="button" onClick={() => setZoom(apZoom + 0.1)} aria-label={t("settings.uiZoomIn")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">＋</button>
                <button type="button" onClick={() => setZoom(1)}
                  className="ml-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-[13px] text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t("settings.reset")}</button>
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.uiZoomDesc")}</p>
            </div>
            {/* UI 폰트(#937) */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.uiFont")}</span>
              <div className="relative">
                <select value={apFont} onChange={(e) => setFont(e.target.value as UiFontPref)}
                  className="w-full appearance-none rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 pr-9 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                  <option value="default">{t("settings.uiFontDefault")}</option>
                  <option value="system">{t("settings.uiFontSystem")}</option>
                  <option value="mono">{t("settings.uiFontMono")}</option>
                </select>
                <IconChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
              </div>
            </div>
          </section>
          )}

          {/* 언어 카드 */}
          {activeSection === "set-language" && (
          <section id="set-language" className="scroll-mt-4 space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="relative">
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                aria-label="언어 선택"
                className="w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 pr-9 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              >
                {LOCALES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <IconChevronDown size={16} stroke={2} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
            </div>
          </section>
          )}

          {/* 터미널 설정 카드(#926) — 폰트·커서·스크롤백·클립보드·GPU */}
          {activeSection === "set-terminal" && (
          <section id="set-terminal" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            {/* 터미널 테마(#914) — 앱 테마와 분리(CLI TUI가 다크 전제라 기본 auto). */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalTheme")}</span>
              <div role="radiogroup" aria-label={t("settings.terminalTheme")} className="inline-flex w-full rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                {([
                  { value: "dark", label: t("settings.dark") },
                  { value: "gray", label: t("settings.gray") },
                  { value: "light", label: t("settings.light") },
                  { value: "auto", label: t("settings.themeAuto") },
                ] as const).map((opt) => {
                  const selected = termPref === opt.value;
                  return (
                    <button key={opt.value} type="button" role="radio" aria-checked={selected}
                      onClick={() => changeTermPref(opt.value)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        selected
                          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                          : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 폰트 크기 */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalFontSize")}</span>
              <input type="number" min={9} max={28} value={tFontSize}
                onChange={(e) => setSetting(TKEYS.fontSize, Math.min(28, Math.max(9, Number(e.target.value) || TERMINAL_DEFAULTS.fontSize)))}
                className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </div>
            {/* 폰트 패밀리 */}
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalFontFamily")}</span>
              <input type="text" value={tFontFamily} onChange={(e) => setSetting(TKEYS.fontFamily, e.target.value)}
                placeholder={TERMINAL_DEFAULTS.fontFamily}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </label>
            {/* 행간 */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalLineHeight")}</span>
              <input type="number" min={0.8} max={2} step={0.1} value={tLineHeight}
                onChange={(e) => setSetting(TKEYS.lineHeight, Math.min(2, Math.max(0.8, Number(e.target.value) || TERMINAL_DEFAULTS.lineHeight)))}
                className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </div>
            {/* 커서 스타일 */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalCursorStyle")}</span>
              <div className="inline-flex w-full rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                {(["bar", "block", "underline"] as const).map((cs) => (
                  <button key={cs} type="button" onClick={() => setSetting(TKEYS.cursorStyle, cs)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${tCursorStyle === cs ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                    {t(`settings.cursor.${cs}`)}
                  </button>
                ))}
              </div>
            </div>
            {/* 토글들 */}
            {([
              { key: TKEYS.cursorBlink, on: tCursorBlink, label: t("settings.terminalCursorBlink") },
              { key: TKEYS.copyOnSelect, on: tCopyOnSelect, label: t("settings.terminalCopyOnSelect") },
              { key: TKEYS.rightClickPaste, on: tRightClickPaste, label: t("settings.terminalRightClickPaste") },
              { key: TKEYS.gpu, on: tGpu, label: t("settings.terminalGpu") },
              { key: TKEYS.focusFollowsMouse, on: tFocusFollowsMouse, label: t("settings.terminalFocusFollowsMouse") },
              { key: TKEYS.macOptionIsMeta, on: tMacOptionIsMeta, label: t("settings.terminalMacOptionIsMeta") },
            ]).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{row.label}</span>
                <button type="button" role="switch" aria-checked={row.on} aria-label={row.label}
                  onClick={() => setSetting(row.key, !row.on)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${row.on ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${row.on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            ))}
            {/* 스크롤백 */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalScrollback")}</span>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.terminalScrollbackHint")}</p>
              </div>
              <input type="number" min={100} max={100000} step={100} value={tScrollback}
                onChange={(e) => setSetting(TKEYS.scrollback, Math.min(100000, Math.max(100, Number(e.target.value) || TERMINAL_DEFAULTS.scrollback)))}
                className="w-28 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </div>
            {/* 폰트 굵기(#941) */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalFontWeight")}</span>
              <div className="inline-flex w-full rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                {(["normal", "bold"] as const).map((fw) => (
                  <button key={fw} type="button" onClick={() => setSetting(TKEYS.fontWeight, fw)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${tFontWeight === fw ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                    {t(`settings.fontWeight.${fw}`)}
                  </button>
                ))}
              </div>
            </div>
            {/* 스크롤 속도(#941) — scrollSensitivity는 값이 높을수록 빠름(한 틱에 더 많이 이동) */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalScrollSpeed")}</span>
              <div className="inline-flex w-full rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                {([{ v: 0.5, k: "slow" }, { v: 1, k: "normal" }, { v: 3, k: "fast" }] as const).map((opt) => (
                  <button key={opt.k} type="button" onClick={() => setSetting(TKEYS.scrollSensitivity, opt.v)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${tScrollSensitivity === opt.v ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                    {t(`settings.scrollSpeed.${opt.k}`)}
                  </button>
                ))}
              </div>
            </div>
          </section>
          )}

          {/* 프로바이더 카드 — OpenAI-Compatible / Claude / Codex 소제목+구분선으로 */}
          {activeSection === "set-agents" && (
          <section id="set-agents" className="scroll-mt-4 space-y-5 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">

            {/* 에이전트 런치(#927) — 기본 에이전트 + per-agent 추가 인자 */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t("settings.agentLaunch")}</h4>
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.defaultAgent")}</span>
                <div className="relative">
                  <select value={aDefault} onChange={(e) => setSetting(AKEYS.default, e.target.value)} aria-label={t("settings.defaultAgent")}
                    className="w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 pr-9 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
                    {LAUNCH_AGENTS.map((a) => <option key={a} value={a}>{AGENT_LABEL[a] || a}</option>)}
                  </select>
                  <IconChevronDown size={16} stroke={2} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                </div>
              </div>
              {([
                { id: "claude", label: "Claude Code", val: aArgsClaude, ph: "--dangerously-skip-permissions" },
                { id: "codex", label: "Codex", val: aArgsCodex, ph: "--model gpt-5" },
                { id: "opencode", label: "OpenCode", val: aArgsOpencode, ph: "" },
              ]).map((row) => (
                <label key={row.id} className="block space-y-1.5">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{row.label} {t("settings.agentExtraArgs")} <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span></span>
                  <input type="text" value={row.val} onChange={(e) => setSetting(AKEYS.args(row.id), e.target.value)} placeholder={row.ph}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
                </label>
              ))}
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.agentExtraArgsHint")}</p>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800" />

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("provider.openai-compatible")}
            </h4>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("provider.localLlmHint")}</p>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Endpoint URL
              </span>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)} onBlur={handleSave}
                placeholder="http://localhost:11434/v1"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Ollama: http://localhost:11434/v1
              </p>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.model")}
              </span>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)} onBlur={handleSave}
                placeholder="hermes-3"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                API Key{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)} onBlur={handleSave}
                placeholder="sk-..."
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
            </label>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800" />

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Claude Agent
            </h4>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.cliPath")}{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="text"
                value={claudeCliPath}
                onChange={(e) => setClaudeCliPath(e.target.value)} onBlur={handleSave}
                placeholder="/usr/local/bin/claude"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-mono text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("settings.cliHint")}
              </p>
            </label>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800" />

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Codex Agent
            </h4>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.cliPath")}{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="text"
                value={codexCliPath}
                onChange={(e) => setCodexCliPath(e.target.value)} onBlur={handleSave}
                placeholder="/usr/local/bin/codex"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-mono text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("settings.cliHint")}
              </p>
            </label>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800" />

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("provider.opencode-agent")}
            </h4>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.cliPath")}{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="text"
                value={openCodeCliPath}
                onChange={(e) => setOpenCodeCliPath(e.target.value)} onBlur={handleSave}
                placeholder="/opt/homebrew/bin/opencode"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-mono text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("settings.cliHint")}
              </p>
            </label>
            </div>

            {/* 데스크톱 앱: 경로 변경은 런타임 서버 재기동이 필요 → 재시작 후 적용. */}
            {desktop && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t("settings.cliPathRestartHint")}
                </p>
                <button
                  type="button"
                  onClick={() => { void desktop.relaunch(); }}
                  className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-amber-700"
                >
                  {t("settings.relaunchNow")}
                </button>
              </div>
            )}
          </section>
          )}

          {/* 제외 목록 — 프로바이더 섹션 안(학습 전용, Mustard-only서 숨김). 암기 provider는 nunopi 섹션으로(#985). */}
          {showLearning && activeSection === "set-agents" && (<>
          {/* 제외 목록 카드 */}
          <section className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("settings.exclude")}
            </h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {t("settings.excludeHint")}
            </p>
            <ExclusionGroup
              label={t("settings.excludeTerm")}
              items={excludedTerms}
              onRemove={(text) => onRemoveExclusion?.("text", text)}
            />
          </section>
          </>)}

          {/* 알림(#928) */}
          {activeSection === "set-notifications" && (
          <section id="set-notifications" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            {([
              { key: NKEYS.master, on: nMaster, label: t("settings.notifMaster"), desc: t("settings.notifMasterDesc") },
              { key: NKEYS.agentDone, on: nAgentDone, label: t("settings.notifAgentDone"), desc: t("settings.notifAgentDoneDesc") },
              { key: NKEYS.suppressWhileWatching, on: nSuppress, label: t("settings.notifSuppress"), desc: t("settings.notifSuppressDesc") },
              { key: NKEYS.silent, on: nSilent, label: t("settings.notifSilent"), desc: t("settings.notifSilentDesc") },
            ]).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{row.label}</span>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{row.desc}</p>
                </div>
                <button type="button" role="switch" aria-checked={row.on} aria-label={row.label}
                  onClick={() => setSetting(row.key, !row.on)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${row.on ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${row.on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => void sendTestNotif()}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              {t("settings.notifTest")}
            </button>
          </section>
          )}

          {/* 확인 다이얼로그(#929) — 파괴적 액션 confirm 켜고 끄기. */}
          {activeSection === "set-confirm" && (
          <section id="set-confirm" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            {([
              { key: CKEYS.skipDelete, on: cSkipDelete, label: t("settings.confirmSkipDelete"), desc: t("settings.confirmSkipDeleteDesc") },
              { key: CKEYS.skipCloseTab, on: cSkipCloseTab, label: t("settings.confirmSkipCloseTab"), desc: t("settings.confirmSkipCloseTabDesc") },
              { key: CKEYS.confirmCloseTerminal, on: cConfirmCloseTerminal, label: t("settings.confirmCloseTerminal"), desc: t("settings.confirmCloseTerminalDesc") },
            ]).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{row.label}</span>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{row.desc}</p>
                </div>
                <button type="button" role="switch" aria-checked={row.on} aria-label={row.label}
                  onClick={() => setSetting(row.key, !row.on)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${row.on ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${row.on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            ))}
          </section>
          )}

          {/* 워크스페이스/일반(#939) — 기본 폴더 등. */}
          {activeSection === "set-workspace" && (
          <section id="set-workspace" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.defaultFolder")}</span>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.defaultFolderDesc")}</p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300" title={wDefaultFolder || undefined}>
                  {wDefaultFolder || t("settings.defaultFolderNone")}
                </span>
                <button type="button" onClick={() => void pickDefaultFolder()}
                  className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">{t("settings.chooseFolder")}</button>
                {wDefaultFolder ? (
                  <button type="button" onClick={() => setSetting(WKEYS.defaultFolder, "")}
                    className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[13px] text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{t("settings.clear")}</button>
                ) : null}
              </div>
            </div>
          </section>
          )}

          {/* git/소스컨트롤(#954) — PR 기본값·자동 fetch·브랜치 prefix. */}
          {activeSection === "set-git" && (
          <section id="set-git" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            {/* PR base 기본값 */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.gitPrBase")}</span>
              <input type="text" value={gPrBase} onChange={(e) => setSetting(GKEYS.prBaseDefault, e.target.value)} placeholder={t("settings.gitPrBasePlaceholder")}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </div>
            {/* branch prefix */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.gitBranchPrefix")}</span>
              <input type="text" value={gBranchPrefix} onChange={(e) => setSetting(GKEYS.branchPrefix, e.target.value)} placeholder={t("settings.gitBranchPrefixPlaceholder")}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            </div>
            {/* 토글: PR 초안 기본 / 자동 fetch */}
            {([
              { key: GKEYS.prDraftDefault, on: gPrDraft, label: t("settings.gitPrDraft"), desc: t("settings.gitPrDraftDesc") },
              { key: GKEYS.autoFetch, on: gAutoFetch, label: t("settings.gitAutoFetch"), desc: t("settings.gitAutoFetchDesc") },
              { key: GKEYS.autoExplainCommits, on: gAutoExplain, label: t("settings.gitAutoExplain"), desc: t("settings.gitAutoExplainDesc") },
            ]).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{row.label}</span>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{row.desc}</p>
                </div>
                <button type="button" role="switch" aria-checked={row.on} aria-label={row.label}
                  onClick={() => setSetting(row.key, !row.on)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${row.on ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${row.on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            ))}
          </section>
          )}

          {/* 캐치업(#1049) — 명령어 해설·용어집 토글. */}
          {activeSection === "set-catchup" && (
          <section id="set-catchup" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            {([
              { key: CUKEYS.commands, on: cuCommands, label: t("settings.catchupCommands"), desc: t("settings.catchupCommandsDesc") },
              { key: CUKEYS.terms, on: cuTerms, label: t("settings.catchupTerms"), desc: t("settings.catchupTermsDesc") },
            ]).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{row.label}</span>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{row.desc}</p>
                </div>
                <button type="button" role="switch" aria-checked={row.on} aria-label={row.label}
                  onClick={() => setSetting(row.key, !row.on)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${row.on ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${row.on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            ))}
          </section>
          )}

          {/* 단축키(#1027) */}
          {activeSection === "set-shortcuts" && <ShortcutsSection />}

          {/* 연동(#958) — 소스 호스트 연결. 현재 GitHub(gh CLI + PAT). */}
          {activeSection === "set-integrations" && (
          <section id="set-integrations" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.integrationsDesc")}</p>
            {/* GitHub 카드 */}
            <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <IconBrandGithub size={18} stroke={1.75} className="shrink-0 text-zinc-700 dark:text-zinc-200" aria-hidden />
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">GitHub</span>
                {(() => {
                  const st = ghAuth?.state;
                  const badge = st === "ok" ? { txt: t("settings.ghConnected"), cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" }
                    : st === "not-authed" ? { txt: t("settings.ghNotAuthed"), cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" }
                    : st === "not-installed" ? { txt: t("settings.ghNotInstalled"), cls: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400" }
                    : st ? { txt: t("settings.ghError"), cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" }
                    : { txt: "…", cls: "bg-zinc-500/15 text-zinc-500" };
                  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.txt}</span>;
                })()}
                <button type="button" onClick={() => void refreshGh()} disabled={ghChecking} title={t("settings.ghRecheck")} aria-label={t("settings.ghRecheck")}
                  className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800">
                  <IconLoader2 size={13} stroke={2} className={ghChecking ? "animate-spin" : ""} aria-hidden />
                </button>
              </div>
              {ghAuth?.detail ? <p className="text-xs text-zinc-400 dark:text-zinc-500">{ghAuth.detail}</p> : null}
              {/* PAT */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{t("settings.ghPat")} {ghHasToken ? <span className="text-emerald-600 dark:text-emerald-400">✓</span> : null}</span>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("settings.ghPatHint")}</p>
                <div className="flex items-center gap-2">
                  <input type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder={ghHasToken ? "••••••••" : "ghp_…"}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
                  <button type="button" onClick={() => void saveGhToken()} disabled={!ghToken.trim()}
                    className="shrink-0 rounded-lg bg-mustard-500 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-mustard-600 disabled:opacity-50">{t("settings.ghPatSave")}</button>
                  {ghHasToken ? (
                    <button type="button" onClick={() => void clearGhToken()}
                      className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[13px] text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{t("settings.clear")}</button>
                  ) : null}
                </div>
              </div>
            </div>
            {/* GitLab 카드(#960) — glab CLI 감지 */}
            <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <IconBrandGitlab size={18} stroke={1.75} className="shrink-0 text-orange-500" aria-hidden />
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">GitLab</span>
                {(() => {
                  const st = glabAuth?.state;
                  const badge = st === "ok" ? { txt: t("settings.ghConnected"), cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" }
                    : st === "not-authed" ? { txt: t("settings.ghNotAuthed"), cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" }
                    : st === "not-installed" ? { txt: t("settings.glabNotInstalled"), cls: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400" }
                    : st ? { txt: t("settings.ghError"), cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" }
                    : { txt: "…", cls: "bg-zinc-500/15 text-zinc-500" };
                  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.txt}</span>;
                })()}
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{glabAuth?.state === "not-installed" ? t("settings.glabInstallHint") : (glabAuth?.detail || t("settings.glabDesc"))}</p>
            </div>
            {/* Bitbucket / Azure 토큰 카드(#960) */}
            {([
              { host: "bitbucket" as const, label: "Bitbucket", token: btToken, setToken: setBtToken, has: btHasToken, Icon: IconBrandBitbucket, iconClass: "text-sky-500" },
              { host: "azure" as const, label: "Azure DevOps", token: azToken, setToken: setAzToken, has: azHasToken, Icon: IconBrandAzure, iconClass: "text-sky-500" },
              { host: "vercel" as const, label: "Vercel", token: vcToken, setToken: setVcToken, has: vcHasToken, Icon: VercelLogo, iconClass: "text-zinc-900 dark:text-zinc-50" },
              { host: "supabase" as const, label: "Supabase", token: sbToken, setToken: setSbToken, has: sbHasToken, Icon: SupabaseLogo, iconClass: "" },
            ]).map((c) => (
              <div key={c.host} className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                  <c.Icon size={18} stroke={1.75} className={`shrink-0 ${c.iconClass}`} aria-hidden />
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{c.label}</span>
                  {c.has ? <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{t("settings.ghConnected")}</span> : <span className="ml-auto rounded-full bg-zinc-500/15 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("settings.hostNotConfigured")}</span>}
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("settings.hostTokenHint")}</p>
                <div className="flex items-center gap-2">
                  <input type="password" value={c.token} onChange={(e) => c.setToken(e.target.value)} placeholder={c.has ? "••••••••" : t("settings.hostTokenPlaceholder")}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[13px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
                  <button type="button" onClick={() => void saveHostToken(c.host, c.token, () => c.setToken(""))} disabled={!c.token.trim()}
                    className="shrink-0 rounded-lg bg-mustard-500 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-mustard-600 disabled:opacity-50">{t("settings.ghPatSave")}</button>
                  {c.has ? (
                    <button type="button" onClick={() => void clearHostToken(c.host)}
                      className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[13px] text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{t("settings.clear")}</button>
                  ) : null}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("settings.integrationsMore2")}</p>
          </section>
          )}

          {/* nunopi 학습 모듈 설치/사용(#924) — 온보딩 외 설정서도 토글. */}
          {activeSection === "set-nunopi" && (
          <section id="set-nunopi" className="scroll-mt-4 space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <IconSparkles size={15} stroke={1.75} className="text-mustard-500" aria-hidden /> nunopi
                </span>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">{t("onboarding.nunopiDesc")}</p>
              </div>
              <button type="button" role="switch" aria-checked={!!nunopiEnabled} aria-label={t("settings.nunopiModule")}
                onClick={() => onNunopiEnabledChange?.(!nunopiEnabled)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${nunopiEnabled ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${nunopiEnabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.nunopiModuleApply")}</p>
            {/* 학습 provider(#985) — 기본 + 모드별 덮어쓰기. 모드 "" = 기본값 따라감. */}
            {showLearning && onModeProviderChange && (
              <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t("settings.learnProviders")}</h4>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.learnProvidersHint")}</p>
                {(["default", ...LEARN_PROVIDER_MODES] as const).map((m) => {
                  const label = m === "default" ? t("settings.learnProviderDefault") : t(`mode.${m}`);
                  // 모델 칸(#987): 기본 따라가는 행은 비활성 + 기본 행 모델 표시. 직접 고른 행만 선택.
                  const rowProvider = resolveModeProvider(modeProviders, m);
                  const follows = m !== "default" && !modeProviders[m];
                  const list = modelLists[rowProvider];
                  const listed = typeof list === "object" ? list : undefined;
                  const saved = follows ? undefined : modeModels[m];
                  const modelName = (id: string | undefined) => {
                    const hit = listed?.models.find((x) => x.id === id);
                    return hit ? hit.label + (hit.latest ? ` (${t("settings.modelLatest")})` : "") : id ?? "";
                  };
                  const defaultName = modelName(listed?.defaultModel) || "…";
                  return (
                    <div key={m} className="flex items-center justify-between gap-3">
                      <span className={`min-w-0 text-sm ${m === "default" ? "font-medium text-zinc-800 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"}`}>{label}</span>
                      <div className="flex shrink-0 gap-2">
                      <div className="relative w-48">
                        <select
                          value={m === "default" ? resolveModeProvider(modeProviders, "default") : (modeProviders[m] ?? "")}
                          onChange={(e) => onModeProviderChange(m, (e.target.value || undefined) as AgentProviderKind | undefined)}
                          aria-label={label}
                          className="w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 pr-9 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
                        >
                          {m !== "default" && (
                            <option value="">{t("settings.followDefault", { name: t(`provider.${resolveModeProvider(modeProviders, "default")}`) })}</option>
                          )}
                          {PROVIDER_CATALOG.map((p) => (
                            <option key={p.id} value={p.id}>{t(`provider.${p.id}`)}</option>
                          ))}
                        </select>
                        <IconChevronDown size={16} stroke={2} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                      </div>
                      {onModeModelChange && (
                      <div className="relative w-52">
                        <select
                          value={follows ? "" : (saved ?? "")}
                          disabled={follows}
                          onChange={(e) => onModeModelChange(m, e.target.value || undefined)}
                          aria-label={`${label} ${t("settings.model")}`}
                          className="w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 pr-9 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
                        >
                          {follows ? (
                            <option value="">{t("settings.followDefault", { name: modelName(resolveModeModel(modeProviders, modeModels, "default")) || defaultName })}</option>
                          ) : (
                            <option value="">{list === "loading" ? t("settings.modelLoading") : t("settings.defaultModel", { name: defaultName })}</option>
                          )}
                          {!follows && listed?.models.map((x) => (
                            <option key={x.id} value={x.id}>{x.label}{x.latest ? ` (${t("settings.modelLatest")})` : ""}</option>
                          ))}
                          {/* 목록에 없는 저장값(목록 실패·모델 단종)도 값 유지 */}
                          {!follows && saved && !listed?.models.some((x) => x.id === saved) && <option value={saved}>{saved}</option>}
                        </select>
                        <IconChevronDown size={16} stroke={2} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                      </div>
                      )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* nunopi UI — 학습 UI 옵션(카드 애니 등). nunopi 켜짐 + 학습노출 시. */}
            {showLearning && onCardFlyAnimationChange && (
              <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">UI</h4>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.cardFlyAnimation")}</span>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.cardFlyAnimationDesc")}</p>
                  </div>
                  <button type="button" role="switch" aria-checked={cardFlyAnimation} aria-label={t("settings.cardFlyAnimation")}
                    onClick={() => onCardFlyAnimationChange?.(!cardFlyAnimation)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${cardFlyAnimation ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${cardFlyAnimation ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
              </div>
            )}
          </section>
          )}

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {t("settings.storageNote")}
          </p>
        </div>
        </div>

      </div>
    </div>
  );
}

// 설정 검색 색인(#1195) — 새 문구 없이 이미 있는 i18n 키만(항목 이름 + 설명). 그래서 언어를 바꾸면 검색도 그 언어로.
// 항목 = 키(이름) | [이름 키, 설명 키] | { text } (번역 안 하는 브랜드 이름). 새 설정 항목을 만들면 여기에 키 한 줄 추가.
export type SearchItem = string | [string, string] | { text: string };
export const SETTINGS_SEARCH: Record<string, SearchItem[]> = {
  "set-appearance": ["settings.theme", ["settings.uiZoom", "settings.uiZoomDesc"], "settings.uiFont"],
  "set-language": ["settings.selectLanguage"],
  "set-update": [["update.check", "update.checkDesc"], ["update.auto", "update.autoDesc"]], // #1200
  "set-notifications": [["settings.notifMaster", "settings.notifMasterDesc"], ["settings.notifAgentDone", "settings.notifAgentDoneDesc"], ["settings.notifSuppress", "settings.notifSuppressDesc"], ["settings.notifSilent", "settings.notifSilentDesc"], "settings.notifTest"],
  "set-confirm": [["settings.confirmSkipDelete", "settings.confirmSkipDeleteDesc"], ["settings.confirmSkipCloseTab", "settings.confirmSkipCloseTabDesc"], ["settings.confirmCloseTerminal", "settings.confirmCloseTerminalDesc"]],
  "set-terminal": ["settings.terminalTheme", ["settings.terminalShell", "settings.terminalShellHint"], "settings.terminalFontSize", "settings.terminalFontFamily", "settings.terminalFontWeight", "settings.terminalLineHeight", "settings.terminalCursorStyle", "settings.terminalCursorBlink",
    ["settings.terminalLinkTarget", "settings.terminalLinkHint"], "settings.terminalCopyOnSelect", "settings.terminalRightClickPaste", "settings.terminalGpu", "settings.terminalFocusFollowsMouse", "settings.terminalOsc52", "settings.terminalImages", "settings.terminalMacOptionIsMeta",
    ["settings.terminalScrollback", "settings.terminalScrollbackHint"], "settings.terminalScrollSpeed"],
  "set-workspace": [["settings.defaultFolder", "settings.defaultFolderDesc"]],
  "set-git": ["settings.gitPrBase", "settings.gitBranchPrefix", ["settings.gitPrDraft", "settings.gitPrDraftDesc"], ["settings.gitAutoFetch", "settings.gitAutoFetchDesc"]],
  "set-quick": [["quick.title", "quick.desc"], "quick.howTo"],
  "set-browser": [["browser.agentControl", "browser.agentControlDesc"], ["browser.homePage", "browser.homePageDesc"], ["settings.terminalLinkTarget", "browser.linkTargetDesc"], ["browser.linkBackground", "browser.linkBackgroundDesc"], ["browser.userAgent", "browser.userAgentDesc"], ["browser.searchEngine", "browser.searchEngineDesc"], ["browser.defaultZoom", "browser.defaultZoomDesc"], ["browser.clearData", "browser.clearDataDesc"]], // #1209
  "set-shortcuts": ["settings.shortcutsSearch"],
  "set-agents": [["settings.defaultAgent", "settings.defaultAgentHint"], "agents.permTitle", ["agents.awakeTitle", "agents.awakeHint"], "settings.agentExtraArgs", ["agents.env", "agents.envHint"], "settings.cliPath", "settings.model", "agents.installed", "agents.available"],
  "set-catchup": [["settings.catchupEnabled", "settings.catchupEnabledDesc"], ["settings.catchupExplain", "settings.catchupExplainDesc"], ["settings.catchupCommands", "settings.catchupCommandsDesc"], ["settings.catchupDiff", "settings.catchupDiffDesc"],
    ["settings.catchupSessions", "settings.catchupSessionsDesc"], ["settings.catchupTerms", "settings.catchupTermsDesc"], ["settings.catchupChat", "settings.catchupChatDesc"], "settings.catchupChatCards"],
  "set-integrations": [{ text: "GitHub" }, ["settings.ghPat", "settings.ghPatHint"], ["settings.prReviewAi", "settings.prReviewAiDesc"], { text: "Linear" }, { text: "Jira" }, ["trackers.syncTitle", "trackers.syncHint"]],
  "set-computer": [["computer.enable", "computer.enableHint"], ["computer.stopKey", "computer.stopKeyHint"], "computer.perm.accessibility", "computer.perm.screen", ["computer.blocked", "computer.blockedHint"], "computer.log"],
  "set-nunopi": ["settings.nunopiModule", ["settings.learnProviders", "settings.learnProvidersHint"], ["settings.cardFlyAnimation", "settings.cardFlyAnimationDesc"], ["settings.exclude", "settings.excludeHint"]],
};

export type SearchHit = { section: string; label: string; desc?: string; score: number };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
// 키 이름의 영어 단어 — settings.terminalFontSize → "terminal font size" (한국어 화면에서 영어로 쳐도 찾힘)
export const keyWords = (k: string) => k.split(".").pop()!.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// 찾기 — 낱말을 모두 포함하는 항목만. 점수: 이름 시작 일치 3 > 이름 포함 2 > 설명·섹션·키 단어 포함 1. 같은 점수면 색인 순서.
export function searchSettings(q: string, t: (k: string) => string, sectionLabel: (id: string) => string, visible: (id: string) => boolean): SearchHit[] {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const [section, items] of Object.entries(SETTINGS_SEARCH)) {
    if (!visible(section)) continue;
    const sec = norm(sectionLabel(section));
    for (const it of items) {
      const [labelKey, descKey] = typeof it === "string" ? [it, undefined] : Array.isArray(it) ? it : [undefined, undefined];
      const label = typeof it === "object" && !Array.isArray(it) ? it.text : t(labelKey!);
      const desc = descKey ? t(descKey) : undefined;
      const name = norm(label), rest = norm(`${desc ?? ""} ${sec} ${labelKey ? keyWords(labelKey) : ""}`);
      if (!words.every((w) => name.includes(w) || rest.includes(w))) continue;
      const score = name.startsWith(words[0]) ? 3 : words.every((w) => name.includes(w)) ? 2 : 1;
      hits.push({ section, label, ...(desc ? { desc } : {}), score });
    }
  }
  return hits.map((h, i) => ({ h, i })).sort((a, b) => b.h.score - a.h.score || a.i - b.i).map((x) => x.h);
}

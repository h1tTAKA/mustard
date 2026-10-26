"use client";

// Mustard 통합 설정 스토어(#924·#925) — 신규 스칼라 옵션(서브2~5: 터미널·에이전트·알림·확인)용 토대.
// 기존 옵션(theme/terminal-theme/locale/provider-settings/runtime-paths)은 각자 기존 통로를 그대로 두고,
// 여기선 "그 외 다양한 스칼라 설정"을 단일 JSON(localStorage "mustard:settings")으로 모은다.
// 타입은 서브별로 아래 MustardSettings에 필드를 추가하며 넓혀간다.
import { useSyncExternalStore } from "react";

export interface MustardSettings {
  // 서브2~5에서 채운다. 예: terminalFontSize, defaultAgent, notifyAgentDone, confirmCloseRunningTerminal …
  [key: string]: unknown;
}

// 터미널 설정(#926) — 키·기본값 공유(Terminal[apps] + SettingsDrawer[packages] 둘 다 참조).
export type TerminalCursorStyle = "bar" | "block" | "underline";
export type TerminalFontWeight = "normal" | "bold";
export const TERMINAL_DEFAULTS = {
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  lineHeight: 1.0,
  cursorStyle: "bar" as TerminalCursorStyle,
  cursorBlink: true,
  scrollback: 1000,
  copyOnSelect: false,
  rightClickPaste: false,
  gpu: true,
  // 심화(#941)
  fontWeight: "normal" as TerminalFontWeight, // xterm fontWeight
  scrollSensitivity: 1,                        // 높을수록 빠름(한 틱에 더 많이 이동)
  macOptionIsMeta: false,                      // mac Option→Alt
  focusFollowsMouse: false,                    // 마우스 올리면 포커스
};
export const TKEYS = {
  fontSize: "terminal.fontSize",
  fontFamily: "terminal.fontFamily",
  lineHeight: "terminal.lineHeight",
  cursorStyle: "terminal.cursorStyle",
  cursorBlink: "terminal.cursorBlink",
  scrollback: "terminal.scrollback",
  copyOnSelect: "terminal.copyOnSelect",
  rightClickPaste: "terminal.rightClickPaste",
  gpu: "terminal.gpu",
  fontWeight: "terminal.fontWeight",
  scrollSensitivity: "terminal.scrollSensitivity",
  macOptionIsMeta: "terminal.macOptionIsMeta",
  focusFollowsMouse: "terminal.focusFollowsMouse",
} as const;

// 에이전트 런치(#927, #1184 Orca식) — 기본 에이전트("auto" = 감지되고 켜진 첫 에이전트, "blank" = 셸만, 아니면 id) + per-agent 유저 인자·권한·켜기.
// 권한 = 전체(perm) + 에이전트별 덮어쓰기(perm.<id>, ""·없음 = 전체 따름). 값: own·ask·accept-edits·auto·full-access. 기본 own(플래그 안 붙임).
// 키를 에이전트마다 따로 둠(객체 하나로 두면 useSetting 스냅샷이 매번 새 객체 — 무한 렌더).
export const AGENT_DEFAULTS = { default: "auto", perm: "own" };
export const AKEYS = {
  default: "agent.default",
  args: (agentId: string) => `agent.args.${agentId}`,
  perm: "agent.perm",
  permOf: (agentId: string) => `agent.perm.${agentId}`,
  off: (agentId: string) => `agent.off.${agentId}`,
  argsLifted: "agent.argsLifted",
  usedAt: (agentId: string) => `agent.used.${agentId}`, // 마지막으로 띄운 시각(ms) — 우리 규칙: 최근 쓴 순서·자동 = 마지막에 쓴 것
  fullOk: "agent.fullAccessOk", // 전체 액세스 처음 고를 때 확인 — 한 번 확인하면 다시 안 물음
} as const;
export type AgentPermission = "own" | "ask" | "accept-edits" | "auto" | "full-access";
// 이 에이전트의 권한 — 덮어쓰기 > 전체 > own. choices = 그 에이전트가 고를 수 있는 것(카탈로그), 못 고르는 건 own.
export function agentPermission(agentId: string, choices?: string[]): { choice: AgentPermission; own: boolean } {
  const mine = getSetting<string>(AKEYS.permOf(agentId), "");
  const choice = (mine || getSetting<string>(AKEYS.perm, AGENT_DEFAULTS.perm)) as AgentPermission;
  return { choice: !choices || choices.includes(choice) ? choice : "own", own: !!mine };
}
export const agentEnabled = (agentId: string) => !getSetting<boolean>(AKEYS.off(agentId), false);
export const agentUsedAt = (agentId: string) => getSetting<number>(AKEYS.usedAt(agentId), 0);
export const markAgentUsed = (agentId: string) => setSetting(AKEYS.usedAt(agentId), Date.now());
// 우리 순서(#1184, Orca는 카탈로그 고정 순서) — 기본 에이전트 → 최근 쓴 순 → 안 쓴 것(받은 순서 = 카탈로그) → 꺼진 것.
export function sortAgents<T extends { id: string }>(list: T[]): T[] {
  const d = getSetting<string>(AKEYS.default, AGENT_DEFAULTS.default);
  const rank = (a: T) => (!agentEnabled(a.id) ? 3 : a.id === d ? 0 : agentUsedAt(a.id) ? 1 : 2);
  return list.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || agentUsedAt(y.a.id) - agentUsedAt(x.a.id) || x.i - y.i).map((x) => x.a);
}
// 기본 에이전트 고르기 — detected = 감지된 id(카탈로그 순서). null = 셸만.
// 자동 = 켜진 것 중 마지막에 쓴 에이전트(우리 규칙 — Orca는 카탈로그 첫 번째), 한 번도 안 썼으면 카탈로그 순서 첫 번째.
export function pickDefaultAgent(detected: string[]): string | null {
  const d = getSetting<string>(AKEYS.default, AGENT_DEFAULTS.default);
  if (d === "blank") return null;
  const ok = detected.filter(agentEnabled);
  if (d !== "auto" && ok.includes(d)) return d;
  const last = ok.reduce<string | null>((best, id) => (agentUsedAt(id) > (best ? agentUsedAt(best) : 0) ? id : best), null);
  return last ?? ok[0] ?? null;
}

// 알림(#928)
// suppressWhileWatching(#1021, 옛 suppressWhileFocused): "지금 보고 있는 레포 탭"의 에이전트 완료 알림만 억제(#973~). 다른 레포는 포커스여도 알림.
export const NOTIF_DEFAULTS = { agentDone: true, suppressWhileWatching: true, terminalBell: false, master: true, silent: false, crew: true };
export const NKEYS = {
  agentDone: "notif.agentDone",
  suppressWhileWatching: "notif.suppressWhileWatching",
  terminalBell: "notif.terminalBell",
  master: "notif.master",   // #939 알림 전체 on/off
  silent: "notif.silent",   // #939 소리 없이(무음 알림)
  crew: "notif.crew",       // #1167 Crew 역할이 사람을 부르면(질문·권한·관문·막힘) 알림 — 에이전트 대화방 헤더 🔔
} as const;

// 워크스페이스/일반(#939)
export const WORKSPACE_DEFAULTS = { defaultFolder: "" };
export const WKEYS = { defaultFolder: "workspace.defaultFolder" } as const;

// 확인 다이얼로그(#929) — 파괴적 액션 confirm 토글.
// skipDelete/skipCloseTab: 이미 confirm 있는 액션의 확인을 "건너뛰기"(기본 false=확인 유지).
// confirmCloseTerminal: 실행 중 터미널 닫기 시 확인을 "추가"(opt-in, 기본 false=바로 닫기).
export const CONFIRM_DEFAULTS = { skipDelete: false, skipCloseTab: false, confirmCloseTerminal: false };
export const CKEYS = {
  skipDelete: "confirm.skipDelete",
  skipCloseTab: "confirm.skipCloseTab",
  confirmCloseTerminal: "confirm.confirmCloseTerminal",
} as const;

// 외관 확장(#937) — UI 줌(electron webFrame 배율) + UI 폰트(--font-sans 프리셋).
export type UiFontPref = "default" | "system" | "mono";
export const APPEARANCE_DEFAULTS = { uiZoom: 1.0, uiFont: "default" as UiFontPref };
export const APKEYS = { uiZoom: "appearance.uiZoom", uiFont: "appearance.uiFont" } as const;

// git/소스컨트롤(#954, 에픽 #943 마무리) — PR 기본값·자동 fetch·브랜치 prefix.
export const GIT_DEFAULTS = { prBaseDefault: "", prDraftDefault: false, autoFetch: false, branchPrefix: "", autoExplainCommits: true };
export const GKEYS = {
  prBaseDefault: "git.prBaseDefault",
  prDraftDefault: "git.prDraftDefault",
  autoFetch: "git.autoFetch",
  branchPrefix: "git.branchPrefix",
  autoExplainCommits: "git.autoExplainCommits", // #1054 커밋 diff 변경 구간 자동 설명
  // #1127 PR 에이전트 리뷰 AI·모델 — "" = 워크스페이스 기본 AI / 그 AI 기본 모델
  prReviewProvider: "git.prReviewProvider", prReviewModel: "git.prReviewModel",
} as const;

// 캐치업(#1049) — 명령어 해설 카드·용어집 켜고 끄기.
// #1062 카테고리마다 표시(캐치업 창에 보이기)·분석(새로 AI 분석) 분리 — 분석 꺼도 예전 내용은 표시로 계속 봄.
// Diff 분석 = 커밋 자동 설명(GKEYS.autoExplainCommits, git 설정과 같은 키).
export const CATCHUP_DEFAULTS = { enabled: true, explainShow: true, explainAnalyze: true, commandsShow: true, commandsAnalyze: true, diffShow: true, termsShow: true, termsAnalyze: true, sessionsShow: true, sessionsAnalyze: true, chatCards: true };
export const CUKEYS = {
  enabled: "catchup.enabled", // 캐치업 전체 — 끄면 패널 숨김 + 모든 분석 중지(카테고리 값은 보존)
  explainShow: "catchup.explainShow", explainAnalyze: "catchup.explainAnalyze",
  commandsShow: "catchup.commandsShow", commandsAnalyze: "catchup.commandsAnalyze",
  diffShow: "catchup.diffShow",
  termsShow: "catchup.termsShow", termsAnalyze: "catchup.termsAnalyze",
  sessionsShow: "catchup.sessionsShow", sessionsAnalyze: "catchup.sessionsAnalyze", // #1064 커밋을 만든 에이전트 세션
  sessionsProvider: "catchup.sessionsProvider", sessionsModel: "catchup.sessionsModel",
  // 카테고리별 AI(#1062) — "" = 워크스페이스 기본 프로바이더. 용어는 해설·명령어 응답에서 모아서 별도 호출 없음.
  explainProvider: "catchup.explainProvider", commandsProvider: "catchup.commandsProvider", diffProvider: "catchup.diffProvider",
  // 카테고리별 모델 — "" = 그 프로바이더 기본 모델. 프로바이더 바꾸면 비움(목록이 달라서).
  explainModel: "catchup.explainModel", commandsModel: "catchup.commandsModel", diffModel: "catchup.diffModel",
  // #1081 질문 화면(캐치업 안) — AI·모델("" = 워크스페이스 기본) + 답변 아래 카드 추가 칩
  chatProvider: "catchup.chatProvider", chatModel: "catchup.chatModel", chatCards: "catchup.chatCards",
} as const;

// 프로바이더 설정에 모델만 덮어씀(#1062 캐치업 카테고리별 모델). 빈 모델이면 그대로.
export function withModel<T extends object | undefined>(ps: T, providerId: string, model: string): T {
  if (!model) return ps;
  const cur = ((ps as Record<string, unknown> | undefined)?.[providerId] ?? {}) as Record<string, unknown>;
  return { ...(ps ?? {}), [providerId]: { ...cur, model } } as T;
}

const KEY = "mustard:settings";
type Listener = () => void;
const listeners = new Set<Listener>();

// 이름 바뀐 설정 키(옛 → 새). 옛 값이 있고 새 키가 없으면 옮기고 옛 키 삭제 — 유저가 고른 값 유지.
export const RENAMED_KEYS: Record<string, string> = {
  "notif.suppressWhileFocused": "notif.suppressWhileWatching", // #1021 의미가 '보고 있는 레포 억제'로 바뀜(#973)
  "catchup.commands": "catchup.commandsAnalyze", // #1062 표시/분석 분리 — 옛 켜기/끄기는 분석으로
  "catchup.terms": "catchup.termsAnalyze",
};
// 순수 이관 — 바뀌었으면 true(호출 측이 저장).
export function migrateRenamed(obj: Record<string, unknown>): boolean {
  let changed = false;
  for (const [from, to] of Object.entries(RENAMED_KEYS)) {
    if (!(from in obj)) continue;
    if (!(to in obj)) obj[to] = obj[from];
    delete obj[from];
    changed = true;
  }
  return changed;
}

function readAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// 이관은 모듈 로드 시 1회(브라우저만) — 렌더 중 getSnapshot에서 저장소를 쓰지 않게(#1022 리뷰: 스냅샷은 부수효과 금지).
if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (obj && migrateRenamed(obj)) localStorage.setItem(KEY, JSON.stringify(obj));
  } catch { /* 저장소 불가 — 이관 생략 */ }
}

function writeAll(obj: Record<string, unknown>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

// 단일 값 읽기 — 없으면 fallback. SSR/미저장 안전(readAll try/catch).
export function getSetting<T>(key: keyof MustardSettings & string, fallback: T): T {
  const all = readAll();
  return key in all ? (all[key] as T) : fallback;
}

// 단일 값 쓰기 + 구독자 통지.
export function setSetting(key: keyof MustardSettings & string, value: unknown): void {
  const all = readAll();
  all[key] = value;
  writeAll(all);
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// React 훅 — 값 구독(설정 변경 시 리렌더). 클라이언트 전용.
export function useSetting<T>(key: keyof MustardSettings & string, fallback: T): T {
  return useSyncExternalStore(
    subscribeSettings,
    () => getSetting<T>(key, fallback),
    () => fallback, // 서버 스냅샷 = fallback(하이드레이션 안전)
  );
}

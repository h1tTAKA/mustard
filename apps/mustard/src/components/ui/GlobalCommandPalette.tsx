"use client";

// 전역 명령 팔레트 배선(#878) — ⌘K 키 바인딩 + open 상태 + 명령 조립.
// I18nProvider 안쪽에 마운트돼야 useT 가능(Home 자체는 provider 바깥이라 여기로 분리).
import { type RefObject, useEffect, useMemo, useState } from "react";
import {
  IconCode, IconFileText, IconMessage2, IconLayoutDashboard, IconCards, IconHome, IconSettings,
  IconFiles, IconFileCode, IconMessages,
} from "@tabler/icons-react";
import { useT, useShortcut, useShortcutHint, shortcutHint, installShortcutDispatcher } from "@mustard/core";
import { CommandPalette, type Command } from "@mustard/nunopi";
import { isNunopiEnabled } from "@/lib/product";
import type { ViewMode } from "@mustard/core";
import type { WorkspaceTabsHandle } from "@/components/workspace/WorkspaceTabs";
import type { AddKind } from "@/components/workspace/WorkspaceAddMenu";

// Mustard(워크스페이스 셸) 뷰 vs nunopi(학습 모듈) 뷰 — 팔레트서 섹션 분리, nunopi는 플래그로 게이트(#878).
const MUSTARD_VIEWS: ViewMode[] = ["workspace"];
const NUNOPI_VIEWS: ViewMode[] = ["code", "text", "ask", "memorize", "history"];
// nunopi 학습 탭(게이트). 레포 탭은 Mustard 네이티브라 별도(항상).
const NUNOPI_TAB_KINDS: AddKind[] = ["ask", "code", "text", "memorize"];

// 뷰별 아이콘 — AreaModeToggle과 동일(일관성).
const VIEW_ICON: Record<ViewMode, React.ReactNode> = {
  workspace: <IconLayoutDashboard size={16} stroke={2} aria-hidden />,
  code: <IconCode size={16} stroke={2} aria-hidden />,
  text: <IconFileText size={16} stroke={2} aria-hidden />,
  ask: <IconMessage2 size={16} stroke={2} aria-hidden />,
  memorize: <IconCards size={16} stroke={2} aria-hidden />,
  history: <IconHome size={16} stroke={2} aria-hidden />,
};
// 탭 종류별 아이콘 — WorkspaceTabs 탭바(MODE_TAB)·레포(IconFiles)와 동일.
const TAB_ICON: Record<AddKind, React.ReactNode> = {
  repo: <IconFiles size={16} stroke={2} aria-hidden />,
  ask: <IconMessages size={16} stroke={2} aria-hidden />,
  code: <IconFileCode size={16} stroke={2} aria-hidden />,
  text: <IconFileText size={16} stroke={2} aria-hidden />,
  memorize: <IconCards size={16} stroke={2} aria-hidden />,
};

export default function GlobalCommandPalette({
  onNavigate,
  onOpenSettings,
  vm,
  workspaceRef,
}: {
  onNavigate: (v: ViewMode) => void;
  onOpenSettings: () => void;
  vm: ViewMode;
  workspaceRef: RefObject<WorkspaceTabsHandle | null>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tabCmds, setTabCmds] = useState<Command[]>([]);

  // #1027 단축키 실행기 설치(앱 전역 1개) + 팔레트(⌘K 터미널 밖·⇧⌘P)·설정(⌘,). input 포커스 중에도 동작.
  useEffect(() => installShortcutDispatcher(), []);
  useShortcut(["palette"], () => setOpen((o) => !o));
  useShortcut(["settings"], () => { setOpen(false); onOpenSettings(); });
  const settingsHint = useShortcutHint("settings");

  // 워크스페이스 탭 명령은 팔레트 열 때 스냅샷 — ref는 effect서만 읽음(렌더 중 접근 금지).
  // run 클로저는 workspaceRef.current를 직접 호출(캡처 stale 회피).
  useEffect(() => {
    const ws = open && vm === "workspace" ? workspaceRef.current : null;
    let next: Command[] = [];
    if (ws) {
      const switchTabs: Command[] = ws.listTabs().map((tb, i) => ({
        id: `tab:${tb.key}`, section: t("palette.section.tab"), label: tb.label, icon: TAB_ICON[tb.kind],
        shortcut: i < 8 ? shortcutHint(`repo.goto${i + 1}`) : undefined, // #1029 ⌘⌥1~8(9는 "마지막"이라 생략)
        run: () => workspaceRef.current?.activate(tb.key),
      }));
      const newKinds: AddKind[] = ["repo", ...(isNunopiEnabled() ? NUNOPI_TAB_KINDS : [])];
      const newTabs: Command[] = newKinds.map((k) => ({
        id: `new:${k}`, section: t("palette.section.newTab"),
        label: `${t("palette.newTab")}: ${k === "repo" ? t("palette.tabRepo") : t(`mode.${k}`)}`,
        icon: TAB_ICON[k], run: () => workspaceRef.current?.addTab(k),
      }));
      next = [...switchTabs, ...newTabs];
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 열림/뷰 전환 시 탭 스냅샷 1회 갱신
    setTabCmds(next);
  }, [open, vm, t, workspaceRef]);

  const commands = useMemo<Command[]>(() => {
    // Mustard 섹션 — 워크스페이스 + 설정(항상).
    const mustard: Command[] = [
      ...MUSTARD_VIEWS.map((v) => ({ id: `view:${v}`, section: t("palette.section.mustard"), label: t(`mode.${v}`), icon: VIEW_ICON[v], run: () => onNavigate(v) })),
      { id: "settings", section: t("palette.section.mustard"), label: t("header.settings"), icon: <IconSettings size={16} stroke={2} aria-hidden />, shortcut: settingsHint, run: onOpenSettings },
    ];
    // nunopi 학습 섹션 — 모듈 설치 시에만. Mustard-only 빌드면 숨김.
    const nunopiNav: Command[] = isNunopiEnabled()
      ? NUNOPI_VIEWS.map((v) => ({ id: `view:${v}`, section: t("palette.section.nunopi"), label: t(`mode.${v}`), icon: VIEW_ICON[v], run: () => onNavigate(v) }))
      : [];
    return [...mustard, ...nunopiNav, ...tabCmds];
  }, [t, onNavigate, onOpenSettings, tabCmds, settingsHint]);

  return <CommandPalette open={open} commands={commands} onClose={() => setOpen(false)} />;
}

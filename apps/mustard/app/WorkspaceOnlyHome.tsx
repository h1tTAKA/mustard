"use client";

// nunopiEnabled=false 경로(#896 서브6) — Mustard(ADE) 워크스페이스 전용 홈.
// 학습 표면(@mustard/nunopi 학습 컴포넌트·useCodeAnalysis)을 일절 import하지 않는다 →
// 이 경로만 타는 빌드는 학습 청크를 안 싣는다. 셸(AppShell 등)은 packages/nunopi 잔류이므로 여전히 참조.
// NOTE: 제대로 된 워크스페이스-우선 홈 UI는 피봇(추후) — 여기선 부팅+게이트 증명 수준의 최소 구성.
import { useEffect, useState, useRef } from "react";
import { AppShell } from "@mustard/nunopi";
import { AgentLogo, type AgentId } from "@/components/workspace/AgentLogo";
import { SettingsDrawer } from "@mustard/nunopi";
import { ConfirmProvider, ToastProvider, I18nProvider } from "@mustard/core";
import GlobalCommandPalette from "@/components/ui/GlobalCommandPalette";
import { isNunopiEnabled, setNunopiEnabled } from "@/lib/product";
import WorkspaceTabs, { type WorkspaceTabsHandle } from "@/components/workspace/WorkspaceTabs";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { type ThemeId, applyTheme, getStoredTheme, setStoredTheme } from "@mustard/core";
import { applyStoredAppearance } from "@mustard/core";

const SETTINGS_STORAGE_KEY = "nunopi:provider-settings";
const DEFAULT_PROVIDER_ID: AgentProviderKind = "claude-agent";

export default function WorkspaceOnlyHome() {
  const [providerId] = useState<AgentProviderKind>(DEFAULT_PROVIDER_ID);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const wsRef = useRef<WorkspaceTabsHandle>(null);

  // 테마(#914 멀티) — 학습 홈과 동일 키·동작.
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setProviderSettings(JSON.parse(raw) as ProviderSettings);
    } catch { /* ignore */ }
  }, []);

  function handleSettingsSave(next: ProviderSettings) {
    setProviderSettings(next);
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  return (
    <I18nProvider>
    <ConfirmProvider>
    <ToastProvider>
      <AppShell
        onOpenSettings={() => setIsSettingsOpen(true)}
        workspace
        workspaceView={
          <WorkspaceTabs
            ref={wsRef}
            active
            providerId={providerId}
            providerSettings={providerSettings}
            onExitWorkspace={() => {}}
            onOpenMemorize={() => {}}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        }
      />
      <SettingsDrawer
        agentLogo={(id) => <AgentLogo agent={id as AgentId} size={16} />}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        variant="modal"
        settings={providerSettings}
        onSave={handleSettingsSave}
        theme={theme}
        onThemeChange={changeTheme}
        showLearning={false}
        nunopiEnabled={isNunopiEnabled()}
        onNunopiEnabledChange={(on) => { setNunopiEnabled(on); location.reload(); }}
      />
      <GlobalCommandPalette onNavigate={() => {}} onOpenSettings={() => setIsSettingsOpen(true)} vm="workspace" workspaceRef={wsRef} />
    </ToastProvider>
    </ConfirmProvider>
    </I18nProvider>
  );
}

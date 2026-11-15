"use client";
// 설정 > 채팅(#1341) — 터미널 칸 채팅 모드의 기본값. 값은 앱 설정(core CHATKEYS)이라 바로 반영.
import { useT, useSetting, setSetting, CHATKEYS, CHAT_DEFAULTS } from "@mustard/core";
import { SettingRow, Segmented } from "./settingsControls";

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function ChatSettingsSection() {
  const t = useT();
  const view = useSetting<"ask" | "term" | "chat">(CHATKEYS.defaultView, CHAT_DEFAULTS.defaultView);
  const mode = useSetting<"default" | "full">(CHATKEYS.newChatMode, CHAT_DEFAULTS.newChatMode);
  const queue = useSetting<boolean>(CHATKEYS.queueWhileBusy, CHAT_DEFAULTS.queueWhileBusy);
  const scroll = useSetting<boolean>(CHATKEYS.scrollOnSend, CHAT_DEFAULTS.scrollOnSend);
  return (
    <section id="set-chat" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("chatSet.desc")}</p>
      <SettingRow title={t("chatSet.defaultView")} desc={t("chatSet.defaultViewDesc")}>
        <Segmented options={["ask", "term", "chat"] as const} value={view} label={t("chatSet.defaultView")} render={(o) => t(o === "ask" ? "chatSet.ask" : o === "chat" ? "achat.modeChat" : "achat.modeTerminal")} onChange={(o) => setSetting(CHATKEYS.defaultView, o)} />
      </SettingRow>
      <SettingRow title={t("chatSet.newChatMode")} desc={t("chatSet.newChatModeDesc")}>
        <Segmented options={["default", "full"] as const} value={mode} label={t("chatSet.newChatMode")} render={(o) => (o === "full" ? "Full access" : "Default")} onChange={(o) => setSetting(CHATKEYS.newChatMode, o)} />
      </SettingRow>
      <SettingRow title={t("chatSet.queue")} desc={t("chatSet.queueDesc")}>
        <Switch on={queue} label={t("chatSet.queue")} onChange={(v) => setSetting(CHATKEYS.queueWhileBusy, v)} />
      </SettingRow>
      <SettingRow title={t("chatSet.scroll")} desc={t("chatSet.scrollDesc")}>
        <Switch on={scroll} label={t("chatSet.scroll")} onChange={(v) => setSetting(CHATKEYS.scrollOnSend, v)} />
      </SettingRow>
    </section>
  );
}

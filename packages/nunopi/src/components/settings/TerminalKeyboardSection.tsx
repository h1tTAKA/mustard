"use client";
// 설정 > 터미널 > 키보드(#1213) — 맥 Option을 Alt로(자동·양쪽·왼쪽만·오른쪽만·끄기). 자동이면 지금 입력 소스로 정한 결과도 보여줌.
// 입력 소스 IPC는 데스크톱 앱(Mustard)에만 있어 타입은 여기서만 좁혀 씀.
import { useEffect, useState } from "react";
import { useT, useSetting, setSetting, TKEYS, readMacOptionAsAlt, effectiveMacOptionAsAlt, MAC_OPTION_AS_ALT } from "@mustard/core";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const readSource = () => (typeof window === "undefined" ? undefined : (window.nunopiDesktop as unknown as { keyboardInputSource?: () => Promise<string | null> } | undefined)?.keyboardInputSource);

export default function TerminalKeyboardSection() {
  const t = useT();
  const stored = useSetting<unknown>(TKEYS.macOptionAsAlt, undefined);
  const legacy = useSetting<unknown>(TKEYS.macOptionIsMeta, undefined);
  const mode = readMacOptionAsAlt(stored, legacy);
  const [source, setSource] = useState<string | null | undefined>(undefined); // undefined = 아직 모름
  useEffect(() => {
    const read = readSource();
    if (!read) return;
    const load = () => { read().then((v) => setSource(v ?? null)).catch(() => setSource(null)); };
    load();
    window.addEventListener("focus", load); // 다른 앱에서 입력 소스 바꾸고 돌아오면 다시
    return () => window.removeEventListener("focus", load);
  }, []);
  if (!isMac) return null;
  const sourceName = source ? source.split(".").pop() : t("settings.optionAltUnknown");
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.terminalMacOptionIsMeta")}</span>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.optionAltDesc")}</p>
        </div>
        <div className="inline-flex shrink-0 rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900" role="radiogroup" aria-label={t("settings.terminalMacOptionIsMeta")}>
          {MAC_OPTION_AS_ALT.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setSetting(TKEYS.macOptionAsAlt, m)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === m ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>{t(`settings.optionAlt.${m}`)}</button>
          ))}
        </div>
      </div>
      {mode === "auto" && source !== undefined && (
        <p className="text-right text-xs text-zinc-500 dark:text-zinc-400">{t("settings.optionAltDetected", { source: sourceName ?? "", result: t(`settings.optionAlt.${effectiveMacOptionAsAlt("auto", source)}`) })}</p>
      )}
    </div>
  );
}

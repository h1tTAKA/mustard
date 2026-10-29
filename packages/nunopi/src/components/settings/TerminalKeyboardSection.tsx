"use client";
// 설정 > 터미널 > 키보드(#1213) — 맥 Option을 Alt로(자동·양쪽·왼쪽만·오른쪽만·끄기, 자동이면 지금 입력 소스로 정한 결과도), JIS ¥ → 백슬래시, 더블클릭 단어 구분 기호.
// 입력 소스 IPC는 데스크톱 앱(Mustard)에만 있어 타입은 여기서만 좁혀 씀.
import { useEffect, useState } from "react";
import { useT, useSetting, setSetting, TKEYS, TERMINAL_DEFAULTS, readMacOptionAsAlt, effectiveMacOptionAsAlt, MAC_OPTION_AS_ALT, DEFAULT_WORD_SEPARATOR } from "@mustard/core";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const readSource = () => (typeof window === "undefined" ? undefined : (window.nunopiDesktop as unknown as { keyboardInputSource?: () => Promise<string | null> } | undefined)?.keyboardInputSource);

export default function TerminalKeyboardSection() {
  const t = useT();
  const stored = useSetting<unknown>(TKEYS.macOptionAsAlt, undefined);
  const legacy = useSetting<unknown>(TKEYS.macOptionIsMeta, undefined);
  const mode = readMacOptionAsAlt(stored, legacy);
  const yen = useSetting<boolean>(TKEYS.jisYenToBackslash, TERMINAL_DEFAULTS.jisYenToBackslash);
  const wordSep = useSetting<string>(TKEYS.wordSeparator, TERMINAL_DEFAULTS.wordSeparator);
  const [source, setSource] = useState<string | null | undefined>(undefined); // undefined = 아직 모름
  useEffect(() => {
    const read = readSource();
    if (!read) return;
    const load = () => { read().then((v) => setSource(v ?? null)).catch(() => setSource(null)); };
    load();
    window.addEventListener("focus", load); // 다른 앱에서 입력 소스 바꾸고 돌아오면 다시
    return () => window.removeEventListener("focus", load);
  }, []);
  const sourceName = source ? source.replace(/^com\.apple\.(keylayout|inputmethod)\./, "") : t("settings.optionAltUnknown"); // 예: Korean.2SetKorean, ABC
  return (
    <>
    {isMac && (
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
    )}
    {isMac && (
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0"><span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.jisYen")}</span><span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("settings.jisYenDesc")}</span></span>
        <button type="button" role="switch" aria-checked={yen} aria-label={t("settings.jisYen")}
          onClick={() => setSetting(TKEYS.jisYenToBackslash, !yen)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${yen ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${yen ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
    )}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="min-w-0"><span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.wordSeparator")}</span><span className="block text-xs text-zinc-400 dark:text-zinc-500">{t("settings.wordSeparatorDesc")}</span></span>
      <input type="text" value={wordSep} placeholder={DEFAULT_WORD_SEPARATOR} spellCheck={false} aria-label={t("settings.wordSeparator")}
        onChange={(e) => setSetting(TKEYS.wordSeparator, e.target.value)}
        className="w-40 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
    </div>
    </>
  );
}

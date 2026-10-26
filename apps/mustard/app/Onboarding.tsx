"use client";

// 첫 실행 온보딩(#902) — nunopi 학습툴 on/off + 언어 + 에이전트 CLI 경로. mustard:onboarded 없을 때만.
// 디자인(#902 재설계): 화면 정중앙 카드, 중립 zinc 팔레트 + 단일 액센트(mustard),
// gradient 없음, 일관 rounded/보더/틴트. #914서 테마 인식(light/dark 페어링) — 저장 테마 base 따라감.
// 온보딩 내 테마 선택 스텝은 후속.
import { useEffect } from "react";
import { useState } from "react";
import { I18nProvider, useLocale, useT, LOCALES, type Locale } from "@mustard/core";
import { setNunopiEnabled } from "@/lib/product";
import { IconFolderOpen, IconSparkles } from "@tabler/icons-react";
import MustardMark from "@/components/brand/MustardMark";

type CliPaths = { claudeCode?: string; codex?: string; opencode?: string };

function OnboardingInner({ onDone }: { onDone: () => void }) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [nunopi, setNunopi] = useState(true);
  const [paths, setPaths] = useState<CliPaths>({});
  // Onboarding은 page.tsx가 client 마운트 후에만 렌더(SSR 없음) → window 참조 안전.
  const isDesktop = typeof window !== "undefined" && !!window.nunopiDesktop;

  useEffect(() => {
    if (isDesktop) window.nunopiDesktop?.getRuntimePaths().then((p) => setPaths((prev) => ({ ...prev, ...p }))).catch(() => {});
  }, [isDesktop]);

  async function finish() {
    setNunopiEnabled(nunopi); // 언어는 setLocale이 이미 실시간 영속.
    if (isDesktop) { try { await window.nunopiDesktop?.setRuntimePaths(paths); } catch { /* resolver 폴백 */ } }
    try { localStorage.setItem("mustard:onboarded", "1"); } catch { /* ignore */ }
    onDone();
  }

  // ⌘⏎ / Ctrl+⏎ = 시작(IDE 관용).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void finish(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // finish는 매 렌더 새로 생성돼 deps서 제외(대신 finish가 닫는 상태·콜백을 나열). exhaustive-deps는 그래서 disable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nunopi, paths, isDesktop, onDone]);

  const CLI: { key: keyof CliPaths; label: string; ph: string }[] = [
    { key: "claudeCode", label: "Claude Code", ph: "claude" },
    { key: "codex", label: "Codex", ph: "codex" },
    { key: "opencode", label: "OpenCode", ph: "opencode" },
  ];

  return (
    // 화면 정중앙 — fixed inset-0 + min-h-full flex center(내용 길면 스크롤).
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-[480px] rounded-2xl border border-zinc-200 bg-white/60 p-8 shadow-[0_10px_40px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:bg-zinc-900/50 dark:shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
          {/* 헤더 — 브랜드 심볼(겨자 꽃가지) + 워드마크 */}
          <div className="mb-7 flex flex-col items-center text-center">
            <MustardMark size={56} className="mb-3" />
            <h1 className="text-4xl font-bold tracking-tight text-mustard-400">Mustard</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-zinc-400">{t("onboarding.welcome")}</p>
          </div>

          <div className="space-y-6">
            {/* 언어 — 세그먼트 */}
            <section className="space-y-2.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{t("onboarding.langLabel")}</div>
              <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
                {LOCALES.map((l) => {
                  const on = locale === l.value;
                  return (
                    <button key={l.value} type="button" onClick={() => setLocale(l.value as Locale)}
                      className={`rounded-md px-4 py-1.5 text-sm transition ${on ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                      {l.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* nunopi 학습 모듈 — 옵션 행 */}
            <section className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{t("onboarding.nunopiLabel")}</div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-800/25">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <IconSparkles size={18} stroke={1.75} className={nunopi ? "text-mustard-400" : "text-zinc-500"} aria-hidden />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">nunopi</span>
                  </div>
                  <button type="button" role="switch" aria-checked={nunopi} aria-label={t("onboarding.nunopiLabel")}
                    onClick={() => setNunopi((v) => !v)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${nunopi ? "bg-mustard-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
                    <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all ${nunopi ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t("onboarding.nunopiDesc")}</p>
              </div>
            </section>

            {/* 에이전트 CLI 경로 — 데스크톱만 */}
            {isDesktop && (
              <section className="space-y-2.5">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{t("onboarding.cliLabel")}</div>
                  <p className="mt-1 text-xs text-zinc-500">{t("onboarding.cliDesc")}</p>
                </div>
                <div className="space-y-1.5">
                  {CLI.map(({ key, label, ph }) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-xs text-zinc-400">{label}</span>
                      <input type="text" value={paths[key] ?? ""} placeholder={ph}
                        onChange={(e) => setPaths((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-mono text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600" />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* 시작 */}
          <button type="button" onClick={finish}
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-lg bg-mustard-500 px-4 py-2.5 text-sm font-semibold text-brown-900 transition hover:bg-mustard-400">
            <IconFolderOpen size={16} stroke={2} aria-hidden />
            {t("onboarding.start")}
            <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-brown-900/25 px-1.5 py-0.5 text-[10px] font-medium leading-none">⌘⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <I18nProvider>
      <OnboardingInner onDone={onDone} />
    </I18nProvider>
  );
}

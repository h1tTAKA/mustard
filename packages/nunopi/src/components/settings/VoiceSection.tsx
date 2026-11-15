"use client";
// 설정 > 음성(#1341) — 채팅 입력 받아쓰기. 켜기·단축키(단축키 설정의 chat.dictate)·누르는 방식·엔진·언어·마이크.
// 엔진: macOS 음성 인식(기본, 설치 없음) 또는 이 Mac에서 도는 로컬 모델(받아서 씀, 소리가 밖으로 안 나감).
// 모델 표: 고른 언어 기준 품질(공개 측정 오류율 구간)·추천 배지·크기, [받기]·진행(취소)·[쓰기]·지우기. 지원 안 하는 언어면 흐리게.
import { useEffect, useState } from "react";
import { IconDownload, IconX, IconTrash, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useT, useLocale, useSetting, setSetting, useShortcutHint, VOICEKEYS, VOICE_DEFAULTS } from "@mustard/core";
import { SettingRow, Segmented } from "./settingsControls";

type Model = { id: string; label: string; size: number; errors: Record<string, number>; recommended: string[]; licence: string; installed: boolean; downloading: { done: number; total: number } | null };
type DictApi = {
  info?: () => Promise<{ available: boolean; local: boolean; devices: { id: string; name: string; default: boolean }[]; models: Model[] }>;
  downloadModel?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  cancelModel?: (id: string) => Promise<boolean>;
  removeModel?: (id: string) => Promise<boolean>;
  onModelProgress?: (cb: (p: { id: string; done: number; total: number }) => void) => () => void;
};
const api = (): DictApi | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { nunopiDesktop?: { dictation?: DictApi } }).nunopiDesktop?.dictation);
const LANGS = ["ko", "ja", "en", "zh", "de", "es", "fr"] as const;
// 오류율 → 품질 등급(≤3 탁월 · ≤6 아주 좋음 · ≤10 좋음 · ≤20 보통 · 그 위 낮음)
const grade = (e?: number) => (e === undefined ? "none" : e <= 3 ? "5" : e <= 6 ? "4" : e <= 10 ? "3" : e <= 20 ? "2" : "1");
const mb = (b: number) => `${Math.round(b / 1_000_000)}MB`;

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-mustard-600 dark:bg-mustard-400" : "bg-zinc-400 dark:bg-zinc-700"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function VoiceSection() {
  const t = useT();
  const { locale } = useLocale();
  const enabled = useSetting<boolean>(VOICEKEYS.enabled, VOICE_DEFAULTS.enabled);
  const mode = useSetting<"auto" | "hold" | "toggle">(VOICEKEYS.mode, VOICE_DEFAULTS.mode);
  const engine = useSetting<"system" | "local">(VOICEKEYS.engine, VOICE_DEFAULTS.engine);
  const modelId = useSetting<string>(VOICEKEYS.modelId, VOICE_DEFAULTS.modelId);
  const langSet = useSetting<string>(VOICEKEYS.language, VOICE_DEFAULTS.language);
  const device = useSetting<string>(VOICEKEYS.device, VOICE_DEFAULTS.device);
  const hint = useShortcutHint("chat.dictate");
  const [info, setInfo] = useState<Awaited<ReturnType<NonNullable<DictApi["info"]>>> | null>(null);
  const [err, setErr] = useState("");
  const lang = langSet || (LANGS as readonly string[]).find((l) => l === locale) || "en";
  const refresh = () => void api()?.info?.().then(setInfo).catch(() => {});
  useEffect(() => {
    refresh();
    const off = api()?.onModelProgress?.((p) => setInfo((cur) => cur && { ...cur, models: cur.models.map((m) => (m.id === p.id ? { ...m, downloading: p.done < 0 ? null : { done: p.done, total: p.total } } : m)) }));
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 한 번 구독
  const download = async (id: string) => {
    setErr("");
    const r = await api()?.downloadModel?.(id);
    if (r && !r.ok && r.error !== "cancelled") setErr(t("voice.downloadFailed", { m: r.error ?? "" }));
    if (r?.ok) { setSetting(VOICEKEYS.modelId, id); setSetting(VOICEKEYS.engine, "local"); } // 받으면 바로 그 모델로
    refresh();
  };
  const remove = async (id: string) => { await api()?.removeModel?.(id); if (modelId === id) { setSetting(VOICEKEYS.modelId, ""); setSetting(VOICEKEYS.engine, "system"); } refresh(); };
  const models = [...(info?.models ?? [])].sort((a, b) => (a.errors[lang] ?? 99) - (b.errors[lang] ?? 99));

  return (
    <section id="set-voice" className="scroll-mt-4 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("voice.desc")}</p>
      <SettingRow title={t("voice.enabled")} desc={t("voice.enabledDesc")}>
        <Switch on={enabled} label={t("voice.enabled")} onChange={(v) => setSetting(VOICEKEYS.enabled, v)} />
      </SettingRow>
      <SettingRow title={t("voice.shortcut")} desc={t("voice.shortcutDesc")}>
        <kbd className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{hint || "—"}</kbd>
      </SettingRow>
      <SettingRow title={t("voice.mode")} desc={t(`voice.modeDesc.${mode}`)}>
        <Segmented options={["auto", "hold", "toggle"] as const} value={mode} label={t("voice.mode")} render={(o) => t(`voice.mode.${o}`)} onChange={(o) => setSetting(VOICEKEYS.mode, o)} />
      </SettingRow>
      <SettingRow title={t("voice.language")} desc={t("voice.languageDesc")}>
        <select value={langSet} onChange={(e) => setSetting(VOICEKEYS.language, e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <option value="">{t("voice.langApp")}</option>
          {LANGS.map((l) => <option key={l} value={l}>{t(`voice.lang.${l}`)}</option>)}
        </select>
      </SettingRow>
      <SettingRow title={t("voice.engine")} desc={t(engine === "local" ? "voice.engineLocalDesc" : "voice.engineSystemDesc")}>
        <Segmented options={["system", "local"] as const} value={engine} label={t("voice.engine")} render={(o) => t(`voice.engine.${o}`)}
          onChange={(o) => { setSetting(VOICEKEYS.engine, o); if (o === "local" && !info?.models.some((m) => m.installed && m.id === modelId)) { const first = info?.models.find((m) => m.installed); if (first) setSetting(VOICEKEYS.modelId, first.id); } }} />
      </SettingRow>
      {/* 로컬 모델 표 */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          <span>{t("voice.model")}</span><span className="w-20 text-right">{t("voice.quality", { lang: t(`voice.lang.${lang}`) })}</span><span className="w-14 text-right">{t("voice.size")}</span><span className="w-24" />
        </div>
        {!info ? <p className="px-3 py-3 text-xs text-zinc-400">…</p> : !info.local ? <p className="px-3 py-3 text-xs text-zinc-500">{t("voice.localUnavailable")}</p> : models.map((m) => {
          const g = grade(m.errors[lang]);
          const rec = m.recommended.includes(lang);
          const using = engine === "local" && modelId === m.id && m.installed;
          return (
            <div key={m.id} className={`group grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2.5 last:border-b-0 dark:border-zinc-800/70 ${g === "none" ? "opacity-60" : ""}`}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm text-zinc-800 dark:text-zinc-100">{m.label}{rec && <span className="rounded bg-mustard-500/15 px-1.5 text-[10.5px] font-medium text-mustard-700 dark:text-mustard-300">{t("voice.recommended")}</span>}</span>
                <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">{t(`voice.modelDesc.${m.id}`)} · {m.licence}</span>
              </span>
              <span className="w-20 text-right text-xs text-zinc-600 dark:text-zinc-300" title={m.errors[lang] !== undefined ? `${m.errors[lang]}%` : undefined}>{t(`voice.grade.${g}`)}</span>
              <span className="w-14 text-right text-xs tabular-nums text-zinc-500">{mb(m.size)}</span>
              <span className="flex w-24 items-center justify-end gap-1">
                {m.downloading ? (
                  <>
                    <span className="text-[11px] tabular-nums text-zinc-500">{Math.floor((m.downloading.done / m.downloading.total) * 100)}%</span>
                    <button type="button" onClick={() => void api()?.cancelModel?.(m.id)} aria-label={t("voice.cancel")} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><IconX size={13} /></button>
                  </>
                ) : m.installed ? (
                  <>
                    {using ? <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><IconCheck size={13} stroke={2} />{t("voice.inUse")}</span>
                      : <button type="button" onClick={() => { setSetting(VOICEKEYS.modelId, m.id); setSetting(VOICEKEYS.engine, "local"); }} className="rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">{t("voice.use")}</button>}
                    <button type="button" onClick={() => void remove(m.id)} aria-label={t("voice.remove")} title={t("voice.remove")} className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-zinc-800"><IconTrash size={13} /></button>
                  </>
                ) : (
                  <button type="button" onClick={() => void download(m.id)} className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${rec ? "bg-mustard-500 text-white hover:bg-mustard-600" : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"}`}><IconDownload size={12} />{t("voice.download")}</button>
                )}
              </span>
              {m.downloading && <div className="col-span-4 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full bg-mustard-500 transition-all" style={{ width: `${(m.downloading.done / m.downloading.total) * 100}%` }} /></div>}
            </div>
          );
        })}
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{t("voice.qualityNote")}</p>
      <SettingRow title={t("voice.microphone")} desc={t("voice.microphoneDesc")}>
        <select value={device} onChange={(e) => setSetting(VOICEKEYS.device, e.target.value)}
          className="max-w-[240px] rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <option value="">{t("voice.micDefault")}</option>
          {(info?.devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}{d.default ? ` (${t("voice.systemDefault")})` : ""}</option>)}
        </select>
      </SettingRow>
      {info === null && <IconLoader2 size={14} className="animate-spin text-zinc-400" aria-hidden />}
    </section>
  );
}

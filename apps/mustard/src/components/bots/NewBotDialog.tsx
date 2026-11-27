"use client";
// 새 봇 창(#1397) — 맡기고 싶은 일을 정해 봇을 바로 만든다(추천·고르기 없음, 유저 결정 11-27).
// 위: 봇 색 띠 + 아바타(색 고르기) / 이름(선택, 비우면 정체성 첫 줄) / 정체성 = 누구고 무슨 일을 하는지(임무) / "이 컴퓨터에서 [AI]로 실행".
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";
import { BOT_COLORS, CREW_PROVIDERS, type CrewProvider } from "@/lib/crew/crewRoleDefaults";
import { PROVIDER_LABEL } from "@/components/workspace/crew/crewUi";
import BotAvatar from "./BotAvatar";

export type CreateResult = "ok" | "rejected" | "unknown";
const NAME_MAX = 24; // 자동 이름 길이(목록 한 줄에 들어가게)

// 정체성 첫 줄 → 이름. 코드포인트 단위로 자름(한글은 안 깨짐, 합친 이모지는 끝에서 갈릴 수 있음 — 이름이라 감수). 잘렸으면 "…".
export function nameFromMission(mission: string): string {
  const first = [...(mission.trim().split("\n")[0] ?? "").trim()];
  return first.length > NAME_MAX ? `${first.slice(0, NAME_MAX).join("")}…` : first.join("");
}
// 한글·일본어 조합 확정 Enter — Safari는 확정 뒤 keydown에 isComposing=false·keyCode 229를 줌
const composing = (e: KeyboardEvent<HTMLElement>) => e.nativeEvent.isComposing || e.keyCode === 229;

const FIELD = "w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-mustard-400/70 focus:ring-4 focus:ring-mustard-400/10 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:placeholder:text-zinc-500";
const LABEL = "mb-1.5 block text-[12px] font-medium text-zinc-600 dark:text-zinc-300";

export default function NewBotDialog({ onClose, create }: {
  onClose: () => void;
  create: (b: { name: string; mission: string; provider: CrewProvider; color: string }) => Promise<CreateResult>;
}) {
  const t = useT();
  const toast = useToast();
  const [color, setColor] = useState(BOT_COLORS[0]);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [provider, setProvider] = useState<CrewProvider>("claude-code");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // Esc = 닫기(만드는 중엔 안 닫음 — 결과를 못 보게 되니)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && !busyRef.current) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shownName = name.trim() || nameFromMission(mission);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const m = mission.trim();
    if (!m || busy) return;
    setBusy(true);
    const r = await create({ name: shownName, mission: m, provider, color });
    setBusy(false);
    if (r === "ok") { onClose(); return; }
    // 거절 = 못 만듦. 늦음(unknown) = 만들어졌는지 모름 → 창·글은 그대로 두고 "목록에 없을 때만 다시" 안내
    toast(t(r === "rejected" ? "bots.new.failed" : "bots.new.slow"), "error");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={() => { if (!busy) onClose(); }} aria-hidden />
      <form role="dialog" aria-modal="true" aria-label={t("bots.new.title")} onSubmit={submit}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
        {/* 봇 색 띠 — 고른 색이 위에서 아래로 옅어짐 */}
        <div aria-hidden className="h-[84px]" style={{ background: `linear-gradient(180deg, ${color}66 0%, ${color}14 70%, transparent 100%)` }} />
        <div className="-mt-12 px-5 pb-5">
          <div className="flex items-end gap-3">
            <span className="rounded-[18px] ring-4 ring-white dark:ring-[#14151c]">
              <BotAvatar name={shownName || "?"} color={color} size={64} />
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{t("bots.new.title")}</div>
              {/* 색 고르기 — 7색 */}
              <div role="radiogroup" aria-label={t("bots.new.color")} className="mt-1.5 flex gap-1.5">
                {BOT_COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} title={c} onClick={() => setColor(c)}
                    className={`h-4 w-4 rounded-full ring-offset-2 ring-offset-white transition dark:ring-offset-[#14151c] ${c === color ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : "hover:scale-110"}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <label className="block">
              <span className={LABEL}>{t("bots.new.name")}</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus
                placeholder={nameFromMission(mission) || t("bots.new.namePlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter" && composing(e)) e.preventDefault(); }}
                className={`${FIELD} h-9`} />
            </label>
            <label className="block">
              <span className={LABEL}>{t("bots.new.identity")} <span className="font-normal text-zinc-400 dark:text-zinc-500">· {t("bots.new.identityHint")}</span></span>
              <textarea value={mission} onChange={(e) => setMission(e.target.value)} rows={4} maxLength={4000}
                placeholder={t("bots.new.identityPlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !composing(e)) { e.preventDefault(); void submit(); } }}
                className={`${FIELD} resize-none py-2 leading-relaxed`} />
            </label>
            {/* 실행 줄 — 문장 안에 AI 고르기 */}
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-zinc-500 dark:text-zinc-400">
              <span>{t("bots.new.runsOn")}</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value as CrewProvider)} aria-label={t("bots.new.agent")}
                className="h-7 rounded-md border border-zinc-200 bg-white px-1.5 text-[12.5px] font-medium text-zinc-800 outline-none focus:border-mustard-400/70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                {CREW_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p] ?? p}</option>)}
              </select>
              {t("bots.new.runsOnTail") && <span>{t("bots.new.runsOnTail")}</span>}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10">
              {t("bots.new.cancel")}
            </button>
            <button type="submit" disabled={!mission.trim() || busy} title={t("bots.new.submitHint")}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-mustard-500 px-3.5 text-[12.5px] font-semibold text-brown-900 transition hover:bg-mustard-400 disabled:opacity-50">
              {busy && <IconLoader2 size={14} stroke={2.2} className="animate-spin" aria-hidden />}
              {t("bots.new.create")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

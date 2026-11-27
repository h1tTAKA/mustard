"use client";
// 봇 홈 첫 실행·새 봇(#1397) — 맡길 일을 적으면 그 임무로 봇을 바로 만든다(유저 결정: 추천·고르기 없이 맡기고 싶은 걸 맡김).
// 이름은 비우면 임무 첫 줄에서 짓는다. 만든 뒤 이름·임무는 대화(H4)·설정(H3)에서 고친다.
import { useState, type FormEvent } from "react";
import { IconRobot, IconLoader2 } from "@tabler/icons-react";
import { useT, useToast } from "@mustard/core";

const NAME_MAX = 24; // 자동 이름 길이(목록 한 줄에 들어가게)

// 임무 첫 줄 → 이름. 코드포인트 단위로 자름(한글은 안 깨짐, 합친 이모지는 끝에서 갈릴 수 있음 — 이름이라 감수). 잘렸으면 "…".
export function nameFromMission(mission: string): string {
  const first = [...(mission.trim().split("\n")[0] ?? "").trim()];
  return first.length > NAME_MAX ? `${first.slice(0, NAME_MAX).join("")}…` : first.join("");
}

export default function BotOnboard({ create }: { create: (name: string, mission: string) => Promise<"ok" | "rejected" | "unknown"> }) {
  const t = useT();
  const toast = useToast();
  const [mission, setMission] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const m = mission.trim();
    if (!m || busy) return;
    setBusy(true);
    const n = name;
    const r = await create(name.trim() || nameFromMission(m), m);
    setBusy(false);
    if (r === "rejected") { toast(t("bots.onboard.createFailed"), "error"); return; }
    // 기다리는 동안 새로 쓴 글은 지우지 않음(리뷰). 응답이 늦었으면(unknown) 서버가 만들었을 수 있어 그대로 다시 누르면 겹침 → 비우고 안내
    setMission((cur) => (cur.trim() === m ? "" : cur));
    setName((cur) => (cur === n ? "" : cur));
    if (r === "unknown") toast(t("bots.onboard.createSlow"), "error"); // 확인 안 된 상태 — 성공(초록)으로 보이지 않게
  };

  return (
    <div className="nunopi-scroll flex flex-1 justify-center overflow-y-auto px-6 py-10">
      <form onSubmit={submit} className="my-auto flex w-full max-w-[640px] flex-col items-center gap-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-mustard-500/10 text-mustard-600 ring-1 ring-inset ring-mustard-500/25 dark:text-mustard-400">
          <IconRobot size={28} stroke={1.6} aria-hidden />
        </div>
        <div className="text-center">
          <h1 className="text-[22px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t("bots.onboard.title")}</h1>
          <p className="mt-2 text-[13.5px] text-zinc-500 dark:text-zinc-400">{t("bots.onboard.sub")}</p>
        </div>
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm transition focus-within:border-mustard-400/70 focus-within:ring-4 focus-within:ring-mustard-400/10 dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:focus-within:border-mustard-400/50">
          <textarea value={mission} onChange={(e) => setMission(e.target.value)} rows={4} maxLength={4000} autoFocus
            placeholder={t("bots.onboard.placeholder")} aria-label={t("bots.onboard.mission")}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }}
            className="block w-full resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500" />
          <div className="flex items-center gap-2 border-t border-zinc-100 px-1.5 pt-1.5 dark:border-zinc-800">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              placeholder={mission.trim() ? nameFromMission(mission) : t("bots.onboard.namePlaceholder")} aria-label={t("bots.onboard.name")}
              className="h-8 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:bg-zinc-100 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-800" />
            <button type="submit" disabled={!mission.trim() || busy} title={t("bots.onboard.submitHint")}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-mustard-500 px-4 text-[13px] font-semibold text-brown-900 transition hover:bg-mustard-400 disabled:opacity-50">
              {busy && <IconLoader2 size={14} stroke={2.2} className="animate-spin" aria-hidden />}
              {t("bots.onboard.create")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

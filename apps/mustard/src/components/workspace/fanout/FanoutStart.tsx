"use client";

import { useEffect, useState } from "react";
import { IconChevronRight, IconLoader2, IconSwords } from "@tabler/icons-react";
import { useT, useToast, getSetting, GKEYS, GIT_DEFAULTS } from "@mustard/core";
import { launchFanout } from "@/lib/repo/workspaceEvents";
import { FanoutPicker, SetupApproval, fanoutReady, type FanoutPick } from "./FanoutPicker";
import { useSetupChain, createFanoutRun } from "./useSetupChain";

// 겨루기 화면 안 시작 칸(#1313) — 새 창 없이 여기서 프롬프트·에이전트 고르고 시작(유저: "크루 대화창에서 그대로").
// 흐름은 새 작업공간 창 겨루기와 같음: 후보 만들기 → setup 줄(승인은 이 칸 안에서) → 다 끝나면 후보마다 터미널 탭·에이전트·프롬프트.
// root = Crew 대화방 경로(레포 탭이 보는 폴더) — launch는 그 폴더 터미널로, 서버는 원래 레포를 찾아 만듦.
// setup 줄이 도는 동안엔 이 화면 닫기·＋·대화방 칼 버튼을 잠금(닫혀 이 칸이 사라지면 남은 setup·에이전트 띄우기가 끊김).
// 한계: 오른쪽 패널을 접거나 다른 모드(GitHub·캐치업)로 바꾸거나 레포 탭 폴더를 바꾸면 대화방째 사라져 끊김 — 기다리던 승인이 없어지고 기록은 진행 중(탭 없음)으로 남음. 겨루기 화면의 "모두 버리기"로 정리.
export default function FanoutStart({ root, empty, fill, onBusy, onDone }: { root: string; empty: boolean; fill: boolean; onBusy: (b: boolean) => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const sc = useSetupChain(root);
  const [creating, setCreating] = useState(false);
  const [picks, setPicks] = useState<FanoutPick[]>([]);
  const [prompt, setPrompt] = useState("");
  const [more, setMore] = useState(false);
  const [base, setBase] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const busy = creating || sc.chain || sc.deciding;
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  // 시작점 후보(로컬·원격 브랜치) — 더 보기를 열 때 한 번
  useEffect(() => {
    if (!more || branches.length) return;
    void fetch("/api/repo/git-branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) })
      .then((r) => r.json()).then((d) => { if (d.ok) setBranches([...(d.local ?? []), ...(d.remote ?? [])]); }).catch(() => {});
  }, [more, branches.length, root]);

  const start = async () => {
    if (busy || !fanoutReady(picks, prompt)) return;
    setCreating(true);
    const prefix = getSetting<string>(GKEYS.branchPrefix, GIT_DEFAULTS.branchPrefix);
    const text = prompt.trim();
    const r = await createFanoutRun({ root, name: "", prompt: text, picks, base: base.trim(), prefix }); // 이름 비움 = fanout-<에이전트>
    if (!r.ok) { setCreating(false); toast(t("newWs.failed", { error: r.error }), "error"); return; }
    await sc.start(r.candidates.map((c) => c.dir), () => {
      launchFanout({ root, id: r.id, prompt: text, candidates: r.candidates }); // 겨루기 화면은 이 이벤트로 목록을 다시 읽고 새 겨루기를 고름
      toast(t("fanout.started", { n: r.candidates.length }));
      setPicks([]); setPrompt(""); setBase("");
      onDone();
    }, true);
    setCreating(false);
  };

  const input = "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] text-zinc-800 outline-none focus:border-mustard-500/60 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100";
  return (
    <div className={`nunopi-scroll overflow-y-auto p-3 ${fill ? "min-h-0 flex-1" : "max-h-[60%] shrink-0 border-b border-zinc-200 dark:border-zinc-800"}`}>
      {sc.setup ? (
        <SetupApproval script={sc.setup.script} busy={sc.deciding} onDecide={(v) => void sc.decide(v)} />
      ) : (
        <div className="space-y-2">
          <p className="text-[11.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t(empty ? "fanout.empty" : "fanout.desc")}</p>
          <FanoutPicker picks={picks} setPicks={setPicks} prompt={prompt} setPrompt={setPrompt} inputClass={input} disabled={busy} />
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
            className="flex items-center gap-0.5 text-[11.5px] font-medium text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            <IconChevronRight size={12} stroke={2} className={`transition ${more ? "rotate-90" : ""}`} aria-hidden />{t("fanout.base")}
          </button>
          {more && (
            <div>
              <input value={base} onChange={(e) => setBase(e.target.value)} disabled={busy} list="fanout-start-branches" placeholder={t("newWs.basePlaceholder")} className={`${input} font-mono`} />
              <datalist id="fanout-start-branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={() => void start()} disabled={busy || !fanoutReady(picks, prompt)}
              className="inline-flex items-center gap-1 rounded-lg bg-mustard-500 px-3.5 py-2 text-[13px] font-semibold text-brown-900 shadow-sm transition hover:bg-mustard-400 disabled:opacity-40">
              {busy ? <IconLoader2 size={13} className="animate-spin" aria-hidden /> : <IconSwords size={13} stroke={2} aria-hidden />}{busy ? t("fanout.starting") : t("fanout.start")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

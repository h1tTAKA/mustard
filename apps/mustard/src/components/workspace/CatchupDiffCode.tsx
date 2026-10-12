"use client";
// 캐치업 diff 카드의 변경 코드(#1060) — 기본 접힘, 펼치면 그 커밋·파일 diff를 처음 한 번 가져와 바뀐 구간만 빨강/초록으로.
// 구간 = diff 화면·자동 설명과 같은 groupHunks(앞뒤 3줄 컨텍스트) → 설명과 같은 단위. 코드는 저장 안 하고 git에서 읽음.
import { Fragment, useRef, useState } from "react";
import { IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { parseDiff, groupHunks } from "@/lib/hunkDiff";

export default function CatchupDiffCode({ root, hash, file }: { root: string; hash: string; file: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hunks, setHunks] = useState<string[] | null>(null); // null = 아직/불러오는 중
  const [failed, setFailed] = useState(false);
  const loadingRef = useRef(false); // 불러오는 중 다시 펼쳐도 중복 요청 X(#1060 리뷰)

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || hunks || loadingRef.current) return;
    setFailed(false); // 실패했어도 다시 펼치면 재시도
    loadingRef.current = true;
    fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash, file }) })
      .then((r) => r.json())
      .then((d) => { if (!d?.ok) throw new Error(); setHunks(groupHunks(parseDiff(String(d.diff ?? ""))).map((h) => h.diffText)); })
      .catch(() => setFailed(true))
      .finally(() => { loadingRef.current = false; });
  };

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[10.5px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
        <IconChevronDown size={12} stroke={2} className={`transition ${open ? "" : "-rotate-90"}`} aria-hidden />
        {open ? t("learn.hideDiffCode") : t("learn.showDiffCode")}
      </button>
      {open && (
        failed ? <p className="mt-1 text-[10px] text-rose-500">{t("learn.diffCodeError")}</p>
        : !hunks ? <div className="flex justify-center py-2"><IconLoader2 size={12} stroke={2} className="animate-spin text-zinc-400" aria-hidden /></div>
        : !hunks.length ? <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">{t("workspace.diffEmpty")}</p> // 바이너리 등 줄 단위 변경 없음
        : (
          // 길면 상자 안에서 스크롤(가로도) — 카드 목록 흐름을 안 밀어냄
          <div className="nunopi-scroll mt-1 max-h-80 overflow-auto rounded-md border border-zinc-200 bg-white font-mono text-[10.5px] leading-[1.45] dark:border-zinc-800 dark:bg-zinc-950">
            {hunks.map((h, i) => (
              <Fragment key={i}>
                {i > 0 && <div className="border-t border-dashed border-zinc-200 dark:border-zinc-800" aria-hidden />}
                {h.split("\n").map((ln, j) => {
                  const kind = ln.startsWith("+ ") ? "add" : ln.startsWith("- ") ? "del" : "ctx";
                  return (
                    <div key={j} className={`whitespace-pre px-2 ${kind === "add" ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : kind === "del" ? "bg-rose-500/15 text-rose-800 dark:text-rose-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                      {ln || " "}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        )
      )}
    </div>
  );
}

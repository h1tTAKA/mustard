"use client";
// 캐치업 diff 카드의 변경 코드(#1060) — 기본 접힘, 펼치면 그 커밋·파일 diff를 처음 한 번 가져와 바뀐 구간만 빨강/초록으로.
// 구간 = diff 화면·자동 설명과 같은 groupHunks(앞뒤 3줄 컨텍스트) → 설명과 같은 단위. 코드는 저장 안 하고 git에서 읽음.
// #1066 왼쪽에 옛/새 줄 번호. range를 주면 그 줄 범위 구간 하나만(설명 구간별 펼치기), label = 버튼 글자.
import { Fragment, useRef, useState } from "react";
import { IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { type DLine, parseDiff, groupHunks } from "@/lib/hunkDiff";

export default function CatchupDiffCode({ root, hash, file, range, label }: { root: string; hash: string; file: string; range?: { from: number; to: number }; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hunks, setHunks] = useState<DLine[][] | null>(null); // null = 아직/불러오는 중
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
      .then((d) => {
        if (!d?.ok) throw new Error();
        const lines = parseDiff(String(d.diff ?? ""));
        const all = groupHunks(lines).filter((h) => !range || (h.newFrom === range.from && h.newTo === range.to));
        setHunks(all.map((h) => lines.slice(h.ctxFrom, h.ctxTo + 1).filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx")));
      })
      .catch(() => setFailed(true))
      .finally(() => { loadingRef.current = false; });
  };

  // 줄 번호 칸 폭 = 가장 큰 번호 자릿수
  const digits = String(Math.max(1, ...(hunks ?? []).flat().map((l) => Math.max(l.oldN ?? 0, l.newN ?? 0)))).length;
  const num = (n: number | null) => <span className="inline-block select-none pr-1.5 text-right text-zinc-400/80 dark:text-zinc-600" style={{ width: `${digits + 1}ch` }}>{n ?? ""}</span>;

  return (
    <div className="mb-2">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[10.5px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
        <IconChevronDown size={12} stroke={2} className={`transition ${open ? "" : "-rotate-90"}`} aria-hidden />
        {label ?? (open ? t("learn.hideDiffCode") : t("learn.showDiffCode"))}
      </button>
      {open && (
        failed ? <p className="mt-1 text-[10px] text-rose-500">{t("learn.diffCodeError")}</p>
        : !hunks ? <div className="flex justify-center py-2"><IconLoader2 size={12} stroke={2} className="animate-spin text-zinc-400" aria-hidden /></div>
        : !hunks.length ? <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">{t("workspace.diffEmpty")}</p> // 바이너리 등 줄 단위 변경 없음(또는 그 뒤 파일이 바뀜)
        : (
          // 길면 상자 안에서 스크롤(가로도) — 카드 목록 흐름을 안 밀어냄
          <div className="nunopi-scroll mt-1 max-h-80 overflow-auto rounded-md border border-zinc-200 bg-white font-mono text-[10.5px] leading-[1.45] dark:border-zinc-800 dark:bg-zinc-950">
            {/* 안쪽 = 가장 긴 줄 폭(w-max, 최소 상자 폭) → 가로 스크롤해도 줄 배경(빨강/초록)이 끝까지(#1062에서 수정) */}
            <div className="w-max min-w-full">
            {hunks.map((h, i) => (
              <Fragment key={i}>
                {i > 0 && <div className="border-t border-dashed border-zinc-200 dark:border-zinc-800" aria-hidden />}
                {h.map((l, j) => (
                  <div key={j} className={`whitespace-pre pr-2 ${l.kind === "add" ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : l.kind === "del" ? "bg-rose-500/15 text-rose-800 dark:text-rose-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {num(l.oldN)}{num(l.newN)}{l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}{l.text || " "}
                  </div>
                ))}
              </Fragment>
            ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

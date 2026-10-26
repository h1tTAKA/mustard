"use client";

import { useEffect, useRef, useState } from "react";
import { IconFolderOpen, IconMessages, IconFileCode, IconFileText, IconCards, IconChevronRight } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { isNunopiEnabled } from "@/lib/product";
// "+" 드롭다운 픽커(#769) — 워크스페이스에 새 탭으로 무엇을 열지 고른다(컴팩트 메뉴).
// "+" 버튼 아래에 앵커링(fixed). 레포는 폴더 다이얼로그, 모드는 즉시 빈 탭. 실제 추가는 onPick.
// 섹션 라벨 + 키보드 네비(↑↓/Enter) + 활성 chevron으로 다듬음.
export type AddKind = "repo" | "ask" | "code" | "text" | "memorize";

type Row = { kind: AddKind; Icon: typeof IconFolderOpen; labelKey: string; group: "ws" | "modes" };
const ROWS: Row[] = [
  { kind: "repo", Icon: IconFolderOpen, labelKey: "workspace.addRepo", group: "ws" },
  { kind: "ask", Icon: IconMessages, labelKey: "mode.ask", group: "modes" },
  { kind: "code", Icon: IconFileCode, labelKey: "mode.code", group: "modes" },
  { kind: "text", Icon: IconFileText, labelKey: "mode.text", group: "modes" },
  { kind: "memorize", Icon: IconCards, labelKey: "workspace.addMemorize", group: "modes" },
];

export default function WorkspaceAddMenu({ anchor, onClose, onPick }: {
  anchor: { left: number; top: number } | null;
  onClose: () => void;
  onPick: (kind: AddKind, target?: "tab" | "window") => void;
}) {
  const t = useT();
  // nunopi 학습툴 off(Mustard-only, #908)면 학습 모드 탭(ask/code/text/memorize) 숨김 — repo만.
  // 학습스트림·워크스페이스 질문·퀴즈는 레포 뷰 내장이라 여기 무관(존치).
  const rows = isNunopiEnabled() ? ROWS : ROWS.filter((r) => r.group !== "modes");
  // 새 창으로 열기(#789)는 Electron에서만. 메뉴는 클릭 후에만(클라이언트) 렌더돼 window 읽기 안전.
  const canWindow = typeof window !== "undefined" && !!window.nunopiDesktop?.openModeWindow;
  // 서브메뉴 방향(#789) — 우측 공간 부족(탭 많아 +가 우측이면)하면 왼쪽으로 뒤집어 잘림 방지.
  const MENU_W = 256; // w-64
  const SUB_W = 176; // w-44
  const openLeft = anchor !== null && typeof window !== "undefined" && anchor.left + MENU_W + SUB_W > window.innerWidth;
  const [activeIdx, setActiveIdx] = useState(0);
  const open = anchor !== null;
  // 최신 onPick 참조 — Enter 핸들러(effect 안 onKey)가 옛 onPick을 잡지 않게(stale closure 방지).
  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  const choose = (i: number) => { onPickRef.current(rows[i].kind); onClose(); };

  useEffect(() => {
    if (!open) return;
    setActiveIdx(0); // eslint-disable-line react-hooks/set-state-in-effect -- 열릴 때 첫 항목으로 리셋
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % rows.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i - 1 + rows.length) % rows.length); }
      else if (e.key === "Enter") { e.preventDefault(); setActiveIdx((i) => { choose(i); return i; }); }
    };
    // 팝오버 바깥 클릭/스크롤/리사이즈 → 닫기. 다음 틱부터 걸어 여는 클릭이 즉시 닫는 것 방지.
    const onDown = () => onClose();
    window.addEventListener("keydown", onKey);
    const id = setTimeout(() => { window.addEventListener("mousedown", onDown); window.addEventListener("resize", onClose); }, 0);
    return () => { clearTimeout(id); window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); window.removeEventListener("resize", onClose); };
  }, [open, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!anchor) return null;

  const label = (g: "ws" | "modes") => (
    <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
      {t(g === "ws" ? "workspace.addGroupWorkspace" : "workspace.addGroupModes")}
    </div>
  );

  return (
    <div role="menu" aria-label={t("workspace.addTitle")} onMouseDown={(e) => e.stopPropagation()}
      style={{ left: anchor.left, top: anchor.top }}
      className="fixed z-50 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[var(--s-menu)] dark:ring-white/5">
      {rows.map((row, i) => {
        const on = i === activeIdx;
        const first = i === 0 || rows[i - 1].group !== row.group;
        const isMode = row.group === "modes"; // 모드 행만 서브메뉴(탭 추가/새 창). 레포는 즉시 폴더 선택.
        return (
          <div key={row.kind}>
            {first && label(row.group)}
            <div className="relative">
              <button type="button" role="menuitem"
                onMouseMove={() => setActiveIdx(i)} onClick={() => choose(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${on ? "bg-zinc-100 text-zinc-900 dark:bg-white/[0.08] dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-200"}`}>
                {/* 활성 시 색 — 레포=인디고, 모드(질문/코드/글)=파랑(탭 아이콘과 일치). */}
                <row.Icon size={16} stroke={1.75} className={`shrink-0 ${on ? (row.group === "ws" ? "text-mustard-600 dark:text-mustard-400" : "text-sky-500 dark:text-sky-400") : "text-zinc-400 dark:text-zinc-500"}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{t(row.labelKey)}</span>
                {isMode && (
                  <IconChevronRight size={14} stroke={2} aria-hidden
                    className={`shrink-0 transition ${on ? "translate-x-0 text-zinc-400 opacity-100 dark:text-zinc-400" : "-translate-x-1 text-transparent opacity-0"}`} />
                )}
              </button>
              {/* 모드 행 hover 시 우측 서브메뉴(#789) — 탭에 추가 / 새 창으로 열기(Electron만). */}
              {isMode && on && (
                <div className={`absolute top-0 z-10 w-44 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[var(--s-menu)] dark:ring-white/5 ${openLeft ? "right-full mr-1" : "left-full ml-1"}`}>
                  <button type="button" role="menuitem"
                    onClick={() => { onPickRef.current(row.kind, "tab"); onClose(); }}
                    className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.08]">
                    {t("workspace.addAsTab")}
                  </button>
                  {canWindow && (
                    <button type="button" role="menuitem"
                      onClick={() => { onPickRef.current(row.kind, "window"); onClose(); }}
                      className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.08]">
                      {t("workspace.openInWindow")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

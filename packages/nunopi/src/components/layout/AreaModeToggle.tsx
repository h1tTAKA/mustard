"use client";

import { IconCode, IconFileText, IconMessage2, IconLayoutDashboard, IconMessages, IconCards, IconArrowBackUp } from "@tabler/icons-react";
import type { ViewMode } from "@mustard/core";
import { useT } from "@mustard/core";
// 공통 세그먼트 스타일.
const SEG_WRAP = "inline-flex rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900";
const SEG_ON = "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50";
const SEG_OFF = "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200";

// ── 1차: 영역 전환. 헤더 우측에 워크스페이스식 작은 아이콘으로(#785) — "현재 영역을 뺀
//    나머지 영역으로 가는 아이콘"만 표시. 워크스페이스 헤더(질문·분석·암기 아이콘)와 대칭. ──
interface AreaPrimaryToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  // "질문·분석" 진입 — 직전 하위뷰로 복귀(enterQAArea).
  onEnterQA: () => void;
  // 암기에서 "돌아가기" — 암기 진입 직전 영역(워크스페이스/독립)으로 복귀(#785).
  onBack: () => void;
  // 암기 배지 — 오늘 복습 due 수(0이면 숨김).
  memorizeBadge?: number;
  disabled?: boolean;
  // 워크스페이스 진입 아이콘 표시 여부(#894 서브5). 스탠드얼론 학습앱(apps/nunopi)은 워크스페이스가 없어 false.
  showWorkspace?: boolean;
}

// 워크스페이스 헤더 컨트롤 아이콘 버튼과 동일 스타일(#721) — 테두리 없는 hover 버튼.
const ICON_BTN = "relative shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

export default function AreaPrimaryToggle({ viewMode, onViewModeChange, onEnterQA, onBack, memorizeBadge = 0, disabled = false, showWorkspace = true }: AreaPrimaryToggleProps) {
  const t = useT();
  const isMemorize = viewMode === "memorize";
  // 질문·분석 하위뷰(질문·코드·글)일 때만 true. 홈(history)은 영역 중립이라 false → 셋 다 노출.
  const inQA = viewMode !== "workspace" && viewMode !== "memorize" && viewMode !== "history";
  // 암기 모드: 영역 아이콘 대신 "돌아가기" 하나 — 진입한 곳(워크스페이스/독립)으로 복귀(#785).
  if (isMemorize) {
    return (
      <button type="button" onClick={onBack} disabled={disabled}
        title={t("mode.back")} aria-label={t("mode.back")} className={ICON_BTN}>
        <IconArrowBackUp size={16} stroke={2} aria-hidden />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      {/* → 워크스페이스 (이 헤더는 항상 non-workspace라 상시 표시). 스탠드얼론 학습앱은 숨김(#894). */}
      {showWorkspace && (
        <button type="button" onClick={() => onViewModeChange("workspace")} disabled={disabled}
          title={t("mode.workspace")} aria-label={t("mode.workspace")} className={ICON_BTN}>
          <IconLayoutDashboard size={16} stroke={2} aria-hidden />
        </button>
      )}
      {/* → 질문·분석 (현재 QA면 숨김) */}
      {!inQA && (
        <button type="button" onClick={onEnterQA} disabled={disabled}
          title={t("mode.qaArea")} aria-label={t("mode.qaArea")} className={ICON_BTN}>
          <IconMessages size={16} stroke={2} aria-hidden />
        </button>
      )}
      {/* → 암기 (암기 모드는 위에서 early-return하므로 여기선 항상 표시) — due 배지 유지 */}
      <button type="button" onClick={() => onViewModeChange("memorize")} disabled={disabled}
        title={t("mode.memorize")} aria-label={t("mode.memorize")} className={ICON_BTN}>
        <IconCards size={16} stroke={2} aria-hidden />
        {memorizeBadge > 0 && (
          <span aria-label={`${t("mem.modeDue")} ${memorizeBadge}`}
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white">
            {memorizeBadge > 99 ? "99+" : memorizeBadge}
          </span>
        )}
      </button>
    </div>
  );
}

// ── 2차: 질문·분석 하위 뷰(질문·코드분석·글분석). 스트립 가운데에 배치(#725). ──
// memorize는 상시 퀵, 홈(history)은 로고 진입 전역 대시보드(#729)라 여기 없음.
const SUB_OPTIONS: { value: ViewMode; tKey: string; Icon: typeof IconCode }[] = [
  { value: "ask", tKey: "mode.ask", Icon: IconMessage2 },
  { value: "code", tKey: "mode.code", Icon: IconCode },
  { value: "text", tKey: "mode.text", Icon: IconFileText },
];

interface QASubToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  withCards?: boolean; // #1083 맨 앞에 카드 갤러리(암기) — Mustard에서 nunopi 진입 = 카드 갤러리
  disabled?: boolean;
}

export function QASubToggle({ viewMode, onViewModeChange, disabled = false, withCards = false }: QASubToggleProps) {
  const t = useT();
  return (
    <div role="tablist" aria-label={t("nav.qaSub")} className={SEG_WRAP}>
      {(withCards ? [{ value: "memorize" as ViewMode, tKey: "mode.memorize", Icon: IconCards }, ...SUB_OPTIONS] : SUB_OPTIONS).map((opt) => {
        const selected = viewMode === opt.value;
        const { Icon } = opt;
        const label = t(opt.tKey);
        return (
          <button key={opt.value} type="button" role="tab" aria-selected={selected} aria-label={label} title={label} disabled={disabled}
            onClick={() => onViewModeChange(opt.value)}
            className={`flex h-6 items-center justify-center rounded-lg px-6 transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? SEG_ON : SEG_OFF}`}>
            <Icon size={16} stroke={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
